import assert from 'node:assert/strict'
import {readFileSync,statSync} from 'node:fs'
import test from 'node:test'
import {
 behavioralProfileViewModel,
 buildConversationHistory,
 contextTraceDebugEnabled,
 contextStatusLabel,
 conversationGroupLabel,
 conversationScopeKey,
 conversationTurnVisibleInScope,
 conversationWorkspaceStorageKey,
 createConversationThreadKey,
 createScopedRegistrationDraft,
 debugContextTraceView,
 fullScreenConversationVersion,
 isBehavioralProfileResponse,
 readConversationWorkspace,
 rehomeResolvedProducerExchange,
 rehomeResolvedProducerQuestion,
 registrationDraftTextForScope,
 responseCardActionMatchesScope,
 writeConversationWorkspace
} from '../src/lib/full-screen-conversation.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {classifyValContextDomain} from '../server/decision-copilot/context-selector.js'

const root=new URL('../',import.meta.url)
const read=path=>readFileSync(new URL(path,root),'utf8')
const exists=path=>statSync(new URL(path,root)).isFile()

const app=read('src/App.jsx')
const copilot=read('src/components/GlobalValCopilot.jsx')
const server=read('server.js')
const sidebar=read('src/components/Sidebar.jsx')
const mobile=read('src/components/MobileNav.jsx')
const panel=read('src/components/copilot/ValContextualPanel.jsx')
const cards=read('src/components/copilot/DecisionCards.jsx')
const speech=read('src/components/copilot/EphemeralSpeechButton.jsx')
const interviewCard=read('src/components/copilot/DecisionInterviewCard.jsx')
const styles=read('src/val-full-screen-copilot.css')
const globalStyles=read('src/global-val-copilot.css')

const requiredDocuments=[
 'VAL_FULL_SCREEN_COPILOT_v1.md',
 'VAL_CONVERSATION_ARCHITECTURE_v1.md',
 'VAL_CONTEXTUAL_PANEL_v1.md',
 'VAL_CHAT_COMPONENTS_v1.md',
 'VAL_MULTIMODAL_COMPOSER_v1.md',
 'VAL_CONVERSATION_MEMORY_POLICY_v1.md',
 'VAL_FULL_SCREEN_MOBILE_v1.md',
 'VAL_FULL_SCREEN_DESKTOP_v1.md'
]

const mandatoryScenarios=[
 [1,'abrir VAL full-screen','src/App.jsx'],[2,'nova conversa','src/components/GlobalValCopilot.jsx'],[3,'contexto de produtor','src/lib/full-screen-conversation.js'],[4,'abrir a partir do Produtor 360','src/App.jsx'],[5,'abrir da oportunidade','src/pages/Opportunities.jsx'],[6,'contexto implícito','src/lib/copilot-context.js'],[7,'conversa contínua','src/lib/global-val-conversation.js'],[8,'Golden Questions','server/ai-reasoning/index.js'],[9,'PrepareVisitCard','src/components/copilot/DecisionCards.jsx'],[10,'agronomia no chat','src/components/copilot/DecisionCards.jsx'],[11,'análise de solo','server/ai-reasoning/intent-router.js'],[12,'foto','src/components/GlobalValCopilot.jsx'],[13,'arquivo','src/components/GlobalValCopilot.jsx'],[14,'market','src/components/copilot/DecisionCards.jsx'],[15,'commodity','server/decision-copilot/capability-router.js'],[16,'voz','src/components/voice/VoiceCapture.jsx'],[17,'resposta por áudio','src/components/copilot/ValAudioResponse.jsx'],[18,'Decision Interview','src/components/copilot/DecisionInterviewCard.jsx'],[19,'confirmação','src/components/voice/VoiceCapture.jsx'],[20,'ASK não persiste','server.js'],[21,'REGISTER persiste após confirmação','server/voice-capture/service.js'],[22,'abrir módulo a partir do card','src/components/copilot/DecisionCards.jsx'],[23,'mobile','VAL_FULL_SCREEN_MOBILE_v1.md'],[24,'desktop','VAL_FULL_SCREEN_DESKTOP_v1.md'],[25,'FAST PATH','server/decision-copilot/capability-router.js'],[26,'DEEP PATH','server/decision-copilot/capability-router.js'],[27,'streaming/progresso real','src/lib/val-progress-client.js'],[28,'cross-tenant','src/lib/copilot-context.js'],[29,'safety','server/technical-safety-audit.js'],[30,'regressões','package.json']
]

