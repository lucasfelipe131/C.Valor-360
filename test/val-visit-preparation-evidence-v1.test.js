import assert from 'node:assert/strict'
import test from 'node:test'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {visitPreparationEvidence,visitPreparationMethodEvidence} from '../server/ai-reasoning/visit-preparation-context.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'

const scope={producer_id:'producer-a',tenant_id:'tenant-a',owner_id:'owner-a'}
const now=new Date()
const observed=new Date(now.getTime()-86400000).toISOString()
const scoped=data=>({...data,producer_id:scope.producer_id,tenant_id:scope.tenant_id,owner_id:scope.owner_id})
const context={client:scoped({id:'producer-a',name:'Produtor A'}),visits:[scoped({id:'visit-a',status:'Realizada',occurredAt:observed,summary:'Avaliamos o milho. Combinamos revisar a análise na próxima semana.',nextCommitment:'Revisar a análise em conjunto'})],interactions:[],commitments:[],opportunities:[],memoryHistory:[]}
const snapshot=message=>buildContextSnapshot(context,{organizationId:scope.tenant_id,subjectType:'client',subjectId:scope.producer_id,actorId:scope.owner_id,role:'consultant',scope:'own_portfolio',objective:'prepare_visit',message,now})

test('preparação preserva relato e próximo passo; pergunta de identidade mantém seleção mínima',()=>{
 const prep=snapshot('Me prepare para a próxima visita.')
 assert.equal(prep.relationship_context.visits[0].data.summary,context.visits[0].summary)
 assert.equal(prep.relationship_context.visits[0].data.nextCommitment,context.visits[0].nextCommitment)
 assert.match(visitPreparationEvidence(prep)[0].statement,/Revisar a análise em conjunto/)
 const identity=snapshot('Qual foi a última visita?')
 assert.equal(identity.relationship_context.visits[0].data.summary,undefined)
})

test('evidência de preparação não aceita outro produtor, tenant, owner ou escopo ausente',()=>{
 const prep=snapshot('Prepare a visita.')
 for(const [key,value] of [['producerId','producer-b'],['tenantId','tenant-b'],['ownerId','owner-b']]){
  const invalid=structuredClone(prep);invalid.relationship_context.visits[0][key]=value
  assert.deepEqual(visitPreparationEvidence(invalid),[])
 }
 assert.deepEqual(visitPreparationEvidence({relationship_context:prep.relationship_context}),[])
})

test('compromisso no fim de relato longo permanece no pacote, junto do prazo estruturado',()=>{
 const prep=snapshot('Prepare a visita.')
 prep.relationship_context.visits[0].data.summary='Avaliamos as condições da lavoura. '.repeat(90)+'Combinamos levar o comparativo detalhado na próxima semana.'
 prep.relationship_context.visits[0].data.nextActionAt=new Date(now.getTime()+86400000).toISOString()
 const fact=visitPreparationEvidence(prep)[0]
 assert.match(fact.statement.slice(0,900),/comparativo detalhado/)
 assert.match(fact.statement.slice(0,900),/Prazo registrado/)
})

test('método de preparação orienta processo, mas não sustenta fato inventado do produtor',()=>{
 const groundingScope={activeProducerId:scope.producer_id,tenantId:scope.tenant_id,ownerId:scope.owner_id}
 const method=visitPreparationMethodEvidence(groundingScope)
 assert.equal(method.epistemic_type,'STRATEGY')
 const wrong=evaluateResponseGrounding({...groundingScope,domain:'VISIT',question:'Prepare a visita',answer:'O produtor confirmou a compra de 500 toneladas para a próxima visita.',evidence:[method]})
 assert.equal(wrong.passed,false)
 const foreign=evaluateResponseGrounding({...groundingScope,ownerId:'owner-b',domain:'VISIT',question:'Prepare a visita',answer:'Revise os compromissos registrados antes da visita.',evidence:[method]})
 assert.equal(foreign.passed,false)
})
