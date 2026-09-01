import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
 buildHomeCopilotAnswer,
 buildLocalHomePriorities,
 canonicalVoiceChange,
 resolveCommitmentResource,
 selectLatestEvidenceVisit
} from '../src/lib/copilot-view-model.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const dashboard=read('src/pages/Dashboard.jsx')
const client360=read('src/pages/Client360.jsx')
const visits=read('src/pages/Visits.jsx')
const sidebar=read('src/components/Sidebar.jsx')
const mobile=read('src/components/MobileNav.jsx')
const app=read('src/App.jsx')
const styles=read('src/copilot-ux.css')

test('fallback local da Home usa próximos passos reais e limita a três prioridades',()=>{
 const priorities=buildLocalHomePriorities({
  clients:[{id:'a',name:'Ana'},{id:'b',name:'Bruno'}],
  upcomingVisits:[{id:'v1',clientId:'a',scheduledAt:'2026-09-03T12:00:00.000Z',objective:'Revisar a primeira aplicação'}],
  opportunities:[
   {id:'o1',clientId:'b',title:'Inseticida',hypothesis:'Preço pode ser uma fricção',stage:'Negociação',nextAction:'Levar comparativo',nextActionAt:'2026-09-01T12:00:00.000Z'},
   {id:'o2',clientId:'a',title:'Semente',stage:'Proposta',next_action:'Confirmar área',next_action_at:'2026-09-02T12:00:00.000Z'},
   {id:'o3',clientId:'a',title:'Encerrada',stage:'Fechado',nextAction:'Não deve aparecer'},
   {id:'o4',clientId:'a',title:'Sem ação',stage:'Diagnóstico'}
  ]
 })
 assert.equal(priorities.length,3)
 assert.equal(priorities[0].recommended_action,'Levar comparativo')
 assert.match(priorities[0].summary,/Hipótese registrada:/)
 assert.equal(priorities.some(item=>item.title==='Encerrada'||item.title==='Sem ação'),false)
 assert.equal(priorities.some(item=>item.category==='PREPARE'),true)
})

test('estado de compromissos nunca transforma loading ou falha em lista vazia',()=>{
 assert.equal(resolveCommitmentResource({status:'loading'}).state,'loading')
 assert.deepEqual(resolveCommitmentResource({status:'error',error:'offline'}),{state:'error',commitment:null,error:'offline'})
 assert.equal(resolveCommitmentResource({status:'success',items:[]}).state,'empty')
 const selected=resolveCommitmentResource({status:'success',items:[
  {commitment_id:'done',status:'DONE',description:'Concluído',due_at:'2026-08-20T12:00:00.000Z'},
  {commitment_id:'proposal',status:'PROPOSED',description:'Ainda não aceito',due_at:'2026-08-21T12:00:00.000Z'},
  {commitment_id:'later',status:'ACCEPTED',description:'Depois',due_at:'2026-09-10T12:00:00.000Z'},
  {commitment_id:'first',status:'ACCEPTED',description:'Primeiro',due_at:'2026-09-02T12:00:00.000Z'}
 ]})
 assert.equal(selected.state,'ready')
 assert.equal(selected.commitment.commitment_id,'first')
})

test('última visita comprovada ignora agendamento vencido sem execução',()=>{
 const visitsForClient=[
  {id:'planned',clientId:'a',lifecycleStatus:'PLANNED',status:'Agendada',scheduledAt:'2026-08-22T12:00:00.000Z'},
  {id:'completed',clientId:'a',lifecycleStatus:'COMPLETED',status:'Realizada',scheduledAt:'2026-08-20T12:00:00.000Z',completedAt:'2026-08-20T13:00:00.000Z'},
  {id:'other-subject',clientId:'b',lifecycleStatus:'COMPLETED',completedAt:'2026-08-23T13:00:00.000Z'}
 ]
 assert.equal(selectLatestEvidenceVisit(visitsForClient,'a',new Date('2026-08-24T12:00:00.000Z').getTime()).id,'completed')
 assert.equal(selectLatestEvidenceVisit([visitsForClient[0]],'a',new Date('2026-08-24T12:00:00.000Z').getTime()),null)
})

test('mudança por voz usa somente o payload confirmado e persistido',()=>{
 assert.equal(canonicalVoiceChange({voice_interaction:{state:'PENDING_REVIEW'}}),null)
 assert.equal(canonicalVoiceChange({voice_interaction:{state:'CONFIRMED',reviewed_candidates:[]}}),null)
 const change=canonicalVoiceChange({
  voice_interaction:{voice_interaction_id:'voice-1',state:'CONFIRMED',confirmed_at:'2026-08-24T10:00:00.000Z',reviewed_candidates:[{review_status:'CONFIRMED',statement:'Sinal confirmado'}]},
  result:{interaction:{summary:'Produtor confirmou participação do sócio.'}}
 })
 assert.equal(change.interactionId,'voice-1')
 assert.equal(change.summary,'Produtor confirmou participação do sócio.')
})

