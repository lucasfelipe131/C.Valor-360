import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {classifyValContextDomain,collectionMatchesContextDomain} from '../server/decision-copilot/context-selector.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const now=Date.now()
const ago=(days,hours=0)=>new Date(now-days*86400000-hours*3600000).toISOString()
const ahead=days=>new Date(now+days*86400000).toISOString()
const evidence=(id,ref,field,statement)=>({id,profile_source_ref:ref,source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field,statement,assessed_at:ago(30),valid_until:ahead(300)})

test('prefixo explícito de registro decide antes da leitura semântica do conteúdo',()=>{
 for(const message of ['Registra que a cotação da soja subiu','Anota que o talhão 3 teve praga','Registra que ele não quer mudar de fungicida','registra que a previsão de chuva atrapalhou a colheita','Val, registra que ele vai plantar milho safrinha']){
  const route=routeValIntent({message,hasClient:true})
  assert.equal(route.intent,'REGISTER_INFORMATION',message)
  assert.equal(route.persistence_mode,'CONFIRM_REQUIRED',message)
 }
 assert.equal(routeValIntent({message:'qual a cotação da soja',hasClient:true}).intent,'ASK_COMMODITY')
})

test('"muda a negociação com ele?" é pergunta sobre o produtor atual, não troca de produtor',()=>{
 assert.deepEqual(extractNaturalClientReference('Essa cotação da soja muda a negociação com ele?'),{kind:'CURRENT_CLIENT',reference:'ele'})
 assert.equal(extractNaturalClientReference('Isso muda a abordagem?').kind,'NONE')
 assert.deepEqual(extractNaturalClientReference('muda para o João'),{kind:'EXPLICIT_NAME',reference:'João'})
 assert.deepEqual(extractNaturalClientReference('muda a conta para o João'),{kind:'EXPLICIT_NAME',reference:'João'})
 assert.deepEqual(extractNaturalClientReference('troca pro Antônio'),{kind:'EXPLICIT_NAME',reference:'Antônio'})
})

test('"e o Matheus?" é candidato a outro produtor; pronome no complemento é o produtor atual',()=>{
 assert.deepEqual(extractNaturalClientReference('e o Matheus?'),{kind:'AUTHORIZED_NAME_CANDIDATE',reference:'Matheus'})
 assert.deepEqual(extractNaturalClientReference('e a Maria, como está?'),{kind:'AUTHORIZED_NAME_CANDIDATE',reference:'Maria'})
 assert.equal(extractNaturalClientReference('E o que você recomenda para ele?').kind,'CURRENT_CLIENT')
 assert.equal(extractNaturalClientReference('E o que faço com ele?').kind,'CURRENT_CLIENT')
 assert.equal(extractNaturalClientReference('mostra o perfil dele').kind,'CURRENT_CLIENT')
 assert.equal(extractNaturalClientReference('me mostra o perfil dele').kind,'CURRENT_CLIENT')
})

test('troca de produtor por frase vira ação de abrir o produtor resolvido, não raciocínio vazio',()=>{
 const client={id:'antonio',name:'Antônio Silva'}
 for(const message of ['volta pro Antônio','volta para o produtor anterior','agora o Antônio','troca pro Antônio','muda para o Antônio']){
  const route=routeGlobalIntent({message,client})
  assert.equal(route.intent,'OPEN',message)
  assert.equal(route.reason,'SWITCH_RESOLVED_CLIENT',message)
  assert.equal(route.workspace_action?.type,'OPEN_CLIENT',message)
  assert.match(route.summary,/Agora falando de Antônio Silva/)
 }
 assert.equal(routeGlobalIntent({message:'qual o perfil do Antônio?',client}).intent,'ASK')
 assert.equal(routeGlobalIntent({message:'volta no que você falou',client}).intent,'FOLLOW_UP')
})

