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
import {selectKnowledge} from '../server/knowledge/selection.js'

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
