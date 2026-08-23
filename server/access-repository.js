import {randomUUID} from 'node:crypto'
import {generateTemporaryPassword,hashPassword,normalizeEmail,validEmail,validPassword,verifyPassword} from './auth.js'

const roles=new Set(['admin','manager','consultant','technical_reviewer'])
const usageTypes=new Set(['login','page_view','client_updated','memory_saved','visit_saved','visit_report_created','visit_report_confirmed','visit_outcome_recorded','opportunity_saved','val_analysis','val_feedback','val_attachment_uploaded','val_attachment_interpreted','val_attachment_confirmed','val_attachment_stored','val_attachment_rejected','manual_sync','survey_created','survey_integrated','commercial_import'])
const domainError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const safeName=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,120)
const accountFromRow=(row,tenantId)=>({
  id:String(row.id),
  email:normalizeEmail(row.email),
  name:String(row.name||row.email||'Usuário'),
  role:roles.has(row.role)?row.role:'consultant',
  status:String(row.status||'blocked'),
  mustChangePassword:Boolean(row.must_change_password),
  sessionVersion:Number(row.session_version||0),
  expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,
  lastLoginAt:row.last_login_at?new Date(row.last_login_at).toISOString():null,
  createdAt:row.created_at?new Date(row.created_at).toISOString():null,
  tenantId
})

export class AccessRepository{
  constructor({db,tenantId,runtimeConfig}){this.db=db;this.tenantId=tenantId;this.config=runtimeConfig;this.bootstrapPromise=null}

