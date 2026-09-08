import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripMessagePreamble} from '../server/message-preamble.js'
import {classifyStructuredClientFact} from '../server/decision-copilot/capability-router.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {selectKnowledge} from '../server/knowledge/selection.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {readFileSync} from 'node:fs'
import {buildOpportunityWorkspace} from '../src/lib/opportunity-workspace.js'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const emptyStore={surveys:[],imports:[],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
const now=Date.now()
const ago=days=>new Date(now-days*86400000).toISOString()
const ahead=days=>new Date(now+days*86400000).toISOString()

async function availablePort(){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});const {port}=probe.address();await new Promise(resolve=>probe.close(resolve));return port}
function waitForStartup(child,timeoutMs=45000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}
async function withServer(store,fn){
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-r6-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 try{await waitForStartup(child);return await fn({base:`http://127.0.0.1:${port}`})}
 finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
}
const askVal=base=>async(message,open={})=>{
 const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:`r6-${Math.random().toString(36).slice(2)}`,mode:'daily',...open})})
 const payload=await response.json().catch(()=>({}))
 return {status:response.status,answer:String(payload?.advice?.answer||payload?.error||'').replace(/\s+/g,' ')}
}

test('o preâmbulo de vocativo, saudação e cortesia sai da frase sem comer palavra do assunto',()=>{
 assert.equal(stripMessagePreamble('val, qual a proxima visita'),'qual a proxima visita')
 assert.equal(stripMessagePreamble('oi val, o que ele comprou'),'o que ele comprou')
 assert.equal(stripMessagePreamble('bom dia val, qual o perfil dele'),'qual o perfil dele')
 assert.equal(stripMessagePreamble('desculpa incomodar, o que e basis'),'o que e basis')
 assert.equal(stripMessagePreamble('com licenca, o que e basis'),'o que e basis')
 assert.equal(stripMessagePreamble('me tira uma duvida, o que e wasde'),'o que e wasde')
 // Palavra do assunto que começa como cortesia não pode ser mutilada.
 assert.equal(stripMessagePreamble('oito hectares de soja'),'oito hectares de soja')
 assert.equal(stripMessagePreamble('olavo comprou'),'olavo comprou')
 assert.equal(stripMessagePreamble('valor em aberto'),'valor em aberto')
 assert.equal(stripMessagePreamble('bom dia'),'')
})

test('vocativo não desliga o fato estruturado: a voz começa pela palavra de acordar',()=>{
 for(const [plain,spoken] of [
  ['qual a próxima visita?','Val, qual a próxima visita?'],
  ['o que ele comprou?','val, o que ele comprou?'],
  ['o que ficou pendente da última visita?','Val, o que ficou pendente da última visita?'],
  ['qual o perfil dele?','Bom dia val, qual o perfil dele?'],
  ['como ele decide?','Oi Val, como ele decide?']
 ]){
  const expected=classifyStructuredClientFact(plain)
  assert.ok(expected,`${plain} deveria ser fato estruturado`)
  assert.equal(classifyStructuredClientFact(spoken),expected,spoken)
 }
})

test('nome do produtor é extraído mesmo com qualificador antes do "do"',()=>{
 for(const question of [
  'qual o compromisso do João Pereira?',
  'qual o compromisso pendente do João Pereira?',
  'qual o compromisso em aberto do João Pereira?',
  'qual o perfil do João Pereira?',
  'qual a oportunidade aberta do João Pereira?',
  'qual a próxima visita do João Pereira?'
 ])assert.equal(extractNaturalClientReference(question).reference,'João Pereira',question)
})

test('cortesia na abertura não derruba a Biblioteca, e o que está fora do acervo continua fora',()=>{
 const count=query=>selectKnowledge({query}).items.length
 for(const question of ['o que e basis?','o que e o wasde?','o que e esclerodio?']){
  assert.ok(count(question)>0,question)
  for(const prefix of ['desculpa incomodar, ','com licenca, ','por gentileza, ','rapidinho, ','bom dia, tira uma duvida: '])
   assert.equal(count(prefix+question),count(question),prefix+question)
 }
 for(const off of ['quem ganhou a segunda guerra mundial?','qual a capital da australia?','me da uma receita de bolo','bom dia, quem ganhou a copa do mundo?'])
  assert.equal(count(off),0,off)
})

