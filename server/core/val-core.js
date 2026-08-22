import {createHash} from 'node:crypto'
import {observe} from '../observability.js'
import {createRequestEnvelope,createResponseEnvelope,requestEnvelopeVersion,responseEnvelopeVersion} from './contracts.js'
import {executeModulePlan,coreExecutorVersion} from './executor.js'
import {authorizeCoreRequest,CorePolicyError,corePolicyVersion} from './policy.js'
import {coreRouterVersion,routeCoreRequest} from './router.js'

export const valCoreVersion='val.core.v1'

const actorReference=value=>createHash('sha256').update(String(value||'')).digest('hex').slice(0,16)
const list=value=>Array.isArray(value)?value:[]
const usefulText=value=>typeof value==='string'&&value.trim()?value.trim().slice(0,2000):''

function evidenceRefs(recommendation){
  const seen=new Set()
  const snapshotReference=recommendation?.contextSnapshotId?[
    {source_id:recommendation.contextSnapshotId,source_type:recommendation.contextSnapshotVersion||'val.context_snapshot.v1'}
  ]:[]
  return [...snapshotReference,...list(recommendation?.advice?.evidence_used)].flatMap(item=>{
    const id=String(item?.id||item?.evidence_id||item?.source_id||'').trim().slice(0,180)
    if(!id||seen.has(id))return []
    seen.add(id)
    const type=usefulText(item?.source_type||item?.type)
    return [{id,...(type?{type:type.slice(0,80)}:{})}]
  }).slice(0,50)
}

function assumptions(recommendation){
  return [...new Set(list(recommendation?.advice?.confidence?.missing_data).map(usefulText).filter(Boolean))].slice(0,20)
}

function confidenceFor(recommendation){
  const level=String(recommendation?.advice?.confidence?.level||'').trim().toUpperCase()
  if(level==='VERIFICADO'||level==='VERIFIED')return 'VERIFICADO'
  if(level==='PROVÁVEL'||level==='PROVAVEL'||level==='PROBABLE')return 'PROVÁVEL'
  if(level==='HIPÓTESE'||level==='HIPOTESE'||level==='HYPOTHESIS')return 'HIPÓTESE'
  return 'INSUFICIENTE'
}

function nextActions(recommendation){
  const candidates=[recommendation?.advice?.next_best_action,recommendation?.advice?.executive_brief?.action]
  const seen=new Set()
  return candidates.flatMap(value=>{
    const description=usefulText(value)
    if(!description||seen.has(description))return []
    seen.add(description)
    return [{description}]
  }).slice(0,5)
}

export function legacyRecommendationResponse(responseEnvelope,requestId){
  return {...(responseEnvelope.recommendation||{}),requestId}
}

export class ValCore{
  constructor({engine,tenantId,clock=()=>new Date(),observeFn=observe}={}){
    if(!engine||typeof engine.answer!=='function')throw new TypeError('ValCore exige um ValEngine compatível.')
    this.engine=engine
    this.tenantId=tenantId
    this.clock=clock
    this.observe=(...args)=>{try{return observeFn(...args)}catch{return false}}
  }

  createRequest(input){return createRequestEnvelope(input)}

  status(){
    return Object.freeze({
      version:valCoreVersion,
      requestContract:requestEnvelopeVersion,
      responseContract:responseEnvelopeVersion,
      router:coreRouterVersion,
      policy:corePolicyVersion,
      executor:coreExecutorVersion,
      legacyAdapter:true
    })
  }

  async execute(requestEnvelope,{engineInput}={}){
    const startedAt=this.clock().toISOString()
    this.observe('core.request.received',{contractVersion:requestEnvelope?.contract_version})
    let policyDecision
    try{
      policyDecision=authorizeCoreRequest(requestEnvelope,{configuredTenantId:this.tenantId})
      this.observe('core.policy.allowed',{contractVersion:corePolicyVersion,outcome:'ok'})
    }catch(error){
      this.observe('core.policy.denied',{contractVersion:corePolicyVersion,outcome:'error',errorCode:String(error?.code||'core_policy_denied')})
      throw error
    }
    const tenantMatches=String(engineInput?.tenantId||'')===requestEnvelope.organization_id
    const subjectMatches=String(engineInput?.clientId||'')===requestEnvelope.subject.id
    const embeddedSubjectMatches=engineInput?.client?.id==null||String(engineInput.client.id)===requestEnvelope.subject.id
    const actorMatches=engineInput?.ownerId==null||String(engineInput.ownerId)===requestEnvelope.actor.id
    if(!tenantMatches||!subjectMatches||!embeddedSubjectMatches||!actorMatches){
      this.observe('core.policy.denied',{contractVersion:corePolicyVersion,outcome:'error',errorCode:'execution_binding_denied'})
      throw new CorePolicyError('execution_binding_denied')
    }
    const route=routeCoreRequest(requestEnvelope)
    this.observe('core.route.selected',{routeId:route.route_id,contractVersion:coreRouterVersion})
    const contextualEngineInput={...engineInput,contextRequest:{
      requestId:requestEnvelope.request_id,
      objective:requestEnvelope.objective,
      actorRole:requestEnvelope.actor.role,
      scope:requestEnvelope.policy_context.scope,
      contextRefs:requestEnvelope.context_refs
    }}
    const execution=await executeModulePlan({
      plan:route.execution_plan,
      registry:{LEGACY_VAL_ENGINE:()=>this.engine.answer(contextualEngineInput)},
      input:{requestEnvelope,engineInput:contextualEngineInput,route},
      observeFn:this.observe
    })
    const recommendation=execution.results.LEGACY_VAL_ENGINE
    if(recommendation?.contextSnapshotId)this.observe('core.context.bound',{contextSnapshotId:recommendation.contextSnapshotId,contractVersion:recommendation.contextSnapshotVersion,outcome:'ok'})
    const evidence=evidenceRefs(recommendation)
    const missing=assumptions(recommendation)
    const completedAt=this.clock().toISOString()
    const response=createResponseEnvelope({
      request_id:requestEnvelope.request_id,
      organization_id:requestEnvelope.organization_id,
      status:execution.degraded?'degraded':'completed',
      recommendation,
      evidence_refs:evidence,
      assumptions:missing,
      confidence:confidenceFor(recommendation),
      next_actions:nextActions(recommendation),
      audit:{
        contract_version:'val.core.audit.v1',
        request_id:requestEnvelope.request_id,
        organization_id:requestEnvelope.organization_id,
        actor_ref:actorReference(requestEnvelope.actor.id),
        route_id:route.route_id,
        objective:requestEnvelope.objective,
        planned_modules:[...route.modules],
        module_runs:execution.module_runs,
        policy_decision:{allowed:policyDecision.allowed,policy_version:policyDecision.policy_version,scope:policyDecision.scope},
        started_at:startedAt,
        completed_at:completedAt
      }
    })
    this.observe('core.response.completed',{routeId:route.route_id,contractVersion:response.contract_version,outcome:execution.degraded?'degraded':'ok'})
    return response
  }
}
