import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {lastCompletedAssistantTurn} from '../src/lib/full-screen-conversation.js'

const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const now='2026-08-29T15:00:00.000Z'

async function availablePort(){
 const server=createServer()
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const port=server.address().port
 await new Promise(resolve=>server.close(resolve))
 return port
}

function waitForStartup(child,timeoutMs=15_000){
 return new Promise((resolve,reject)=>{
  let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(reject,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(resolve)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(reject,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

async function stop(child){
 if(child.exitCode!==null)return
 child.kill('SIGTERM')
 await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
}

const DAY_MS=86_400_000
// Datas relativas ao relogio real: fixtures com data fixa venciam a janela de frescor (180 dias para
// compra/compromisso, valid_until do perfil) e o teste passava a falhar sozinho meses depois.
const daysAgo=(days,hour=12)=>{const date=new Date(Date.now()-days*DAY_MS);date.setUTCHours(hour,0,0,0);return date.toISOString()}
const daysAhead=(days,hour=12)=>{const date=new Date(Date.now()+days*DAY_MS);date.setUTCHours(hour,0,0,0);return date.toISOString()}
const brDate=iso=>new Date(iso).toLocaleDateString('pt-BR',{timeZone:'UTC'})
const scoped=value=>({tenantId,ownerId,...value})
const profileAssessedAt=daysAgo(34),profileValidUntil=daysAhead(331),antonioVisitAt=daysAgo(11),carlosVisitAt=daysAgo(10)

test('preparação retoma histórico em conversa nova',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-routing-http-'))
 const port=await availablePort()
 const store={
  surveys:[],
  imports:[scoped({id:'import-a',clients:[
   scoped({id:'antonio',name:'Antônio Carlos',area:428.5,cultures:'Soja, Milho'}),
   scoped({id:'carlos',name:'Carlos Oliveira',area:310,cultures:'Milho'}),
   scoped({
    id:'matheus',name:'Matheus Nascimento Jaeger',primaryProfile:'Analítico',
    decisionDriver:'Compara custo por hectare e retorno antes de decidir',
    technicalPresentation:'Prefere dados objetivos e comparáveis',
    profileUpdatedAt:profileAssessedAt,profileValidUntil:profileValidUntil,
    profileSourceRef:'profile-matheus',
    profileEvidence:[
     {id:'profile-matheus-q7',profile_source_ref:'profile-matheus',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Compara custo por hectare e retorno antes de decidir',assessed_at:profileAssessedAt,valid_until:profileValidUntil},
     {id:'profile-matheus-q8',profile_source_ref:'profile-matheus',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'technicalPresentation',statement:'Prefere dados objetivos e comparáveis',assessed_at:profileAssessedAt,valid_until:profileValidUntil}
    ],
   }),
   scoped({id:'sem-dados',name:'Produtor Sem Dados'}),
   scoped({id:'joao-a',name:'João Pereira'}),
   scoped({id:'joao-b',name:'João Souza'}),
  ]})],
  visits:[
   scoped({id:'visit-antonio',clientId:'antonio',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:antonioVisitAt,summary:'Conversamos sobre nutrição no milho. O produtor pediu um comparativo de custo por hectare antes de decidir. Combinamos apresentar o comparativo na próxima semana.',nextCommitment:'Apresentar o comparativo de custo por hectare na próxima semana',nextActionAt:daysAhead(5)}),
   scoped({id:'visit-carlos',clientId:'carlos',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:carlosVisitAt,summary:'Milho.'}),
  ],
  businessEvents:[
   scoped({id:'purchase-antonio',clientId:'antonio',outcome:'won',occurredAt:daysAgo(15),value:185000,currency:'BRL',product:'Fertilizante X'}),
   scoped({id:'purchase-carlos',clientId:'carlos',outcome:'won',occurredAt:daysAgo(14),value:92000,currency:'BRL',product:'Semente Y'}),
  ],
  val:{
   commitments:[scoped({commitment_id:'commitment-antonio',client_id:'antonio',description:'Enviar proposta.',status:'OPEN',updated_at:carlosVisitAt})],
   visitReports:[
    scoped({visit_report_id:'report-antonio',client_id:'antonio',confirmation_status:'CONFIRMED',confirmed_at:daysAgo(11,13),objections:[{statement:'Preço acima do orçamento.'}]}),
    scoped({visit_report_id:'report-carlos',client_id:'carlos',confirmation_status:'CONFIRMED',confirmed_at:daysAgo(10,13),objections:[{statement:'Prazo de entrega.'}]}),
   ],
  },
  grains:{profiles:[],intentions:[],marketSnapshots:[scoped({
   id:'market-soja-current',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:151.5,
   priceUnit:'BRL/sc_60kg',sourceName:'Fonte autorizada do teste',sourceType:'cooperative',
   observedAt:new Date().toISOString(),confidence:95,status:'active'
  })]},
 }
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
  store.imports[0].clients.push(scoped({id:'genor',name:'Genor Blum Filho TEST',area:200,cultures:'Milho, Soja'}));
  store.val.producerSeasons=[scoped({clientId:'genor',season:'2627V',revision:1,updatedAt:new Date().toISOString(),observedOn:new Date().toISOString().slice(0,10),crops:[{crop:'Milho',areaHa:70},{crop:'Soja',areaHa:90}]}),scoped({clientId:'matheus',season:'2627V',revision:1,updatedAt:new Date().toISOString(),observedOn:new Date().toISOString().slice(0,10),crops:[{crop:'Soja',areaHa:150}]})];
  store.interactions=[scoped({id:'genor-hobby',clientId:'genor',occurredAt:new Date().toISOString(),summary:'Seu hobby é pescar com a família.'})];
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store));
 const child=spawn(process.execPath,['server/start.js'],{
  cwd:repositoryRoot,
  env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'60',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},
  stdio:['ignore','pipe','pipe'],
 })
 const base=`http://127.0.0.1:${port}`
 const conversationId='thread-routing-http-a'
 const turn=async(message,clientId,thread=conversationId,payloadOverrides={})=>{
  const started=performance.now()
  const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:clientId?store.imports[0].clients.find(item=>item.id===clientId):undefined,conversationId:thread,mode:'daily',...payloadOverrides})})
  const payload=await response.json()
  return {status:response.status,payload,wallMs:performance.now()-started}
 }
 const assertFast=result=>{
  assert.equal(result.status,200,JSON.stringify(result.payload))
  assert.equal(result.payload.responseMetadata.performance.path,'FAST')
  assert.equal(result.payload.advice.ai_reasoning.run.model_call_count,0)
  assert.equal(result.payload.responseMetadata.performance.latency.MODEL,null)
  assert.ok(result.wallMs<5_000,`FAST path excedeu limite de incidente: ${result.wallMs} ms`)
 }
 try{
  await waitForStartup(child)
  const openAntonio=await turn('Abra Antônio Carlos.','antonio')
  assertFast(openAntonio)
  assert.equal(openAntonio.payload.workspaceAction.type,'OPEN_CLIENT')
  assert.equal(openAntonio.payload.conversationState.current_client.id,'antonio')
  assert.equal(openAntonio.payload.responseMetadata.executionBudget.entityResolutions,1)

  const prepared=await turn('Me prepare para a próxima visita.','antonio','new-session');
  assert.equal(prepared.status,200,JSON.stringify(prepared.payload));
  const reasoning=prepared.payload.advice.ai_reasoning;
  assert.match(prepared.payload.advice.answer,/comparativo de custo por hectare/);
  assert.match(reasoning.recommended_strategy.action,/comparativo de custo por hectare/);
  assert.doesNotMatch(prepared.payload.advice.answer,/não há evidência|confirme a fonte/i);
  assert.equal(reasoning.grounding.passed,true);
  assert.equal(reasoning.run.status,'VISIT_PREPARATION_RECOVERED');
  assert.equal(reasoning.golden_questions.length,3);
  assert.ok(reasoning.golden_questions.every(item=>/comparativo|custo/.test(item.question)));
  assert.match(reasoning.recommended_strategy.action,/Registre as respostas/);
  assert.ok(!reasoning.decision_interview.questions.some(item=>/qual decisão precisa ficar fechada/i.test(item.question)));
  assert.equal(prepared.payload.automaticRouting.useGenerativeAi,true);
  assert.match(prepared.payload.advice.answer,/antes de discutir desconto/);
  assert.match(prepared.payload.advice.answer,/sem estimar perdas ou ganhos/);
  const continued=await turn('Ele disse que está caro e ainda não informou o custo da alternativa. Como conduzir essa visita?', 'antonio','new-session');
  assert.equal(continued.status,200);
  assert.match(continued.payload.advice.answer,/comparativo de custo/);
  assert.match(continued.payload.advice.answer,/alternativa|referência/);
  assert.match(continued.payload.advice.answer,/ainda não informou o custo da alternativa/);
  assert.doesNotMatch(continued.payload.advice.ai_reasoning.golden_questions[0].question,/o que mudou/);
  assert.doesNotMatch(continued.payload.advice.answer,/ganho de \d|perda de \d|desconto de \d/);

  assert.ok(reasoning.facts_used.some(f=>f.source_ref==='visit:visit-antonio'));
  assert.ok(!reasoning.decision_interview.questions.some(q=>q.field==='timing'));
  const other=await turn('Me prepare para a próxima visita.','carlos','other-session');
  assert.equal(other.status,200,JSON.stringify(other.payload));
  assert.doesNotMatch(other.payload.advice.answer,/comparativo|Antônio|Enviar proposta/i);
  const empty=await turn('Me prepare para a próxima visita.','sem-dados','empty-session');
  assert.equal(empty.status,200,JSON.stringify(empty.payload));
  assert.doesNotMatch(empty.payload.advice.answer,/comparativo|Antônio|Enviar proposta/i);
  assert.ok(!empty.payload.advice.ai_reasoning.facts_used.some(f=>f.source_type==='visit'));
  for(const [question,target,expected,forbidden] of [
   ['Quantos hectares Genor Blum Filho TEST planta de milho?','antonio',/70 ha/,/428|150 ha/],
   ['Qual o hobby de Genor Blum Filho TEST?','genor',/pescar/,/Antônio/],
   ['Quantos hectares Matheus Nascimento Jaeger planta de soja?','genor',/150 ha/,/70 ha|pescar/]
  ]){
   const answer=await turn(question,target,'registered-facts',{conversationMode:true,responseMode:'audio'});
   assert.equal(answer.status,200,question+JSON.stringify(answer.payload));assert.match(answer.payload.advice.answer,expected);assert.doesNotMatch(answer.payload.advice.answer,forbidden);
   assert.match(answer.payload.advice.ai_reasoning.voice_output.speakable_text,expected);
   assert.equal(answer.payload.advice.ai_reasoning.decision_interview.questions.length,0);
   console.log(`FACT_LATENCY ${question}: ${Math.round(answer.wallMs)}ms`);
  }
  store.visits[0].nextCommitment='Levar o laudo atualizado para avaliação conjunta';
  store.visits[0].summary='Revisamos o combinado anterior. A prioridade agora é avaliar o laudo atualizado.';
  await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store));
  const changed=await turn('Me prepare para a próxima visita.','antonio','changed-session');
  assert.equal(changed.status,200,JSON.stringify(changed.payload));
  assert.match(changed.payload.advice.answer,/laudo atualizado/);
  assert.doesNotMatch(changed.payload.advice.answer,/comparativo de custo/);

 }finally{await stop(child);await rm(dataRoot,{recursive:true,force:true})}
})
