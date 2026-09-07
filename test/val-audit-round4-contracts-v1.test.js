import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {request as httpRequest} from 'node:http'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDatabase} from '../server/db.js'
import {ValRepository} from '../server/repository.js'
import {selectKnowledge} from '../server/knowledge/selection.js'
import {classifyStructuredClientFact} from '../server/decision-copilot/capability-router.js'
import {conversationReferenceKind} from '../server/decision-copilot/context-selector.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {buildDayBriefing,buildTopCultures} from '../src/lib/home-command-center.js'
import {seasonCode} from '../src/lib/producer-seasons.js'
import {readFileSync} from 'node:fs'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const now=Date.now()
const ahead=days=>new Date(now+days*86400000).toISOString()

test('pool do PostgreSQL registra ouvinte de erro: queda do banco não derruba o processo',()=>{
 const listeners=new Map()
 class FakePool{
  on(event,handler){listeners.set(event,handler);return this}
  async query(){return {rowCount:0,rows:[]}}
  async connect(){return {async query(){return {rowCount:0,rows:[]}},release(){}}}
  async end(){}
 }
 createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false},{PoolClass:FakePool})
 const handler=listeners.get('error')
 assert.equal(typeof handler,'function','o pool precisa de um ouvinte de error, senão o processo cai')
 // Um erro de conexão ociosa é absorvido pelo ouvinte em vez de virar exceção não tratada.
 assert.doesNotThrow(()=>handler(Object.assign(new Error('terminating connection due to administrator command'),{code:'57P01'})))
})

test('cortesia e saudação não tiram a pergunta do acervo, e a pergunta fora do acervo continua fora',()=>{
 const modules=['MCTX','MDI','MVV','MIA','MIC']
 const answered=query=>selectKnowledge({query,modules,geography:'General',limit:1}).items
 for(const query of [
  'me tira uma duvida sobre calagem?','bom dia! o que e basis?','boa tarde, o que e o wasde?',
  'tenho uma duvida sobre vazio sanitario?','queria tirar uma duvida sobre hedge?',
  'fiquei na duvida sobre ferrugem asiatica?','me explica direitinho o que e basis?'
 ])assert.equal(answered(query).length,1,query)
 assert.equal(answered('bom dia! o que e basis?')[0].item_id,answered('o que e basis?')[0].item_id)
 for(const query of [
  'qual a distância da terra até a lua','distância até o aeroporto','por que a terra não é plana',
  'qual a capital da Austrália','quem ganhou a segunda guerra mundial','receita de bolo de cenoura','preço do bitcoin'
 ])assert.deepEqual(answered(query),[],query)
})

async function availablePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
function waitForStartup(child,timeoutMs=30000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}

// Envia o corpo em dois pacotes com o corte no meio de um caractere multibyte, como um TCP lento faz.
function postSplitBody(port,path,payload){
 const body=Buffer.from(JSON.stringify(payload),'utf8')
 const accent=body.indexOf(Buffer.from('ç','utf8'))
 assert.ok(accent>0,'a fixture precisa de um caractere multibyte')
 const head=body.subarray(0,accent+1)
 const tail=body.subarray(accent+1)
 return new Promise((resolve,reject)=>{
  const call=httpRequest({host:'127.0.0.1',port,path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},response=>{
   let raw='';response.setEncoding('utf8');response.on('data',chunk=>{raw+=chunk});response.on('end',()=>{let parsed;try{parsed=JSON.parse(raw)}catch{parsed={}};resolve({status:response.statusCode,payload:parsed})})
  })
  call.on('error',reject)
  call.write(head)
  setTimeout(()=>{call.end(tail)},40)
 })
}