test('documentação do Full-Screen Copilot existe e mantém os limites constitucionais',()=>{
 assert.equal(requiredDocuments.length,8)
 for(const path of requiredDocuments){assert.equal(exists(path),true,path);assert.match(read(path),/^# /)}
 assert.match(read('VAL_FULL_SCREEN_COPILOT_v1.md'),/não substitui/i)
 assert.match(read('VAL_CONVERSATION_MEMORY_POLICY_v1.md'),/Conversa não é memória confirmada/)
 assert.match(read('VAL_CONVERSATION_ARCHITECTURE_v1.md'),/NAME_SWAP_TEST/)
})

test('matriz obrigatória mantém 30 cenários rastreáveis sem transformar UAT físico em automação',()=>{
 assert.equal(mandatoryScenarios.length,30)
 assert.deepEqual(mandatoryScenarios.map(item=>item[0]),Array.from({length:30},(_,index)=>index+1))
 for(const [id,,path] of mandatoryScenarios)assert.equal(exists(path),true,`${id}: ${path}`)
 assert.match(read('VAL_FULL_SCREEN_MOBILE_v1.md'),/UAT físico obrigatório/)
})

test('App possui página própria e atalhos encaminham para o mesmo Full-Screen Copilot',()=>{
 assert.match(app,/copilot:\['VAL Copilot'/)
 assert.match(app,/setPage\('copilot'\)/)
 assert.match(app,/page!=='copilot'&&<Topbar/)
 assert.match(app,/content-copilot-fullscreen/)
 assert.match(app,/open=\{page==='copilot'&&copilotOpen\}/)
 assert.match(sidebar,/\['copilot','VAL',BrainCircuit\]/)
 assert.match(sidebar,/Perguntar à VAL/)
 assert.match(mobile,/mobile-val-button/)
})

test('objeto ativo evolui sem fragmentar a thread do produtor',()=>{
 assert.equal(conversationScopeKey({}),'__global__')
 assert.equal(conversationScopeKey({clientId:'producer-a'}),'client:producer-a')
 assert.equal(conversationScopeKey({clientId:'producer-a',context:{type:'opportunity',id:'opp-1'}}),'client:producer-a')
 assert.equal(conversationScopeKey({clientId:'producer-a',context:{type:'visit',id:'visit-1'}}),conversationScopeKey({clientId:'producer-a',context:{type:'opportunity',id:'opp-1'}}))
 assert.equal(contextStatusLabel({client:{id:'a'},context:{type:'opportunity'}}),'Oportunidade ativa')
})

test('nova conversa cria thread distinta e rascunho de registro não atravessa cliente ou thread',()=>{
 const first=createConversationThreadKey({clientId:'producer-a',threadId:'first'})
 const second=createConversationThreadKey({clientId:'producer-a',threadId:'second'})
 const general=createConversationThreadKey({threadId:'general'})
 assert.equal(first,'client:producer-a:conversation:first')
 assert.notEqual(first,second)
 assert.notEqual(first,conversationScopeKey({clientId:'producer-a'}))
 assert.equal(general,'__global__:conversation:general')
 assert.notEqual(general,conversationScopeKey({}))
 const draft=createScopedRegistrationDraft({text:'  O filho participa da decisão.  ',clientId:'producer-a',threadKey:first})
 assert.deepEqual(draft,{text:'O filho participa da decisão.',clientId:'producer-a',threadKey:first})
 assert.equal(registrationDraftTextForScope(draft,{clientId:'producer-a',threadKey:first}),'O filho participa da decisão.')
 assert.equal(registrationDraftTextForScope(draft,{clientId:'producer-b',threadKey:first}),'')
 assert.equal(registrationDraftTextForScope(draft,{clientId:'producer-a',threadKey:second}),'')
 assert.equal(createScopedRegistrationDraft({text:'sem cliente',threadKey:first}),null)
 assert.match(copilot,/const nextKey=createConversationThreadKey\(\{clientId:nextClientId\}\)/)
 assert.match(copilot,/setThreadOverride\(nextKey\)/)
 assert.match(copilot,/if\(!id\)\{newConversation\(\{general:true\}\);return\}/)
 assert.doesNotMatch(copilot,/const nextKey=general\?'__global__':threadKey/)
 assert.match(copilot,/registrationDraftTextForScope\(registrationDraft,\{clientId:selectedId,threadKey\}\)/)
 assert.match(copilot,/payloadClientId&&payloadClientId!==expectedClientId/)
 assert.match(copilot,/assertResponseScopeForRequest\(payload,\{tenantId:identityTenantId,ownerId:identityOwnerId,conversationId:currentConversationId,producerId:/)
 assert.match(copilot,/key=\{`register:\$\{client\?\.id\|\|'none'\}:\$\{threadKey\}`\}/)
})

test('resolver troca produtor sem relabelar a thread anterior e move somente o intercâmbio corrente',()=>{
 const oldAnswer={role:'assistant',producerId:'producer-a',text:'Histórico comprovado de A'}
 const currentQuestion={role:'user',producerId:'producer-a',turnId:'turn-current',text:'E o perfil de B?'}
 const assistant={role:'assistant',tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-b',conversationId:'conversation-shared',contextEpoch:4,turnId:'turn-current',text:'Perfil comprovado de B'}
 const moved=rehomeResolvedProducerExchange({
  threads:{'client:producer-a':[oldAnswer,currentQuestion]},
  sourceThreadKey:'client:producer-a',
  targetThreadKey:'client:producer-b:conversation:new',
  turnId:'turn-current',
  userTurn:currentQuestion,
  assistantTurn:assistant
 })
 assert.deepEqual(moved['client:producer-a'],[oldAnswer])
 assert.deepEqual(moved['client:producer-b:conversation:new'],[{...currentQuestion,tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-b',conversationId:'conversation-shared',contextEpoch:4},assistant])
 assert.equal(moved['client:producer-a'][0].producerId,'producer-a')
 assert.equal(moved['client:producer-b:conversation:new'][1].producerId,'producer-b')
 const clarificationMove=rehomeResolvedProducerQuestion({threads:{'client:producer-a':[oldAnswer,currentQuestion]},sourceThreadKey:'client:producer-a',targetThreadKey:'client:producer-b:conversation:clarified',turnId:'turn-current',targetScope:{producerId:'producer-b',conversationId:'conversation-shared',contextEpoch:3}})
 assert.deepEqual(clarificationMove['client:producer-a'],[oldAnswer])
 assert.equal(clarificationMove['client:producer-b:conversation:clarified'][0].producerId,'producer-b')
 assert.throws(()=>rehomeResolvedProducerExchange({threads:moved,sourceThreadKey:'same',targetThreadKey:'same',turnId:'turn-current',assistantTurn:assistant}),/producer_thread_transition_invalid/)
 assert.throws(()=>rehomeResolvedProducerExchange({threads:{'client:producer-a':[currentQuestion],'client:producer-b:conversation:occupied':[oldAnswer]},sourceThreadKey:'client:producer-a',targetThreadKey:'client:producer-b:conversation:occupied',turnId:'turn-current',assistantTurn:assistant}),/producer_thread_transition_target_not_empty/)
 assert.throws(()=>rehomeResolvedProducerExchange({threads:{'client:producer-a':[currentQuestion]},sourceThreadKey:'client:producer-a',targetThreadKey:'client:producer-b:conversation:new',turnId:'different-turn',assistantTurn:assistant}),/producer_thread_transition_invalid/)
 assert.match(copilot,/const responseThreadKey=changesConversationScope\?createConversationThreadKey\(\{clientId:resolvedClient\.id\}\):activeThreadKey/)
 assert.match(copilot,/bindConversationId\(responseThreadKey,storageScope,responseScope\.conversationId\)/)
 assert.match(copilot,/rehomeResolvedProducerExchange\(\{threads:current,sourceThreadKey:activeThreadKey,targetThreadKey:responseThreadKey/)
 assert.match(copilot,/rehomeResolvedProducerQuestion\(\{threads:current,sourceThreadKey,targetThreadKey:responseThreadKey/)
 assert.match(copilot,/const selectedConversationId=globalThis\.crypto\?\.randomUUID/)
 assert.match(copilot,/clarificationSelection:\{contractVersion:'val\.client_clarification\.v1',clientId:String\(option\.id\),reference:clarificationReference\}/)
 assert.match(copilot,/clarificationSelection:turnOptions\.clarificationSelection\|\|undefined/)
 assert.doesNotMatch(copilot,/bindConversationId\(responseThreadKey,storageScope,clarification\?\.conversationId\)/)
 assert.doesNotMatch(copilot,/setThreadOverride\(activeThreadKey\)/)
})

test('ação de card exige tenant, owner, produtor, conversa, contextEpoch e domínio exatos',()=>{
 const responseScope={contractVersion:'val.response_scope.v1',tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-a',conversationId:'conversation-a',contextEpoch:3,domain:'PROFILE'}
 const activeScope={tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-a',conversationId:'conversation-a',contextEpoch:3,domain:'PROFILE'}
 assert.equal(responseCardActionMatchesScope(responseScope,activeScope),true)
 assert.equal(responseCardActionMatchesScope({...responseScope,tenantId:'tenant-b'},activeScope),false)
 assert.equal(responseCardActionMatchesScope({...responseScope,ownerId:'owner-b'},activeScope),false)
 assert.equal(responseCardActionMatchesScope({...responseScope,producerId:'producer-b'},activeScope),false)
 assert.equal(responseCardActionMatchesScope({...responseScope,conversationId:'conversation-b'},activeScope),false)
 assert.equal(responseCardActionMatchesScope({...responseScope,contextEpoch:2},activeScope),false)
 assert.equal(responseCardActionMatchesScope({...responseScope,domain:'CREDIT'},activeScope),false)
 for(const missing of ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain']){const incomplete={...activeScope};delete incomplete[missing];assert.equal(responseCardActionMatchesScope(responseScope,incomplete),false,missing)}
 assert.equal(responseCardActionMatchesScope({...responseScope,contractVersion:'legacy'},activeScope),false)
 assert.equal(responseCardActionMatchesScope(null,activeScope),false)
 assert.match(copilot,/responseCardAction:true,responseScope/)
 assert.match(copilot,/responseCardActionMatchesScope\(responseScope,activeScope\)/)
 assert.match(copilot,/const currentScope=\{tenantId:identityTenantId,ownerId:identityOwnerId,conversationId:currentConversationId,producerId:/)
 assert.match(copilot,/const activeScope=\{tenantId:identityTenantId,ownerId:identityOwnerId,conversationId:activeConversationId,producerId:/)
 assert.match(app,/identityScope=\{\{tenantId:currentUser\?\.tenantId\|\|'',ownerId:currentUser\?\.ownerId\|\|''\}\}/)
 assert.match(server,/tenantId:session\.tenantId\|\|config\.defaultTenantId,ownerId:session\.id\|\|session\.sub\|\|session\.email/)
 assert.match(server,/tenantId:config\.defaultTenantId,ownerId:'demo@valor360\.local'/)
 assert.match(copilot,/contextEpoch:sourceTurn\.contextEpoch,domain:sourceTurn\.domain/)
 assert.match(copilot,/domain:responseScope\.domain/)
 assert.match(copilot,/Este card pertence a outro tenant, usuário, produtor, conversa, epoch ou domínio/)
 assert.match(copilot,/if\(\(descriptor\.responseCardAction===true\|\|descriptor\.responseScope\)&&!responseCardActionAllowed\(descriptor\.responseScope\)\)return/)
})

test('thread e histórico exigem escopo 6D exato e ignoram override de produtor em card do servidor',()=>{
 const responseScope={contractVersion:'val.response_scope.v1',tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-b',conversationId:'conversation-a',contextEpoch:2,domain:'PROFILE'}
 const activeScope={tenantId:'tenant-a',ownerId:'owner-a',producerId:'producer-a',conversationId:'conversation-a',contextEpoch:2,domain:'PROFILE'}
 const scopedPayload=(scope,answer)=>({responseScope:scope,advice:{answer,ai_reasoning:{organization:{id:scope.tenantId},client:{id:scope.producerId},conversation_id:scope.conversationId,premises:{context_scope:{tenant_id:scope.tenantId,owner_id:scope.ownerId,producer_id:scope.producerId,conversation_id:scope.conversationId,context_epoch:scope.contextEpoch,domain:scope.domain,minimum_sufficient_context:true}}}}})
 const poison={role:'assistant',serverGrounded:true,payload:scopedPayload(responseScope,'Dossiê privado de B')}
 assert.equal(conversationTurnVisibleInScope(poison,activeScope),false)
 assert.equal(conversationTurnVisibleInScope({...poison,explicitProducerOverride:true},activeScope),false)
 const canonical={...responseScope,producerId:'producer-a'}
 assert.equal(conversationTurnVisibleInScope({...poison,payload:scopedPayload(canonical,'Resposta segura')},activeScope),true)
 for(const [field,value] of [['tenantId','tenant-b'],['ownerId','owner-b'],['conversationId','conversation-b'],['contextEpoch',3],['domain','GRAINS']]){
  assert.equal(conversationTurnVisibleInScope({...poison,payload:scopedPayload({...canonical,[field]:value},`Poison ${field}`)},activeScope),false,field)
 }
 for(const missing of ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain']){const incomplete={...activeScope};delete incomplete[missing];assert.equal(conversationTurnVisibleInScope({...poison,payload:scopedPayload(canonical,'Resposta segura')},incomplete),false,missing)}
 const otherConversationScope={...responseScope,producerId:'producer-a',conversationId:'conversation-other'}
 const sameProducerOtherConversation={...poison,payload:scopedPayload(otherConversationScope,'Resposta da conversa B')}
 assert.equal(conversationTurnVisibleInScope(sameProducerOtherConversation,activeScope),false)
 const safeUser={role:'user',text:'Pergunta segura',at:'2026-08-30T10:00:00.000Z'}
 const threads={'client:producer-a':[safeUser,poison,sameProducerOtherConversation]}
 const metadata={'client:producer-a':{tenantId:'tenant-a',ownerId:'owner-a',clientId:'producer-a',clientName:'A',conversationId:'conversation-a',contextEpoch:2,domain:'PROFILE'}}
 const history=buildConversationHistory({threads,metadata})
 assert.equal(history[0].preview,'Pergunta segura')
 assert.doesNotMatch(history[0].preview,/privado de B/i)
 const values=new Map();writeConversationWorkspace({setItem:(key,value)=>values.set(key,value)},'scope-a',{threads,metadata})
 const persisted=readConversationWorkspace({getItem:key=>values.get(key)||null},'scope-a')
 assert.deepEqual(persisted.threads['client:producer-a'],[safeUser])
 assert.match(copilot,/const visibleThread=useMemo\(\(\)=>thread\.filter\(turn=>conversationTurnVisibleInScope/)
 assert.match(copilot,/tenantId:identityTenantId,ownerId:identityOwnerId,conversationId:realtimeConversationId/)
 assert.match(copilot,/\{visibleThread\.map\(/)
 assert.match(copilot,/conversationId:realtimeConversationId,contextEpoch:realtimeContextEpoch/)
})

test('histórico é escopado, limitado, pesquisável e agrupado por data',()=>{
 const now=new Date('2026-08-26T12:00:00.000Z')
 assert.equal(conversationGroupLabel('2026-08-26T08:00:00.000Z',now),'Hoje')
 assert.equal(conversationGroupLabel('2026-08-25T08:00:00.000Z',now),'Ontem')
 const threads={
  'client:a':[{role:'user',text:'Prepare a visita',at:'2026-08-26T08:00:00.000Z'}],
  '__global__':[{role:'user',text:'Preço da soja',at:'2026-08-25T08:00:00.000Z'}]
 }
 const metadata={'client:a':{clientId:'a',clientName:'Ana',label:'Ana'},'__global__':{label:'Conversa geral'}}
 const all=buildConversationHistory({threads,metadata,clients:[{id:'a',name:'Ana'}],now})
 assert.deepEqual(all.map(item=>item.group),['Hoje','Ontem'])
 assert.equal(buildConversationHistory({threads,metadata,query:'Ana',now}).length,1)
 assert.notEqual(conversationWorkspaceStorageKey('tenant-a:owner-a'),conversationWorkspaceStorageKey('tenant-b:owner-a'))
 const values=new Map();const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}
 assert.equal(writeConversationWorkspace(storage,'tenant-a:owner-a',{threads,metadata}),true)
 assert.deepEqual(readConversationWorkspace(storage,'tenant-a:owner-a').threads,threads)
 assert.deepEqual(readConversationWorkspace(storage,'tenant-b:owner-a').threads,{})
 assert.equal(fullScreenConversationVersion,'val.full_screen_conversation.v4')
 const legacyValues=new Map([[conversationWorkspaceStorageKey('tenant-a:owner-a'),JSON.stringify({version:'val.full_screen_conversation.v3',threads:{'client:a':[{role:'assistant',serverGrounded:true,payload:{advice:{answer:'stale sem responseScope'}}}]},metadata:{}})]])
 assert.deepEqual(readConversationWorkspace({getItem:key=>legacyValues.get(key)||null},'tenant-a:owner-a'),{threads:{},metadata:{}})
})

test('tela central possui header, composer fixo, histórico e painel opcional',()=>{
 for(const marker of ['val-fullscreen-page','val-fs-header','val-fs-workspace','global-val-thread','global-val-composer-wrap','val-history-drawer','ValContextualPanel'])assert.match(copilot,new RegExp(marker))
 assert.match(styles,/height:100dvh/)
 assert.match(styles,/safe-area-inset-bottom/)
 assert.match(styles,/\.val-fullscreen-page\.has-context-panel/)
 assert.match(panel,/\['context','CONTEXTO'/)
 for(const tab of ['MEMÓRIA','AGRONOMIA','EVIDÊNCIAS','HISTÓRICO'])assert.match(panel,new RegExp(tab))
})

test('resposta usa cards reutilizáveis e drill-down sem remover módulos',()=>{
 for(const name of ['DecisionCard','PrepareVisitCard','AgronomicInsightCard','CommitmentCard','OpportunityCard','EvidenceCard','KnowledgeCard','MarketCard','ConfirmationCard'])assert.match(cards,new RegExp(`export function ${name}`))
 assert.match(copilot,/<PrepareVisitCard/)
 assert.match(copilot,/<MarketCard/)
 assert.match(copilot,/onNavigate\?\.\(\{\.\.\.moduleDescriptor,clientId:/)
 assert.match(copilot,/context:\{\.\.\.\(activeContext\|\|\{\}\),\.\.\.\(moduleDescriptor\.context\|\|\{\}\)\}/)
 assert.match(cards,/Abrir preparação completa/)
 assert.match(cards,/Ver Inteligência Agronômica/)
 assert.match(cards,/CAPACIDADES AGRONÔMICAS/)
 assert.match(cards,/disponibilidade não significa execução/)
 assert.match(cards,/CONTEXTO NECESSÁRIO/)
 assert.doesNotMatch(cards,/normalized==='EXECUTED'\?'FERRAMENTA EXECUTADA':'FERRAMENTA PRONTA'/)
 assert.match(copilot,/toolResult\?\.status!=='CATALOG'/)
})

test('composer multimodal diferencia ASK, REGISTER, voz efêmera e arquivo sem vínculo',()=>{
 assert.match(copilot,/persistence_mode:'NONE'/)
 assert.match(copilot,/persistence_mode:'CONFIRM_REQUIRED'/)
 assert.match(copilot,/Perguntar não atualiza fatos/)
 assert.match(copilot,/Quer vincular esta análise a algum produtor\?/)
 assert.match(copilot,/Deixar sem vínculo/)
 assert.match(copilot,/capture="environment"/)
 assert.match(speech,/SpeechRecognition\|\|globalThis\.webkitSpeechRecognition/)
 assert.match(speech,/onTranscript/)
 assert.match(copilot,/DecisionInterviewCard/)
 assert.match(interviewCard,/useId\(\)/)
 assert.match(copilot,/onFallbackPushToTalk=\{requestPushToTalk\}/)
 assert.match(copilot,/autoOpenKey=\{pendingCapture==='voice'\?voiceAutoOpenKey:''\}/)
 assert.match(copilot,/autoStartKey=\{pendingCapture==='voice'\?voiceAutoOpenKey:''\}/)
})

test('cards antigos falham fechados ao trocar de produtor e download leva escopo explícito',()=>{
 assert.match(copilot,/attachmentMatchesBrowserScope\(sourceAttachment,\{clientId:requestClientId,allowUnlinked\}\)/)
 assert.match(copilot,/Este card pertence a outro produtor/)
 assert.match(copilot,/attachmentContentUrl\(sourceAttachment,\{clientId:requestClientId,allowUnlinked\}\)/)
 assert.match(copilot,/onNavigate\?\.\(\{\.\.\.moduleDescriptor,files,clientId:requestClientId/)
})

test('FAST/DEEP, qualidade, current data e governança continuam no mesmo pipeline',()=>{
 assert.match(copilot,/initialValProgress/)
 assert.match(copilot,/startValProgressPolling/)
 assert.match(copilot,/reasoning\.run\?\.path/)
 assert.match(copilot,/Por que a VAL disse isso\?/)
 assert.match(copilot,/teste de troca de nome/)
 assert.match(copilot,/teste sem contexto/)
 assert.match(copilot,/As premissas são recalculadas/)
})

test('perfil comportamental entrega resumo curto e quatro camadas fechadas separadas',()=>{
 const facts=Array.from({length:6},(_,index)=>({id:`e-${index}`,statement:`Evidência ${index}`}))
 const view=behavioralProfileViewModel({answer:'Perfil principal: Analítico. Confiança: alta. Por quê: pediu ROI e custo por hectare. Como abordar: use comparativos objetivos. O que ainda não sabemos: quem participa da decisão.',facts})
 assert.deepEqual({...view,evidence:view.evidence.map(item=>item.id)},{primary:'Analítico',confidence:'alta',why:'pediu ROI e custo por hectare',approach:'use comparativos objetivos',unknown:'quem participa da decisão',evidence:['e-0','e-1','e-2','e-3']})
 assert.equal(behavioralProfileViewModel({reasoning:{confidence:{level:'INSUFICIENTE'}},answer:'O perfil não possui fonte auditável. Confiança: baixa. O que ainda não sabemos: como compara alternativas.'}).primary,'Não comprovado')
 assert.match(copilot,/isBehavioralProfile\?<ProfileResponse/)
 assert.match(copilot,/\['Por quê\?',profile\.why/)
 assert.match(copilot,/\['Ver evidências',profile\.evidence/)
 assert.match(copilot,/\['Como abordar',profile\.approach/)
 assert.match(copilot,/\['O que ainda não sabemos',profile\.unknown/)
 assert.match(copilot,/<details className="global-val-layer val-profile-layer"/)
 assert.match(copilot,/aria-label="Perfil comportamental"/)
 assert.match(styles,/\.val-fullscreen-page \.val-profile-layers\{display:grid/)
 assert.match(globalStyles,/\.val-profile-response>header/)
})

test('perguntas PROFILE contextuais também usam a resposta visual compacta',()=>{
 const contextualQuestions=[
  'Que perfil comportamental você consegue comprovar dele?',
  'Descreva o perfil dele com as evidências atuais.'
 ]
 for(const message of contextualQuestions){
  const domain=classifyValContextDomain(message)
  assert.equal(domain,'PROFILE',message)
  assert.equal(routeSystemCapability({message,hasClient:true}).path,'CONTEXT',message)
  assert.equal(isBehavioralProfileResponse({premises:{context_scope:{domain}}}),true,message)
 }
 assert.equal(isBehavioralProfileResponse({commercial_context:{data_path:'BEHAVIORAL_PROFILE'}}),true)
 assert.equal(isBehavioralProfileResponse({premises:{context_scope:{domain:'COMMERCIAL'}}}),false)
 assert.match(copilot,/const isBehavioralProfile=isBehavioralProfileResponse\(reasoning\)/)
})

test('Context Trace exige safe e flag explícita de debug ou staging, com produção oculta por padrão',()=>{
 const reasoning={context_trace:{safe:true,domain:'PROFILE',selected:[{sourceType:'behavioral_profile',reasonSelected:'BEHAVIORAL_EVIDENCE',sourceId:'sigiloso'}]}}
 assert.equal(contextTraceDebugEnabled({PROD:true}),false)
 assert.equal(contextTraceDebugEnabled({DEV:false,VITE_VAL_CONTEXT_TRACE_ENABLED:'false'}),false)
 assert.equal(contextTraceDebugEnabled({DEV:true}),true)
 assert.equal(contextTraceDebugEnabled({PROD:true,VITE_VAL_CONTEXT_TRACE_ENABLED:'true'}),true)
 assert.equal(debugContextTraceView(reasoning,{PROD:true}),null)
 assert.equal(debugContextTraceView({...reasoning,context_trace:{...reasoning.context_trace,safe:false}},{DEV:true}),null)
 assert.deepEqual(debugContextTraceView(reasoning,{PROD:true,VITE_VAL_CONTEXT_TRACE_ENABLED:'true'}),{domain:'PROFILE',selected:[{sourceType:'behavioral_profile',reasonSelected:'BEHAVIORAL_EVIDENCE'}],rejected:[]})
 assert.match(copilot,/const contextTrace=debugContextTraceView\(reasoning,import\.meta\.env\)/)
 assert.match(copilot,/density==='analytical'&&contextTrace\?<SafeContextTrace/)
 const traceComponent=copilot.slice(copilot.indexOf('function SafeContextTrace'),copilot.indexOf('function ReasoningResponse'))
 assert.match(traceComponent,/trace\.domain/)
 assert.match(traceComponent,/trace\.selected/)
 assert.match(traceComponent,/trace\.rejected/)
 assert.doesNotMatch(traceComponent,/sourceId|producerId|tenantId|timestamp|statement/)
})

test('controles responsivos mantêm nomes acessíveis e estados anunciados',()=>{
 for(const label of ['Abrir histórico de conversas','Iniciar nova conversa','Abrir contexto','Ação da VAL','Abrir preferências da resposta'])assert.match(copilot,new RegExp(label))
 assert.match(copilot,/role="group" aria-label="Ação da VAL"/)
 assert.match(copilot,/aria-pressed=\{mode==='ASK'\}/)
 assert.match(copilot,/aria-pressed=\{mode==='REGISTER'\}/)
 assert.match(copilot,/aria-pressed=\{density===id\}/)
 assert.match(copilot,/aria-pressed=\{outputMode===id\}/)
 assert.match(globalStyles,/summary:focus-visible/)
})

test('follow-up de áudio usa o mesmo assistant_text visível e não busca perguntas antigas',()=>{
 assert.match(copilot,/const speakable=localTurn\?\.text\|\|''/)
 assert.match(copilot,/<ValAudioResponse text=\{item\.text\} autoPlay=\{item\.playAudio===true\}\/>/)
 assert.doesNotMatch(copilot,/previousQuestions/)
})
