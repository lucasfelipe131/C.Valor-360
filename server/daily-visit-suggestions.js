import {readRouteProperties} from './route-properties.js'
import {proposeRouteOrder} from '../src/lib/visit-route.js'
import {dailyVisitSuggestions,narrativeFollowups} from '../src/lib/daily-visit-suggestions.js'
export async function readDailyVisitSuggestions(repository,ownerId,{now=new Date(),timeZone='America/Sao_Paulo'}={}){
 if(!ownerId||!repository.db.configured)throw Object.assign(new Error('Não foi possível consultar os compromissos da carteira.'),{statusCode:503})
 const {rows}=await repository.db.query(`
 SELECT c.external_key AS client_key,c.id AS client_id,c.name AS client_name,
  k.id::text AS source_id,k.description,k.due_at,k.status,k.updated_at
 FROM val_commitments k JOIN clients c ON c.tenant_id=k.tenant_id AND c.id=k.client_id
 WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active'
 UNION ALL
 SELECT c.external_key,c.id,c.name,'visit:'||v.id::text,v.next_commitment,v.next_action_at,'OPEN',v.updated_at
 FROM visits v JOIN clients c ON c.tenant_id=v.tenant_id AND c.id=v.client_id
 WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active' AND NULLIF(trim(v.next_commitment),'') IS NOT NULL
  AND COALESCE(v.status,'') NOT ILIKE '%cancel%'
  AND NOT EXISTS(SELECT 1 FROM val_commitments k WHERE k.tenant_id=v.tenant_id AND k.visit_id=v.id)
 ORDER BY updated_at DESC LIMIT 3000`,[repository.tenantId,ownerId])
 const records=rows.map(row=>({clientId:String(row.client_key||row.client_id),clientName:row.client_name,sourceId:row.source_id,description:row.description,dueAt:row.due_at,status:row.status,updatedAt:row.updated_at}))
 const interactions=await repository.db.query(`SELECT i.id,i.summary,i.commitments,i.occurred_at,c.id client_id,c.external_key client_key,c.name client_name
  FROM interactions i JOIN clients c ON c.tenant_id=i.tenant_id AND c.id=i.client_id
  WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.status='active'
  AND NOT EXISTS(SELECT 1 FROM val_commitments k WHERE k.tenant_id=i.tenant_id AND k.client_id=i.client_id AND k.source_ref IN(i.id::text,'interaction:'||i.id::text))
  ORDER BY i.occurred_at DESC LIMIT 1500`,[repository.tenantId,ownerId])
 for(const row of interactions.rows){
  const base={clientId:String(row.client_key||row.client_id),clientName:row.client_name,sourceId:`interaction:${row.id}`,updatedAt:row.occurred_at}
  const commitments=Array.isArray(row.commitments)?row.commitments:[]
  if(commitments.length)records.push(...commitments.map((item,index)=>({...base,sourceId:`${base.sourceId}:${index}`,description:typeof item==='string'?item:item.description||item.text||'',dueAt:item.due_at||item.dueAt||null,status:item.status||'PROPOSED'})))
  else records.push(...narrativeFollowups({...base,summary:row.summary}))
 }
 const portfolio=await readRouteProperties(repository,ownerId)
 const suggestions=dailyVisitSuggestions({records,now,timeZone}).map(item=>{
  const matches=portfolio.properties.filter(property=>String(property.clientId)===String(item.clientId))
  // Several properties require an explicit choice; never guess the destination.
  const property=matches.length===1?matches[0]:null
  return {...item,propertyId:property?.id||null,location:property?.location||null}
 })
 const ordered=['DUE_TODAY','OVERDUE','SUGGESTED'].flatMap(kind=>{
  const group=suggestions.filter(item=>item.classification===kind)
  const ids=proposeRouteOrder(group.map(item=>({...item,visitId:item.id,lifecycle:'PLANNED',timeFlexible:true})))
  return ids.map(id=>group.find(item=>item.id===id))
 })
 return {generatedAt:now.toISOString(),timeZone,suggestions:ordered,limitations:['Ordem por prioridade e proximidade aproximada quando a propriedade é inequívoca; estradas, disponibilidade e tempo de deslocamento não confirmados.'],truncated:rows.length===3000||interactions.rows.length===1500}
}