test('verbo comprar é domínio comercial e a oportunidade responde à pergunta de oportunidade',()=>{
 assert.equal(classifyValContextDomain('quanto ele comprou?','ASK_CLIENT'),'COMMERCIAL')
 assert.equal(classifyValContextDomain('qual foi a última compra dele?','ASK_CLIENT'),'COMMERCIAL')
 const opportunity={id:'opp-1',tenantId,ownerId,clientId:'joao',title:'Venda de KCl para safra 25/26',category:'Fertilizante',stage:'Proposta',estimatedValue:80000}
 assert.equal(collectionMatchesContextDomain(opportunity,'opportunity','OPPORTUNITY','ele tem oportunidade aberta?'),true)
 assert.equal(collectionMatchesContextDomain(opportunity,'opportunity','PROFILE','qual o perfil dele?'),false)
 assert.equal(collectionMatchesContextDomain(opportunity,'opportunity','VISIT','qual foi a última visita?'),false)
})

test('pergunta conceitual com rascunho de visita ativo continua na Biblioteca',()=>{
 const route=routeSystemCapability({message:'O que é WASDE?',intentHint:'ASK_GENERAL',hasClient:true,activeContext:{type:'visit_draft',id:'rascunho-1'}})
 assert.deepEqual(route.capabilities,['KNOWLEDGE_LIBRARY'])
 const profile=routeSystemCapability({message:'como abordar ele na próxima visita?',intentHint:'ASK_CLIENT',hasClient:true,activeContext:{type:'visit_draft',id:'rascunho-1'}})
 assert.ok(profile.capabilities.includes('VISIT_HISTORY'))
})

test('card de Decision Interview expõe as entradas materiais quando não há perguntas',()=>{
 const source=readFileSync(join(repositoryRoot,'src/components/copilot/DecisionInterviewCard.jsx'),'utf8')
 assert.match(source,/material_missing_information/)
 assert.match(source,/global-val-interview-missing/)
 assert.match(source,/humanizeMaterialInput/)
 assert.match(source,/areaHa:'Área \(ha\)'/)
 const css=readFileSync(join(repositoryRoot,'src/global-val-copilot.css'),'utf8')
 assert.match(css,/\.global-val-interview ul\.global-val-interview-missing/)
 const panel=readFileSync(join(repositoryRoot,'src/components/copilot/ValContextualPanel.jsx'),'utf8')
 assert.match(panel,/clientVisits\.find\(completedVisit\)/)
 const copilot=readFileSync(join(repositoryRoot,'src/components/GlobalValCopilot.jsx'),'utf8')
 assert.match(copilot,/valIntentLabel\(latestReasoning\.intent\)/)
})

