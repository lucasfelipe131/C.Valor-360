import assert from 'node:assert/strict'
import test from 'node:test'
import {buildFastClientComparisonResponse,buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {evaluateReasoningGrounding,evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'

const tenantA='00000000-0000-4000-8000-000000000001'
const tenantB='00000000-0000-4000-8000-000000000002'
const ownerA='00000000-0000-4000-8000-000000000010'
const producerA='producer-matheus'
const producerB='producer-joao'
const now=new Date('2026-08-30T12:00:00.000Z')

const emptyContext=()=>({
 client:{id:producerA,name:'Matheus Nascimento Jaeger'},
 memoryHistory:[],
 businessHistory:[],
 visits:[],
 interactions:[],
 commitments:[],
 opportunities:[],
 properties:[],
 fieldReports:[],
 soilAnalyses:[],
 ndviObservations:[]
})

function snapshot(context,{message='Qual foi a última visita?',objective='visit_query',requestId='00000000-0000-4000-8000-000000000951'}={}){
 return buildContextSnapshot(context,{
  organizationId:tenantA,
  subjectType:'client',
  subjectId:producerA,
  actorId:ownerA,
  role:'consultant',
  scope:'own_portfolio',
  objective,
  message,
  requestId,
  now
 })
}

function assertCollectionFailsClosed({record,missingScope,requestId}){
 let result
 try{
  result=snapshot({...emptyContext(),visits:[record]},{requestId})
 }catch(error){
  assert.equal(error?.code,'CONTEXT_SCOPE_VIOLATION')
  assert.match(String(error?.reason||error?.message),new RegExp(`MISSING.*${missingScope}|${missingScope}.*MISSING`,'i'))
  return
 }
 assert.deepEqual(result.relationship_context.visits,[],'coleção sem proveniência de escopo não pode ser re-carimbada como ativa')
 assert.ok(
  result.selection.context_trace.rejected.some(item=>String(item.reasonSelected||'').includes('MISSING')),
  'a rejeição deve registrar uma razão de proveniência ausente'
 )
}

function behavioralMemory(id,statement){
 return {
  id,
  tenant_id:tenantA,
  client_id:producerA,
  context_owner_id:ownerA,
  subject_type:'client',
  subject_id:producerA,
  memory_type:'inference',
  memory_state:'INFERENCE',
  memory_domain:'BEHAVIORAL',
  key:'profile.decision_driver',
  value:{statement},
  status:'verified',
  source:'producer_360',
  source_ref:`producer_360:${id}`,
  source_type:'producer_360',
  confidence:85,
  valid_from:'2026-08-01T12:00:00.000Z',
  created_at:'2026-08-01T12:00:00.000Z',
  updated_at:'2026-08-01T12:00:00.000Z',
  acl:{scope:'own_portfolio'}
 }
}

function scopedEvidence(statement,overrides={}){
 return {
  id:'evidence-a',
  source_type:'visit',
 producer_id:producerA,
 tenant_id:tenantA,
  context_owner_id:ownerA,
  epistemic_type:'FACT',
  observed_at:'2026-08-29T12:00:00.000Z',
  statement,
  ...overrides
 }
}

const fastProfileClient={
 id:producerA,
 name:'Matheus Nascimento Jaeger',
 producer_id:producerA,
 tenant_id:tenantA,
 context_owner_id:ownerA,
 primaryProfile:'Analítico',
 decisionDriver:'Compara alternativas com dados antes de decidir',
 technicalPresentation:'Prefere indicadores objetivos e comparáveis'
}

function assertFastProfileEvidenceFailsClosed(profileEvidence){
 let result
 try{
  result=buildFastClientResponse({
   facts:{client:fastProfileClient,profileEvidence:[profileEvidence],profileSourceRef:profileEvidence.id},
   message:'qual o perfil dele?',
   organizationId:tenantA,
   ownerId:ownerA,
   conversationId:'conversation-profile-a',
   now
  })
 }catch(error){
  assert.match(String(error?.code||error?.message),/(?:CONTEXT_SCOPE|GROUNDING|EVIDENCE|EXPIRED|STALE)/i)
  return
 }
 const capability=result.advice.ai_reasoning.run.capability_results[0]
 assert.notEqual(capability.status,'EXECUTED','evidência inválida não pode autorizar o FAST profile')
 assert.equal(result.advice.ai_reasoning.confidence.level,'INSUFICIENTE')
 assert.deepEqual(result.advice.ai_reasoning.facts_used,[],'evidência inválida não pode ser re-carimbada como ativa')
}

test('FAST bloqueia raw fact de outro produtor antes de ler ou reetiquetar conteúdo',()=>{
 const poisonedCommitment={
  id:'commitment-b',description:'SEGREDO DO PRODUTOR B: travar contrato de grãos',
  producer_id:producerB,tenant_id:tenantA,context_owner_id:ownerA,
  updated_at:'2026-08-29T12:00:00.000Z'
 }
 assert.throws(()=>buildFastClientResponse({
  facts:{client:fastProfileClient,latestCommitment:poisonedCommitment},
  message:'qual foi o último compromisso?',organizationId:tenantA,ownerId:ownerA,
  conversationId:'conversation-fast-poison',now
 }),error=>error?.code==='CONTEXT_SCOPE_VIOLATION'&&error?.reason==='PRODUCER_MISMATCH')
})

test('FAST comparison bloqueia tenant/owner poison antes de compor statements',()=>{
 const clientA={id:producerA,name:'Matheus',producer_id:producerA,tenant_id:tenantA,context_owner_id:ownerA}
 const clientB={id:producerB,name:'João',producer_id:producerB,tenant_id:tenantA,context_owner_id:ownerA}
 const poisonedPurchase={
  id:'purchase-poison',product:'SEGREDO CROSS-TENANT',value:999,
  producer_id:producerA,tenant_id:tenantB,context_owner_id:ownerA,
  occurred_at:'2026-08-29T12:00:00.000Z'
 }
 assert.throws(()=>buildFastClientComparisonResponse({
  entries:[{client:clientA,latestPurchase:poisonedPurchase},{client:clientB}],
  authorizedProducerIds:[producerA,producerB],
  message:'compare os dois',organizationId:tenantA,ownerId:ownerA,
  conversationId:'conversation-fast-comparison-poison',now
 }),error=>error?.code==='CONTEXT_SCOPE_VIOLATION'&&error?.reason==='TENANT_MISMATCH')
})

test('FAST comparison exige exatamente o par autorizado pelo resolver',()=>{
 const clientA={id:producerA,name:'Matheus',producer_id:producerA,tenant_id:tenantA,context_owner_id:ownerA}
 const producerC='producer-c'
 const clientC={id:producerC,name:'C SEGREDO',producer_id:producerC,tenant_id:tenantA,context_owner_id:ownerA}
 assert.throws(()=>buildFastClientComparisonResponse({
  entries:[{client:clientA},{client:clientC}],authorizedProducerIds:[producerA,producerB],
  message:'compare os dois',organizationId:tenantA,ownerId:ownerA,
  conversationId:'conversation-fast-comparison-pair',now
 }),error=>error?.code==='CONTEXT_SCOPE_VIOLATION'&&error?.reason==='COMPARISON_PRODUCER_MISMATCH')
})

test('coleção sem producer falha fechado em vez de herdar o produtor ativo',()=>{
 assertCollectionFailsClosed({
  record:{id:'visit-missing-producer',tenantId:tenantA,summary:'Visita concluída com objeção de preço.'},
  missingScope:'PRODUCER',
  requestId:'00000000-0000-4000-8000-000000000951'
 })
})

test('coleção sem tenant falha fechado em vez de herdar o tenant ativo',()=>{
 assertCollectionFailsClosed({
  record:{id:'visit-missing-tenant',clientId:producerA,summary:'Visita concluída com objeção de preço.'},
  missingScope:'TENANT',
  requestId:'00000000-0000-4000-8000-000000000952'
 })
})

for(const [id,statement] of [
 ['behavioral-credit-poison','CPF financeira pendente.'],
 ['behavioral-grains-poison','Travamento de contrato de grãos.']
]){
 test(`PROFILE rejeita memória BEHAVIORAL semanticamente contaminada: ${statement}`,()=>{
  const result=snapshot({...emptyContext(),memoryHistory:[behavioralMemory(id,statement)]},{
   message:'qual o perfil dele?',
   objective:'profile_query',
   requestId:id.endsWith('poison')&&id.includes('credit')
    ?'00000000-0000-4000-8000-000000000953'
    :'00000000-0000-4000-8000-000000000954'
  })
  assert.equal(result.selection.selected_refs.includes(id),false,'rótulo BEHAVIORAL não deve superar a relevância semântica')
  assert.doesNotMatch(JSON.stringify(result),new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'))
  assert.ok(
   result.selection.exclusion_reason_codes.find(item=>item.ref===id)?.reason_codes.includes('DOMAIN_MISMATCH'),
   'o poison cross-domain deve ser auditado como incompatível com PROFILE'
  )
 })
}

test('grounding rejeita resposta irrelevante mesmo quando a afirmação tem evidência exata',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual foi a última visita?',
  domain:'VISIT',
  answer:'O limite de crédito é R$ 1000.',
  evidence:[scopedEvidence('O limite de crédito é R$ 1000.')],
  activeProducerId:producerA,
  tenantId:tenantA
 })
 assert.equal(result.passed,false)
 assert.equal(result.question_relevance,'FAIL')
})

