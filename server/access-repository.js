import {randomUUID} from 'node:crypto'
import {generateTemporaryPassword,hashPassword,normalizeEmail,validEmail,validPassword,verifyPassword} from './auth.js'

const roles=new Set(['admin','manager','consultant','technical_reviewer'])
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
    return accountFromRow({...row,...updated.rows[0]},this.tenantId)
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