const matheus=scoped({id:'matheus',name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',decisionDriver:'Compara custo por hectare e retorno antes de decidir',technicalPresentation:'Prefere dados objetivos e comparáveis',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-matheus',profileEvidence:[evidence('pm-1','profile-matheus','decisionDriver','Compara custo por hectare e retorno antes de decidir'),evidence('pm-2','profile-matheus','technicalPresentation','Prefere dados objetivos e comparáveis')]})
const antonio=scoped({id:'antonio',name:'Antônio Silva',municipality:'Jataí',primaryProfile:'Relacional',decisionDriver:'Decide pela confiança no consultor e pela tradição da família',technicalPresentation:'Prefere conversa presencial e exemplos de vizinhos',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-antonio',profileEvidence:[evidence('pa-1','profile-antonio','decisionDriver','Decide pela confiança no consultor e pela tradição da família'),evidence('pa-2','profile-antonio','technicalPresentation','Prefere conversa presencial e exemplos de vizinhos')]})
const bruno=scoped({id:'bruno',name:'Bruno Costa'})
const joao=scoped({id:'joao',name:'João Pereira',cultures:'Soja, Milho',totalAreaHa:850,municipality:'Cascavel/PR',primaryProfile:'Analítico',decisionDriver:'Compara custo por hectare antes de decidir',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-joao',profileEvidence:[evidence('profile-joao-q7','profile-joao','decisionDriver','Compara custo por hectare antes de decidir')]})
const store={surveys:[],imports:[scoped({id:'import-a',clients:[matheus,antonio,bruno,joao]})],
 visits:[scoped({id:'visit-done',clientId:'joao',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:ago(10),summary:'Discutimos adubação de base e o preço do fertilizante para a safra.',updatedAt:ago(10)}),scoped({id:'visit-m1',clientId:'matheus',scheduledAt:ago(8),status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:ago(8),objective:'Apresentar planilha de custo por hectare do milho safrinha',summary:'Planilha de custo apresentada.'})],
 businessEvents:[scoped({id:'evt-won-1',clientId:'joao',outcome:'won',product:'Fertilizante NPK 04-14-08',category:'Fertilizante',quantity:20,unit:'t',value:120000,currency:'BRL',occurredAt:ago(30)})],
 opportunities:[scoped({id:'opp-1',clientId:'joao',title:'Venda de KCl para safra 25/26',category:'Fertilizante',stage:'Proposta',estimatedValue:80000,createdAt:ago(9),updatedAt:ago(5)})],
 val:{commitments:[],memories:[scoped({id:'mem-decisor',client_id:'joao',status:'verified',memory_type:'fact',memory_state:'FACT',memory_domain:'COMMERCIAL',key:'decision_maker',value:{decision_maker:'O filho, Pedro Pereira'},source_type:'confirmed_visit_report',source_ref:'report-1',observed_at:ago(10),created_at:ago(10),updated_at:ago(10),confidence:0.95})],visitReports:[scoped({visit_report_id:'report-1',client_id:'joao',visit_id:'visit-done',confirmation_status:'CONFIRMED',confirmed_at:ago(10),objections:[]})]},
 grains:{profiles:[],intentions:[],marketSnapshots:[scoped({id:'market-soja-now',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:135.5,priceUnit:'BRL/sc_60kg',sourceName:'Cooperativa (teste)',sourceType:'cooperative',observedAt:ago(0,2),confidence:95,status:'active',scope:'MARKET'})]}}
const names={matheus:'Matheus Nascimento Jaeger',antonio:'Antônio Silva',bruno:'Bruno Costa',joao:'João Pereira',ghost:'Ghost Fora da Carteira'}

async function availablePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
function waitForStartup(child,timeoutMs=30_000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}

test('HTTP demo: contratos da rodada 2 de auditoria',async()=>{
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-audit-r2-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'500',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const turn=async(message,conversationId,clientId='',extra={})=>{const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:clientId||undefined,client:clientId?{id:clientId,name:names[clientId]}:undefined,conversationId,mode:'daily',...extra})});let payload;try{payload=await response.json()}catch{payload={}}return {status:response.status,payload}}
 const reasoning=turn=>turn.payload?.advice?.ai_reasoning||{}
 try{
  await waitForStartup(child)
  for(const [index,message] of ['Abra o produtor Ghost.','resume a conta dele','oi'].entries()){
   const ghost=await turn(message,`ghost-${index}`,'ghost')
   assert.equal(ghost.status,404,message);assert.equal(ghost.payload.code,'val_client_not_authorized',message);assert.equal(ghost.payload.conversationState,undefined,message)
  }
  const market=await turn('Qual a última cotação de soja?','market')
  assert.equal(market.status,200);assert.match(market.payload.advice.answer,/Cooperativa \(teste\)/);assert.match(market.payload.advice.answer,/135,50/)
  const register=await turn('Registra que a cotação da soja subiu','register','matheus')
  assert.equal(register.status,409);assert.equal(register.payload.code,'val_confirmation_required')
  const negotiation=await turn('Essa cotação da soja muda a negociação com ele?','negotiation','matheus')
  assert.equal(negotiation.status,200,JSON.stringify(negotiation.payload));assert.equal(negotiation.payload.conversationState.current_client.id,'matheus')
  for(const message of ['oi','O que é WASDE?','obrigado']){
   const general=await turn(message,'general','matheus')
   assert.equal(general.status,200,message)
   assert.equal(general.payload.responseScope.producerId,'matheus',message)
   assert.equal(reasoning(general).premises.context_scope.producer_id,'matheus',message)
   assert.equal(reasoning(general).premises.session_context.current_client.id,'matheus',message)
   assert.equal(reasoning(general).client.id,'portfolio',message)
   assert.equal(general.payload.conversationState.current_client.id,'matheus',message)
  }
  const summary=await turn('resume a conta','summary','joao')
  assert.equal(summary.status,200,JSON.stringify(summary.payload));assert.match(summary.payload.advice.answer,/João Pereira: 1 visita\(s\) e 1 oportunidade\(s\) aberta\(s\)/)
  assert.equal(reasoning(summary).grounding.question_relevance,'CLIENT_CONTEXT_SUMMARY')
  const relational=await turn('qual o perfil dele?','relational','antonio')
  assert.equal(relational.status,200,JSON.stringify(relational.payload));assert.match(relational.payload.advice.answer,/Perfil principal: Relacional/);assert.match(relational.payload.advice.answer,/Como abordar: comece pelo histórico de confiança/)
  const pronoun=await turn('mostra o perfil dele','pronoun')
  assert.equal(pronoun.status,422);assert.equal(pronoun.payload.code,'val_client_reference_context_required')
  const decider=await turn('quem decide?','decider','joao')
  assert.equal(decider.status,200);assert.match(decider.payload.advice.answer,/Quem decide \(decisor confirmado\): O filho, Pedro Pereira/)
  const purchase=await turn('quanto ele comprou?','purchase','joao')
  assert.equal(purchase.status,200,JSON.stringify(purchase.payload));assert.match(purchase.payload.advice.answer,/Fertilizante NPK 04-14-08/);assert.equal(reasoning(purchase).grounding.question_relevance,'STRUCTURED_FACT')
  const opportunity=await turn('ele tem oportunidade aberta?','opportunity','joao')
  assert.equal(opportunity.status,200);assert.doesNotMatch(opportunity.payload.advice.answer,/Ainda não há oportunidade registrada/)
  assert.ok(reasoning(opportunity).run.capability_results.some(item=>item.capability==='OPPORTUNITY_PIPELINE'&&item.status==='EXECUTED'))
  const noOpportunity=await turn('ele tem oportunidade aberta?','no-opportunity','antonio')
  assert.match(noOpportunity.payload.advice.answer,/Ainda não há oportunidade registrada/)
  await turn('qual o perfil dele?','switch','matheus')
  const switched=await turn('volta pro Antônio','switch','matheus')
  assert.equal(switched.status,200);assert.equal(switched.payload.conversationState.current_client.id,'antonio');assert.match(switched.payload.advice.answer,/Agora falando de Antônio Silva/);assert.equal(switched.payload.workspaceAction?.type,'OPEN_CLIENT')
  const resumeAfterSwitch=await turn('resume','switch','antonio')
  assert.equal(resumeAfterSwitch.status,200);assert.doesNotMatch(resumeAfterSwitch.payload.advice.answer,/Agora falando|Abrindo/);assert.match(resumeAfterSwitch.payload.advice.answer,/Este comando precisa de uma resposta anterior/)
  await turn('qual o perfil dele?','other','matheus')
  const other=await turn('e o Bruno?','other','matheus')
  assert.equal(other.status,200);assert.equal(other.payload.conversationResolution?.client?.id,'bruno')
  const weather=await turn('e o clima hoje?','weather','matheus')
  assert.notEqual(weather.payload.code,'val_client_reference_not_found')
  const firstTurn=await turn('Mostre a última visita do Matheus','first-turn','bruno')
  assert.equal(firstTurn.status,200,JSON.stringify(firstTurn.payload));assert.equal(firstTurn.payload.conversationState.current_client.id,'bruno');assert.equal(firstTurn.payload.conversationResolution.request_override,true)
  const nextTurn=await turn('qual o perfil dele?','first-turn','bruno')
  assert.equal(nextTurn.status,200,JSON.stringify(nextTurn.payload))
  const draft=await turn('O que é WASDE?','draft','matheus',{context:{type:'visit_draft',id:'rascunho-1',label:'Rascunho'}})
  assert.equal(draft.status,200);assert.match(draft.payload.advice.answer,/WASDE/)
  const calculator=await turn('quantas sementes por metro para 60 mil plantas/ha com espaçamento de 50 cm?','calculator','matheus')
  assert.equal(reasoning(calculator).decision_interview.status,'NEEDS_INPUT');assert.ok(reasoning(calculator).decision_interview.material_missing_information.length>0)
 }finally{
  child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
})