test('HTTP demo: acento partido entre pacotes chega íntegro ao registro e o assunto sem "?" não cai no muro de produtor',async()=>{
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-round4-'))
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR'})
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify({surveys:[],imports:[scoped({id:'import-a',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'500',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 try{
  await waitForStartup(child)
  const objective='Revisar adubação de cobertura e correção do solo'
  const saved=await postSplitBody(port,'/api/visits',{clientId:'joao',scheduledAt:ahead(4),objective})
  assert.equal(saved.status,201)
  const stored=saved.payload.visit||saved.payload
  assert.equal(stored.objective,objective,'o acento partido entre pacotes não pode virar U+FFFD')
  assert.doesNotMatch(JSON.stringify(saved.payload),/�/)
  const intelligence=await fetch(`${base}/api/intelligence`).then(response=>response.json())
  const persisted=(intelligence.visits||[]).find(item=>String(item.id)===String(stored.id))
  assert.equal(persisted?.objective,objective,'o registro gravado precisa manter o texto íntegro')

  const ask=async message=>{const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:`r4-${message.length}-${message.slice(0,6)}`,mode:'daily'})});return {status:response.status,payload:await response.json().catch(()=>({}))}}
  for(const topic of ['lixiviacao de potassio','fosforo no solo']){
   const semInterrogacao=await ask(topic)
   const comInterrogacao=await ask(`${topic}?`)
   assert.equal(semInterrogacao.status,200,topic)
   assert.doesNotMatch(semInterrogacao.payload.advice.answer,/Nenhum produtor está selecionado/,topic)
   assert.equal(semInterrogacao.payload.advice.answer,comInterrogacao.payload.advice.answer,`"${topic}" e "${topic}?" precisam responder o mesmo`)
  }
 }finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
})

// --- Rodada 5 -------------------------------------------------------------
const read5=path=>readFileSync(join(repositoryRoot,path),'utf8')

test('rodada 5: perfil na forma nominal, vocativo preserva a conversa, pronome com cauda e escritas ampliadas',()=>{
 for(const message of ['perfil dele','o perfil dele','me fala do perfil dele','me fala do perfil comportamental dele','fala do perfil dele','como e o jeito dele?','qual o perfil dele?'])assert.equal(classifyStructuredClientFact(message),'BEHAVIORAL_PROFILE',message)
 assert.equal(classifyStructuredClientFact('perfil de mercado da soja'),null)
 // "Val, repete" precisa continuar sendo continuidade: sem isso o dominio mudava e a conversa
 // inteira era zerada (turnos, fatos e tese), derrubando ate os comandos sem vocativo.
 for(const message of ['repete','Val, repete','Val, resume isso','val explica melhor','Val, mostra os numeros'])assert.equal(conversationReferenceKind(message),'TURN_CONTENT',message)
 for(const message of ['quando vou visitar ele de novo?','quando vou encontrar ele de novo?','vou ver ele na semana que vem','vamos visitar ele semana que vem']){
  const reference=extractNaturalClientReference(message)
  assert.equal(reference.kind,'CURRENT_CLIENT',`${message} -> ${JSON.stringify(reference)}`)
 }
 assert.equal(extractNaturalClientReference('vou visitar o Genor Brum amanha').kind,'EXPLICIT_NAME')
 const client={id:'joao',name:'João Pereira'}
 const intent=message=>routeGlobalIntent({message,client}).intent
 for(const message of ['cria uma nova visita para amanhã','agenda uma nova visita para sexta','cadastra uma nova oportunidade'])assert.equal(intent(message),'CREATE',message)
 for(const message of ['deleta a oportunidade de KCl','coloca a oportunidade em Proposta','move a oportunidade para Negociação'])assert.equal(intent(message),'UPDATE',message)
 assert.equal(intent('quando foi a nova visita?'),'ASK')
})

test('rodada 5: Home conta pela mesma fonte do funil, descarta cultura de preenchimento e leva a visita escolhida',()=>{
 // A oportunidade declarada no Produtor 360 entra pelo pipeline: contar so o array cru fazia a Home
 // dizer "Oportunidades 00" enquanto o funil da mesma tela mostrava 1.
 const pipelineItem={id:'o-joao',clientId:'joao',title:'Semente',stage:'Diagnóstico',value:180000}
 assert.equal(buildDayBriefing({visits:[],opportunities:[pipelineItem],clients:[{id:'joao',name:'João'}]}).cards.find(item=>item.id==='opportunities')?.value,1)
 const cultures=buildTopCultures({clients:[{id:'a',cultures:'A definir'},{id:'b',cultures:'A classificar'},{id:'c',cultures:'Soja, Milho'}]})
 assert.deepEqual(cultures.map(item=>item.culture).sort(),['Milho','Soja'])
 assert.equal(seasonCode('Inverno  2029'),'INVERNO 2029','espaco interno colapsa como o DOM faz')
 const dashboard=read5('src/pages/Dashboard.jsx')
 assert.match(dashboard,/onPrepare\(client,\{visitId:entry\.id\}\)/)
 assert.match(dashboard,/buildDayBriefing\(\{visits,opportunities:pipelineItems,clients\}\)/)
 assert.match(read5('src/App.jsx'),/const prepareClient=\(c,options=\{\}\)=>/)
 assert.match(read5('src/pages/Visits.jsx'),/const requested=initialVisitId\?candidates\.find/)
})

test('rodada 5: cadastro comercial ausente continua desconhecido e a galeria filtra imagens no servidor',async()=>{
 const rows={business:{purchase_total:0,purchase_count:0,margin_total:null,last_purchase_at:null}}
 const db={configured:true,query:async sql=>{
  if(/FROM clients c/.test(sql))return {rows:[{id:1,external_key:'joao',name:'João Pereira',commercial_profile:{},relationship_profile:{},profile_snapshot:{}}],rowCount:1}
  if(/business_events/.test(sql))return {rows:[rows.business],rowCount:1}
  return {rows:[],rowCount:0}
 }}
 const repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 const overview=await repository.getClientOverview({tenantId,ownerId:'owner-1',clientId:'joao'}).catch(()=>null)
 if(overview){
  const commercial=overview.commercial||{}
  for(const field of ['currentPurchases','potentialTotal','openPotential','creditLimit','creditUsed','creditAvailable'])assert.equal(commercial[field],null,`${field} sem cadastro precisa continuar desconhecido, nao R$ 0,00`)
 }
 assert.match(read5('src/components/ProducerFieldGallery.jsx'),/mimePrefix=\$\{encodeURIComponent\('image\/'\)\}/)
 assert.match(read5('server.js'),/mimePrefix=clean\(url\.searchParams\.get\('mimePrefix'\)\)/)
 assert.match(read5('server/repository.js'),/a\.mime_type LIKE \$5\|\|'%'/)
})
