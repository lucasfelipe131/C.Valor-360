import assert from 'node:assert/strict'
import test from 'node:test'
import {composeMarketAttachmentResponse} from '../server/decision-copilot/capability-router.js'

const now='2026-08-25T15:00:00.000Z'
const question='Analise agronomicamente esta foto.'
const scope=Object.freeze({
 tenant_id:'tenant-attachment',owner_id:'owner-attachment',producer_id:'producer-attachment',
 conversation_id:'attachment-binding-thread',context_epoch:7,domain:'AGRONOMY'
})

const marketResponse=()=>({
 advice:{answer:'',ai_reasoning:{
  objective:question,created_at:now,facts_used:[],quality:{automatic_tests:{}},
  run:{capabilities_planned:[],capabilities_used:[],capability_results:[]},
  premises:{context_scope:{...scope}}
 }}
})

const attachment=id=>({
 id,organizationId:scope.tenant_id,contextOwnerId:scope.owner_id,clientId:scope.producer_id,
 mimeType:'image/jpeg',status:'interpreted',createdAt:'2026-08-25T14:00:00.000Z'
})

const fact=(overrides={})=>({
 id:'fact-image-a',source_ref:'image-a',source_type:'consultant_attachment',epistemic_type:'OBSERVATION',
 statement:'Há amarelecimento visível na folha; a causa não está confirmada.',observed_at:'2026-08-25T14:00:00.000Z',
 producer_id:scope.producer_id,tenant_id:scope.tenant_id,context_owner_id:scope.owner_id,...overrides
})

const attachmentResponse=({facts=[fact()],evidenceRefs=['fact-image-a'],attachments=[attachment('image-a')]}={})=>({
 attachments,
 advice:{ai_reasoning:{
  organization:{id:scope.tenant_id},client:{id:scope.producer_id},facts_used:facts,
  grounding:{passed:true,claim_ledger:[{supported:true,evidence_refs:evidenceRefs}]},
  agronomic_context:{status:'requires_human_review',human_review_required:true},
  premises:{context_scope:{...scope}}
 }}
})

const compose=input=>composeMarketAttachmentResponse({marketResponse:marketResponse(),attachmentTypes:['image/jpeg'],attachmentResponse:attachmentResponse(input)})

test('origem de anexo — identidade canônica distinta liga-se por source_ref e ledger canônico',()=>{
 const result=compose()
 assert.equal(result.responseMetadata.attachmentCompositionStatus,'EXECUTED')
 const selected=result.advice.ai_reasoning.facts_used.find(item=>item.id==='fact-image-a')
 assert.equal(selected?.source_ref,'image-a')
})

test('origem de anexo — id de outro anexo e source_ref conflitante falham fechado',()=>{
 assert.throws(()=>compose({
  attachments:[attachment('image-a'),attachment('image-b')],
  facts:[fact({id:'image-b',source_ref:'image-a'})],evidenceRefs:['image-b']
 }),error=>error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_SOURCE_BINDING_CONFLICT')
})

test('origem de anexo — aliases conflitantes em payloads aninhados falham fechado',()=>{
 const nestedPoisons=[
  ['payload.attachment.id',{payload:{attachment:{id:'image-b'}}}],
  ['payload.analysis.source_ref',{payload:{analysis:{source_ref:'image-b'}}}],
  ['provenance.attachments',{provenance:{attachments:[{id:'image-a'},{attachment_id:'image-b'}]}}],
  ['source_ref object',{source_ref:{id:'image-b',source_ref:'image-a'}}],
  ['payload.source_refs array',{payload:{source_refs:['image-a','image-b']}}]
 ]
 for(const [label,poison] of nestedPoisons)assert.throws(()=>compose({
  attachments:[attachment('image-a'),attachment('image-b')],
  facts:[fact(poison)],evidenceRefs:['fact-image-a']
 }),error=>error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_SOURCE_BINDING_CONFLICT',label)
})

test('origem de anexo — source_id forjado não pode ser a única âncora do ledger',()=>{
 assert.throws(()=>compose({
  facts:[fact({source_id:'forged-ledger-alias'})],evidenceRefs:['forged-ledger-alias']
 }),error=>error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_EVIDENCE_ID_ALIAS_CONFLICT')
})

test('origem de anexo — ledger que cita apenas source_ref não suporta fato de identidade distinta',()=>{
 assert.throws(()=>compose({evidenceRefs:['image-a']}),error=>
  error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_UPSTREAM_GROUNDING_REQUIRED'
 )
})

test('origem de anexo — aliases aninhados repetidos para o mesmo anexo permanecem válidos',()=>{
 const result=compose({facts:[fact({payload:{attachment:{id:'image-a'},source_ref:'image-a'}})]})
 assert.equal(result.responseMetadata.attachmentEvidenceSelected,1)
 assert.equal(result.advice.ai_reasoning.facts_used.find(item=>item.id==='fact-image-a')?.source_ref,'image-a')
})

test('origem de anexo — referência tipada resolve para um único anexo autorizado',()=>{
 const result=compose({facts:[fact({source_ref:'attachment:image-a'})]})
 assert.equal(result.advice.ai_reasoning.facts_used.find(item=>item.id==='fact-image-a')?.source_ref,'image-a')
})

test('origem de anexo — origem ausente e IDs autorizados duplicados falham fechado',()=>{
 assert.throws(()=>compose({facts:[fact({source_ref:'image-not-authorized'})]}),error=>
  error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_SOURCE_NOT_AUTHORIZED'
 )
 assert.throws(()=>compose({attachments:[attachment('image-a'),attachment('image-a')]}),error=>
  error?.code==='RESPONSE_GROUNDING_VIOLATION'&&error?.reason==='ATTACHMENT_AUTHORIZED_ID_DUPLICATE'
 )
})
