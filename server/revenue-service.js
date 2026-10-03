import {isK5Synthetic} from '../src/lib/business-metrics-scope.js'
import {expansionFromOutcomes} from './post-conversion-expansion.js'
import {randomUUID} from 'node:crypto'
import {hashDecision} from './decision-governance.js'
import {opportunityValuePlan} from './commercial/value-plan.js'
import {calculateObservedImpact} from './revenue-policy.js'
import {buildRevenueIntelligence} from './conversion-engine.js'
import {buildCommercialCoach} from './sales-playbook.js'
const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode})}
export class RevenueService{
 constructor({decisionService}){this.decisions=decisionService;this.db=decisionService.db;this.repository=decisionService.repository;this.tenantId=decisionService.tenantId}
 async audit(connection,actor,action,id,payload){await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'revenue',$4,$5)",[this.tenantId,actor.id,action,id,JSON.stringify(payload)])}
 async owned(connection,actor,id){const row=(await connection.query("SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3 AND status='active' FOR SHARE",[this.tenantId,actor.id,id])).rows[0];if(!row)fail('revenue_scope_not_found',404);return row}
 async valuePlan(actor,id,input){return this.db.transaction(async connection=>{
  await this.decisions.authorize(actor,connection)
  if(!(await this.decisions.settings(connection)).flags.revenue_intelligence_v1)fail('revenue_disabled',409)
  const opportunity=(await connection.query('SELECT * FROM opportunities WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[this.tenantId,id])).rows[0]
  if(!opportunity)fail('opportunity_not_found',404)
  await this.owned(connection,actor,opportunity.client_id)
  if(input.expectedUpdatedAt!==new Date(opportunity.updated_at).toISOString())fail('opportunity_changed',409)
  const plan=opportunityValuePlan({organizationId:this.tenantId,subjectId:opportunity.client_id,opportunityId:id,input:input.plan})
  await connection.query('UPDATE opportunities SET value_plan=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,JSON.stringify(plan)])
  await this.audit(connection,actor,'value_plan_changed',id,{before:opportunity.value_plan,after:plan})
  return {saved:true,value_plan:plan}
 })}
 async feedback(actor,id,input){return this.db.transaction(async connection=>{
  await this.decisions.authorize(actor,connection)
  if(!(await this.decisions.settings(connection)).flags.commercial_coach_v1)fail('coach_disabled',409)
  if(!['USEFUL','ADAPTED','EXECUTED','DISMISSED'].includes(input.feedback)||!String(input.result||'').trim()||! /^[0-9a-f-]{36}$/i.test(input.requestId||''))fail('coach_feedback_required',422)
  const card=(await connection.query('SELECT * FROM val_commercial_coach_cards WHERE tenant_id=$1 AND owner_id=$2 AND id=$3',[this.tenantId,actor.id,id])).rows[0]
  if(!card)fail('coach_card_not_found',404)
  await this.owned(connection,actor,card.client_id)
  const prior=(await connection.query('SELECT * FROM val_commercial_coach_feedback WHERE tenant_id=$1 AND owner_id=$2 AND request_id=$3',[this.tenantId,actor.id,input.requestId])).rows[0]
  if(prior){if(prior.card_id!==id||prior.feedback!==input.feedback||prior.result!==input.result)fail('feedback_idempotency_conflict',409);return {saved:true,replayed:true}}
  await connection.query('INSERT INTO val_commercial_coach_feedback(tenant_id,owner_id,card_id,request_id,feedback,result) VALUES($1,$2,$3,$4,$5,$6)',[this.tenantId,actor.id,id,input.requestId,input.feedback,String(input.result).slice(0,4000)])
  await this.audit(connection,actor,'coach_feedback_recorded',id,{feedback:input.feedback,result:input.result,learning_status:'PROPOSED',automaticWeightChange:false})
  return {saved:true,learning_status:'PROPOSED',automaticWeightChange:false}
 })}
 async impact(actor,input){return this.db.transaction(async connection=>{
  await this.decisions.authorize(actor,connection)
  if(!(await this.decisions.settings(connection)).flags.impact_engine_v1)fail('impact_disabled',409)
  if(!/^[0-9a-f-]{36}$/i.test(input.requestId||''))fail('impact_request_required',422)
  const outcome=(await connection.query('SELECT * FROM val_outcomes WHERE tenant_id=$1 AND recorded_by=$2 AND id=$3',[this.tenantId,actor.id,input.outcome])).rows[0]
  if(!outcome)fail('outcome_not_found',404)
  await this.owned(connection,actor,outcome.client_id)
  if(input.producer!==outcome.client_id||input.action!==outcome.action_plan_id||input.opportunity!==(outcome.result?.opportunity_id||null)||input.decision!==(outcome.result?.decision_card_id||null))fail('impact_chain_mismatch',422)
  const prior=(await connection.query('SELECT * FROM val_observed_impacts WHERE tenant_id=$1 AND owner_id=$2 AND request_id=$3',[this.tenantId,actor.id,input.requestId])).rows[0]
  const payload=calculateObservedImpact(input)
  if(prior){if(hashDecision({...prior.payload,impact_id:null})!==hashDecision({...payload,impact_id:null}))fail('impact_idempotency_conflict',409);return {saved:true,impact:prior.payload,replayed:true}}
  payload.impact_id=randomUUID()
  await connection.query('INSERT INTO val_observed_impacts(id,tenant_id,owner_id,client_id,outcome_id,request_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[payload.impact_id,this.tenantId,actor.id,outcome.client_id,outcome.id,input.requestId,JSON.stringify(payload)])
  await this.audit(connection,actor,'impact_measured',payload.impact_id,payload)
  return {saved:true,impact:payload}
 })}
 async reviewLearning(actor,id,input){return this.db.transaction(async connection=>{
  await this.decisions.authorize(actor,connection,{admin:true})
  if(!(await this.decisions.settings(connection)).flags.commercial_coach_v1)fail('coach_disabled',409)
  const row=(await connection.query('SELECT f.*,c.client_id FROM val_commercial_coach_feedback f JOIN val_commercial_coach_cards c ON c.tenant_id=f.tenant_id AND c.id=f.card_id WHERE f.tenant_id=$1 AND f.id=$2 FOR UPDATE OF f',[this.tenantId,id])).rows[0]
  if(!row)fail('learning_not_found',404)
  const transitions={PROPOSED:['REVIEWED','REJECTED'],REVIEWED:['APPROVED','REJECTED'],APPROVED:['ROLLED_BACK'],REJECTED:[],ROLLED_BACK:[]}
  if(!transitions[row.learning_status]?.includes(input.status)||!String(input.reason||'').trim())fail('learning_review_required',422)
  await connection.query('UPDATE val_commercial_coach_feedback SET learning_status=$3 WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,input.status])
  await this.audit(connection,actor,'coach_learning_reviewed',id,{previous:row.learning_status,status:input.status,reason:input.reason,automaticWeightChange:false})
  return {saved:true,status:input.status,automaticWeightChange:false}
 })}
 async validateImpact(actor,id,input){return this.db.transaction(async connection=>{
  await this.decisions.authorize(actor,connection,{admin:true})
  if(!(await this.decisions.settings(connection)).flags.impact_engine_v1)fail('impact_disabled',409)
  const row=(await connection.query('SELECT * FROM val_observed_impacts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[this.tenantId,id])).rows[0]
  if(!row)fail('impact_not_found',404)
  if(!['OBSERVED_CHANGE','ASSOCIATED','CONTRIBUTED','CAUSAL_NOT_PROVEN','VALIDATED_CAUSAL_LINK'].includes(input.status)||!String(input.reason||'').trim()||!input.source_refs?.length)fail('impact_validation_evidence_required',422)
  if(input.status==='VALIDATED_CAUSAL_LINK'&&(!input.methodology||!input.counterfactual||!input.alternative_explanations))fail('causal_validation_method_required',422)
  const payload={...row.payload,attribution_status:input.status,validation:{reviewed_by:actor.id,reviewed_at:new Date().toISOString(),reason:input.reason,source_refs:input.source_refs,methodology:input.methodology||null,counterfactual:input.counterfactual||null,alternative_explanations:input.alternative_explanations||null}}
  await connection.query('UPDATE val_observed_impacts SET payload=$3 WHERE tenant_id=$1 AND id=$2',[this.tenantId,id,JSON.stringify(payload)])
  await this.audit(connection,actor,'impact_validated',id,{before:row.payload,after:payload})
  return {saved:true,impact:payload}
 })}
 async generate(actor,{clientId=null,now=Date.now()}={}){
  return this.db.transaction(async connection=>{
   await this.decisions.authorize(actor,connection)
   await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`revenue:${this.tenantId}:${actor.id}`])
   const settings=await this.decisions.settings(connection)
   if(!settings.flags.revenue_intelligence_v1)return {enabled:false,producers:[],coach_cards:[]}
   const contexts=(await this.repository.getDecisionContexts(actor.id,clientId,connection,now,{territory:false})).filter(context=>!isK5Synthetic(context.client))
   const ids=contexts.map(context=>context.canonicalClientId)
   const outcomes=(await connection.query('SELECT * FROM val_outcomes WHERE tenant_id=$1 AND recorded_by=$2 AND client_id=ANY($3::uuid[]) ORDER BY measured_at DESC,id',[this.tenantId,actor.id,ids])).rows
   const actionPlans=(await connection.query('SELECT id,client_id,visit_id,status FROM val_action_plans WHERE tenant_id=$1 AND owner_user_id=$2 AND client_id=ANY($3::uuid[])',[this.tenantId,actor.id,ids])).rows
   const decisionCards=(await connection.query('SELECT id,client_id,card,generated_at FROM val_decision_cards WHERE tenant_id=$1 AND owner_id=$2 AND client_id=ANY($3::uuid[]) ORDER BY generated_at DESC',[this.tenantId,actor.id,ids])).rows
   const grouped=new Map()
   for(const outcome of outcomes){if(!grouped.has(outcome.client_id))grouped.set(outcome.client_id,[]);grouped.get(outcome.client_id).push(outcome)}
   for(const context of contexts)context.opportunities=context.opportunities.map(opportunity=>({...opportunity,value_plan:opportunity.value_plan||opportunityValuePlan({organizationId:this.tenantId,subjectId:context.canonicalClientId,opportunityId:opportunity.id})}))
   const producers=contexts.map(context=>buildRevenueIntelligence({...context,outcomes:grouped.get(context.canonicalClientId)||[]},{now,tenantId:this.tenantId,ownerId:actor.id}))
   const group=rows=>{const result=new Map();for(const row of rows){if(!result.has(row.client_id))result.set(row.client_id,[]);result.get(row.client_id).push(row)}return result},plansByClient=group(actionPlans),cardsByClient=group(decisionCards)
   for(let index=0;index<producers.length;index++){
    const producer=producers[index],context=contexts[index]
    producer.visits=context.visits.map(visit=>({id:visit.id,objective:visit.objective,scheduled_at:visit.scheduled_at}))
    producer.commitments=context.commitments.map(commitment=>({id:commitment.id,description:commitment.description,visit_id:commitment.visit_id,status:commitment.status}))
    producer.action_plans=plansByClient.get(producer.producer)||[]
    producer.decision_cards=(cardsByClient.get(producer.producer)||[]).slice(0,20).map(card=>({id:card.id,label:card.card.headline||card.card.title||'Decisão registrada',generated_at:card.generated_at}))
   }
   const auditEvents=[],walletHistory=new Map(),walletChanges=[]
   for(const row of (await connection.query('SELECT * FROM (SELECT w.*,row_number() OVER(PARTITION BY client_id ORDER BY observed_at DESC,id) position FROM val_wallet_observations w WHERE tenant_id=$1 AND owner_id=$2 AND client_id=ANY($3::uuid[])) history WHERE position<=2',[this.tenantId,actor.id,ids])).rows){if(!walletHistory.has(row.client_id))walletHistory.set(row.client_id,[]);walletHistory.get(row.client_id).push(row)}
   for(const producer of producers){
    const history=walletHistory.get(producer.producer)||[],current=producer.metrics.current_purchases,potential=producer.metrics.potential_total
    if(current!==null&&potential>0&&(!history.length||Number(history[0].current_purchases)!==current||Number(history[0].potential_total)!==potential))walletChanges.push({client_id:producer.producer,current_purchases:current,potential_total:potential,source_ref:`client:${producer.producer}:commercial_profile`})
   }
   if(walletChanges.length)for(const row of (await connection.query('INSERT INTO val_wallet_observations(tenant_id,owner_id,client_id,current_purchases,potential_total,source_ref) SELECT $1,$2,w.client_id,w.current_purchases,w.potential_total,w.source_ref FROM jsonb_to_recordset($3::jsonb) w(client_id uuid,current_purchases numeric,potential_total numeric,source_ref text) RETURNING *',[this.tenantId,actor.id,JSON.stringify(walletChanges)])).rows){if(!walletHistory.has(row.client_id))walletHistory.set(row.client_id,[]);walletHistory.get(row.client_id).unshift(row)}
   const priorProjections=new Map((await connection.query('SELECT client_id,payload FROM val_revenue_projection WHERE tenant_id=$1 AND owner_id=$2 AND client_id=ANY($3::uuid[])',[this.tenantId,actor.id,ids])).rows.map(row=>[row.client_id,row.payload])),projectionChanges=[]
   for(const producer of producers){
    const history=walletHistory.get(producer.producer)||[]
    producer.share_history=history.slice(0,2)
    producer.share_change=history.length>=2&&producer.metrics.realized_share_percent!==null?{before:100*Number(history[1].current_purchases)/Number(history[1].potential_total),after:producer.metrics.realized_share_percent,delta:producer.metrics.realized_share_percent-100*Number(history[1].current_purchases)/Number(history[1].potential_total),unit:'percentage_points',source_refs:history.slice(0,2).map(row=>row.id),causality:'CAUSAL_NOT_PROVEN'}:null
    const prior=priorProjections.get(producer.producer),payload={opportunities:producer.opportunities.map(opportunity=>({id:opportunity.id,health:opportunity.health,stalled:opportunity.stalled}))},fingerprint=hashDecision(payload)
    if(!prior||hashDecision(prior)!==fingerprint){
     projectionChanges.push({client_id:producer.producer,fingerprint,payload})
     const previousOpportunities=new Map((prior?.opportunities||[]).map(item=>[item.id,item]))
     for(const opportunity of payload.opportunities){const previous=previousOpportunities.get(opportunity.id);if(previous?.health!==opportunity.health)auditEvents.push({action:'pipeline_health_changed',id:opportunity.id,payload:{before:previous?.health||null,after:opportunity.health}});if(opportunity.stalled&&!previous?.stalled)auditEvents.push({action:'opportunity_stalled',id:opportunity.id,payload:{policy_version:'val.stalled_value_policy.v1'}})}
    }
   }
   if(projectionChanges.length)await connection.query('INSERT INTO val_revenue_projection(tenant_id,owner_id,client_id,fingerprint,payload) SELECT $1,$2,p.client_id,p.fingerprint,p.payload FROM jsonb_to_recordset($3::jsonb) p(client_id uuid,fingerprint text,payload jsonb) ON CONFLICT(tenant_id,owner_id,client_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,payload=EXCLUDED.payload,updated_at=now()',[this.tenantId,actor.id,JSON.stringify(projectionChanges)])
   for(let index=0;index<producers.length;index++)producers[index].post_conversion=expansionFromOutcomes({...contexts[index],outcomes:producers[index].outcomes},{now})
   const coach_cards=settings.flags.commercial_coach_v1?producers.flatMap(producer=>buildCommercialCoach(producer,{now})):[]
   if(coach_cards.length){
    const cards=coach_cards.map(card=>({client_id:card.context.producer,source_key:card.id,card,fingerprint:hashDecision({...card,created_at:null})}))
    const inserted=(await connection.query('INSERT INTO val_commercial_coach_cards(tenant_id,owner_id,client_id,source_key,card,fingerprint) SELECT $1,$2,c.client_id,c.source_key,c.card,c.fingerprint FROM jsonb_to_recordset($3::jsonb) c(client_id uuid,source_key text,card jsonb,fingerprint text) ON CONFLICT DO NOTHING RETURNING id,card',[this.tenantId,actor.id,JSON.stringify(cards)])).rows
    const stored=(await connection.query('SELECT c.id,c.card,c.source_key,c.fingerprint FROM val_commercial_coach_cards c JOIN jsonb_to_recordset($3::jsonb) wanted(source_key text,fingerprint text) ON wanted.source_key=c.source_key AND wanted.fingerprint=c.fingerprint WHERE c.tenant_id=$1 AND c.owner_id=$2',[this.tenantId,actor.id,JSON.stringify(cards.map(({source_key,fingerprint})=>({source_key,fingerprint})))])).rows
    const indexed=new Map(stored.map(row=>[row.source_key+':'+row.fingerprint,row]))
    for(let index=0;index<coach_cards.length;index++){const row=indexed.get(cards[index].source_key+':'+cards[index].fingerprint);coach_cards[index].id=row.id;coach_cards[index].created_at=row.card.created_at}
    for(const row of inserted)auditEvents.push({action:'coach_card_generated',id:row.id,payload:{signal:row.card.signal,evidence_refs:row.card.evidence_refs}})
   }
   if(auditEvents.length)await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) SELECT $1,$2,e.action,'revenue',e.id,e.payload FROM jsonb_to_recordset($3::jsonb) e(action text,id text,payload jsonb)",[this.tenantId,actor.id,JSON.stringify(auditEvents)])
   const impacts=settings.flags.impact_engine_v1?(await connection.query('SELECT payload FROM val_observed_impacts WHERE tenant_id=$1 AND owner_id=$2 AND client_id=ANY($3::uuid[]) ORDER BY created_at DESC',[this.tenantId,actor.id,ids])).rows.map(row=>row.payload):[]
   await connection.query("INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2::uuid,'revenue_view_opened','revenue',($2::uuid)::text,$3)",[this.tenantId,actor.id,JSON.stringify({producer_count:producers.length,policy_version:'val.revenue_calculation_policy.v1'})])
   return {enabled:true,producers,coach_cards,impacts,flags:settings.flags,generated_at:new Date(now).toISOString(),automatic_execution:false}
  })
 }
}
