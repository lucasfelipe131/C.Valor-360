import {managementRoles} from './management-access.js'
import {managementVisitStatus,recordedTravel,summarizeManagement} from '../src/lib/management-data.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode,exposeMessage:true})}
const iso=value=>value?new Date(value).toISOString():null
const number=value=>value==null||value===''?null:Number.isFinite(Number(value))?Number(value):null
const MAX_ROWS=5000
const realClient=`COALESCE(c.source,'') NOT LIKE 'val-demo-%'
 AND COALESCE(c.commercial_profile->>'isDemo','false')<>'true'
 AND COALESCE(c.commercial_profile->>'synthetic','false')<>'true'`

export function managementFilters(input={}){
 if(Object.keys(input).some(key=>!['start','end','consultantId','municipality','status'].includes(key)))fail('Filtro gerencial inválido.')
 const date=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Informe um período válido.')
  return value
 }
 const start=date(input.start),end=date(input.end)
 if(end<start||(Date.parse(end)-Date.parse(start))/86400000>365)fail('Selecione um período de até 366 dias.')
 const consultantId=input.consultantId||null
 if(consultantId&&!uuid.test(consultantId))fail('Consultor inválido.')
 const municipality=String(input.municipality||'').trim()
 if(municipality.length>140)fail('Município inválido.')
 const status=input.status||''
 if(status&&!['PLANNED','PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'].includes(status))fail('Situação de visita inválida.')
 return {start,end,consultantId,municipality,status}
}