// Com produtor aberto, "fala sobre ferrugem asiática" era tratada como pergunta do produtor e
// morria em "não há evidência"; sem produtor a Biblioteca respondia a mesma frase.
test('pergunta conceitual na forma falada não vira pergunta do produtor só porque há um aberto',()=>{
 const intentOf=message=>routeValIntent({message,hasClient:true}).intent
 for(const message of ['fala sobre ferrugem asiática','comenta sobre o basis','me fala sobre o wasde'])
  assert.equal(intentOf(message),'ASK_GENERAL',message)
 // Assunto que é uma pessoa continua sendo pergunta do produtor.
 for(const message of ['me fala sobre ele','fala sobre esse produtor','me conta sobre a visita dele'])
  assert.equal(intentOf(message),'ASK_CLIENT',message)
})

test('a frase de ausência de compromisso em aberto é aceita pelo grounding, e afirmação não',()=>{
 const evaluate=answer=>evaluateResponseGrounding({question:'qual o compromisso pendente?',answer,domain:'VISIT',evidence:[],activeProducerId:'joao',tenantId:'t',ownerId:'o',now:new Date()}).passed
 assert.equal(evaluate('Ainda não há compromisso em aberto registrado com referência auditável.'),true)
 assert.equal(evaluate('Ainda não há compromisso registrado com referência auditável.'),true)
 assert.equal(evaluate('O compromisso em aberto de João Pereira é: Levar amostra — status open.'),false)
 assert.equal(evaluate('Ainda não há compromisso aberto e o produtor está em risco.'),false)
})

test('HTTP: a VAL responde o produtor nomeado, o pendente e o conceito geral com produtor aberto',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja',totalAreaHa:850,
  primaryProfile:'Relacional',decisionDriver:'Decide pela confiança no consultor',technicalPresentation:'Prefere conversa presencial',
  profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'perfil-joao',
  profileEvidence:[
   {id:'e1',profile_source_ref:'perfil-joao',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Decide pela confiança no consultor',assessed_at:ago(30),valid_until:ahead(300)},
   {id:'e2',profile_source_ref:'perfil-joao',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'technicalPresentation',statement:'Prefere conversa presencial',assessed_at:ago(30),valid_until:ahead(300)}]})
 const rafael=scoped({id:'rafael',name:'Rafael Menezes',municipality:'Toledo/PR',cultures:'Milho'})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao,rafael]})],
  visits:[scoped({id:'v1',clientId:'joao',scheduledAt:ahead(4),status:'planejada',lifecycleStatus:'PLANNED',objective:'Apresentar proposta de KCl'})],
  businessEvents:[],opportunities:[],
  val:{commitments:[
   scoped({id:'k-joao',clientId:'joao',description:'Enviar cotação de trigo',status:'open',dueAt:ahead(3),createdAt:ago(5)}),
   scoped({id:'k-rafael',clientId:'rafael',description:'Levar proposta de KCl',status:'open',dueAt:ahead(2),createdAt:ago(1)})],memories:[],visitReports:[]},
  grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const openJoao={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  const openRafael={clientId:'rafael',client:{id:'rafael',name:'Rafael Menezes'}}

  // A pergunta nomeia João; a tela aberta é a do Rafael. A resposta é sobre João.
  const named=await ask('qual o compromisso pendente do João Pereira?',openRafael)
  assert.equal(named.status,200,named.answer)
  assert.match(named.answer,/João Pereira/)
  assert.match(named.answer,/trigo/)
  assert.doesNotMatch(named.answer,/Rafael|KCl/)

  // Vocativo e frase nua entregam o mesmo fato.
  const plain=await ask('qual a próxima visita?',openJoao)
  const spoken=await ask('Val, qual a próxima visita?',openJoao)
  assert.equal(plain.status,200,plain.answer)
  assert.equal(spoken.answer,plain.answer)
  assert.match(plain.answer,/Apresentar proposta de KCl/)

  // "estilo de compra" casa PROFILE e COMMERCIAL: não pode virar 400 na tela.
  for(const message of ['qual o estilo de compra dele?','como ele compra?','qual o jeito de compra dele?']){
   const result=await ask(message,openJoao)
   assert.equal(result.status,200,`${message} -> ${result.answer}`)
   assert.match(result.answer,/Perfil principal/)
  }

  // Conceito da Biblioteca responde igual com e sem produtor aberto.
  for(const message of ['lixiviacao de potassio','o que e basis?','fala sobre ferrugem asiática']){
   const withProducer=await ask(message,openJoao)
   const withoutProducer=await ask(message,{})
   assert.equal(withProducer.status,200,withProducer.answer)
   assert.equal(withProducer.answer,withoutProducer.answer,message)
  }

  // Pergunta que nomeia o dono do fato continua no escopo do produtor, não vira conhecimento geral.
  const scopedQuestion=await ask('qual a área dele?',openJoao)
  assert.equal(scopedQuestion.status,200,scopedQuestion.answer)
  assert.doesNotMatch(scopedQuestion.answer,/Biblioteca|conceito/i)
 })
})

