import assert from 'node:assert/strict'
import {readFileSync,statSync} from 'node:fs'
import test from 'node:test'
import {validateAIReasoningResult} from '../server/ai-reasoning/contracts.js'
import {buildDecisionInterview,buildReasoningConfidence} from '../server/ai-reasoning/decision-interview.js'
import {legacyIntentAliases,normalizeValIntent,routeValIntent,valIntents} from '../server/ai-reasoning/intent-router.js'
import {buildSessionReplyMessage} from '../src/lib/global-val-conversation.js'
import {
 answerCurrentMarket,
 buildFastClientResponse,
 buildFastMarketResponse,
 reasoningPathVersion,
 routeSystemCapability,
 systemCapabilities,
 systemCapabilityRouterVersion
} from '../server/decision-copilot/capability-router.js'

const root=new URL('../',import.meta.url)
const read=path=>readFileSync(new URL(path,root),'utf8')
const exists=path=>statSync(new URL(path,root)).isFile()

const requiredDocuments=[
 ['VAL_DECISION_COPILOT_v3.md',['System Capability Router','FAST','DEEP','não promove']],
 ['VAL_DECISION_INTERVIEW_v1.md',['SESSION_CONTEXT','MATERIAL','CONFIRMED_MEMORY']],
 ['VAL_VOICE_DECISION_v1.md',['Web Speech','persistence: NONE','fallback']],
 ['VAL_AGRONOMIC_WORKSPACE_v2.md',['headless','valor360:navigate','sidebar']],
 ['VAL_AGRONOMIC_LINKING_v1.md',['UNLINKED','linkHistory','externalId']],
 ['VAL_SYSTEM_CAPABILITY_ROUTER_v1.md',['ASK_COMMODITY','current_data_required','CONFIRM_REQUIRED']],
 ['VAL_FAST_DEEP_REASONING_v1.md',['provider spy','p50','p95']],
 ['VAL_MARKET_COMMODITY_ACCESS_v1.md',['CURRENT','STALE','UNAVAILABLE']],
 ['VAL_REASONING_CONFIDENCE_v1.md',['context','thesis','agronomy']],
 ['VAL_COPILOT_UX_v3.md',['Desktop','Mobile','UAT']]
]

// Matriz rastreável dos 30 cenários pedidos. `coverage` descreve o tipo de
// evidência necessário; não transforma UAT ou regressão futura em PASS.
const mandatoryMatrix=[
 [1,'perguntar sem visita','AUTOMATED',['test/val-ai-copilot-v2.test.js']],
 [2,'perguntar dentro do produtor','AUTOMATED',['test/val-ai-copilot-v2.test.js']],
 [3,'perguntar mercado','CONTRACT',['server/decision-copilot/capability-router.js']],
 [4,'perguntar commodity','CONTRACT',['server/decision-copilot/capability-router.js']],
 [5,'perguntar agronomia','INTEGRATION',['test/prepare-visit-quality.test.js']],
 [6,'análise de solo sem vínculo','CONTRACT',['VAL_AGRONOMIC_LINKING_v1.md','manual/app/page.tsx']],
 [7,'vincular análise','CONTRACT',['VAL_AGRONOMIC_LINKING_v1.md','manual/app/page.tsx']],
 [8,'desvincular análise','CONTRACT',['VAL_AGRONOMIC_LINKING_v1.md','manual/app/page.tsx']],
 [9,'cruzar análise com produtor','INTEGRATION',['server/decision-intelligence.js']],
 [10,'voz entrada','INTEGRATION',['test/voice-capture-service.test.js']],
 [11,'voz saída','AUTOMATED',['test/val-voice-output-frontend.test.js']],
 [12,'VAL faz pergunta','CONTRACT',['server/ai-reasoning/decision-interview.js']],
 [13,'consultor responde','INTEGRATION',['test/conversation-orchestrator.test.js']],
 [14,'premissas recalculadas','CONTRACT',['server/ai-reasoning/index.js']],
 [15,'memória não muda em ASK','INTEGRATION',['test/voice-capture-service.test.js']],
 [16,'memória muda após REGISTER confirmado','INTEGRATION',['test/voice-capture-service.test.js']],
 [17,'perguntas específicas','AUTOMATED',['test/prepare-visit-quality.test.js']],
 [18,'NAME_SWAP_TEST','AUTOMATED',['test/val-ai-copilot-v2.test.js']],
 [19,'FAST PATH','CONTRACT',['server/decision-copilot/capability-router.js']],
 [20,'DEEP PATH','CONTRACT',['server/decision-copilot/capability-router.js']],
 [21,'Biblioteca','INTEGRATION',['test/knowledge-library.test.js']],
 [22,'Manual','INTEGRATION',['test/ingestion.test.js']],
 [23,'MIA','INTEGRATION',['test/technical-safety-audit.test.js']],
 [24,'commercial + agronomic reasoning','INTEGRATION',['test/prepare-visit-quality.test.js']],
 [25,'current data','CONTRACT',['server/decision-copilot/capability-router.js']],
 [26,'cross-tenant','POSTGRES',['test/phase1-tenant-isolation.test.js']],
 [27,'safety','INTEGRATION',['test/technical-safety-audit.test.js']],
 [28,'mobile','PHYSICAL_UAT',['VAL_COPILOT_UX_v3.md']],
 [29,'desktop','BROWSER_UAT',['VAL_COPILOT_UX_v3.md']],
 [30,'regressão completa','REGRESSION',['package.json']]
].map(([id,scenario,coverage,evidence])=>({id,scenario,coverage,evidence}))