test('resposta curta da Home usa somente a recomendação canônica do pipeline',()=>{
 assert.equal(buildHomeCopilotAnswer({}),null)
 assert.deepEqual(buildHomeCopilotAnswer({recommendationId:'rec-1',advice:{executive_brief:{headline:'Preço ainda é hipótese',reason:'A aplicação está próxima.',action:'Validar o critério de escolha.',question:'O que mais pesa nesta decisão?'}}}),{
  recommendationId:'rec-1',headline:'Preço ainda é hipótese',reason:'A aplicação está próxima.',action:'Validar o critério de escolha.',question:'O que mais pesa nesta decisão?'
 })
 const long='x'.repeat(600)
 const bounded=buildHomeCopilotAnswer({advice:{executive_brief:{headline:long,reason:long,action:long,question:long}}})
 assert.equal(bounded.headline.length,180)
 assert.equal(bounded.reason.length,300)
 assert.equal(bounded.action.length,320)
 assert.equal(bounded.question.length,320)
})

test('Home e Cliente 360 conectam os view models e o refetch protegido',()=>{
 assert.match(dashboard,/fetch\('\/api\/v1\/insights'/)
 assert.match(dashboard,/buildLocalHomePriorities\(\{upcomingVisits,opportunities,clients\}\)/)
 assert.match(dashboard,/priorities\.slice\(0,3\)/)
 assert.match(dashboard,/interactionType="GENERAL_CONTEXT"/)
 assert.match(dashboard,/canonicalVoiceChange\(payload\)/)
 assert.match(dashboard,/fetch\('\/api\/val\/chat'/)
 assert.match(dashboard,/buildHomeCopilotAnswer\(result\)/)
 assert.ok(dashboard.indexOf('try{await onRefreshPortfolio?.()}catch{portfolioRefreshFailed=true}')<dashboard.indexOf("fetch('/api/val/chat'"))
 assert.ok(dashboard.indexOf('Até 3 prioridades para agir')<dashboard.indexOf('Ver carteira, radar e números'))
 assert.match(client360,/resolveCommitmentResource\(commitmentResource\)/)
 assert.match(client360,/selectLatestEvidenceVisit\(visits,client\.id\)/)
 assert.match(client360,/canonicalVoiceChange\(payload\)/)
 assert.match(client360,/await onRefreshPortfolio\?\.\(\)/)
 assert.match(client360,/Verificando compromissos confirmados/)
 assert.match(client360,/Não foi possível verificar os compromissos agora/)
 assert.match(app,/onRefreshPortfolio=\{refreshPortfolio\}/)
 assert.match(app,/const refreshPortfolio=async\(\)=>\{const response=await fetch\('\/api\/intelligence'/)
})

test('Cliente 360 mantém dossiê em drill-down sem chamar agendamento de interação',()=>{
 for(const label of ['O QUE MUDOU','PRIORIDADE / OPORTUNIDADE','ÚLTIMA VISITA COMPROVADA','PRÓXIMO COMPROMISSO'])assert.match(client360,new RegExp(label))
 assert.doesNotMatch(client360,/ÚLTIMA INTERAÇÃO/)
 assert.match(client360,/Somente informações registradas ou confirmadas/)
 assert.match(client360,/const Drilldown=.*<details className="client-drilldown"/)
 assert.match(client360,/ProducerBusinessOverview/)
 assert.match(client360,/ProducerFieldGallery/)
})

test('navegação preserva agronomia nativa e deixa o workspace como aprofundamento',()=>{
 assert.match(sidebar,/\['dashboard','Hoje',LayoutDashboard\]/)
 assert.match(sidebar,/Perguntar à VAL/)
 assert.doesNotMatch(sidebar,/\['val','Ambientes VAL'/)
 assert.match(sidebar,/\['questionnaire','Coletar preferências'/)
 assert.match(sidebar,/\['agro','Ferramentas agronômicas'/)
 assert.doesNotMatch(sidebar,/Manual agronômico/)
 assert.match(mobile,/onClick=\{onOpenVal\} aria-label="Abrir a VAL"/)
 assert.match(mobile,/\['dashboard','Hoje',CalendarDays\]/)
 assert.match(mobile,/\['agro','Ferramentas agronômicas',Sprout\]/)
})

test('pós-visita tem um Voice Capture operacional e legado explicitamente inacessível',()=>{
 assert.equal((visits.match(/interactionType="POST_VISIT"/g)||[]).length,1)
 assert.match(visits,/const legacyReportUiEnabled=false/)
 assert.match(visits,/legacyReportUiEnabled&&register\.open/)
 assert.doesNotMatch(visits,/legacyReportUiEnabled=true/)
 assert.doesNotMatch(visits,/open:true/)
 assert.match(visits,/Me conte como foi\. A VAL organiza; você confirma\./)
})

test('copiloto e memória viva mantêm leitura mobile e foco de teclado',()=>{
 assert.match(styles,/@media\(max-width:700px\)/)
 assert.match(styles,/\.client-memory-grid p\{[^}]*font-size:14px/)
 assert.match(styles,/\.copilot-priority-grid p\{[^}]*font-size:13px/)
 assert.match(styles,/\.copilot-welcome p\{font-size:14px\}/)
 assert.match(styles,/\.copilot-advanced>summary:focus-visible/)
 assert.match(styles,/\.client-memory-grid\{grid-template-columns:1fr\}/)
 assert.match(styles,/\.mobile-nav\{grid-template-columns:repeat\(4,1fr\)!important\}/)
})
