import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildOpportunityWorkspace,filterOpportunities} from '../src/lib/opportunity-workspace.js'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const now=Date.now()
const ago=days=>new Date(now-days*86400000).toISOString()
const ahead=days=>new Date(now+days*86400000).toISOString()
const read=relative=>readFileSync(join(repositoryRoot,relative),'utf8')

async function availablePort(){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});const {port}=probe.address();await new Promise(resolve=>probe.close(resolve));return port}
function waitForStartup(child,timeoutMs=45000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}
async function withServer(store,fn,extraEnv={}){
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-r7-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:'',...extraEnv},stdio:['ignore','pipe','pipe']})
 try{await waitForStartup(child);return await fn({base:`http://127.0.0.1:${port}`})}
 finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
}
const askVal=base=>async(message,open={},conversationId)=>{
 const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:conversationId||`r7-${Math.random().toString(36).slice(2)}`,mode:'daily',...open})})
 const payload=await response.json().catch(()=>({}))
 return {status:response.status,answer:String(payload?.advice?.answer||payload?.error||'').replace(/\s+/g,' '),client:payload?.advice?.ai_reasoning?.client?.name||''}
}

// O identificador externo do ERP/app de campo pertence ao consultor, não ao tenant: sem o dono na
// chave, o laudo e o NDVI de um consultor eram reescritos para o produtor de outro, e a venda do
// segundo era engolida — os dois casos com HTTP 202 accepted:true.
test('a chave de identificador externo da integração é escopada pelo dono',()=>{
 const schema=read('database/schema.sql')
 const migration=read('database/migrations/20260909_011_owner_scoped_external_ids_expand.sql')
 for(const table of ['business_events','field_reports','ndvi_observations']){
  assert.match(schema,new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS owner_user_id`),table)
  assert.match(schema,new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_owner_external ON ${table}\\(tenant_id,owner_user_id,source,external_id\\)`),table)
  assert.match(migration,new RegExp(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_tenant_id_source_external_id_key`),table)
  assert.match(migration,new RegExp(`UPDATE ${table} target SET owner_user_id=client\\.consultant_id`),table)
 }
 const repository=read('server/repository.js')
 // Nenhuma escrita dessas três tabelas pode continuar apontando para a chave sem dono.
 // soil_analyses fica de fora: ali a protecao ja e o prefixo `manual-soil:<ownerId>:` no external_id.
 for(const table of ['business_events','field_reports','ndvi_observations']){
  const insert=repository.slice(repository.indexOf(`INSERT INTO ${table} (`))
  assert.match(insert.slice(0,4000),/ON CONFLICT \(tenant_id,owner_user_id,source,external_id\)/,table)
 }
 assert.ok((repository.match(/ON CONFLICT \(tenant_id,owner_user_id,source,external_id\)/g)||[]).length>=4)
 // O recibo não pode mais dizer "aceito" quando a linha não entrou.
 assert.match(repository,/DO NOTHING RETURNING id/)
 assert.match(repository,/business_event_external_id_conflict/)
})

// O balde protegia conta nenhuma (bastava trocar de IP) e transformava uso normal em bloqueio
// coletivo: oito logins CERTOS trancavam a equipe inteira atrás do proxy ou de um NAT. O caminho de
// login exige PostgreSQL, então o comportamento foi medido contra um banco real e aqui fica o
// contrato das três propriedades que a correção precisa manter.
test('o freio de login cobra a tentativa que falha, não a que dá certo, e a chave inclui a conta',()=>{
 const server=read('server.js')
 // (1) a checagem acontece antes de autenticar e NAO consome cota
 assert.match(server,/function rateLimitAllows\(scope,key,limit\)/)
 assert.match(server,/if\(!rateLimitAllows\('login',loginKey,config\.loginAttemptsPerTenMinutes\)\)return json\(response,429/)
 // (2) a chave inclui a conta, nao so o endereco de origem
 assert.match(server,/const loginKey=`\$\{requestIdentity\(request\)\}\|\$\{String\(payload\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)\}`/)
 // (3) so a tentativa que falha consome, e o sucesso limpa o balde
 assert.match(server,/if\(!identity\)\{consumeRateLimit\('login',loginKey,config\.loginAttemptsPerTenMinutes\);return json\(response,401/)
 assert.match(server,/rateBuckets\.delete\(`login:\$\{loginKey\}`\)/)
 const loginBlock=server.slice(server.indexOf("url.pathname==='/api/auth/login'"),server.indexOf("url.pathname==='/api/auth/logout'"))
 assert.ok(loginBlock.indexOf('rateLimitAllows')<loginBlock.indexOf('accessRepository.authenticate'),'a checagem vem antes de autenticar')
 assert.ok(loginBlock.indexOf('accessRepository.authenticate')<loginBlock.indexOf("consumeRateLimit('login'"),'a cobranca vem depois de autenticar')
})

// Regressão da rodada 6: o padrão FACT_OWNER passou a aceitar "perfil do X" e transformou
// substantivo comum em produtor inexistente.
test('substantivo comum depois de "perfil do" não vira produtor inexistente',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja',totalAreaHa:850})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  for(const open of [{clientId:'joao',client:{id:'joao',name:'João Pereira'}},{}])
   for(const message of ['qual o perfil do solo?','qual o potencial do mercado de soja?']){
    const result=await ask(message,open)
    assert.equal(result.status,200,`${message} -> ${result.answer}`)
    assert.doesNotMatch(result.answer,/na sua carteira autorizada/,message)
   }
  // O ganho da rodada 6 continua: nome de produtor com qualificador no meio resolve.
  const named=await ask('qual o perfil do João Pereira?',{})
  assert.equal(named.status,200,named.answer)
 })
})

// Regressão da rodada 6: a ordenação aberto-primeiro era incondicional, então a pergunta neutra
// chamava de "último" um registro antigo só por estar aberto.
test('a pergunta neutra devolve o compromisso mais recente e a pendente devolve o aberto',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja'})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],
  val:{commitments:[
   scoped({id:'k-antigo',clientId:'joao',description:'Enviar cotação de trigo',status:'open',dueAt:ahead(30),createdAt:ago(40),updatedAt:ago(40)}),
   scoped({id:'k-recente',clientId:'joao',description:'Levar amostra ao laboratório',status:'COMPLETED',dueAt:ago(2),createdAt:ago(9),updatedAt:ago(1)})],memories:[],visitReports:[]},
  grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const open={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  const neutral=await ask('qual foi o último compromisso?',open)
  assert.equal(neutral.status,200,neutral.answer)
  assert.match(neutral.answer,/amostra ao laboratório/)
  const pending=await ask('qual o compromisso pendente?',open)
  assert.equal(pending.status,200,pending.answer)
  assert.match(pending.answer,/cotação de trigo/)
  assert.match(pending.answer,/compromisso em aberto/)
 })
})

// Regressão da rodada 6: a ponte de conceito geral desviava qualquer frase sem palavra contextual,
// e o follow-up curto perdia o produtor aberto.
test('follow-up curto não perde o produtor ativo, e o conceito geral continua respondendo',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja',
  primaryProfile:'Relacional',decisionDriver:'Decide pela confiança no consultor',
  profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'p-joao',
  profileEvidence:[{id:'e1',profile_source_ref:'p-joao',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Decide pela confiança no consultor',assessed_at:ago(30),valid_until:ahead(300)}]})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],
  visits:[scoped({id:'v1',clientId:'joao',scheduledAt:ahead(4),status:'planejada',lifecycleStatus:'PLANNED',objective:'Apresentar proposta de KCl'})],
  businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const open={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  const conversationId=`seq-${Math.random().toString(36).slice(2)}`
  const first=await ask('qual a próxima visita?',open,conversationId)
  assert.equal(first.client,'João Pereira',first.answer)
  const followUp=await ask('e a objeção?',open,conversationId)
  assert.equal(followUp.status,200,followUp.answer)
  assert.equal(followUp.client,'João Pereira',`o follow-up não pode virar conversa geral: ${followUp.answer}`)
  // A ponte da rodada 6 continua valendo para conceito de verdade.
  for(const message of ['lixiviacao de potassio','o que e basis?','fala sobre ferrugem asiática']){
   const withProducer=await ask(message,open)
   const withoutProducer=await ask(message,{})
   assert.equal(withProducer.answer,withoutProducer.answer,message)
  }
 })
})

// Regressão da rodada 6: a Home trocou de fonte mas não de recorte, e passou a somar negócio
// perdido e arquivado no degrau "Fechado" do funil.
test('a Home usa o mesmo recorte do quadro, e não conta perdido nem arquivado',()=>{
 const joao={id:'joao',name:'João Pereira',commercial:{potential:0,potentialValidated:false}}
 const persisted=[
  {id:'db:1',databaseId:1,clientId:'joao',candidateKey:'manual:a',title:'Foliar soja',stage:'Negociação',value:100000,valueKnown:true,status:'open',evidence:[]},
  {id:'db:2',databaseId:2,clientId:'joao',candidateKey:'manual:b',title:'Barter milho',stage:'Fechado',value:50000,valueKnown:true,status:'won',evidence:[]},
  {id:'db:3',databaseId:3,clientId:'joao',candidateKey:'manual:c',title:'KCl safrinha',stage:'Fechado',value:80000,valueKnown:true,status:'lost',evidence:[]},
  {id:'db:4',databaseId:4,clientId:'joao',candidateKey:'manual:d',title:'Semente 2029',stage:'Fechado',value:30000,valueKnown:true,status:'archived',evidence:[]}
 ]
 const board=filterOpportunities(buildOpportunityWorkspace([joao],persisted),{archived:false})
 const closed=board.filter(item=>item.stage==='Fechado')
 assert.equal(closed.length,1)
 assert.equal(closed.reduce((total,item)=>total+Number(item.value||0),0),50000)
 const dashboard=read('src/pages/Dashboard.jsx')
 assert.match(dashboard,/filterOpportunities\(buildOpportunityWorkspace\(clients,opportunities\),\{archived:false\}\)/)
})