test('documentação v3 — os dez contratos existem e declaram seus limites materiais',()=>{
 assert.equal(requiredDocuments.length,10)
 for(const [path,markers] of requiredDocuments){
  assert.equal(exists(path),true,path)
  const content=read(path)
 assert.match(content,/^# /,path)
  for(const marker of markers)assert.ok(content.includes(marker),`${path}: ${marker}`)
 }
})

test('matriz v3 — os 30 cenários têm dono de evidência sem converter UAT em teste automático',()=>{
 assert.equal(mandatoryMatrix.length,30)
 assert.deepEqual(mandatoryMatrix.map(item=>item.id),Array.from({length:30},(_,index)=>index+1))
 assert.equal(new Set(mandatoryMatrix.map(item=>item.scenario)).size,30)
 for(const item of mandatoryMatrix){
  assert.ok(item.evidence.length>0,`cenário ${item.id}`)
  for(const path of item.evidence)assert.equal(exists(path),true,`${item.id}: ${path}`)
 }
 assert.equal(mandatoryMatrix.find(item=>item.id===28).coverage,'PHYSICAL_UAT')
 assert.equal(mandatoryMatrix.find(item=>item.id===29).coverage,'BROWSER_UAT')
 assert.equal(mandatoryMatrix.find(item=>item.id===30).coverage,'REGRESSION')
})

test('Intent Router v2 — intents canônicos, aliases e persistência permanecem governados',()=>{
 assert.equal(valIntents.length,17)
 assert.equal(new Set(valIntents).size,valIntents.length)
 assert.equal(legacyIntentAliases.REGISTER_NOTE,'REGISTER_INFORMATION')
 assert.equal(normalizeValIntent('soil_interpretation'),'ANALYZE_SOIL')
 assert.equal(normalizeValIntent('desconhecido'),null)
 const market=routeValIntent({message:'Qual é o preço da soja hoje?',hasClient:false})
 assert.equal(market.intent,'ASK_COMMODITY')
 assert.equal(routeValIntent({message:'Me prepare para uma conversa comercial com este produtor.',intentHint:'ASK_COMMODITY',hasClient:true}).intent,'PREPARE_VISIT')
 assert.equal(routeValIntent({message:'Me prepare para visitar João amanhã.',hasClient:true}).intent,'PREPARE_VISIT')
 assert.equal(routeValIntent({message:'Como isso afeta ele?',intentHint:'ASK_COMMODITY',hasClient:true}).intent,'ASK_COMMODITY')
 assert.equal(routeValIntent({message:'E para milho?',intentHint:'ASK_COMMODITY',hasClient:true}).intent,'ASK_COMMODITY')
 assert.equal(market.client_context_required,false)
 assert.equal(market.requires_current_data,true)
 assert.equal(market.persistence_mode,'NONE')
 const register=routeValIntent({intentHint:'REGISTER_NOTE',hasClient:true})
 assert.equal(register.intent,'REGISTER_INFORMATION')
 assert.equal(register.persistence_mode,'CONFIRM_REQUIRED')
})

test('Capability Router — FAST é direto e DEEP cruza contexto sem conceder permissão',()=>{
 assert.equal(systemCapabilityRouterVersion,'val.system_capability_router.v1')
 assert.equal(reasoningPathVersion,'val.fast_deep_reasoning.v1')
 assert.ok(systemCapabilities.includes('MARKET_COMMODITY'))
 assert.ok(systemCapabilities.includes('VOICE_OUTPUT'))

 const visit=routeSystemCapability({message:'Qual foi a última visita?',hasClient:true})
 assert.equal(visit.path,'FAST')
 assert.equal(visit.direct,true)
 assert.deepEqual(visit.capabilities,['VISIT_HISTORY'])

 const quote=routeSystemCapability({message:'Qual é o preço da soja hoje?',hasClient:false})
 assert.equal(quote.path,'LIVE_DATA')
 assert.equal(quote.current_data_required,true)
 assert.equal(quote.client_context_required,false)

 const impact=routeSystemCapability({message:'Como a soja de hoje muda a negociação desta conta?',intentHint:'ASK_COMMODITY',hasClient:true})
 assert.equal(impact.path,'DEEP')
 assert.ok(impact.capabilities.includes('MARKET_COMMODITY'))

 const agronomy=routeSystemCapability({message:'Cruze o manejo agronômico com o histórico do talhão.',hasClient:true})
 assert.equal(agronomy.path,'DEEP')
 assert.ok(agronomy.capabilities.includes('AGRONOMIC_WORKSPACE'))
 assert.ok(agronomy.capabilities.includes('AGRONOMIST_MANUAL'))
})

test('current data — fonte e data são obrigatórias; referência antiga nunca vira preço de hoje',()=>{
 const now=new Date('2026-08-25T15:00:00.000Z')
 const workspace={marketSnapshots:[
  {id:'soja-current',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:151.5,priceUnit:'BRL/sc_60kg',sourceName:'Boletim identificado',sourceUrl:'https://example.test/boletim',observedAt:'2026-08-25T13:00:00.000Z',confidence:95,status:'active'},
  {id:'soja-before',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:149,priceUnit:'BRL/sc_60kg',sourceName:'Boletim identificado',observedAt:'2026-08-24T13:00:00.000Z',confidence:95,status:'active'}
 ]}
 const current=answerCurrentMarket({workspace,message:'Preço da soja hoje',now})
 assert.equal(current.status,'CURRENT')
 assert.equal(current.source.id,'soja-current')
 assert.equal(current.source.observed_at,'2026-08-25T13:00:00.000Z')
 assert.match(current.answer,/Boletim|referência mais recente/i)
 assert.match(current.facts[0].statement,/fonte Boletim identificado/)

 const stale=answerCurrentMarket({workspace:{marketSnapshots:[{...workspace.marketSnapshots[0],observedAt:'2026-08-01T13:00:00.000Z'}]},message:'Preço da soja hoje',now})
 assert.equal(stale.status,'STALE')
 assert.match(stale.answer,/histórica|confirme uma atualização/i)

 const unavailable=answerCurrentMarket({workspace:{marketSnapshots:[{commodity:'soja',price:200,observedAt:now.toISOString()}]},message:'Preço da soja hoje',now})
 assert.equal(unavailable.status,'UNAVAILABLE')
 assert.equal(unavailable.source,null)
 assert.match(unavailable.answer,/não vou tratar memória antiga como preço atual/i)
})

test('FAST envelopes — respostas diretas preservam AIReasoningResult, provenance e zero memória',()=>{
 const now=new Date('2026-08-25T15:00:00.000Z')
 const clientResponse=buildFastClientResponse({
  facts:{client:{id:'joao',name:'João Pereira'},latestCompletedVisit:{id:'visit-1',objective:'Revisar proposta',status:'Concluída',lifecycleStatus:'COMPLETED',occurredAt:'2026-08-24T14:00:00.000Z',updatedAt:'2026-08-25T14:30:00.000Z',nextCommitment:'Enviar comparativo'}},
  message:'Qual foi a última visita?',organizationId:'tenant-a',conversationId:'thread-joao',now,latencyMs:12
 })
 const clientReasoning=clientResponse.advice.ai_reasoning
 assert.deepEqual(validateAIReasoningResult(clientReasoning),[])
 assert.equal(clientResponse.route,'FAST')
 assert.equal(clientReasoning.run.path,'FAST')
 assert.deepEqual(clientReasoning.run.capabilities_used,['VISIT_HISTORY'])
 assert.equal(clientReasoning.persistence_mode,'NONE')
 assert.equal(clientReasoning.voice_output.persistence,'NONE')
 assert.match(clientReasoning.situation_summary,/João Pereira/)

 const marketResponse=buildFastMarketResponse({workspace:{marketSnapshots:[]},message:'Preço da soja hoje',organizationId:'tenant-a',conversationId:'global',now,latencyMs:8})
 const marketReasoning=marketResponse.advice.ai_reasoning
 assert.deepEqual(validateAIReasoningResult(marketReasoning),[])
 assert.equal(marketResponse.route,'LIVE_DATA')
 assert.equal(marketReasoning.run.path,'LIVE_DATA')
 assert.equal(marketReasoning.premises.current_data.required,true)
 assert.equal(marketReasoning.premises.conversation_is_not_confirmed_memory,true)
})

test('Decision Interview — pergunta no máximo três lacunas materiais e não repete o que já sabe',()=>{
 const result={
  conversation_id:'thread-1',confidence:{score:.3},facts_used:[],knowledge_refs:[],golden_questions:[],
  missing_information:['decisão','participantes','janela'],agronomic_context:{status:'not_applicable'}
 }
 const interview=buildDecisionInterview({intent:'PREPARE_VISIT',message:'Prepare a visita.',context:{conversationSession:{id:'thread-1'}},result})
 assert.equal(interview.version,'val.decision_interview.v1')
 assert.equal(interview.status,'NEEDS_INPUT')
 assert.ok(interview.questions.length>=1&&interview.questions.length<=3)
 assert.ok(interview.questions.every(item=>item.classification==='MATERIAL'&&item.already_known===false&&item.why))
 assert.equal(interview.session_context.persistence_mode,'NONE')
 assert.equal(interview.session_context.confirmed_memory_unchanged,true)
 assert.equal(interview.register_offer.confirmation_required,true)

 const single=buildDecisionInterview({intent:'ASK_AGRONOMIC',message:'No talhão Norte, soja em estádio V4.',context:{},result})
 assert.equal(single.questions.length,1)
 assert.match(single.explanation,/^Falta 1 informação material que pode mudar/)

 const knownContext={
  conversationSession:{id:'thread-1'},
  memories:[{status:'verified',memory_state:'FACT',value:{decision:'fechar a proposta',participants:'pai e sócio',timing:'amanhã nesta semana'}}]
 }
 const complete=buildDecisionInterview({intent:'PREPARE_VISIT',message:'Prepare a visita.',context:knownContext,result})
 assert.equal(complete.status,'NOT_NEEDED')
 assert.deepEqual(complete.questions,[])

 const unconfirmed=buildDecisionInterview({
  intent:'PREPARE_VISIT',message:'Prepare a visita.',
  context:{memories:[{status:'proposed',memory_state:'HYPOTHESIS',value:{decision:'fechar a proposta',participants:'pai e sócio',timing:'amanhã'}}],visits:[{summary:'Falamos de proposta com o sócio na semana passada.'}]},
  result
 })
 assert.equal(unconfirmed.status,'NEEDS_INPUT')
 assert.ok(unconfirmed.questions.some(item=>item.field==='decision_target'))
})

test('Decision Interview — segunda rodada preserva intenção e elimina a pergunta já respondida',()=>{
 const result={
  conversation_id:'thread-2',confidence:{score:.3},facts_used:[],knowledge_refs:[],golden_questions:[],
  missing_information:['decisão','participantes','janela'],agronomic_context:{status:'not_applicable'}
 }
 const first=buildDecisionInterview({intent:'PREPARE_VISIT',message:'Prepare a visita.',context:{conversationSession:{id:'thread-2'}},result})
 const answered=first.questions[0]
 const reply='Resposta do consultor à pergunta material “'+answered.question+'”: precisamos fechar a proposta'
 const second=buildDecisionInterview({intent:'PREPARE_VISIT',message:reply,context:{conversationSession:{id:'thread-2'}},result})
 assert.equal(second.questions.some(item=>item.field===answered.field),false)
 assert.ok(second.questions.length<first.questions.length)
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.ok(copilot.includes('intent:reasoning.intent'))
 assert.ok(copilot.includes('intent||activeReply?.intent||'))
})

test('Decision Interview — reconhece padrão agronômico no plural e não repete a pergunta confirmada na sessão',()=>{
 const result={
  conversation_id:'thread-agro',confidence:{score:.3},facts_used:[],knowledge_refs:[],golden_questions:[],
  missing_information:['área','estádio','padrão'],agronomic_context:{status:'limited'}
 }
 const message=buildSessionReplyMessage({
  objective:'O que o contexto agronômico disponível muda na visita?',
  replies:[{
   field:'observed_pattern',
   question:'O problema aparece em reboleiras, bordas ou de forma uniforme?',
   answer:'Em reboleiras no talhão Norte, soja em V4.'
  }]
 })
 const interview=buildDecisionInterview({intent:'ASK_AGRONOMIC',message,context:{conversationSession:{id:'thread-agro'}},result})
 assert.equal(interview.questions.some(item=>item.field==='observed_pattern'),false)
 assert.equal(interview.status,'NOT_NEEDED')
})

test('Reasoning Confidence — dimensões são calibradas e agronomia não aplicável fica nula',()=>{
 const confidence=buildReasoningConfidence({
  context:{soilAnalyses:[],fieldReports:[],ndviObservations:[],manualRecords:[]},
  result:{confidence:{score:.74},facts_used:[{source_type:'visit'},{source_type:'memory'}],knowledge_refs:[{id:'k1'}],golden_questions:[{question:'Qual decisão muda?'}],agronomic_context:{status:'not_applicable'}}
 })
 assert.equal(confidence.version,'val.reasoning_confidence.v1')
 for(const key of ['context','thesis','question','knowledge'])assert.ok(confidence[key]>=0&&confidence[key]<=1,key)
 assert.equal(confidence.agronomy,null)
 assert.ok(confidence.threshold.ask_below>0&&confidence.threshold.ask_below<1)
})

test('arquivos de UX v3 — entrevista, áudio e workspace agronômico têm superfícies próprias',()=>{
 for(const path of [
  'src/components/copilot/DecisionInterviewCard.jsx',
  'src/components/copilot/ValAudioResponse.jsx',
  'src/hooks/useSpeechSynthesis.js',
  'src/pages/Agro.jsx'
 ])assert.equal(exists(path),true,path)
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.ok(copilot.includes('DecisionInterviewCard'))
 assert.ok(copilot.includes('ValAudioResponse'))
 const agro=read('src/pages/Agro.jsx')
 const agroActions=read('src/lib/agro-hero-actions.js')
 assert.ok(agro.includes('/tecnico?embedded=1&page='))
 assert.ok(agro.includes('createAgroWorkspaceMessage'))
 assert.ok(agroActions.includes("type:'valor360:navigate'"))
})

test('solo auditável + headless — vínculo muda refs sem perder identidade ou medições',()=>{
 const manual=read('manual/app/page.tsx')
 const integration=read('manual/app/lib/valor360.ts')
 const repository=read('server/repository.js')
 const agro=read('src/pages/Agro.jsx')
 const agroActions=read('src/lib/agro-hero-actions.js')

 for(const state of ['UNLINKED','LINKED_TO_CLIENT','LINKED_TO_PROPERTY','LINKED_TO_FIELD']){
  assert.ok(manual.includes(`"${state}"`),state)
 }
 for(const field of ['recordId','linkState','linkVersion','linkHistory','linkProvenance']){
  assert.ok(manual.includes(field),field)
  assert.ok(integration.includes(field),field)
 }
 for(const action of ['Vincular análise','Alterar vínculo','Desvincular'])assert.ok(manual.includes(action),action)

 assert.match(integration,/analysisExternalId\s*=\s*`manual-soil:/)
 assert.ok(integration.includes('type: "soil_analysis.completed"'))
 assert.ok(integration.includes('externalId: `manual-soil-event:'))
 assert.match(repository,/analysisExternalId\|\|event\.externalId/)
 assert.match(repository,/ON CONFLICT \(tenant_id,source,external_id\) DO UPDATE SET client_id=EXCLUDED\.client_id/)
 assert.match(repository,/linkState==='UNLINKED'\?null:/)
 assert.match(repository,/UPDATE soil_measurements SET superseded_at=NOW\(\)/)
 assert.match(repository,/INSERT INTO soil_measurements[\s\S]*?link_version,source_event_id/)
 assert.match(repository,/soil_measurement_set_replaced/)

 assert.ok(manual.includes('searchParams.get("page")'))
 assert.ok(manual.includes('event.origin !== window.location.origin'))
 assert.ok(manual.includes('message?.type === "valor360:navigate"'))
 assert.ok(manual.includes('message?.type !== "valor360:session-media"'))
 assert.ok(agro.includes('/tecnico?embedded=1&page='))
 assert.ok(agro.includes('createAgroWorkspaceMessage({context:agroContext,tool:activeTool})'))
 assert.ok(agro.includes('postMessage(workspaceMessage,window.location.origin)'))
 assert.ok(agroActions.includes("type:'valor360:navigate'"))
})