test('grounding não aceita R$ 100 com evidência de R$ 1000',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual foi o valor aprovado?',
  domain:'COMMERCIAL',
  answer:'O valor aprovado é R$ 100.',
  evidence:[scopedEvidence('O valor aprovado é R$ 1000.')],
  activeProducerId:producerA,
  tenantId:tenantA
 })
 assert.equal(result.passed,false)
 assert.ok(
  result.claim_ledger.some(item=>item.supported===false&&/(?:NUMERIC|VALUE_MISMATCH)/.test(item.reason_code)),
  'o claim ledger deve registrar incompatibilidade numérica exata'
 )
})

test('grounding vincula cada número à entidade do mesmo subfato',()=>{
 const cropSwap=evaluateResponseGrounding({
  question:'Qual é a produção de soja e milho?',domain:'GENERAL',
  answer:'Soja: 200 sc; milho: 100 sc.',
  evidence:[
   scopedEvidence('Soja: 100 sc.',{id:'soy-volume',source_type:'business_event'}),
   scopedEvidence('Milho: 200 sc.',{id:'corn-volume',source_type:'business_event'})
  ],
  activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(cropSwap.passed,false)
 assert.ok(cropSwap.unsupported_terms.includes('UNSUPPORTED_NUMERIC_CLAIM'))

 const deadlineSwap=evaluateResponseGrounding({
  question:'Qual é o prazo da proposta e do contrato?',domain:'COMMERCIAL',
  answer:'Prazo da proposta: 20 dias; prazo do contrato: 10 dias.',
  evidence:[scopedEvidence('Prazo da proposta: 10 dias; prazo do contrato: 20 dias.',{source_type:'business_event'})],
  activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(deadlineSwap.passed,false)
 assert.ok(deadlineSwap.unsupported_terms.includes('UNSUPPORTED_NUMERIC_CLAIM'))
})

test('grounding preserva o sinal numérico e os vínculos corretos',()=>{
 for(const negative of ['-10%','−10%']){
  const signSwap=evaluateResponseGrounding({
   question:'Qual é a margem?',domain:'COMMERCIAL',answer:`A margem é ${negative}.`,
   evidence:[scopedEvidence('A margem é 10%.',{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(signSwap.passed,false,negative)
  assert.ok(signSwap.unsupported_terms.includes('UNSUPPORTED_NUMERIC_CLAIM'),negative)
 }

 for(const input of [
  {question:'Qual é a produção de soja e milho?',domain:'GENERAL',statement:'Soja: 100 sc; milho: 200 sc.'},
  {question:'Qual é o prazo da proposta e do contrato?',domain:'COMMERCIAL',statement:'Prazo da proposta: 10 dias; prazo do contrato: 20 dias.'},
  {question:'Qual é a margem?',domain:'COMMERCIAL',statement:'A margem é -10%.'},
  {question:'Qual é a margem?',domain:'COMMERCIAL',statement:'A margem é −10%.'}
 ]){
  const result=evaluateResponseGrounding({
   question:input.question,domain:input.domain,answer:input.statement,
   evidence:[scopedEvidence(input.statement,{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,true,`${input.statement}: ${result.unsupported_terms.join(', ')}`)
 }
})

for(const epistemicType of ['QUOTE','INFERENCE']){
 test(`grounding não promove evidência ${epistemicType} a FACT`,()=>{
  const result=evaluateResponseGrounding({
   question:'Qual foi a objeção comercial?',
   domain:'COMMERCIAL',
   answer:'O produtor rejeitou a proposta.',
   evidence:[scopedEvidence('O produtor rejeitou a proposta.',{epistemic_type:epistemicType})],
   activeProducerId:producerA,
   tenantId:tenantA
  })
  assert.equal(result.passed,false)
  assert.ok(result.claim_ledger.some(item=>item.type==='FACT'&&item.supported===false))
 })
}

test('grounding rejeita imperativo específico sem qualquer evidência selecionada',()=>{
 const result=evaluateResponseGrounding({
  question:'Como abordar a próxima visita?',
  domain:'VISIT',
  answer:'Envie o contrato hoje e confirme a assinatura.',
  evidence:[],
  activeProducerId:producerA,
  tenantId:tenantA
 })
 assert.equal(result.passed,false)
 assert.ok(result.claim_ledger.some(item=>item.type==='STRATEGY'&&item.supported===false))
})

test('grounding exige source id/type, tipo epistêmico e observed_at identificáveis',()=>{
 const complete=scopedEvidence('A última visita foi concluída.',{source_type:'visit'})
 for(const [field,reason] of [['id','MISSING_SOURCE_ID'],['source_type','MISSING_SOURCE_TYPE'],['epistemic_type','MISSING_EPISTEMIC_TYPE'],['observed_at','MISSING_OBSERVED_AT']]){
  const evidence={...complete};delete evidence[field]
  const result=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'A última visita foi concluída.',evidence:[evidence],activeProducerId:producerA,tenantId:tenantA,now})
  assert.equal(result.passed,false,field)
  assert.ok(result.provenance_violations.some(item=>item.reason_codes.includes(reason)),reason)
 }
})

test('scope GLOBAL não sustenta atributo individual nominal do produtor ativo',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual é a área de Matheus Nascimento Jaeger?',
  domain:'GENERAL',
  answer:'A área do produtor Matheus Nascimento Jaeger é 420 ha.',
  evidence:[{
   id:'global-producer-attribute',scope:'GLOBAL',tenant_id:tenantA,context_owner_id:ownerA,source_type:'system_capability',epistemic_type:'FACT',
   statement:'A área do produtor Matheus Nascimento Jaeger é 420 ha.'
  }],
  activeProducerId:producerA,tenantId:tenantA,ownerId:ownerA,now
 })
 assert.equal(result.passed,false)
 assert.deepEqual(result.scope_violations,['global-producer-attribute'])
 assert.ok(result.provenance_violations[0].reason_codes.includes('GLOBAL_PRODUCER_SPECIFIC_CLAIM'))
})

for(const [label,question,answer] of [
 ['cultivo elíptico','Explique quanto cultiva?','Cultiva 420 ha.'],
 ['patrimônio elíptico','Explique o patrimônio?','Patrimônio de R$ 9 milhões.'],
 ['total cultivado elíptico','O que é o total cultivado?','Total cultivado: 420 ha.']
]){
 test(`market_snapshot GLOBAL não sustenta atributo individual implícito: ${label}`,()=>{
  const result=evaluateResponseGrounding({
   question,
   domain:'GENERAL',
   answer,
   evidence:[{
    id:`global-market-${label}`,
    scope:'MARKET',tenant_id:tenantA,context_owner_id:ownerA,
    source_type:'market_snapshot',
    epistemic_type:'FACT',
    observed_at:'2026-08-30T11:00:00.000Z',
    statement:answer
   }],
   activeProducerId:producerA,
   tenantId:tenantA,
   ownerId:ownerA,
   now
  })
  assert.equal(result.passed,false,'GLOBAL não pode responder por elipse um atributo do produtor ativo')
 })
}

test('market_snapshot GLOBAL sustenta cotação genuinamente geral em turno com produtor ativo',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual é a cotação da soja no mercado?',
  domain:'GENERAL',
  answer:'A cotação da soja no mercado é R$ 132 por saca.',
  evidence:[{
   id:'global-market-soy-quote',
   scope:'MARKET',tenant_id:tenantA,context_owner_id:ownerA,
   source_type:'market_snapshot',
   epistemic_type:'FACT',
   observed_at:'2026-08-30T11:00:00.000Z',
   statement:'A cotação da soja no mercado é R$ 132 por saca.'
  }],
  activeProducerId:producerA,
  tenantId:tenantA,
  ownerId:ownerA,
  now
 })
 assert.equal(result.passed,true)
 assert.deepEqual(result.claim_ledger[0].evidence_refs,['global-market-soy-quote'])
})

test('market_snapshot falha fechado sem marcador MARKET, tenant ou owner originais',()=>{
 const base={
  id:'market-scope-proof',scope:'MARKET',tenant_id:tenantA,context_owner_id:ownerA,producer_id:null,
  source_type:'market_snapshot',epistemic_type:'FACT',observed_at:'2026-08-30T11:00:00.000Z',
  statement:'A cotação da soja no mercado é R$ 132 por saca.'
 }
 for(const [field,reason] of [['scope','MISSING_MARKET_SCOPE'],['tenant_id','MISSING_TENANT_ID'],['context_owner_id','MISSING_OWNER_ID']]){
  const evidence={...base};delete evidence[field]
  const result=evaluateResponseGrounding({question:'Qual é a cotação da soja no mercado?',domain:'GENERAL',answer:base.statement,evidence:[evidence],activeProducerId:producerA,tenantId:tenantA,ownerId:ownerA,now})
  assert.equal(result.passed,false,field)
  assert.ok(result.provenance_violations.some(item=>item.reason_codes.includes(reason)),reason)
 }
 const missingActiveOwner=evaluateResponseGrounding({question:'Qual é a cotação da soja no mercado?',domain:'GENERAL',answer:base.statement,evidence:[base],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(missingActiveOwner.passed,false)
 assert.ok(missingActiveOwner.provenance_violations.some(item=>item.reason_codes.includes('MISSING_ACTIVE_OWNER_ID')))
})

test('grounding rejeita aliases de escopo conflitantes na mesma evidência',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual foi a última visita?',answer:'A última visita ocorreu em 29/08/2026.',domain:'VISIT',activeProducerId:'producer-a',tenantId:'tenant-a',ownerId:'owner-a',
  evidence:[{id:'visit-a',source_type:'visit',epistemic_type:'FACT',producer_id:'producer-a',client_id:'producer-b',tenant_id:'tenant-a',organization_id:'tenant-b',owner_id:'owner-a',context_owner_id:'owner-b',observed_at:'2026-08-29T12:00:00.000Z',statement:'A última visita ocorreu em 29/08/2026.'}],
  now:new Date('2026-08-30T12:00:00.000Z')
 })
 assert.equal(result.passed,false)
 assert.deepEqual(result.scope_violations,['visit-a'])
 assert.deepEqual(result.provenance_violations[0].reason_codes,['PRODUCER_ALIAS_CONFLICT','TENANT_ALIAS_CONFLICT','OWNER_ALIAS_CONFLICT'])
})

test('grounding rejeita aliases conflitantes de fonte, epistemologia e tempo',()=>{
 const variants=[
  ['source type',{source_type:'visit',sourceType:'opportunity'},'SOURCE_TYPE_ALIAS_CONFLICT'],
  ['epistemic type',{epistemic_type:'FACT',evidence_type:'QUOTE'},'EPISTEMIC_TYPE_ALIAS_CONFLICT'],
  ['observed at',{observed_at:'2026-08-29T12:00:00.000Z',observedAt:'2026-08-28T12:00:00.000Z'},'OBSERVED_AT_ALIAS_CONFLICT'],
  ['valid until',{valid_until:'2026-09-30T12:00:00.000Z',validUntil:'2026-10-30T12:00:00.000Z'},'VALID_UNTIL_ALIAS_CONFLICT']
 ]
 for(const [label,aliases,reason] of variants){
  const evidence=scopedEvidence('A última visita ocorreu em 29/08/2026.',aliases)
  const result=evaluateResponseGrounding({
   question:'Qual foi a última visita?',answer:'A última visita ocorreu em 29/08/2026.',domain:'VISIT',
   activeProducerId:producerA,tenantId:tenantA,evidence:[evidence],now
  })
  assert.equal(result.passed,false,label)
  assert.deepEqual(result.scope_violations,['evidence-a'],label)
  assert.ok(result.provenance_violations[0].reason_codes.includes(reason),`${label}: ${result.provenance_violations[0].reason_codes.join(', ')}`)
 }
})

test('grounding bloqueia piggyback semântico mesmo com alta sobreposição e conectores variados',()=>{
 const supported='O produtor acompanha indicadores de custo, produtividade, margem, risco, histórico e retorno antes de decidir'
 const evidence=[scopedEvidence(`${supported}.`)]
 for(const connector of ['e','bem como','além disso','mas','porém','contudo','entretanto']){
  const result=evaluateResponseGrounding({
   question:'Resuma a leitura comportamental confirmada.',domain:'GENERAL',
   answer:`${supported} ${connector} possui dívida oculta.`,evidence,
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,connector)
  assert.ok(result.claim_ledger.some(item=>item.supported===false&&item.reason_code==='UNSUPPORTED_SEMANTIC_TAIL'),connector)
 }
})

test('grounding audita todas as afirmações, inclusive depois da quadragésima',()=>{
 const supported=Array.from({length:40},(_,index)=>`Registro ${index+1} confirmado.`)
 const answer=[...supported,'Ele quer travar um contrato de grãos.'].join(' ')
 const evidence=supported.map((statement,index)=>({id:`source-${index+1}`,source_type:'system_capability',epistemic_type:'FACT',producer_id:'producer-a',tenant_id:'tenant-a',owner_id:'owner-a',observed_at:'2026-08-30T11:00:00.000Z',statement}))
 const result=evaluateResponseGrounding({question:'Resuma os registros confirmados.',answer,domain:'GENERAL',activeProducerId:'producer-a',tenantId:'tenant-a',ownerId:'owner-a',evidence})
 assert.equal(result.claim_ledger.length,41)
 assert.equal(result.passed,false)
 assert.equal(result.claim_ledger[40].supported,false)
})

test('quadragésima primeira afirmação não esconde piggyback em evidência longa',()=>{
 const supported=Array.from({length:40},(_,index)=>`Registro ${index+1} confirmado.`)
 const groundedLead='O produtor acompanha indicadores de custo, produtividade, margem, risco, histórico e retorno antes de decidir'
 const answer=[...supported,`${groundedLead} e possui dívida oculta.`].join(' ')
 const evidence=[
  ...supported.map((statement,index)=>({id:`source-${index+1}`,source_type:'system_capability',epistemic_type:'FACT',producer_id:producerA,tenant_id:tenantA,owner_id:ownerA,observed_at:'2026-08-30T11:00:00.000Z',statement})),
  {id:'source-41',source_type:'system_capability',epistemic_type:'FACT',producer_id:producerA,tenant_id:tenantA,owner_id:ownerA,observed_at:'2026-08-30T11:00:00.000Z',statement:`${groundedLead}.`}
 ]
 const result=evaluateResponseGrounding({question:'Resuma os registros confirmados.',answer,domain:'GENERAL',activeProducerId:producerA,tenantId:tenantA,ownerId:ownerA,evidence,now})
 assert.equal(result.claim_ledger.length,41)
 assert.equal(result.passed,false)
 assert.equal(result.claim_ledger[40].supported,false)
 assert.equal(result.claim_ledger[40].reason_code,'UNSUPPORTED_SEMANTIC_TAIL')
})

test('grounding permite scheduled future somente com lifecycle planejado',()=>{
 const scheduled=scopedEvidence('A próxima visita está agendada para 31/08/2026.',{source_type:'scheduled_visit',observed_at:'2026-08-31T12:00:00.000Z',lifecycle_status:'PLANNED'})
 const input={question:'Qual é a próxima visita?',domain:'VISIT',answer:'A próxima visita está agendada para 31/08/2026.',activeProducerId:producerA,tenantId:tenantA,now}
 assert.equal(evaluateResponseGrounding({...input,evidence:[scheduled]}).passed,true)
 const invalid=evaluateResponseGrounding({...input,evidence:[{...scheduled,lifecycle_status:'DRAFT'}]})
 assert.equal(invalid.passed,false)
 assert.deepEqual(invalid.temporal_violations,['evidence-a'])
})

test('grounding bloqueia quote antiga como intenção atual e polaridade contraditória',()=>{
 const stale=evaluateResponseGrounding({question:'Qual é a intenção atual?',domain:'GENERAL',answer:'O produtor pretende vender.',evidence:[scopedEvidence('O produtor quer vender.',{source_type:'visit_quote',epistemic_type:'QUOTE',observed_at:'2010-01-01T00:00:00.000Z'})],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(stale.passed,false)
 assert.deepEqual(stale.temporal_violations,['evidence-a'])
 const polarity=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'A visita não ocorreu em Passo Fundo.',evidence:[scopedEvidence('A visita ocorreu em Passo Fundo.')],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(polarity.passed,false)
 assert.ok(polarity.unsupported_terms.includes('POLARITY_CONTRADICTION'))
})

test('grounding não promove negação epistêmica ou factual a afirmação positiva',()=>{
 const cases=[
  {question:'Qual é a situação do crédito?',domain:'CREDIT',evidence:'Não há confirmação de que o crédito está bloqueado.',answer:'O crédito está bloqueado.'},
  {question:'Qual é a situação do contrato de grãos?',domain:'GRAINS',evidence:'Não foi confirmado que o contrato de grãos está travado.',answer:'O contrato de grãos está travado.'},
  {question:'Matheus possui dívida oculta?',domain:'CREDIT',evidence:'É falso afirmar que Matheus possui dívida oculta.',answer:'Matheus possui dívida oculta.'},
  {question:'Qual é a situação do crédito?',domain:'CREDIT',evidence:'É falso que o crédito está bloqueado.',answer:'O crédito está bloqueado.'},
  {question:'Qual é a situação do crédito?',domain:'CREDIT',evidence:'É incorreto afirmar que o crédito está bloqueado.',answer:'O crédito está bloqueado.'},
  {question:'Qual é a situação do crédito?',domain:'CREDIT',evidence:'A afirmação de que o crédito está bloqueado é falsa.',answer:'O crédito está bloqueado.'},
  {question:'Qual é a situação do crédito?',domain:'CREDIT',evidence:'A hipótese de que o crédito está bloqueado não foi confirmada.',answer:'O crédito está bloqueado.'}
 ]
 for(const item of cases){
  const result=evaluateResponseGrounding({
   question:item.question,domain:item.domain,answer:item.answer,
   evidence:[scopedEvidence(item.evidence,{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,item.evidence)
  assert.ok(result.unsupported_terms.includes('POLARITY_CONTRADICTION'),item.evidence)
  assert.ok(result.claim_ledger.some(claim=>!claim.supported&&claim.reason_code==='POLARITY_CONTRADICTION'),item.evidence)
 }
})

test('grounding preserva polaridades positivas, negativas e epistêmicas compatíveis',()=>{
 const cases=[
  {evidence:'O crédito está bloqueado.',answer:'O crédito está bloqueado.'},
  {evidence:'O crédito não está bloqueado.',answer:'O crédito não está bloqueado.'},
  {evidence:'Não há confirmação de que o crédito está bloqueado.',answer:'Não há confirmação de que o crédito está bloqueado.'},
  {evidence:'É falso afirmar que o crédito está bloqueado.',answer:'O crédito não está bloqueado.'}
 ]
 for(const item of cases){
  const result=evaluateResponseGrounding({
   question:'Qual é a situação do crédito?',domain:'CREDIT',answer:item.answer,
   evidence:[scopedEvidence(item.evidence,{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.claim_ledger.length,1,item.evidence)
  assert.equal(result.claim_ledger[0].supported,true,item.evidence)
  assert.equal(result.unsupported_terms.includes('POLARITY_CONTRADICTION'),false,item.evidence)
 }
})

test('grounding não cria contradição entre ocorrências quando a afirmação consta literalmente na evidência',()=>{
 const statement='O registro foi encontrado. O registro pode não refletir um fato ainda não salvo.'
 const result=evaluateResponseGrounding({
  question:'Qual é a incerteza do registro?',domain:'COMMERCIAL',answer:'O registro pode não refletir um fato ainda não salvo.',
  evidence:[scopedEvidence(statement,{source_type:'business_event'})],activeProducerId:producerA,tenantId:tenantA,now,checkQuestionRelevance:false
 })
 assert.equal(result.passed,true)
 assert.equal(result.unsupported_terms.includes('POLARITY_CONTRADICTION'),false)
})

test('grounding bloqueia tails factuais curtos e siglas sem evidência',()=>{
 for(const tail of ['é mau','é VIP','é MEI','é réu','tem CPF','usa IA','tem boi','é bom']){
  const result=evaluateResponseGrounding({
   question:'O que o produtor pediu?',domain:'GENERAL',answer:`O produtor pediu ROI e ${tail}.`,
   evidence:[scopedEvidence('O produtor pediu ROI.',{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,tail)
  assert.ok(result.unsupported_terms.includes('UNSUPPORTED_SEMANTIC_TAIL'),`${tail}: ${result.unsupported_terms.join(', ')}`)
 }
})

test('grounding preserva termos curtos quando a evidência os contém',()=>{
 for(const statement of ['O produtor pediu ROI.','O produtor pediu ROI e é VIP.','O produtor pediu ROI e tem CPF.','O produtor pediu ROI e usa IA.']){
  const result=evaluateResponseGrounding({
   question:'O que o produtor pediu?',domain:'GENERAL',answer:statement,
   evidence:[scopedEvidence(statement,{source_type:'business_event'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,true,`${statement}: ${result.unsupported_terms.join(', ')}`)
 }
})

test('grounding exige suporte para ação e termos materiais de STRATEGY específica',()=>{
 const result=evaluateResponseGrounding({question:'Como agir sobre o contrato?',domain:'COMMERCIAL',answer:'Envie o contrato hoje.',evidence:[scopedEvidence('O produtor mencionou o contrato em conversa comercial.',{source_type:'opportunity'})],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(result.passed,false)
 assert.ok(result.unsupported_terms.includes('UNSUPPORTED_MATERIAL_STRATEGY'))
})

test('grounding diferencia intenção dentro do mesmo domínio',()=>{
 const latest=evaluateResponseGrounding({question:'Qual foi a última visita?',domain:'VISIT',answer:'A próxima visita está agendada amanhã.',evidence:[scopedEvidence('A próxima visita está agendada amanhã.',{source_type:'scheduled_visit',observed_at:'2026-08-31T12:00:00.000Z',lifecycle_status:'PLANNED'})],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(latest.passed,false)
 assert.equal(latest.question_relevance,'FAIL')
 const objection=evaluateResponseGrounding({question:'Qual foi a objeção comercial?',domain:'COMMERCIAL',answer:'O preço registrado é R$ 100.',evidence:[scopedEvidence('O preço registrado é R$ 100.',{source_type:'business_event'})],activeProducerId:producerA,tenantId:tenantA,now})
 assert.equal(objection.passed,false)
 assert.equal(objection.question_relevance,'FAIL')
})

test('grounding distingue orientação processual determinística de conteúdo cross-domain',()=>{
 const process=evaluateReasoningGrounding({
  question:'Como responder à objeção comercial?',domain:'COMMERCIAL',evidence:[],activeProducerId:producerA,tenantId:tenantA,now,
  blocks:{'decision_interview.questions.0.why':'A frase real ajuda a distinguir preço, risco, confiança, timing ou falta de valor percebido.'}
 })
 assert.deepEqual(process.unsupported_claims,[])
 assert.ok(process.claim_ledger.every(item=>item.supported))
 const poison=evaluateReasoningGrounding({
  question:'qual o perfil dele?',domain:'PROFILE',evidence:[],activeProducerId:producerA,tenantId:tenantA,now,
  blocks:{'decision_interview.questions.0.why':'O contrato de grãos travado muda a recomendação de perfil.'}
 })
 assert.equal(poison.passed,false)
 assert.ok(poison.unsupported_terms.includes('UNSUPPORTED_CROSS_DOMAIN_CLAIM'))
})

test('insuficiência explícita não mascara afirmações materiais ou cross-domain',()=>{
 const poisons=[
  ['grãos','Por quê: não há dados suficientes; porém ele quer travar contrato de grãos.','UNSUPPORTED_CROSS_DOMAIN_CLAIM'],
  ['crédito','Por quê: não há dados suficientes; porém há uma pendência no CPF financeiro.','UNSUPPORTED_CROSS_DOMAIN_CLAIM'],
  ['produto','Por quê: não há dados suficientes; porém ele quer relançar o produto.','UNSUPPORTED_MATERIAL_INSUFFICIENCY'],
  ['comportamento específico','Por quê: não há dados suficientes; porém ele pediu um comparativo.','UNSUPPORTED_MATERIAL_INSUFFICIENCY'],
  ['perfil específico','Por quê: não há dados suficientes; porém é analítico.','UNSUPPORTED_MATERIAL_INSUFFICIENCY']
 ]
 for(const [label,answer,reason] of poisons){
  const result=evaluateResponseGrounding({question:'qual o perfil dele?',domain:'PROFILE',answer,evidence:[],activeProducerId:producerA,tenantId:tenantA,now})
  assert.equal(result.passed,false,label)
  assert.equal(result.question_relevance,'FAIL',label)
  assert.ok(result.unsupported_terms.includes(reason),`${label}: ${result.unsupported_terms.join(', ')}`)
 }
})

test('insuficiência explícita pura permanece uma resposta segura sem evidência',()=>{
 const result=evaluateResponseGrounding({
  question:'qual o perfil dele?',domain:'PROFILE',
  answer:'Não há dados suficientes para determinar o perfil comportamental.',
  evidence:[],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(result.passed,true)
 assert.equal(result.question_relevance,'PASS')
 assert.ok(result.claim_ledger.every(item=>item.supported&&item.reason_code==='EXPLICIT_INSUFFICIENT_EVIDENCE'))
})

test('insuficiência factual usa template canônico sem nome livre nem outro domínio',()=>{
 const safe=evaluateResponseGrounding({question:'Qual foi a última visita?',answer:'Ainda não há visita concluída registrada com referência auditável.',domain:'VISIT',evidence:[],activeProducerId:'client-a',tenantId:'tenant-a',ownerId:'owner-a'})
 assert.equal(safe.passed,true)
 assert.equal(safe.claim_ledger[0].reason_code,'EXPLICIT_INSUFFICIENT_EVIDENCE')

 const freeName=evaluateResponseGrounding({question:'Qual foi a última visita?',answer:'Ainda não há visita concluída registrada para João na carteira autorizada.',domain:'VISIT',evidence:[],activeProducerId:'client-a',tenantId:'tenant-a',ownerId:'owner-a'})
 assert.equal(freeName.passed,false)

 const poisoned=evaluateResponseGrounding({question:'Qual foi a última visita?',answer:'Ainda não há visita concluída nem contrato registrado para João.',domain:'VISIT',evidence:[],activeProducerId:'client-a',tenantId:'tenant-a',ownerId:'owner-a'})
 assert.equal(poisoned.passed,false)
 assert.ok(poisoned.unsupported_terms.includes('UNSUPPORTED_MATERIAL_INSUFFICIENCY'))
})

test('grounding exige suporte exato para detalhes temporal e local',()=>{
 const evidence=[scopedEvidence('A última visita ocorreu hoje.')]
 const input={question:'Qual foi a última visita?',domain:'VISIT',evidence,activeProducerId:producerA,tenantId:tenantA,now}
 const exact=evaluateResponseGrounding({...input,answer:'A última visita ocorreu hoje.'})
 assert.equal(exact.passed,true)

 const stale=evaluateResponseGrounding({...input,answer:'A última visita ocorreu ontem.'})
 assert.equal(stale.passed,false)
 assert.ok(stale.unsupported_terms.includes('UNSUPPORTED_TEMPORAL_DETAIL'))

 const inventedLocation=evaluateResponseGrounding({...input,answer:'A última visita ocorreu hoje em Cascavel.'})
 assert.equal(inventedLocation.passed,false)
 assert.ok(inventedLocation.unsupported_terms.includes('UNSUPPORTED_LOCATION_DETAIL'))

 const locatedEvidence=[scopedEvidence('A última visita ocorreu hoje em Cascavel.')]
 const exactLocation=evaluateResponseGrounding({...input,evidence:locatedEvidence,answer:'A última visita ocorreu hoje em Cascavel.'})
 assert.equal(exactLocation.passed,true)

 const statusEvidence=[scopedEvidence('O status da última visita é análise hoje.')]
 const nonLocation=evaluateResponseGrounding({...input,evidence:statusEvidence,answer:'A última visita está hoje em Análise.'})
 assert.equal(nonLocation.passed,true,'status capitalizado não deve ser confundido com local')
})

test('PROFILE bloqueia hard foreign e estado comercial mesmo com verbo comportamental',()=>{
 for(const statement of ['Pediu comparativo antes do travamento de contrato de grãos.','Pediu comparativo antes da negociação da proposta.']){
  const evidence=scopedEvidence(statement,{source_type:'behavioral_profile_evidence',epistemic_type:'OBSERVATION',valid_until:'2027-08-30T12:00:00.000Z'})
  const result=evaluateResponseGrounding({question:'qual o perfil dele?',domain:'PROFILE',answer:'Perfil principal: Analítico. Confiança: média. Por quê: pediu comparativos. Como abordar: use dados.',evidence:[evidence],activeProducerId:producerA,tenantId:tenantA,now})
  assert.equal(result.passed,false,statement)
  assert.deepEqual(result.incompatible_evidence,['evidence-a'])
 }
})

test('FAST profile falha fechado para evidence de outro producer',()=>{
 assertFastProfileEvidenceFailsClosed({
  id:'profile-evidence-foreign-producer',
  producer_id:producerB,
  tenant_id:tenantA,
  valid_until:'2026-09-30T12:00:00.000Z'
 })
})

test('FAST profile falha fechado para evidence de outro tenant',()=>{
 assertFastProfileEvidenceFailsClosed({
  id:'profile-evidence-foreign-tenant',
  producer_id:producerA,
  tenant_id:tenantB,
  valid_until:'2026-09-30T12:00:00.000Z'
 })
})

test('FAST profile falha fechado quando a própria evidence está expirada',()=>{
 assertFastProfileEvidenceFailsClosed({
  id:'profile-evidence-expired',
  producer_id:producerA,
  tenant_id:tenantA,
  valid_until:'2026-08-29T12:00:00.000Z'
 })
})

for(const [container,key] of [
 ['data','statement'],['data','summary'],['data','description'],['data','objective'],
 ['value','statement'],['value','description']
]){
 test(`grounding não promove ${container}.${key} sem proveniência própria`,()=>{
  const topStatement='A última visita ocorreu hoje em Passo Fundo.'
  const nestedStatement='A última visita ocorreu ontem em Cascavel.'
  const evidence=scopedEvidence(topStatement,{
   [container]:{
    [key]:nestedStatement,
    source_ref:'forged:nested-origin',
    source_type:'opportunity',
    epistemic_type:'VALIDATED_KNOWLEDGE'
   }
  })
  const input={question:'Qual foi a última visita?',domain:'VISIT',evidence:[evidence],activeProducerId:producerA,tenantId:tenantA,now}
  const top=evaluateResponseGrounding({...input,answer:topStatement})
  assert.equal(top.passed,true,'o registro top-level canônico deve continuar utilizável')
  assert.deepEqual(top.claim_ledger[0].evidence_refs,['evidence-a'])

  const nested=evaluateResponseGrounding({...input,answer:nestedStatement})
  assert.equal(nested.passed,false,'o subrecord sem identidade/escopo próprios não pode sustentar resposta')
  assert.equal(nested.claim_ledger[0].supported,false)
 })
}

test('evidence formada somente por payload aninhado falha com statement canônico ausente',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual foi a última visita?',domain:'VISIT',answer:'A última visita ocorreu hoje.',
  evidence:[scopedEvidence(undefined,{data:{summary:'A última visita ocorreu hoje.'}})],
  activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(result.passed,false)
 assert.ok(result.provenance_violations[0].reason_codes.includes('MISSING_SEMANTIC_STATEMENT'))
 assert.equal(result.claim_ledger[0].supported,false)
})

test('source_ref não substitui identidade auditável nem aparece como suporte forjado',()=>{
 const sourceRefOnly=scopedEvidence('A última visita ocorreu hoje.',{source_ref:'forged:visit'})
 delete sourceRefOnly.id
 const rejected=evaluateResponseGrounding({
  question:'Qual foi a última visita?',domain:'VISIT',answer:'A última visita ocorreu hoje.',
  evidence:[sourceRefOnly],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(rejected.passed,false)
 assert.ok(rejected.provenance_violations[0].reason_codes.includes('MISSING_SOURCE_ID'))

 const derived=scopedEvidence('A última visita ocorreu hoje.',{id:'derived:visit-summary',source_ref:'visit:canonical'})
 const accepted=evaluateResponseGrounding({
  question:'Qual foi a última visita?',domain:'VISIT',answer:'A última visita ocorreu hoje.',
  evidence:[derived],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(accepted.passed,true)
 assert.deepEqual(accepted.claim_ledger[0].evidence_refs,['derived:visit-summary'])
 assert.equal(accepted.claim_ledger[0].evidence_refs.includes('visit:canonical'),false)
})

test('aliases de identidade canônica conflitantes falham; source_ref continua relação derivada',()=>{
 const result=evaluateResponseGrounding({
  question:'Qual foi a última visita?',domain:'VISIT',answer:'A última visita ocorreu hoje.',
  evidence:[scopedEvidence('A última visita ocorreu hoje.',{
   id:'source-a',source_id:'source-b',memory_ref:'source-c',source_ref:'visit:legitimate-parent'
  })],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(result.passed,false)
 assert.deepEqual(result.scope_violations,['source-a'])
 assert.ok(result.provenance_violations[0].reason_codes.includes('SOURCE_ID_ALIAS_CONFLICT'))
 assert.equal(result.claim_ledger[0].evidence_refs.includes('visit:legitimate-parent'),false)
})

test('relações derivadas de questionnaire e behavioral_profile preservam id próprio',()=>{
 const questionnaire=evaluateResponseGrounding({
  question:'O que ele pediu antes de decidir?',domain:'PROFILE',answer:'Pediu dados comparáveis antes de decidir.',checkQuestionRelevance:false,
  evidence:[{
   id:'profile-answer-7',source_ref:'producer_360:profile-a',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',
   producer_id:producerA,tenant_id:tenantA,observed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',
   statement:'Pediu dados comparáveis antes de decidir.'
  }],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(questionnaire.passed,true)
 assert.deepEqual(questionnaire.claim_ledger[0].evidence_refs,['profile-answer-7'])

 const profile=evaluateResponseGrounding({
  question:'qual o perfil dele?',domain:'PROFILE',answer:'Perfil principal: Analítico.',field:'key_signals.0',checkQuestionRelevance:false,
  evidence:[{
   id:'profile-inference:a1',source_ref:'profile-answer-7',source_type:'behavioral_profile',epistemic_type:'INFERENCE',
   producer_id:producerA,tenant_id:tenantA,observed_at:'2026-08-01T12:00:00.000Z',valid_until:'2027-08-01T12:00:00.000Z',
   statement:'Perfil principal: Analítico.'
  }],activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(profile.passed,true)
 assert.deepEqual(profile.claim_ledger[0].evidence_refs,['profile-inference:a1'])
})

test('source_type fora do contrato não recebe privilégio temporal ou epistêmico',()=>{
 for(const sourceType of ['business_events','credit_state','arbitrary_source','memory','val_memory','confirmed_memory','facts','validated_knowledge','context']){
  const result=evaluateResponseGrounding({
   question:'Qual é o registro confirmado?',domain:'GENERAL',answer:'O registro está confirmado.',
   evidence:[scopedEvidence('O registro está confirmado.',{source_type:sourceType,observed_at:'2010-01-01T00:00:00.000Z'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,sourceType)
  assert.ok(result.provenance_violations[0].reason_codes.includes('UNSUPPORTED_SOURCE_TYPE'),sourceType)
 }
})

test('fontes mutáveis canônicas não podem ocultar estado de 2010',()=>{
 for(const sourceType of ['opportunity','context_snapshot','system_capability']){
  const result=evaluateResponseGrounding({
   question:'Qual é o registro confirmado?',domain:'GENERAL',answer:'O registro está confirmado.',
   evidence:[scopedEvidence('O registro está confirmado.',{source_type:sourceType,observed_at:'2010-01-01T00:00:00.000Z',valid_until:'2030-01-01T00:00:00.000Z'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,sourceType)
  assert.deepEqual(result.temporal_violations,['evidence-a'],sourceType)
 }
})

test('conversation_turn não pode ser promovido a VALIDATED_KNOWLEDGE',()=>{
 const promoted=evaluateResponseGrounding({
  question:'O que foi confirmado?',domain:'GENERAL',answer:'O produtor confirmou o contrato.',checkQuestionRelevance:false,
  evidence:[scopedEvidence('O produtor confirmou o contrato.',{source_type:'conversation_turn',epistemic_type:'VALIDATED_KNOWLEDGE'})],
  activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(promoted.passed,false)
 assert.ok(promoted.provenance_violations[0].reason_codes.includes('SOURCE_EPISTEMIC_MISMATCH'))

 const scopedInference=evaluateResponseGrounding({
  question:'Resume.',domain:'GENERAL',answer:'Resumo inferido da resposta anterior.',field:'session_turn.reading',checkQuestionRelevance:false,
  evidence:[scopedEvidence('Resumo inferido da resposta anterior.',{source_type:'conversation_turn',epistemic_type:'INFERENCE'})],
  activeProducerId:producerA,tenantId:tenantA,now
 })
 assert.equal(scopedInference.passed,true)
 assert.deepEqual(scopedInference.claim_ledger[0].evidence_refs,['evidence-a'])
})

test('fontes observacionais e de entrada não promovem conteúdo a VALIDATED_KNOWLEDGE',()=>{
 for(const sourceType of ['visit','visit_report','confirmed_visit_report','confirmed_voice_interaction','interaction','field_report','manual_record','consultant_input','soil_analysis']){
  const result=evaluateResponseGrounding({
   question:'Qual é o registro confirmado?',domain:'GENERAL',answer:'O registro está confirmado.',
   evidence:[scopedEvidence('O registro está confirmado.',{source_type:sourceType,epistemic_type:'VALIDATED_KNOWLEDGE'})],
   activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,sourceType)
  assert.ok(result.provenance_violations[0].reason_codes.includes('SOURCE_EPISTEMIC_MISMATCH'),sourceType)
 }
})

test('somente fontes estáticas declaradas podem omitir observed_at',()=>{
 for(const sourceType of ['client_record','crop_season','context_snapshot','system_capability','calculation','opportunity','producer_questionnaire']){
  const evidence=scopedEvidence('O registro está confirmado.',{source_type:sourceType})
  delete evidence.observed_at
  if(sourceType==='producer_questionnaire')evidence.valid_until='2027-08-30T12:00:00.000Z'
  const result=evaluateResponseGrounding({
   question:'Qual é o registro confirmado?',domain:'GENERAL',answer:'O registro está confirmado.',
   evidence:[evidence],activeProducerId:producerA,tenantId:tenantA,now
  })
  assert.equal(result.passed,false,sourceType)
  assert.ok(result.provenance_violations[0].reason_codes.includes('MISSING_OBSERVED_AT'),sourceType)
 }
})