test('HTTP: compromisso concluído não responde "o que está pendente"',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja'})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],
  val:{commitments:[scoped({id:'k1',clientId:'joao',description:'Levar amostra ao laboratório',status:'COMPLETED',dueAt:ago(2),createdAt:ago(9),updatedAt:ago(1)})],memories:[],visitReports:[]},
  grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const open={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  for(const message of ['qual o compromisso pendente?','tem algum compromisso pendente?','qual o compromisso em aberto?']){
   const result=await ask(message,open)
   assert.equal(result.status,200,`${message} -> ${result.answer}`)
   assert.match(result.answer,/Ainda não há compromisso em aberto registrado/,message)
   assert.doesNotMatch(result.answer,/amostra ao laboratório/,message)
  }
  // A pergunta neutra continua respondendo o registro que existe.
  const neutral=await ask('qual foi o último compromisso?',open)
  assert.equal(neutral.status,200,neutral.answer)
  assert.match(neutral.answer,/amostra ao laboratório/)
 })
})

// Railway classifica tudo que sai em stderr como severity=error. Um aviso de depreciação impresso
// a cada boot enche o monitoramento de erro falso e esconde a falha de verdade.
test('o boot do servidor não escreve avisos de depreciação em stderr',async()=>{
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-boot-stderr-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(emptyStore))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let out='',err='',settled=false
 try{
  await new Promise((resolve,reject)=>{
   const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value)}
   const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),30000)
   child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)})
   child.stderr.on('data',chunk=>{err+=chunk})
   child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))
  })
  await new Promise(resolve=>setTimeout(resolve,300))
  assert.equal(/DeprecationWarning|DEP0060|util\._extend/.test(err),false,`stderr do boot: ${err.slice(0,500)}`)
 }finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
})

test('http-proxy só é carregado quando existe núcleo técnico para servir',()=>{
 const source=readFileSync(join(repositoryRoot,'server/technical-workspace.js'),'utf8')
 assert.equal(/^import .*from 'http-proxy'/m.test(source),false)
 assert.match(source,/enabled\?createRequire\(import\.meta\.url\)\('http-proxy'\)/)
})

// O servidor recusa a safra sem origem dos dados (400). Um consultor real levou essa recusa em
// produção depois de preencher as quatro culturas: a tela precisa barrar antes do round-trip.
test('a tela de safras exige a origem dos dados antes de enviar ao servidor',()=>{
 const source=readFileSync(join(repositoryRoot,'src/components/ProducerSeasons.jsx'),'utf8')
 assert.match(source,/if\(!String\(draft\.sourceNote\|\|''\)\.trim\(\)\)\{setError\('Informe a origem dos dados antes de salvar a safra\.'\);return\}/)
 assert.match(source,/Origem dos dados \(obrigatório\)/)
 assert.match(source,/required aria-required="true"/)
 const save=source.slice(source.indexOf('const save=async()=>{'))
 assert.ok(save.indexOf('sourceNote')<save.indexOf('fetch('),'a checagem precisa vir antes do fetch')
})