export function createManagementService({db,tenantId}){
 function check(actor,admin=false){
  if(!actor?.id||actor.tenantId!==tenantId||!managementRoles.has(actor.role)||(admin&&actor.role!=='admin')||actor.demo)fail('Acesso gerencial não permitido.',403)
  if(!db?.configured)fail('A consulta gerencial está indisponível. Tente novamente.',503)
 }
 async function authorize(connection,actor,admin=false){
  check(actor,admin)
  const {rows}=await connection.query(`SELECT m.role,um.unit_id,u.name AS unit_name
   FROM memberships m JOIN users account ON account.id=m.user_id
   LEFT JOIN val_management_memberships um ON um.tenant_id=m.tenant_id AND um.user_id=m.user_id
   LEFT JOIN val_management_units u ON u.tenant_id=um.tenant_id AND u.id=um.unit_id
   WHERE m.tenant_id=$1 AND m.user_id=$2 AND account.status='active'
    AND (account.expires_at IS NULL OR account.expires_at>NOW())`,[tenantId,actor.id])
  const access=rows[0]
  if(!access||!managementRoles.has(access.role)||(admin&&access.role!=='admin'))fail('Acesso gerencial não permitido.',403)
  return access
 }
 async function units(actor){
  check(actor,true)
  return db.transaction(async connection=>{
   await authorize(connection,actor,true)
   const units=await connection.query('SELECT id,name FROM val_management_units WHERE tenant_id=$1 ORDER BY name',[tenantId])
   const members=await connection.query(`SELECT a.id,a.name,a.email,m.role,a.status,um.unit_id AS "unitId"
    FROM memberships m JOIN users a ON a.id=m.user_id
    LEFT JOIN val_management_memberships um ON um.tenant_id=m.tenant_id AND um.user_id=m.user_id
    WHERE m.tenant_id=$1 ORDER BY a.name`,[tenantId])
   return {units:units.rows,members:members.rows}
  })
 }
 async function createUnit(actor,input={}){
  check(actor,true)
  const name=String(input.name||'').trim().replace(/\s+/g,' ')
  if(!name||name.length>120)fail('Informe um nome de unidade com até 120 caracteres.')
  try{return await db.transaction(async connection=>{
   await authorize(connection,actor,true)
   const {rows}=await connection.query('INSERT INTO val_management_units (tenant_id,name) VALUES ($1,$2) RETURNING id,name',[tenantId,name])
   await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES ($1,$2,'management_unit_created','management_unit',$3,$4)`,[tenantId,actor.id,rows[0].id,JSON.stringify({name})])
   return {unit:rows[0]}
  })}catch(error){if(error.code==='23505')fail('Já existe uma unidade com esse nome.',409);throw error}
 }
 async function assignUnit(actor,input={}){
  check(actor,true)
  if(!uuid.test(input.userId||'')||(input.unitId!==null&&!uuid.test(input.unitId||'')))fail('Selecione o usuário e a unidade.')
  return db.transaction(async connection=>{
   await authorize(connection,actor,true)
   const member=await connection.query('SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',[tenantId,input.userId])
   if(!member.rows.length)fail('Usuário não encontrado nesta organização.',404)
   if(input.unitId){
    const unit=await connection.query('SELECT id FROM val_management_units WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE',[tenantId,input.unitId])
    if(!unit.rows.length)fail('Unidade não encontrada nesta organização.',404)
   }
   const before=await connection.query('SELECT unit_id FROM val_management_memberships WHERE tenant_id=$1 AND user_id=$2',[tenantId,input.userId])
   if(input.unitId)await connection.query(`INSERT INTO val_management_memberships (tenant_id,user_id,unit_id) VALUES ($1,$2,$3)
    ON CONFLICT (tenant_id,user_id) DO UPDATE SET unit_id=EXCLUDED.unit_id,updated_at=NOW()`,[tenantId,input.userId,input.unitId])
   else await connection.query('DELETE FROM val_management_memberships WHERE tenant_id=$1 AND user_id=$2',[tenantId,input.userId])
   await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data) VALUES ($1,$2,'management_unit_assigned','user',$3,$4,$5)`,[tenantId,actor.id,input.userId,JSON.stringify({unitId:before.rows[0]?.unit_id||null}),JSON.stringify({unitId:input.unitId})])
   return {saved:true}
  })
 }
 async function overview(actor,input){
  check(actor)
  const filters=managementFilters(input)
  return db.transaction(async connection=>{
   // All facts and authorization come from the same consistent database snapshot.
   await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
   const access=await authorize(connection,actor)
   if(!access.unit_id)return {configured:false,reason:'UNIT_NOT_ASSIGNED',filters}
   const team=await connection.query(`SELECT a.id,a.name FROM val_management_memberships um
    JOIN users a ON a.id=um.user_id WHERE um.tenant_id=$1 AND um.unit_id=$2 ORDER BY a.name`,[tenantId,access.unit_id])
   if(filters.consultantId&&!team.rows.some(member=>member.id===filters.consultantId))fail('Consultor não disponível na sua unidade.',403)
   const owners=filters.consultantId?[filters.consultantId]:team.rows.map(member=>member.id)
   const params=[tenantId,owners,filters.start,filters.end,filters.municipality]
   const producerRows=await connection.query(`SELECT c.id,c.name,c.consultant_id,c.municipality,c.total_area_ha,c.cultures,c.updated_at
    FROM clients c WHERE c.tenant_id=$1 AND c.consultant_id=ANY($2::uuid[]) AND c.status='active'
    AND ($5::text='' OR c.municipality=$5) AND ${realClient}
    AND $3::date<=$4::date ORDER BY c.name,c.id LIMIT ${MAX_ROWS+1}`,params)
   const visitRows=await connection.query(`SELECT v.id,v.client_id,v.consultant_id,v.scheduled_at,v.occurred_at,v.completed_at,v.objective,v.status,v.lifecycle_status,
     r.id AS report_id,r.summary AS report_summary,r.consultant_notes AS report_notes,r.confirmed_at AS report_confirmed_at
    FROM visits v JOIN clients c ON c.tenant_id=v.tenant_id AND c.id=v.client_id
    LEFT JOIN LATERAL (SELECT report.id,report.summary,report.consultant_notes,report.confirmed_at
     FROM val_visit_reports report WHERE report.tenant_id=v.tenant_id AND report.visit_id=v.id
      AND report.client_id=v.client_id AND report.created_by=v.consultant_id
      AND report.confirmation_status='CONFIRMED' AND report.confirmed_at IS NOT NULL
     ORDER BY report.confirmed_at DESC,report.id DESC LIMIT 1) r ON TRUE
    WHERE v.tenant_id=$1 AND v.consultant_id=ANY($2::uuid[]) AND c.consultant_id=ANY($2::uuid[])
    AND c.status='active' AND ($5::text='' OR c.municipality=$5) AND ${realClient}
    AND COALESCE(v.occurred_at,v.completed_at,v.scheduled_at)>=($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND COALESCE(v.occurred_at,v.completed_at,v.scheduled_at)<(($4::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    ORDER BY COALESCE(v.occurred_at,v.completed_at,v.scheduled_at) DESC,v.id LIMIT ${MAX_ROWS+1}`,params)
   const routeRows=await connection.query(`SELECT owner_id,route_date::text AS route_date,trace,time_zone FROM val_visit_routes
    WHERE tenant_id=$1 AND owner_id=ANY($2::uuid[]) AND route_date BETWEEN $3::date AND $4::date
    ORDER BY route_date DESC,owner_id LIMIT ${MAX_ROWS+1}`,params.slice(0,4))
   if([producerRows,visitRows,routeRows].some(result=>result.rows.length>MAX_ROWS))fail('O resultado excede 5.000 registros. Reduza o período ou selecione um consultor.',422)
   const producers=producerRows.rows.map(row=>({id:row.id,name:row.name,consultantId:row.consultant_id,municipality:row.municipality||null,areaHa:number(row.total_area_ha),cultures:row.cultures||null,updatedAt:iso(row.updated_at),dataStatus:'REAL DATA'}))
   const visits=visitRows.rows.map(row=>({id:row.id,clientId:row.client_id,consultantId:row.consultant_id,scheduledAt:iso(row.scheduled_at),occurredAt:iso(row.occurred_at||row.completed_at),objective:row.objective||null,lifecycleStatus:managementVisitStatus(row),dataStatus:'REAL DATA',report:row.report_id?{id:row.report_id,summary:row.report_summary,notes:row.report_notes||null,confirmedAt:iso(row.report_confirmed_at),dataStatus:'REAL DATA'}:null})).filter(visit=>!filters.status||visit.lifecycleStatus===filters.status)
   const routes=routeRows.rows.map(row=>({consultantId:row.owner_id,date:row.route_date,timeZone:row.time_zone,...recordedTravel(row.trace)}))
   return {configured:true,unit:{id:access.unit_id,name:access.unit_name},filters,team:team.rows,producers,visits,routes,
    summary:summarizeManagement({producers,visits,routes}),generatedAt:new Date().toISOString(),timeZone:'America/Sao_Paulo',
    travelScope:'period_and_consultant',portfolioScope:'current_unit',demoExcluded:true}
  })
 }
 return {units,createUnit,assignUnit,overview}
}
