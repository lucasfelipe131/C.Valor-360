import {buildPortfolioRadar} from './portfolio-radar.js'
import {DECISION_FLAGS,SCORING_POLICIES,decisionRegistries,stagingDecisionDefaults,hashDecision} from './decision-governance.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode})}
const note=value=>String(value||'').trim().slice(0,1000)
export class DecisionService{
 constructor({db,repository,tenantId,environment,config={}}){Object.assign(this,{db,repository,tenantId,environment,registry:decisionRegistries(config)})}
 async authorize(actor,connection=this.db,{admin=false}={}){
  if(!this.db.configured)fail('decision_database_required',503)
  if(!uuid.test(String(actor?.id))||actor.tenantId!==this.tenantId||actor.demo||actor.role==='bi_viewer')fail('decision_access_denied',403)
  const row=(await connection.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND u.status='active' AND (u.expires_at IS NULL OR u.expires_at>NOW())`,[this.tenantId,actor.id])).rows[0]
  if(!row||row.role!==actor.role||(admin&&row.role!=='admin')||row.role==='bi_viewer')fail('decision_access_denied',403)
 }
 async settings(connection=this.db){
  const row=(await connection.query('SELECT * FROM val_decision_settings WHERE tenant_id=$1',[this.tenantId])).rows[0]
  if(row)return {...row,runtime_registry_drift:hashDecision(row.registry)!==hashDecision(this.registry)}
  return {revision:0,flags:stagingDecisionDefaults(this.environment),policy_version:'val.decision-scoring.v1',registry:this.registry,runtime_registry_drift:false}
 }
 async registryView(actor){await this.authorize(actor);const state=await this.settings();return {...state,history:(await this.db.query('SELECT revision,policy_version,reason,created_at FROM val_decision_settings_history WHERE tenant_id=$1 ORDER BY revision DESC LIMIT 50',[this.tenantId])).rows,environment:this.environment||'unclassified',mutable:actor.role==='admin'&&['staging','test','development'].includes(this.environment)}}
 async configure(actor,input){
  if(!['staging','test','development'].includes(this.environment))fail('decision_staging_only',403)
  return this.db.transaction(async connection=>{
   await this.authorize(actor,connection,{admin:true})
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`decision-settings:${this.tenantId}`])
   const previous=await this.settings(connection)
   if(input.expectedRevision!==previous.revision)fail('decision_settings_changed',409)
   if(!note(input.reason))fail('decision_change_reason_required')
   if(previous.revision===0)await connection.query('INSERT INTO val_decision_settings_history(tenant_id,revision,flags,policy_version,registry,reason,actor_id) VALUES($1,0,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[this.tenantId,JSON.stringify(previous.flags),previous.policy_version,JSON.stringify(previous.registry),'Initial staging defaults',actor.id])
   let target=previous
   if(input.rollbackRevision!==undefined){
    if(!Number.isInteger(input.rollbackRevision)||input.rollbackRevision<0)fail('decision_rollback_invalid')
    target=(await connection.query('SELECT * FROM val_decision_settings_history WHERE tenant_id=$1 AND revision=$2',[this.tenantId,input.rollbackRevision])).rows[0]
    if(!target)fail('decision_rollback_not_found',404)
   }
   const flags=input.rollbackRevision!==undefined?target.flags:{...previous.flags,...input.flags}
   if(Object.keys(flags).some(key=>!DECISION_FLAGS.includes(key)||typeof flags[key]!=='boolean'))fail('decision_flags_invalid')
   const policy=input.rollbackRevision!==undefined?target.policy_version:input.policyVersion||previous.policy_version
   if(!SCORING_POLICIES[policy])fail('decision_policy_unknown')
   const revision=previous.revision+1,registry=target.registry
   await connection.query(`INSERT INTO val_decision_settings(tenant_id,revision,flags,policy_version,registry,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id) DO UPDATE SET revision=$2,flags=$3,policy_version=$4,registry=$5,updated_by=$6,updated_at=now()`,[this.tenantId,revision,JSON.stringify(flags),policy,JSON.stringify(registry),actor.id])
   await connection.query('INSERT INTO val_decision_settings_history(tenant_id,revision,flags,policy_version,registry,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.tenantId,revision,JSON.stringify(flags),policy,JSON.stringify(registry),note(input.reason),actor.id])
   await connection.query(`INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data) VALUES($1::uuid,$2,$3,'decision_settings',($1::uuid)::text,$4,$5)`,[this.tenantId,actor.id,input.rollbackRevision!==undefined?'decision_policy_rollback':'decision_policy_changed',JSON.stringify({revision:previous.revision,flags:previous.flags,policy:previous.policy_version}),JSON.stringify({revision,flags,policy,reason:note(input.reason),rollbackRevision:input.rollbackRevision??null})])
   return {revision,flags,policy_version:policy,rollback_version:previous.revision}
  })
 }
 async audit(connection,actor,row,action,metadata={}){await connection.query('INSERT INTO val_decision_audit(tenant_id,owner_id,card_id,action,policy_version,metadata,actor_id) VALUES($1,$2,$3,$4,$5,$6,$2)',[this.tenantId,actor.id,row.id,action,row.policy_version,JSON.stringify(metadata)])}
 async generate(actor,{clientId=null,now=Date.now()}={}){
  return this.db.transaction(async connection=>{
   await this.authorize(actor,connection)
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`decisions:${this.tenantId}:${actor.id}`])
   const settings=await this.settings(connection)
   if(!settings.flags.nba_v1)return {enabled:false,flags:settings.flags,cards:[],items:[],reason:'CAPABILITY_DISABLED'}
   const contexts=await this.repository.getDecisionContexts(actor.id,clientId,connection,now)
   const radar=buildPortfolioRadar(contexts,{now,version:'v2',policy:SCORING_POLICIES[settings.policy_version]})
   const cards=[]
   for(const card of radar.cards){
    const context=contexts.find(c=>c.client.id===card.producer_id),canonical=context.canonicalClientId
    const client=(await connection.query("SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3 AND status='active' FOR SHARE",[this.tenantId,actor.id,canonical])).rows[0]
    if(!client)fail('decision_client_scope_changed',409)
    const prior=(await connection.query('SELECT * FROM val_decision_cards WHERE tenant_id=$1 AND owner_id=$2 AND client_id=$3 ORDER BY version DESC LIMIT 1',[this.tenantId,actor.id,canonical])).rows[0]
    // Individual pages do not invent a new portfolio rank or alter portfolio priority.
    if(clientId)card.rank=prior?.card?.rank??null
    const fingerprint=hashDecision([card.decision_fingerprint,card.rank,settings.revision])
    let row=prior
    if(!prior||prior.fingerprint!==fingerprint){
     card.priority_change=prior?{previous_score:prior.card.priority_score,current_score:card.priority_score,delta:card.priority_score-prior.card.priority_score,previous_rank:prior.card.rank,current_rank:card.rank,reason:prior.card.evidence_fingerprint!==card.evidence_fingerprint?'EVIDENCE_CHANGED':prior.policy_version!==card.policy_version?'POLICY_CHANGED':'TIME_OR_RANK_CHANGED',previous_version:prior.version}:null
     row=(await connection.query('INSERT INTO val_decision_cards(tenant_id,owner_id,client_id,version,fingerprint,policy_version,card) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[this.tenantId,actor.id,canonical,(prior?.version||0)+1,fingerprint,card.policy_version,JSON.stringify(card)])).rows[0]
     await this.audit(connection,actor,row,'decision_generated',{version:row.version,evidence_count:card.evidence.length,context_snapshot_ref:card.context_snapshot_ref})
     if(prior&&prior.card.evidence_fingerprint!==card.evidence_fingerprint)await this.audit(connection,actor,row,'evidence_changed',{previous_card_id:prior.id})
     if(prior&&(prior.card.priority_score!==card.priority_score||prior.card.rank!==card.rank))await this.audit(connection,actor,row,'priority_changed',{previous_card_id:prior.id,...card.priority_change})
     if(card.review_reasons.length){await connection.query('INSERT INTO val_decision_reviews(tenant_id,owner_id,card_id,reasons) VALUES($1,$2,$3,$4)',[this.tenantId,actor.id,row.id,JSON.stringify(card.review_reasons)]);await this.audit(connection,actor,row,'review_requested',{reasons:card.review_reasons})}
    }
    cards.push({...row.card,id:row.id,revision:row.version,generated_at:row.card.generated_at})
   }
   return {...radar,enabled:true,flags:settings.flags,settings_revision:settings.revision,cards:settings.flags.decision_cards?cards:[],items:settings.flags.portfolio_radar_v2&&settings.flags.decision_cards?cards.filter(c=>c.eligible).slice(0,5):[],legacyRadar:settings.flags.portfolio_radar_v2?null:buildPortfolioRadar(contexts,{now}),metrics:decisionMetrics(cards),registry_drift:settings.runtime_registry_drift}
  })
 }
 async ownedCard(actor,id,connection=this.db){
  if(!uuid.test(String(id)))fail('decision_not_found',404)
  const row=(await connection.query(`SELECT d.* FROM val_decision_cards d JOIN clients c ON c.tenant_id=d.tenant_id AND c.id=d.client_id AND c.consultant_id=d.owner_id AND c.status='active' WHERE d.tenant_id=$1 AND d.owner_id=$2 AND d.id=$3`,[this.tenantId,actor.id,id])).rows[0]
  if(!row)fail('decision_not_found',404);return row
 }
 async detail(actor,id){await this.authorize(actor);const row=await this.ownedCard(actor,id);const args=[this.tenantId,actor.id,id];return {card:{...row.card,id:row.id,revision:row.version},audit:(await this.db.query('SELECT action,policy_version,metadata,created_at FROM val_decision_audit WHERE tenant_id=$1 AND owner_id=$2 AND card_id=$3 ORDER BY id',args)).rows,reviews:(await this.db.query('SELECT id,reasons,status,resolution,resolved_at FROM val_decision_reviews WHERE tenant_id=$1 AND owner_id=$2 AND card_id=$3',args)).rows,feedback:(await this.db.query('SELECT feedback,note,created_at FROM val_decision_feedback WHERE tenant_id=$1 AND owner_id=$2 AND card_id=$3 ORDER BY created_at',args)).rows}}
 async feedback(actor,id,input){return this.db.transaction(async connection=>{
  await this.authorize(actor,connection);const row=await this.ownedCard(actor,id,connection)
  if(!uuid.test(String(input.requestId))||!['USEFUL','NOT_USEFUL','ACTION_SELECTED','ACTION_EXECUTED','ACTION_ADAPTED','ACTION_DISMISSED'].includes(input.feedback))fail('decision_feedback_invalid')
  const inserted=await connection.query('INSERT INTO val_decision_feedback(tenant_id,owner_id,card_id,request_id,feedback,note,actor_id) VALUES($1,$2,$3,$4,$5,$6,$2) ON CONFLICT(tenant_id,owner_id,request_id) DO NOTHING RETURNING id',[this.tenantId,actor.id,id,input.requestId,input.feedback,note(input.note)])
  if(!inserted.rows.length){const old=(await connection.query('SELECT card_id,feedback,note FROM val_decision_feedback WHERE tenant_id=$1 AND owner_id=$2 AND request_id=$3',[this.tenantId,actor.id,input.requestId])).rows[0];if(old.card_id!==id||old.feedback!==input.feedback||old.note!==note(input.note))fail('decision_feedback_replay_conflict',409);return {saved:true,duplicate:true}}
  await this.audit(connection,actor,row,input.feedback==='ACTION_DISMISSED'?'action_dismissed':input.feedback==='ACTION_SELECTED'?'action_selected':'feedback_recorded',{feedback:input.feedback,elapsed_ms:Math.max(0,Date.now()-new Date(row.generated_at).getTime()),self_reported:true})
  return {saved:true,automaticCrmWrite:false}
 })}
 async review(actor,id,input){return this.db.transaction(async connection=>{
  await this.authorize(actor,connection);const row=await this.ownedCard(actor,id,connection)
  if(!['APPROVED','REJECTED','RESOLVED'].includes(input.status)||!note(input.reason))fail('decision_review_resolution_required')
  const changed=await connection.query("UPDATE val_decision_reviews SET status=$4,resolution=$5,resolved_by=$2,resolved_at=now() WHERE tenant_id=$1 AND owner_id=$2 AND card_id=$3 AND status='PENDING' RETURNING id",[this.tenantId,actor.id,id,input.status,note(input.reason)])
  if(!changed.rows.length)fail('decision_review_already_resolved',409)
  await this.audit(connection,actor,row,'review_resolved',{status:input.status,reason:note(input.reason),changesCanonicalEvidence:false})
  return {saved:true,status:input.status,canonicalEvidenceUnchanged:true}
 })}
 async queue(actor){await this.authorize(actor);return {items:(await this.db.query(`SELECT r.id,r.card_id,r.reasons,r.status,r.created_at,d.card->'producer' producer FROM val_decision_reviews r JOIN val_decision_cards d ON d.tenant_id=r.tenant_id AND d.owner_id=r.owner_id AND d.id=r.card_id JOIN clients c ON c.id=d.client_id AND c.tenant_id=d.tenant_id AND c.consultant_id=r.owner_id AND c.status='active' WHERE r.tenant_id=$1 AND r.owner_id=$2 ORDER BY r.created_at DESC,r.id LIMIT 200`,[this.tenantId,actor.id])).rows,limit:200}}
}

export function decisionMetrics(cards=[]){return {cards:cards.length,priorities:cards.filter(c=>c.eligible).length,overdue:cards.filter(c=>c.priority_band==='NOW').length,without_next_step:cards.filter(c=>c.missing_information.some(m=>m.key==='next_action')).length,recorded_value:cards.reduce((s,c)=>s+(c.expected_value.amount||0),0),confidence:Object.fromEntries(['HIGH','MEDIUM','LOW'].map(k=>[k,cards.filter(c=>c.confidence.level===k).length])),evidence_count:cards.reduce((s,c)=>s+c.evidence.length,0),causality:'NOT_ESTABLISHED',value_basis:'Recorded opportunity value or potential gap per producer; not realized revenue'}}