// A Home lia o pipeline por reconcilePipeline sobre o cache do navegador e o quadro lia os registros
// canônicos do servidor: o consultor salvava no quadro e a Home dizia que não havia nada em aberto.
test('a Home conta as oportunidades pela mesma fonte do quadro',()=>{
 const joao={id:'joao',name:'João Pereira',additionalNeed:'Ampliar armazenagem',additionalNeedStatus:'reported',
  commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'},potential:120000,potentialValidated:true}}
 const maria={id:'maria',name:'Maria Souza',commercial:{potential:0,potentialValidated:false}}
 const clients=[joao,maria]
 const persisted=[
  {id:'db:1',databaseId:1,clientId:'joao',candidateKey:'producer_360_q27:ampliar armazenagem',title:'Ampliar armazenagem',stage:'Negociação',value:8000,valueKnown:true,evidence:[]},
  {id:'db:2',databaseId:2,clientId:'joao',candidateKey:'manual:abc',title:'Barter milho 26',stage:'Proposta',value:90000,valueKnown:true,evidence:[]},
  {id:'db:3',databaseId:3,clientId:'maria',candidateKey:'manual:def',title:'Venda de KCl 25/26',stage:'Negociação',value:50000,valueKnown:true,evidence:[]}
 ]
 const board=buildOpportunityWorkspace(clients,persisted)
 assert.equal(board.length,3)
 assert.equal(board.reduce((total,item)=>total+Number(item.value||0),0),148000)
 // A oportunidade criada no quadro não some, e a etapa gravada do candidato Q27 não volta para
 // Diagnóstico por causa de outra oportunidade do mesmo produtor.
 assert.equal(board.find(item=>item.title==='Barter milho 26')?.stage,'Proposta')
 assert.equal(board.find(item=>item.title==='Ampliar armazenagem')?.stage,'Negociação')
 assert.equal(board.find(item=>item.title==='Ampliar armazenagem')?.value,8000)
 const dashboard=readFileSync(join(repositoryRoot,'src/pages/Dashboard.jsx'),'utf8')
 const settings=readFileSync(join(repositoryRoot,'src/pages/Settings.jsx'),'utf8')
 for(const source of [dashboard,settings]){
  assert.match(source,/buildOpportunityWorkspace\(clients,opportunities\)/)
  assert.doesNotMatch(source,/reconcilePipeline\(clients,\[\.\.\./)
 }
})

// Valor não informado não é zero: o quadro precisa dizer "a estimar", não "R$ 0".
test('oportunidade de relato de visita e de voz nasce com valor desconhecido, não com zero',()=>{
 const source=readFileSync(join(repositoryRoot,'server/repository.js'),'utf8')
 assert.match(source,/value:item\.estimated_value\?\?null,valueKnown:item\.estimated_value!=null/)
 assert.match(source,/item\.hypothesis,item\.estimated_value\?\?null,item\.stage\|\|'Diagnóstico'/)
 assert.doesNotMatch(source,/hypothesis:item\.hypothesis,value:0,/)
})

// "0% do limite de crédito utilizado" aparecia ao lado do mesmo campo exibido como "—".
test('sem crédito utilizado a tela não afirma percentual de uso',()=>{
 const source=readFileSync(join(repositoryRoot,'src/components/ProducerBusinessOverview.jsx'),'utf8')
 assert.match(source,/!known\(business\.creditUsed\)\?'Crédito utilizado ainda não informado\.'/)
 assert.doesNotMatch(source,/business\.creditLimit\?`\$\{percent\(business\.creditUsed\/business\.creditLimit/)
})

// A visita em andamento não está entre as preparáveis: abrir "a próxima do produtor" entregava o
// roteiro de outro compromisso.
test('a linha clicada abre a visita pedida, e nunca outra do mesmo produtor',()=>{
 const source=readFileSync(join(repositoryRoot,'src/pages/Visits.jsx'),'utf8')
 assert.match(source,/const requestedAnyLifecycle=initialVisitId\?visits\.find\(item=>String\(item\.id\)===String\(initialVisitId\)&&item\.clientId===initialClientId\):null/)
 assert.match(source,/const visit=requested\|\|\(requestedAnyLifecycle\?null:candidates\.find/)
 assert.match(source,/Esta visita já foi iniciada/)
})
