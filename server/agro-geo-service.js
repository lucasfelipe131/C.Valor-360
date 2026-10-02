import {buildAgronomicTerritory} from './agronomic-geometry-bridge.js'
import {hashDecision} from './decision-governance.js'
const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode})}
const uuid=/^[0-9a-f-]{36}$/i
export class AgroGeoService{
 constructor({decisionService}){this.decisions=decisionService;this.db=decisionService.db;this.repository=decisionService.repository;this.tenantId=decisionService.tenantId}
 async audit(connection,actor,clientId,action,entityId,after){await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'agro_geo',$4,$5)",[this.tenantId,actor.id,action,entityId,JSON.stringify({client_id:clientId,...after})])}
 async ownedClient(connection,actor,id){const row=(await connection.query("SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3 AND status='active' FOR SHARE",[this.tenantId,actor.id,id])).rows[0];if(!row)fail('agro_scope_not_found',404);return row}
 async generate(actor,{clientId=null,now=Date.now()}={}){
  return this.db.transaction(async connection=>{
   await this.decisions.authorize(actor,connection)
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`agro-geo:${this.tenantId}:${actor.id}`])
   const settings=await this.decisions.settings(connection)
   if(!settings.flags.agro_geo_v1)return {enabled:false,cards:[],territories:[],flags:settings.flags}
   const contexts=await this.repository.getDecisionContexts(actor.id,clientId,connection,now),territories=[],cards=[]
   for(const context of contexts){
    await this.ownedClient(connection,actor,context.canonicalClientId)
    const territory=buildAgronomicTerritory(context,{now,tenantId:this.tenantId,ownerId:actor.id,priorityEnabled:settings.flags.field_priority_v1})
    for(const card of territory.cards){
     const key=card.signal.signal_id,fingerprint=hashDecision({...card,generated_at:null,settings_revision:settings.revision})
     let row=(await connection.query('SELECT * FROM val_agro_decisions WHERE tenant_id=$1 AND owner_id=$2 AND signal_key=$3 ORDER BY version DESC LIMIT 1',[this.tenantId,actor.id,key])).rows[0]
     if(row?.fingerprint!==fingerprint){
      const previous=row
      row=(await connection.query('INSERT INTO val_agro_decisions(tenant_id,owner_id,client_id,field_id,signal_key,fingerprint,version,card) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[this.tenantId,actor.id,context.canonicalClientId,card.field.id,key,fingerprint,(previous?.version||0)+1,JSON.stringify(card)])).rows[0]
      await this.audit(connection,actor,context.canonicalClientId,'signal_generated',row.id,{source_refs:card.source_refs,signal_id:key})
      await this.audit(connection,actor,context.canonicalClientId,'agronomic_decision_generated',row.id,{version:row.version,policy_version:card.priority.policy_version})
      if(previous?.card.priority.score!==card.priority.score)await this.audit(connection,actor,context.canonicalClientId,'field_priority_changed',row.id,{previous:previous?.card.priority.score??null,current:card.priority.score})
     }
     Object.assign(card,{id:row.id,revision:row.version,generated_at:row.card.generated_at})
     if(settings.flags.agronomic_decision_cards)cards.push(card)
    }
    if(settings.flags.geo_review_queue)for(const conflict of [...territory.conflicts,...territory.unlinked]){
     const fingerprint=hashDecision(conflict)
     const inserted=await connection.query('INSERT INTO val_geo_reviews(tenant_id,owner_id,client_id,fingerprint,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[this.tenantId,actor.id,context.canonicalClientId,fingerprint,JSON.stringify(conflict)])
     if(inserted.rows.length)await this.audit(connection,actor,context.canonicalClientId,'geo_conflict_detected',inserted.rows[0].id,conflict)
    }
    territories.push({...territory,cards:settings.flags.agronomic_decision_cards?territory.cards:[]})
   }
   cards.sort((a,b)=>(b.priority.score||0)-(a.priority.score||0)||a.id.localeCompare(b.id))
   return {enabled:true,flags:settings.flags,territories,cards,items:cards.slice(0,5),state:'AVAILABLE',automatic_execution:false}
  })
 }
 async queue(actor){await this.decisions.authorize(actor);return {items:(await this.db.query(`SELECT r.* FROM val_geo_reviews r JOIN clients c ON c.id=r.client_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.owner_id=$2 AND c.consultant_id=$2 AND c.status='active' ORDER BY r.created_at DESC LIMIT 200`,[this.tenantId,actor.id])).rows}}
 async resolve(actor,id,input){
  if(!uuid.test(String(id))||!['RESOLVED','REJECTED'].includes(input.status)||!String(input.reason||'').trim())fail('geo_resolution_required')
  return this.db.transaction(async connection=>{
   await this.decisions.authorize(actor,connection)
   const row=(await connection.query('SELECT * FROM val_geo_reviews WHERE tenant_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',[this.tenantId,actor.id,id])).rows[0]
   if(!row)fail('geo_review_not_found',404)
   await this.ownedClient(connection,actor,row.client_id)
   if(row.status!=='PENDING')fail('geo_review_already_resolved',409)
   await connection.query('UPDATE val_geo_reviews SET status=$4,resolution=$5,resolved_by=$2,resolved_at=now() WHERE tenant_id=$1 AND owner_id=$2 AND id=$3',[this.tenantId,actor.id,id,input.status,String(input.reason).trim().slice(0,1000)])
   await this.audit(connection,actor,row.client_id,'geo_review_resolved',id,{status:input.status,reason:input.reason,canonicalEvidenceChanged:false})
   return {saved:true,canonicalEvidenceChanged:false}
  })
 }
 async history(actor,clientId){
  await this.decisions.authorize(actor)
  if(!uuid.test(String(clientId)))fail('agro_scope_not_found',404)
  await this.ownedClient(this.db,actor,clientId)
  return {items:(await this.db.query('SELECT * FROM val_geo_history WHERE tenant_id=$1 AND client_id=$2 ORDER BY id DESC LIMIT 200',[this.tenantId,clientId])).rows}
 }
 async validateSignal(actor,id,input){
  if(!uuid.test(String(id))||!['VALIDATED','REJECTED'].includes(input.state)||!String(input.reason||'').trim()||!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length||input.evidenceRefs.some(r=>typeof r!=='string'||!r.trim()||r.length>500))fail('signal_validation_evidence_required')
  return this.db.transaction(async connection=>{
   await this.decisions.authorize(actor,connection)
   const row=(await connection.query('SELECT * FROM val_agro_decisions WHERE tenant_id=$1 AND owner_id=$2 AND id=$3 FOR SHARE',[this.tenantId,actor.id,id])).rows[0]
   if(!row)fail('agro_decision_not_found',404)
   await this.ownedClient(connection,actor,row.client_id)
   if(input.state==='VALIDATED'&&row.card.missing_information.length)fail('signal_material_information_missing',409)
   const result=await connection.query('INSERT INTO val_agro_signal_validation(tenant_id,owner_id,client_id,signal_key,evidence_fingerprint,state,reason,evidence_refs,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$2) RETURNING id',[this.tenantId,actor.id,row.client_id,row.signal_key,row.card.signal.evidence_fingerprint,input.state,String(input.reason).slice(0,1000),JSON.stringify(input.evidenceRefs)])
   await this.audit(connection,actor,row.client_id,input.state==='VALIDATED'?'signal_validated':'signal_rejected',id,{validation_id:result.rows[0].id,state:input.state,evidence_refs:input.evidenceRefs,reason:input.reason,notAPrescription:true})
   return {saved:true,state:input.state,evidence_version:row.card.signal.evidence_fingerprint}
  })
 }
 async linkAnalysis(actor,id,input){
  if(!uuid.test(String(id))||!String(input.reason||'').trim()||!Object.hasOwn(input,'expectedFieldId'))fail('analysis_link_reason_and_revision_required')
  return this.db.transaction(async connection=>{
   await this.decisions.authorize(actor,connection)
   const analysis=(await connection.query('SELECT a.* FROM soil_analyses a JOIN clients c ON c.tenant_id=a.tenant_id AND c.id=a.client_id WHERE a.tenant_id=$1 AND c.consultant_id=$2 AND a.id=$3 FOR UPDATE OF a',[this.tenantId,actor.id,id])).rows[0]
   if(!analysis)fail('analysis_not_found',404)
   await this.ownedClient(connection,actor,analysis.client_id)
   if(analysis.field_id!==input.expectedFieldId)fail('analysis_link_changed',409)
   let field=null
   if(input.fieldId){
    if(!uuid.test(String(input.fieldId)))fail('field_not_found',404)
    field=(await connection.query('SELECT f.id,f.property_id FROM fields f JOIN properties p ON p.id=f.property_id AND p.tenant_id=f.tenant_id WHERE f.tenant_id=$1 AND f.id=$2 AND p.client_id=$3 FOR SHARE',[this.tenantId,input.fieldId,analysis.client_id])).rows[0]
    if(!field)fail('field_not_found',404)
   }
   await connection.query("SELECT set_config('val.geo_actor',$1,true),set_config('val.geo_source','human-link-review',true),set_config('val.geo_reason',$2,true)",[actor.id,String(input.reason).slice(0,1000)])
   await connection.query('UPDATE soil_analyses SET field_id=$3,property_id=$4 WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,field?.id||null,field?.property_id||null])
   await this.audit(connection,actor,analysis.client_id,field?'analysis_linked':'analysis_unlinked',id,{previous_field_id:analysis.field_id,field_id:field?.id||null,reason:input.reason,originalMeasurementsPreserved:true})
   return {saved:true,field_id:field?.id||null,originalMeasurementsPreserved:true}
  })
 }
}
