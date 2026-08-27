import assert from 'node:assert/strict'
import {readFileSync,statSync} from 'node:fs'
import test from 'node:test'
import {
 buildConversationHistory,
 contextStatusLabel,
 conversationGroupLabel,
 conversationScopeKey,
 conversationWorkspaceStorageKey,
 readConversationWorkspace,
 writeConversationWorkspace
} from '../src/lib/full-screen-conversation.js'

const root=new URL('../',import.meta.url)
const read=path=>readFileSync(new URL(path,root),'utf8')
const exists=path=>statSync(new URL(path,root)).isFile()

const app=read('src/App.jsx')
const copilot=read('src/components/GlobalValCopilot.jsx')
const sidebar=read('src/components/Sidebar.jsx')
const mobile=read('src/components/MobileNav.jsx')
const panel=read('src/components/copilot/ValContextualPanel.jsx')
const cards=read('src/components/copilot/DecisionCards.jsx')
const speech=read('src/components/copilot/EphemeralSpeechButton.jsx')
const interviewCard=read('src/components/copilot/DecisionInterviewCard.jsx')
const styles=read('src/val-full-screen-copilot.css')

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

test('thread é separada por objeto sem duplicar a memória do produtor',()=>{
 assert.equal(conversationScopeKey({}),'__global__')
 assert.equal(conversationScopeKey({clientId:'producer-a'}),'client:producer-a')
 assert.equal(conversationScopeKey({clientId:'producer-a',context:{type:'opportunity',id:'opp-1'}}),'context:opportunity:opp-1:producer-a')
 assert.notEqual(conversationScopeKey({clientId:'producer-a',context:{type:'visit',id:'visit-1'}}),conversationScopeKey({clientId:'producer-a',context:{type:'opportunity',id:'opp-1'}}))
 assert.equal(contextStatusLabel({client:{id:'a'},context:{type:'opportunity'}}),'Oportunidade ativa')
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
 assert.match(copilot,/onNavigate\?\.\(\{\.\.\.descriptor,clientId:/)
 assert.match(copilot,/context:\{\.\.\.\(activeContext\|\|\{\}\),\.\.\.\(descriptor\.context\|\|\{\}\)\}/)
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