  async ensureBootstrapAdmin(){
    if(!this.db.configured)throw domainError('O PostgreSQL é obrigatório para gerenciar acessos.',503)
    if(this.bootstrapPromise)return this.bootstrapPromise
    this.bootstrapPromise=this.db.transaction(async connection=>{
      const email=normalizeEmail(this.config.adminEmail)
      const current=await connection.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1 FOR UPDATE',[email])
      let row=current.rows[0]
      if(!row){
        const passwordHash=await hashPassword(this.config.adminPassword,{enforcePolicy:false})
        const name=email.split('@')[0].split(/[._-]+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Administrador VALOR 360'
        const inserted=await connection.query(`INSERT INTO users (id,name,email,status,password_hash,must_change_password,session_version,created_at,updated_at) VALUES ($1,$2,$3,'active',$4,false,0,NOW(),NOW()) RETURNING *`,[randomUUID(),name,email,passwordHash])
        row=inserted.rows[0]
      }else if(!row.password_hash){
        const updated=await connection.query(`UPDATE users SET password_hash=$1,status='active',updated_at=NOW() WHERE id=$2 RETURNING *`,[await hashPassword(this.config.adminPassword,{enforcePolicy:false}),row.id])
        row=updated.rows[0]
      }
      await connection.query(`INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,'admin') ON CONFLICT (tenant_id,user_id) DO UPDATE SET role='admin'`,[this.tenantId,row.id])
      await connection.query(`UPDATE clients client SET consultant_id=$2,updated_at=NOW() WHERE client.tenant_id=$1 AND COALESCE(client.source,'')<>'manual-do-agronomo' AND (client.consultant_id IS NULL OR NOT EXISTS (SELECT 1 FROM users owner JOIN memberships membership ON membership.user_id=owner.id AND membership.tenant_id=client.tenant_id WHERE owner.id=client.consultant_id AND owner.password_hash IS NOT NULL))`,[this.tenantId,row.id])
      await connection.query('UPDATE survey_invitations SET owner_user_id=$2 WHERE tenant_id=$1 AND owner_user_id IS NULL',[this.tenantId,row.id])
      await connection.query('UPDATE import_jobs SET owner_user_id=$2 WHERE tenant_id=$1 AND owner_user_id IS NULL',[this.tenantId,row.id])
      await connection.query('UPDATE integration_events SET owner_user_id=$2 WHERE tenant_id=$1 AND owner_user_id IS NULL',[this.tenantId,row.id])
      await connection.query('UPDATE val_recommendations SET consultant_id=$2 WHERE tenant_id=$1 AND consultant_id IS NULL',[this.tenantId,row.id])
      await connection.query(`UPDATE visits visit SET consultant_id=client.consultant_id FROM clients client WHERE visit.tenant_id=$1 AND visit.tenant_id=client.tenant_id AND visit.client_id=client.id AND visit.consultant_id IS NULL`,[this.tenantId])
      return accountFromRow({...row,role:'admin'},this.tenantId)
    }).catch(error=>{this.bootstrapPromise=null;throw error})
    return this.bootstrapPromise
  }

  async authenticate(email,password){
    await this.ensureBootstrapAdmin()
    const normalized=normalizeEmail(email)
    if(!validEmail(normalized)||!password)return null
    const result=await this.db.query(`SELECT user_record.*,membership.role FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE LOWER(user_record.email)=LOWER($2) LIMIT 1`,[this.tenantId,normalized])
    const row=result.rows[0]
    if(!row||row.status!=='active'||(row.expires_at&&new Date(row.expires_at)<=new Date())||!await verifyPassword(password,row.password_hash))return null
    const updated=await this.db.query(`UPDATE users SET last_login_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING last_login_at,updated_at`,[row.id])
    const account=accountFromRow({...row,...updated.rows[0]},this.tenantId)
    await this.recordUsage(account,{eventType:'login',page:'login'})
    return account
  }

  async resolveSession(tokenIdentity){
    if(!tokenIdentity||!this.db.configured)return null
    await this.ensureBootstrapAdmin()
    const byId=/^[0-9a-f-]{36}$/i.test(String(tokenIdentity.sub||''))
    const result=await this.db.query(`SELECT user_record.*,membership.role FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE ${byId?'user_record.id::text=$2':'LOWER(user_record.email)=LOWER($2)'} LIMIT 1`,[this.tenantId,byId?tokenIdentity.sub:tokenIdentity.email])
    const row=result.rows[0]
    if(!row||row.status!=='active'||(row.expires_at&&new Date(row.expires_at)<=new Date())||Number(row.session_version||0)!==Number(tokenIdentity.sessionVersion||0))return null
    return accountFromRow(row,this.tenantId)
  }

  async resolveIntegrationOwner(ownerUserId){
    const bootstrap=await this.ensureBootstrapAdmin()
    if(ownerUserId===undefined||ownerUserId===null||String(ownerUserId).trim()==='')return bootstrap.id
    const id=String(ownerUserId).trim()
    if(!/^[0-9a-f-]{36}$/i.test(id))throw domainError('O proprietário informado pela integração é inválido.',403)
    const result=await this.db.query(`SELECT user_record.id FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE user_record.id=$2 AND user_record.status='active' AND (user_record.expires_at IS NULL OR user_record.expires_at>NOW()) LIMIT 1`,[this.tenantId,id])
    if(!result.rowCount)throw domainError('O login proprietário da integração não está ativo.',403)
    return String(result.rows[0].id)
  }

  async listUsers(actor){
    if(actor?.role!=='admin')throw domainError('Acesso restrito à administração.',403)
    const result=await this.db.query(`SELECT user_record.*,membership.role,COUNT(client.id)::int producer_count FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 LEFT JOIN clients client ON client.tenant_id=membership.tenant_id AND client.consultant_id=user_record.id AND client.status='active' GROUP BY user_record.id,membership.role ORDER BY user_record.created_at DESC`,[this.tenantId])
    return result.rows.map(row=>({...accountFromRow(row,this.tenantId),producerCount:Number(row.producer_count||0)}))
  }

  async recordUsage(actor,input={}){
    const userId=typeof actor==='string'?actor:actor?.id
    const eventType=String(input.eventType||'').trim()
    if(!this.db.configured||!/^[0-9a-f-]{36}$/i.test(String(userId||''))||!usageTypes.has(eventType))return false
    const page=String(input.page||'').trim().replace(/[^a-z0-9_-]/gi,'').slice(0,80)||null
    const entityType=String(input.entityType||'').trim().replace(/[^a-z0-9_-]/gi,'').slice(0,80)||null
    const entityId=String(input.entityId||'').trim().slice(0,180)||null
    const metadata=input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?input.metadata:{}
    try{await this.db.query(`INSERT INTO usage_events (tenant_id,user_id,event_type,page,entity_type,entity_id,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,[this.tenantId,userId,eventType,page,entityType,entityId,JSON.stringify(metadata)]);return true}catch{return false}
  }

  async getAdminMetrics(actor,requestedDays=30){
    if(actor?.role!=='admin')throw domainError('Acesso restrito à administração.',403)
    const days=[7,30,90].includes(Number(requestedDays))?Number(requestedDays):30
    const interval=`${days} days`
    const [usersResult,dailyResult,pagesResult,operationsResult]=await Promise.all([
      this.db.query(`SELECT user_record.id,user_record.name,user_record.email,user_record.status,user_record.last_login_at,user_record.created_at,membership.role,
        (SELECT COUNT(*) FROM clients client WHERE client.tenant_id=$1 AND client.consultant_id=user_record.id AND client.status='active')::int producer_count,
        (SELECT COUNT(*) FROM usage_events event WHERE event.tenant_id=$1 AND event.user_id=user_record.id AND event.event_type='login' AND event.occurred_at>=NOW()-$2::interval)::int accesses,
        (SELECT COUNT(*) FROM usage_events event WHERE event.tenant_id=$1 AND event.user_id=user_record.id AND event.event_type='page_view' AND event.occurred_at>=NOW()-$2::interval)::int page_views,
        (SELECT COUNT(*) FROM usage_events event WHERE event.tenant_id=$1 AND event.user_id=user_record.id AND event.event_type NOT IN ('login','page_view','val_analysis') AND event.occurred_at>=NOW()-$2::interval)::int direct_interactions,
        (SELECT COUNT(*) FROM val_recommendations recommendation WHERE recommendation.tenant_id=$1 AND recommendation.consultant_id=user_record.id AND recommendation.created_at>=NOW()-$2::interval)::int val_analyses,
        (SELECT COUNT(*) FROM visits visit WHERE visit.tenant_id=$1 AND visit.consultant_id=user_record.id AND visit.created_at>=NOW()-$2::interval)::int visits,
        (SELECT COUNT(*) FROM opportunities opportunity JOIN clients client ON client.id=opportunity.client_id AND client.tenant_id=opportunity.tenant_id WHERE opportunity.tenant_id=$1 AND client.consultant_id=user_record.id AND opportunity.updated_at>=NOW()-$2::interval)::int opportunities,
        (SELECT MAX(event.occurred_at) FROM usage_events event WHERE event.tenant_id=$1 AND event.user_id=user_record.id) last_activity_at
        FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1
        ORDER BY COALESCE(user_record.last_login_at,user_record.created_at) DESC`,[this.tenantId,interval]),
      this.db.query(`WITH date_series AS (SELECT GENERATE_SERIES(CURRENT_DATE-($2::int-1),CURRENT_DATE,'1 day')::date AS event_day),
        usage AS (SELECT occurred_at::date AS event_day,COUNT(*) FILTER (WHERE event_type='login')::int accesses,COUNT(*) FILTER (WHERE event_type='page_view')::int page_views,COUNT(*) FILTER (WHERE event_type NOT IN ('login','page_view','val_analysis'))::int interactions FROM usage_events WHERE tenant_id=$1 AND occurred_at>=CURRENT_DATE-($2::int-1) GROUP BY occurred_at::date),
        analyses AS (SELECT created_at::date AS event_day,COUNT(*)::int val_analyses FROM val_recommendations WHERE tenant_id=$1 AND created_at>=CURRENT_DATE-($2::int-1) GROUP BY created_at::date)
        SELECT TO_CHAR(date_series.event_day,'YYYY-MM-DD') AS day_key,COALESCE(usage.accesses,0)::int accesses,COALESCE(usage.page_views,0)::int page_views,COALESCE(usage.interactions,0)::int interactions,COALESCE(analyses.val_analyses,0)::int val_analyses
        FROM date_series LEFT JOIN usage USING(event_day) LEFT JOIN analyses USING(event_day) ORDER BY date_series.event_day`,[this.tenantId,days]),
      this.db.query(`SELECT page,COUNT(*)::int views,COUNT(DISTINCT user_id)::int users FROM usage_events WHERE tenant_id=$1 AND event_type='page_view' AND occurred_at>=NOW()-$2::interval AND page IS NOT NULL GROUP BY page ORDER BY views DESC LIMIT 12`,[this.tenantId,interval]),
      this.db.query(`SELECT
        (SELECT COUNT(*) FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1)::int users_total,
        (SELECT COUNT(*) FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE user_record.status='active')::int users_active,
        (SELECT COUNT(*) FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE user_record.status='blocked')::int users_blocked,
        (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE tenant_id=$1 AND occurred_at>=NOW()-$2::interval)::int active_users_period,
        (SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND status='active')::int producers,
        (SELECT COUNT(*) FROM visits WHERE tenant_id=$1 AND created_at>=NOW()-$2::interval)::int visits,
        (SELECT COUNT(*) FROM opportunities WHERE tenant_id=$1 AND updated_at>=NOW()-$2::interval)::int opportunities,
        (SELECT COUNT(*) FROM val_recommendations WHERE tenant_id=$1 AND created_at>=NOW()-$2::interval)::int val_analyses,
        (SELECT COUNT(*) FROM val_feedback WHERE tenant_id=$1 AND created_at>=NOW()-$2::interval)::int val_feedback,
        (SELECT COUNT(*) FROM integration_events WHERE tenant_id=$1 AND source='manual-do-agronomo' AND occurred_at>=NOW()-$2::interval)::int manual_syncs,
        (SELECT COUNT(*) FROM usage_events WHERE tenant_id=$1 AND event_type='login' AND occurred_at>=NOW()-$2::interval)::int accesses,
        (SELECT COUNT(*) FROM usage_events WHERE tenant_id=$1 AND event_type='page_view' AND occurred_at>=NOW()-$2::interval)::int page_views,
        (SELECT COUNT(*) FROM usage_events WHERE tenant_id=$1 AND event_type NOT IN ('login','page_view','val_analysis') AND occurred_at>=NOW()-$2::interval)::int direct_interactions`,[this.tenantId,interval])
    ])
    const users=usersResult.rows.map(row=>({...accountFromRow(row,this.tenantId),producerCount:Number(row.producer_count||0),accesses:Number(row.accesses||0),pageViews:Number(row.page_views||0),directInteractions:Number(row.direct_interactions||0),valAnalyses:Number(row.val_analyses||0),visits:Number(row.visits||0),opportunities:Number(row.opportunities||0),lastActivityAt:row.last_activity_at?new Date(row.last_activity_at).toISOString():null}))
    const operations=operationsResult.rows[0]||{}
    return {generatedAt:new Date().toISOString(),periodDays:days,summary:Object.fromEntries(Object.entries(operations).map(([key,value])=>[key,Number(value||0)])),daily:dailyResult.rows.map(row=>({day:row.day_key,accesses:Number(row.accesses||0),pageViews:Number(row.page_views||0),interactions:Number(row.interactions||0),valAnalyses:Number(row.val_analyses||0)})),pages:pagesResult.rows.map(row=>({page:row.page,views:Number(row.views||0),users:Number(row.users||0)})),users}
  }

  async createUser(actor,input){
    if(actor?.role!=='admin')throw domainError('Acesso restrito à administração.',403)
    const name=safeName(input.name);const email=normalizeEmail(input.email);const role=roles.has(input.role)&&input.role!=='admin'?input.role:'consultant'
    if(!name||!validEmail(email))throw domainError('Informe nome e e-mail válidos.')
    const temporaryPassword=generateTemporaryPassword();const passwordHash=await hashPassword(temporaryPassword);const id=randomUUID()
    try{
      const row=await this.db.transaction(async connection=>{
        const inserted=await connection.query(`INSERT INTO users (id,name,email,status,password_hash,must_change_password,session_version,created_at,updated_at) VALUES ($1,$2,$3,'active',$4,true,0,NOW(),NOW()) RETURNING *`,[id,name,email,passwordHash])
        await connection.query(`INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,$3)`,[this.tenantId,id,role])
        await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,after_data,created_at) VALUES ($1,$2,'access_created','user',$3,$4,NOW())`,[this.tenantId,actor.id,id,JSON.stringify({name,email,role})])
        return inserted.rows[0]
      })
      return {user:accountFromRow({...row,role},this.tenantId),temporaryPassword}
    }catch(error){if(/unique|duplicate/i.test(String(error.message)))throw domainError('Este e-mail já possui acesso.',409);throw error}
  }

  async updateUser(actor,input){
    if(actor?.role!=='admin')throw domainError('Acesso restrito à administração.',403)
    const id=String(input.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw domainError('Usuário inválido.')
    const current=await this.db.query(`SELECT user_record.*,membership.role FROM users user_record JOIN memberships membership ON membership.user_id=user_record.id AND membership.tenant_id=$1 WHERE user_record.id=$2 LIMIT 1`,[this.tenantId,id])
    if(!current.rowCount)throw domainError('Usuário não encontrado.',404)
    const previous=current.rows[0];const name=input.name===undefined?previous.name:safeName(input.name);const email=input.email===undefined?previous.email:normalizeEmail(input.email);const role=input.role===undefined?previous.role:String(input.role);const status=input.status===undefined?previous.status:String(input.status)
    if(!name||!validEmail(email)||!roles.has(role)||!['active','blocked'].includes(status))throw domainError('Os dados do acesso são inválidos.')
    if(id===actor.id&&(status==='blocked'||role!=='admin'))throw domainError('O administrador atual não pode bloquear ou rebaixar o próprio acesso.')
    const bump=previous.email!==email||previous.status!==status||previous.role!==role
    try{
      const result=await this.db.transaction(async connection=>{
        const updated=await connection.query(`UPDATE users SET name=$1,email=$2,status=$3,session_version=session_version+$4,updated_at=NOW() WHERE id=$5 RETURNING *`,[name,email,status,bump?1:0,id])
        await connection.query(`UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2`,[this.tenantId,id,role])
        await connection.query(`INSERT INTO audit_events (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES ($1,$2,'access_updated','user',$3,$4,$5,NOW())`,[this.tenantId,actor.id,id,JSON.stringify({name:previous.name,email:previous.email,role:previous.role,status:previous.status}),JSON.stringify({name,email,role,status})])
        return updated.rows[0]
      })
      return accountFromRow({...result,role},this.tenantId)
    }catch(error){if(/unique|duplicate/i.test(String(error.message)))throw domainError('Este e-mail já possui acesso.',409);throw error}
  }

  async resetPassword(actor,userId){
    if(actor?.role!=='admin')throw domainError('Acesso restrito à administração.',403)
    const id=String(userId||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw domainError('Usuário inválido.')
    if(id===String(actor.id))throw domainError('Use a troca de senha da própria conta para alterar o acesso administrativo.',400)
    const temporaryPassword=generateTemporaryPassword();const result=await this.db.query(`UPDATE users SET password_hash=$1,must_change_password=true,session_version=session_version+1,updated_at=NOW() WHERE id=$2 AND EXISTS (SELECT 1 FROM memberships WHERE tenant_id=$3 AND user_id=users.id) RETURNING *`,[await hashPassword(temporaryPassword),id,this.tenantId])
    if(!result.rowCount)throw domainError('Usuário não encontrado.',404)
    const membership=await this.db.query(`SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2`,[this.tenantId,id])
    return {user:accountFromRow({...result.rows[0],role:membership.rows[0]?.role},this.tenantId),temporaryPassword}
  }

  async changePassword(actor,currentPassword,newPassword){
    if(!actor?.id)throw domainError('Sessão expirada.',401)
    if(!validPassword(newPassword))throw domainError('A nova senha precisa ter de 8 a 72 caracteres, com maiúscula, minúscula e número.')
    const current=await this.db.query(`SELECT password_hash FROM users WHERE id=$1 LIMIT 1`,[actor.id])
    if(!current.rowCount||!await verifyPassword(currentPassword,current.rows[0].password_hash))throw domainError('A senha atual não confere.')
    const updated=await this.db.query(`UPDATE users SET password_hash=$1,must_change_password=false,session_version=session_version+1,updated_at=NOW() WHERE id=$2 RETURNING *`,[await hashPassword(newPassword),actor.id])
    return accountFromRow({...updated.rows[0],role:actor.role},this.tenantId)
  }
}
