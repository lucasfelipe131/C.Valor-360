// Ponta a ponta da integração VAL ⇄ VAL Cred (contrato val-cred-integration.v1) pelo servidor real
// (server/start.js) contra PostgreSQL de verdade: PGlite com schema.sql e migrations, servido por
// um proxy do protocolo do Postgres neste processo. O VAL Cred é um servidor HTTP simulado aqui.
// Tudo sintético: tenant piloto, usuários e chaves inventados, nenhum segredo real.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {createServer as createHttpServer} from 'node:http'
import {createServer as createNetServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test,{after,before} from 'node:test'
import {fileURLToPath} from 'node:url'
import {PGlite} from '@electric-sql/pglite'
import {createAuth} from '../server/auth.js'
import {credIntegrationStatus} from '../server/config.js'
import {credDecisionValues,credEventTypes} from '../server/cred-events.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {publicStorageScope} from '../server/storage-policy.js'

const appRoot=fileURLToPath(new URL('..',import.meta.url))
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerA=randomUUID(),ownerB=randomUUID()
const clientKey='joao-da-silva',unlinkedKey='maria-sem-vinculo'
const propertyKey=`${clientKey}:fazenda-sao-joao`
const secrets={cred:'synthetic-cred-webhook-secret-only',manual:'synthetic-manual-webhook-secret-only',inbound:'synthetic-cred-inbound-secret-only',read:'synthetic-cred-read-token-only'}
const admin={adminEmail:`cred-admin-${randomUUID()}@example.test`,adminPassword:'Synthetic-cred-test-42!',sessionSecret:'synthetic-cred-session-not-a-deployed-secret-42',defaultTenantId:tenantId,sessionTtlSeconds:3600}
const auth=createAuth(admin)
const cookie=id=>({cookie:`valor360_session=${auth.issue({id,email:`${id}@example.test`,tenantId,role:'consultant'})}`})

// Mesmo formato do VAL Cred: JSON com não-ASCII escapado e HMAC hex do corpo bruto.
const asciiJson=value=>JSON.stringify(value).replace(/[\u007f-￿]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
const hmac=(raw,secret)=>`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`
const unit={code:'C149',name:'Unidade C149',uf:'RS',valTenantId:tenantId}
const envelope=(type,payload,extra={})=>({schemaVersion:1,type,externalId:`valcred:${type}:${randomUUID()}`,occurredAt:'2026-10-03T13:00:00.000Z',source:'val-cred',ownerUserId:ownerA,clientExternalKey:clientKey,...extra,payload:{contract:'val-cred-integration.v1',sentAt:'2026-10-03T13:00:01.000Z',unit,...payload}})
const requestEvent=(extra={})=>envelope('credit.request.updated',{request:{id:'r1',title:'Custeio soja',status:'analisada',revision:3,purpose:'custeio',periodStart:'2026-11-01',principal:150000,termMonths:12,properties:['Fazenda São João']}},extra)
const analysisEvent=()=>envelope('credit.analysis.completed',{observacao:'Análise conferida em reunião',analysis:{id:'a1',requestId:'r1',revision:3,model:'cashflow-price-12m-v1',status:'calculated',coverage:1.71,coversPayments:true,stressCoverage:1.12,stressCoversPayments:true,installment:14000,missing:0,warnings:1}})
const decisionEvent=()=>envelope('credit.decision.recorded',{decision:{id:'d1',requestId:'r1',analysisId:'a1',decision:'favoravel',humanDecision:true}})
const credProperty={name:'Fazenda São João',municipality:'Cruz Alta',areaHa:320.5,tenure:'propria',location:{lat:-28.64,lng:-53.6,source:'val-cred'},mapping:{revision:2,totalHa:318,productiveHa:280},registry:{matricula:'12.345',cartorio:'1º RI',cnm:'',car:'RS-123',sigef:'',georeferenced:true,confirmed:true,activeLienTypes:['hipoteca']},details:{activities:['graos'],crops:['soja'],irrigation:'',arableHa:290,storageCapacityT:null,carStatus:'ativo'},crosscheck:{at:'2026-10-02T10:00:00.000Z',summary:'ok',divergences:[{severity:'baixa',code:'area'}]}}
const propertyEvent=(extra={},property=credProperty)=>envelope('credit.property.updated',{reason:'mapping',property},{propertyExternalKey:propertyKey,...extra})

let pg,proxy,fake,dataRoot,server,clientA,unlinkedA
let pgQueue=Promise.resolve()
// Uma única sessão do PGlite atende o proxy e o teste, sempre em fila.
const db=(text,params)=>{const run=pgQueue.then(()=>pg.query(text,params));pgQueue=run.catch(()=>{});return run}

// Proxy do protocolo do Postgres: repassa mensagens completas ao PGlite (servidor usa PG_POOL_MAX=1).
function startPgProxy(){
 const sockets=new Set()
 const listener=createNetServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{})
  let buffer=Buffer.alloc(0),started=false
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);const messages=[];let terminate=false
   while(true){
    if(!started){if(buffer.length<4)break;const size=buffer.readInt32BE(0);if(buffer.length<size)break;messages.push(buffer.subarray(0,size));buffer=buffer.subarray(size);started=true;continue}
    if(buffer.length<5)break;const size=buffer.readInt32BE(1);if(buffer.length<size+1)break
    const message=buffer.subarray(0,size+1);buffer=buffer.subarray(size+1)
    if(message[0]===0x58){terminate=true;break}
    messages.push(message)
   }
   if(messages.length){const payload=Buffer.concat(messages);const run=pgQueue.then(async()=>{const output=await pg.execProtocolRaw(new Uint8Array(payload));if(output?.length&&!socket.destroyed)socket.write(Buffer.from(output))});pgQueue=run.catch(()=>{socket.destroy()})}
   if(terminate)pgQueue=pgQueue.then(()=>socket.end())
  })
 })
 return new Promise(resolve=>listener.listen(0,'127.0.0.1',()=>resolve({port:listener.address().port,close:()=>new Promise(done=>{for(const socket of sockets)socket.destroy();listener.close(()=>done())})})))
}

// VAL Cred simulado: entrada B (eventos da SOG) e leitura C (resumo de crédito).
function startFakeCred(){
 const state={received:[],reads:[],seen:new Map(),hold:null,failTypes:new Set(),summaries:new Map()}
 const listener=createHttpServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const raw=Buffer.concat(chunks),url=new URL(request.url,'http://cred.test')
  const reply=(status,body)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body))}
  if(request.method==='POST'&&url.pathname==='/api/v1/integrations/val/events'){
   if(state.hold)await state.hold
   const signed=request.headers['x-valor-signature']===hmac(raw,secrets.inbound)
   const envelope=JSON.parse(raw.toString('utf8'))
   state.received.push({envelope,signed,ascii:/^[\x00-\x7f]*$/.test(raw.toString('latin1')),raw:raw.toString('utf8')})
   if(!signed)return reply(401,{error:'Assinatura inválida.'})
   if(state.failTypes.has(envelope.type))return reply(500,{error:'Falha simulada.'})
   const hash=createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex')
   if(state.seen.has(envelope.externalId))return state.seen.get(envelope.externalId)===hash?reply(200,{accepted:true,duplicate:true}):reply(409,{error:'Conflito.'})
   state.seen.set(envelope.externalId,hash);return reply(202,{accepted:true,duplicate:false})
  }
  const read=url.pathname.match(/^\/api\/v1\/integrations\/val\/producers\/([^/]+)\/credit-summary$/)
  if(request.method==='GET'&&read){
   const key=decodeURIComponent(read[1]);state.reads.push({key,authorization:request.headers.authorization})
   if(request.headers.authorization!==`Bearer ${secrets.read}`)return reply(401,{error:'Token inválido.'})
   const summary=state.summaries.get(key);return summary?reply(200,summary):reply(404,{error:'Produtor não vinculado.'})
  }
  reply(404,{error:'Rota não encontrada.'})
 })
 return new Promise(resolve=>listener.listen(0,'127.0.0.1',()=>resolve({state,url:`http://127.0.0.1:${listener.address().port}`,close:()=>new Promise(done=>{listener.closeAllConnections?.();listener.close(()=>done())})})))
}

async function availablePort(){const listener=createNetServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port}

async function startServer({cred=true}={}){
 const port=await availablePort()
 const env={...process.env,PORT:String(port),DATA_DIR:dataRoot,DATABASE_URL:`postgres://postgres:postgres@127.0.0.1:${proxy.port}/postgres`,PG_SSL:'false',PG_POOL_MAX:'1',AUTO_MIGRATE:'false',VAL_DEMO_MODE:'false',VAL_DEMO_ENVIRONMENT:'',OPENAI_API_KEY:'',VAL_DEFAULT_TENANT_ID:tenantId,VAL_ADMIN_EMAIL:admin.adminEmail,VAL_ADMIN_PASSWORD:admin.adminPassword,VAL_SESSION_SECRET:admin.sessionSecret,VAL_MANUAL_WEBHOOK_SECRET:secrets.manual,VAL_INTEGRATION_TOKEN:'',
  VAL_CRED_WEBHOOK_SECRET:cred?secrets.cred:'',VAL_CRED_BASE_URL:cred?fake.url:'',VAL_CRED_INBOUND_SECRET:cred?secrets.inbound:'',VAL_CRED_READ_TOKEN:cred?secrets.read:''}
 const child=spawn(process.execPath,['server/start.js'],{cwd:appRoot,env,stdio:['ignore','pipe','pipe']})
 let output='',diagnostic=''
 child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-4000)})
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`Servidor não iniciou em 30 s. ${diagnostic}`)),30_000)
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4000);if(output.includes('VALOR 360 disponível na porta')){clearTimeout(timer);resolve()}})
  child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Servidor encerrou (${code}): ${diagnostic}`))})
 })
 const call=async(path,{method='GET',headers={},body,json}={})=>{
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(json!==undefined?{'content-type':'application/json'}:{}),...headers},body:json!==undefined?JSON.stringify(json):body,signal:AbortSignal.timeout(8_000)})
  const text=await response.text();let payload=null;try{payload=text?JSON.parse(text):null}catch{payload={raw:text}}
  return {status:response.status,body:payload,text}
 }
 const stop=async()=>{if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},5_000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
 return {call,stop}
}

const postCred=(raw,headers={})=>server.call('/api/v1/integrations/cred/events',{method:'POST',headers:{'content-type':'application/json',...headers},body:raw})
const signedCred=(event,{secret=secrets.cred,raw=asciiJson(event)}={})=>postCred(raw,{'x-valor-signature':hmac(raw,secret)})
async function waitFor(check,label,timeoutMs=8_000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,40))}throw new Error(`Tempo esgotado esperando: ${label}`)}
const sent=type=>fake.state.received.filter(item=>item.envelope.type===type)

before(async()=>{
 pg=new PGlite();await pg.waitReady
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
 for(const id of [ownerA,ownerB]){
  await db("INSERT INTO users(id,name,email,password_hash) VALUES($1,'SYNTHETIC consultor',$2,'synthetic-no-login')",[id,`${id}@example.test`])
  await db("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'consultant')",[tenantId,id])
 }
 clientA=(await db("INSERT INTO clients(tenant_id,external_key,consultant_id,name,municipality) VALUES($1,$2,$3,'SYNTHETIC João da Silva','Cruz Alta') RETURNING id",[tenantId,clientKey,ownerA])).rows[0].id
 unlinkedA=(await db("INSERT INTO clients(tenant_id,external_key,consultant_id,name,municipality) VALUES($1,$2,$3,'SYNTHETIC Maria','Ijuí') RETURNING id",[tenantId,unlinkedKey,ownerA])).rows[0].id
 await db("INSERT INTO properties(tenant_id,client_id,external_key,name,municipality,area_ha,metadata) VALUES($1,$2,$3,'Fazenda São João','Cruz Alta',300,$4::jsonb)",[tenantId,clientA,propertyKey,JSON.stringify({location:{lat:-28.5,lng:-53.5,source:'val'}})])
 dataRoot=await mkdtemp(join(tmpdir(),'val-cred-http-'))
 proxy=await startPgProxy();fake=await startFakeCred()
 fake.state.summaries.set(clientKey,{schemaVersion:1,source:'val-cred',clientExternalKey:clientKey,generatedAt:'2026-10-03T14:00:00.000Z',cpf:'123.456.789-00',documents:[{name:'matricula.pdf'}],producer:{name:'João da Silva',municipality:'Cruz Alta',cpf:'123.456.789-00',unit:{code:'C149',name:'Unidade C149',cnpj:'00.000.000/0001-00'}},properties:[{name:'Fazenda São João',municipality:'Cruz Alta',areaHa:320.5,tenure:'propria',mapped:true,registryConfirmed:true,activeLiens:1,matricula:'12.345'}],requests:[{id:'r1',title:'Custeio soja',status:'favoravel',principal:150000,termMonths:12,score:820,analysis:{fresh:true,coverage:1.71,coversPayments:true,stressCoversPayments:true,at:'2026-10-03T13:00:00.000Z'},updatedAt:'2026-10-03T13:05:00.000Z'}],governance:{automaticDecision:false,humanDecisionRequired:true,documentsShared:false}})
 server=await startServer({cred:true})
})

after(async()=>{await server?.stop();await fake?.close();await proxy?.close();await pg?.close();if(dataRoot)await rm(dataRoot,{recursive:true,force:true})})

test('contrato publicado: escopo próprio, flags públicas sem segredos, OpenAPI e JSON Schema do envelope',async()=>{
 assert.equal(publicStorageScope('/api/v1/integrations/cred/events','POST'),'cred-event')
 assert.equal(publicStorageScope('/api/v1/integrations/cred/events','GET'),null)
 assert.equal(publicStorageScope('/api/v1/integrations/manual/events','POST'),'manual-event')
 assert.deepEqual(credIntegrationStatus({}),{inboundConfigured:false,outboundConfigured:false,readConfigured:false})
 assert.deepEqual(credIntegrationStatus({credWebhookSecret:'a',credBaseUrl:'ftp://cred.test',credInboundSecret:'b',credReadToken:'c'}),{inboundConfigured:true,outboundConfigured:false,readConfigured:false})
 assert.deepEqual(credIntegrationStatus({credBaseUrl:'https://cred.test',credInboundSecret:'b'}),{inboundConfigured:false,outboundConfigured:true,readConfigured:false})
 const status=await server.call('/api/val/status',{headers:cookie(ownerA)})
 assert.equal(status.status,200,status.text)
 assert.deepEqual(status.body.credIntegration,{inboundConfigured:true,outboundConfigured:true,readConfigured:true})
 for(const value of [...Object.values(secrets),fake.url])assert.equal(status.text.includes(value),false,'status público não expõe segredo nem endereço do VAL Cred')
 const openapi=await readFile(new URL('../openapi/val-core-v1.yaml',import.meta.url),'utf8')
 for(const path of ['/api/v1/integrations/cred/events:','/api/grains/cred-sync:','/api/clients/{clientId}/credit:','valCredSignature:','integration-event.schema.json'])assert.ok(openapi.includes(path),path)
 const schema=JSON.parse(await readFile(new URL('../contracts/v1/integration-event.schema.json',import.meta.url),'utf8'))
 assert.deepEqual([...schema.$defs.credTypes.enum].sort(),[...credEventTypes].sort())
 const decision=schema.$defs.credEvent.allOf.find(item=>item.if.properties.type.const==='credit.decision.recorded')
 assert.deepEqual(decision.then.properties.payload.properties.decision.properties.decision.enum,[...credDecisionValues])
 assert.equal(decision.then.properties.payload.properties.decision.properties.humanDecision.const,true)
 assert.equal(schema.properties.externalId.minLength,4);assert.equal(schema.properties.externalId.maxLength,180)
 const env=await readFile(new URL('../.env.example',import.meta.url),'utf8')
 for(const name of ['VAL_CRED_WEBHOOK_SECRET','VAL_CRED_BASE_URL','VAL_CRED_INBOUND_SECRET','VAL_CRED_READ_TOKEN'])assert.match(env,new RegExp(`^${name}=$`,'m'))
})

test('entrada A: só HMAC do corpo bruto com o segredo próprio; Bearer, segredo do Manual e corpo alterado são recusados',async()=>{
 const event=requestEvent(),raw=asciiJson(event)
 assert.equal((await postCred(raw)).status,401)
 assert.equal((await postCred(raw,{'x-valor-signature':hmac(raw,secrets.manual)})).status,401)
 assert.equal((await postCred(raw,{authorization:`Bearer ${secrets.cred}`})).status,401)
 assert.equal((await postCred(raw+' ',{'x-valor-signature':hmac(raw,secrets.cred)})).status,401)
 const accepted=await signedCred(event)
 assert.equal(accepted.status,202,accepted.text)
 assert.equal(accepted.body.accepted,true);assert.equal(accepted.body.duplicate,false)
 assert.equal(accepted.body.eventType,'credit.request.updated');assert.equal(accepted.body.externalId,event.externalId)
 const row=(await db('SELECT tenant_id,owner_user_id,source,client_external_key,status FROM integration_events WHERE external_id=$1',[event.externalId])).rows[0]
 assert.deepEqual({...row,tenant_id:String(row.tenant_id),owner_user_id:String(row.owner_user_id)},{tenant_id:tenantId,owner_user_id:ownerA,source:'val-cred',client_external_key:clientKey,status:'processed'})
 const usage=(await db("SELECT COUNT(*)::int count FROM usage_events WHERE user_id=$1 AND event_type='cred_sync'",[ownerA])).rows[0].count
 assert.equal(usage,1)
})

test('entrada A: origem forçada, tenant do servidor, idempotência 200/409 e corpo UTF-8 assinado em bytes',async()=>{
 const event=requestEvent({source:'manual-do-agronomo'})
 assert.equal((await signedCred(event)).status,202)
 assert.equal((await db('SELECT source FROM integration_events WHERE external_id=$1',[event.externalId])).rows[0].source,'val-cred')
 const duplicate=await signedCred(event)
 assert.equal(duplicate.status,200,duplicate.text);assert.equal(duplicate.body.accepted,true);assert.equal(duplicate.body.duplicate,true)
 const changed=await signedCred({...event,payload:{...event.payload,request:{...event.payload.request,status:'favoravel'}}})
 assert.equal(changed.status,409,changed.text);assert.equal(changed.body.accepted,false);assert.equal(changed.body.status,'CONFLICT')
 assert.equal((await db('SELECT COUNT(*)::int count FROM integration_events WHERE external_id=$1',[event.externalId])).rows[0].count,1)
 assert.equal((await signedCred(requestEvent({tenantId:'00000000-0000-4000-8000-000000000099'}))).status,403)
 assert.equal((await signedCred(envelope('credit.request.updated',{unit:{...unit,valTenantId:'00000000-0000-4000-8000-000000000099'},request:{id:'r9',status:'rascunho'}}))).status,403)
 assert.equal((await signedCred(requestEvent({ownerUserId:randomUUID()}))).status,403)
 // Corpo com acentos em UTF-8 cru: o HMAC é sobre os bytes recebidos, não sobre um texto remontado.
 const utf8=Buffer.from(JSON.stringify(analysisEvent()),'utf8')
 assert.ok(utf8.some(byte=>byte>0x7f),'o corpo leva bytes multibyte de verdade')
 const raw=await server.call('/api/v1/integrations/cred/events',{method:'POST',headers:{'content-type':'application/json','x-valor-signature':hmac(utf8,secrets.cred)},body:utf8})
 assert.equal(raw.status,202,raw.text)
 assert.equal((await signedCred(decisionEvent())).status,202)
 assert.equal((await signedCred(envelope('credit.decision.recorded',{decision:{id:'d2',requestId:'r1',decision:'favoravel',humanDecision:false}}))).status,400)
 const unitEvent=(({ownerUserId,clientExternalKey,...rest})=>({...rest,payload:{...rest.payload,unit:{id:'u1',code:'C149',name:'Unidade C149',municipality:'Cruz Alta',uf:'RS',active:true,valTenantId:tenantId}}}))(envelope('cooperative.unit.upserted',{}))
 assert.equal((await signedCred(unitEvent)).status,202)
})

test('cada rota aceita só os próprios tipos: Manual recusado aqui e crédito recusado no Manual',async()=>{
 const manualType={schemaVersion:1,type:'business.closed',externalId:`manual-${randomUUID()}`,occurredAt:'2026-10-03T13:00:00.000Z',ownerUserId:ownerA,clientExternalKey:clientKey,payload:{contract:'val-cred-integration.v1',value:10}}
 const refused=await signedCred(manualType)
 assert.equal(refused.status,400,refused.text);assert.match(refused.body.error,/não suportado/)
 const credit=requestEvent(),raw=JSON.stringify(credit)
 const manual=await server.call('/api/v1/integrations/manual/events',{method:'POST',headers:{'content-type':'application/json','x-valor-signature':hmac(raw,secrets.manual)},body:raw})
 assert.equal(manual.status,400,manual.text);assert.match(manual.body.error,/não suportado/)
 const manualWithCredSecret=await server.call('/api/v1/integrations/manual/events',{method:'POST',headers:{'content-type':'application/json','x-valor-signature':hmac(raw,secrets.cred)},body:raw})
 assert.equal(manualWithCredSecret.status,401)
 assert.equal((await db('SELECT COUNT(*)::int count FROM integration_events WHERE external_id=ANY($1::text[])',[[manualType.externalId,credit.externalId]])).rows[0].count,0)
})

test('credit.property.updated só acrescenta properties.metadata.valCred na propriedade existente do mesmo produtor',async()=>{
 const applied=await signedCred(propertyEvent({occurredAt:'2026-10-03T13:00:00.000Z'}))
 assert.equal(applied.status,202,applied.text);assert.equal(applied.body.valCredMaterialization,'APPLIED')
 const property=async()=>(await db('SELECT name,area_ha,metadata FROM properties WHERE tenant_id=$1 AND external_key=$2',[tenantId,propertyKey])).rows[0]
 let current=await property()
 assert.equal(current.name,'Fazenda São João');assert.equal(Number(current.area_ha),300)
 assert.deepEqual(current.metadata.location,{lat:-28.5,lng:-53.5,source:'val'},'a sede da VAL não muda')
 assert.equal(current.metadata.valCred.contract,'val-cred-integration.v1')
 assert.equal(current.metadata.valCred.areaHa,320.5);assert.equal(current.metadata.valCred.registry.confirmed,true)
 assert.deepEqual(current.metadata.valCred.unit,{code:'C149',name:'Unidade C149',uf:'RS'})
 const stale=await signedCred(propertyEvent({occurredAt:'2026-10-01T13:00:00.000Z'},{...credProperty,areaHa:1}))
 assert.equal(stale.status,202);assert.equal(stale.body.valCredMaterialization,'STALE_IGNORED')
 assert.equal((await property()).metadata.valCred.areaHa,320.5)
 const missing=await signedCred(propertyEvent({propertyExternalKey:`${clientKey}:fazenda-nova`},{...credProperty,name:'Fazenda Nova'}))
 assert.equal(missing.status,202);assert.equal(missing.body.valCredMaterialization,'NO_TARGET')
 assert.equal((await db('SELECT COUNT(*)::int count FROM properties WHERE tenant_id=$1 AND client_id=$2',[tenantId,clientA])).rows[0].count,1,'nunca cria propriedade')
 assert.equal((await signedCred(propertyEvent({propertyExternalKey:`${unlinkedKey}:fazenda-sao-joao`}))).status,400)
})

test('leitura C na ficha: posse antes do VAL Cred, resumo sem documentos e eventos recebidos',async()=>{
 const path=`/api/clients/${clientA}/credit`
 assert.equal((await server.call(path)).status,401)
 const reads=fake.state.reads.length
 const foreign=await server.call(path,{headers:cookie(ownerB)})
 assert.equal(foreign.status,404,foreign.text)
 assert.equal(fake.state.reads.length,reads,'sem posse o VAL Cred não é consultado')
 const view=await server.call(path,{headers:cookie(ownerA)})
 assert.equal(view.status,200,view.text)
 assert.equal(view.body.contract,'val-cred-integration.v1');assert.equal(view.body.configured,true);assert.equal(view.body.status,'ok');assert.equal(view.body.eventsAvailable,true)
 assert.equal(view.body.summary.clientExternalKey,clientKey)
 assert.deepEqual(view.body.summary.governance,{automaticDecision:false,humanDecisionRequired:true,documentsShared:false})
 assert.deepEqual(view.body.summary.requests[0].analysis,{fresh:true,coverage:1.71,coversPayments:true,stressCoversPayments:true,at:'2026-10-03T13:00:00.000Z'})
 assert.doesNotMatch(view.text,/cpf|cnpj|123\.456|matricula|"score"|"documents"|0001-00/i)
 assert.deepEqual(fake.state.reads.at(-1),{key:clientKey,authorization:`Bearer ${secrets.read}`})
 const types=view.body.events.map(item=>item.type)
 for(const type of ['credit.request.updated','credit.analysis.completed','credit.decision.recorded','credit.property.updated'])assert.ok(types.includes(type),type)
 assert.ok(view.body.events.length<=20)
 const decision=view.body.events.find(item=>item.type==='credit.decision.recorded')
 assert.deepEqual(decision.decision,{requestId:'r1',decision:'favoravel',humanDecision:true})
 const byKey=await server.call(`/api/clients/${clientKey}/credit`,{headers:cookie(ownerA)})
 assert.equal(byKey.status,200);assert.equal(byKey.body.status,'ok')
 const unlinked=await server.call(`/api/clients/${unlinkedA}/credit`,{headers:cookie(ownerA)})
 assert.equal(unlinked.status,200);assert.equal(unlinked.body.status,'not_linked');assert.equal(unlinked.body.summary,null);assert.deepEqual(unlinked.body.events,[])
})

test('saída B: gravações da SOG publicam no VAL Cred sem esperar e sem mudar status nem corpo',async()=>{
 const headers=cookie(ownerA)
 let release;fake.state.hold=new Promise(resolve=>{release=resolve})
 // Com o VAL Cred travado, a rota responde mesmo assim: a publicação roda depois da resposta.
 const profile=await server.call('/api/grains/profiles',{method:'PUT',headers,json:{clientId:clientKey,commodities:['soja','milho'],storageCapacityT:1200,storageStructure:'Silo bolsa',logisticsMode:'Caminhão próprio',usualDeliveryLocations:'Cruz Alta',marketingNotes:'Nota interna 123.456.789-00',source:'consultant_interview',observedAt:'2026-10-01T12:00:00.000Z'}})
 assert.equal(profile.status,200,profile.text)
 assert.deepEqual(Object.keys(profile.body).sort(),['profile','saved']);assert.equal(profile.body.saved,true);assert.equal(profile.body.profile.clientId,clientKey)
 assert.equal(sent('sog.profile.upserted').length,0)
 release();fake.state.hold=null
 const [published]=await waitFor(()=>sent('sog.profile.upserted').length?sent('sog.profile.upserted'):null,'sog.profile.upserted')
 assert.equal(published.signed,true);assert.equal(published.ascii,true)
 assert.equal(published.envelope.source,'val');assert.equal(published.envelope.schemaVersion,1)
 assert.equal(published.envelope.clientExternalKey,clientKey);assert.equal(published.envelope.ownerUserId,ownerA);assert.equal(published.envelope.tenantId,tenantId)
 assert.equal(published.envelope.payload.id,profile.body.profile.id);assert.equal(published.envelope.payload.storageCapacityT,1200)
 assert.doesNotMatch(published.raw,/marketingNotes|Nota interna|123\.456\.789|clientName|SYNTHETIC/)
 const link=await waitFor(()=>sent('val.client.upserted')[0],'val.client.upserted')
 assert.deepEqual(link.envelope.payload,{id:clientA});assert.equal(link.envelope.clientExternalKey,clientKey)

 const intent=await server.call('/api/grains/intents',{method:'POST',headers,json:{clientId:clientKey,commodity:'soja',direction:'sell',season:'2026/27',volume:5000,volumeUnit:'sc_60kg',targetPrice:128.5,priceUnit:'BRL/sc_60kg',deliveryStart:'2027-03-01',deliveryEnd:'2027-04-30',deliveryLocation:'Cruz Alta',status:'draft',confidence:60,source:'consultant_interview',notes:'não sai'}})
 assert.equal(intent.status,201,intent.text)
 assert.deepEqual(Object.keys(intent.body).sort(),['intention','saved'])
 const first=await waitFor(()=>sent('sog.intent.upserted')[0],'sog.intent.upserted')
 assert.equal(first.envelope.payload.status,'draft');assert.equal(first.envelope.payload.volume,5000);assert.equal(first.envelope.payload.targetPrice,128.5)
 assert.equal(first.envelope.payload.deliveryStart,'2027-03-01');assert.equal(first.envelope.clientExternalKey,clientKey)
 assert.doesNotMatch(first.raw,/não sai|"notes"|qualitySpecs/)

 const patched=await server.call(`/api/grains/intents/${intent.body.intention.id}`,{method:'PATCH',headers,json:{status:'monitoring'}})
 assert.equal(patched.status,200,patched.text)
 assert.deepEqual(Object.keys(patched.body).sort(),['intention','saved']);assert.equal(patched.body.intention.status,'monitoring')
 const second=await waitFor(()=>sent('sog.intent.upserted')[1],'segunda versão da intenção')
 assert.equal(second.envelope.payload.status,'monitoring');assert.equal(second.envelope.clientExternalKey,clientKey)
 assert.notEqual(second.envelope.externalId,first.envelope.externalId)

 fake.state.failTypes.add('sog.market.snapshot')
 const market=await server.call('/api/grains/market',{method:'POST',headers,json:{commodity:'soja',marketKind:'spot',price:131.2,priceUnit:'BRL/sc_60kg',region:'Cruz Alta',sourceName:'Cooperativa sintética',sourceType:'cooperative',observedAt:'2026-10-02T12:00:00.000Z',confidence:80}})
 assert.equal(market.status,201,market.text)
 assert.deepEqual(Object.keys(market.body).sort(),['marketSnapshot','saved'])
 const quote=await waitFor(()=>sent('sog.market.snapshot')[0],'sog.market.snapshot')
 assert.equal(quote.envelope.clientExternalKey,undefined);assert.equal(quote.envelope.payload.price,131.2)
 fake.state.failTypes.delete('sog.market.snapshot')

 // Republicação idempotente: o que já chegou volta duplicate, a cotação que falhou agora entra.
 const sync=await server.call('/api/grains/cred-sync',{method:'POST',headers})
 assert.equal(sync.status,200,sync.text)
 assert.equal(sync.body.enabled,true);assert.deepEqual(sync.body.failures,[])
 assert.equal(sync.body.summary.sent+sync.body.summary.duplicate,sync.body.events)
 assert.equal(sync.body.summary.sent,1,'só a cotação que tinha falhado é nova')
 assert.ok(sync.body.summary.duplicate>=3)
 assert.ok(fake.state.received.every(item=>item.signed&&item.ascii))
 assert.equal((await server.call('/api/grains/cred-sync',{method:'POST'})).status,401)
})

test('sem as variáveis do VAL Cred tudo fica desligado e seguro',async()=>{
 await server.stop()
 server=await startServer({cred:false})
 const event=requestEvent(),raw=asciiJson(event)
 const disabled=await postCred(raw,{'x-valor-signature':hmac(raw,secrets.cred)})
 assert.equal(disabled.status,503,disabled.text);assert.equal(disabled.body.code,'cred_integration_disabled')
 assert.equal((await db('SELECT COUNT(*)::int count FROM integration_events WHERE external_id=$1',[event.externalId])).rows[0].count,0)
 const status=await server.call('/api/val/status',{headers:cookie(ownerA)})
 assert.deepEqual(status.body.credIntegration,{inboundConfigured:false,outboundConfigured:false,readConfigured:false})
 const reads=fake.state.reads.length,received=fake.state.received.length
 const view=await server.call(`/api/clients/${clientA}/credit`,{headers:cookie(ownerA)})
 assert.equal(view.status,200,view.text)
 assert.equal(view.body.configured,false);assert.equal(view.body.status,'not_configured');assert.equal(view.body.summary,null)
 assert.ok(view.body.events.some(item=>item.type==='credit.request.updated'),'eventos já recebidos continuam visíveis')
 assert.equal((await server.call(`/api/clients/${clientA}/credit`,{headers:cookie(ownerB)})).status,404)
 const profile=await server.call('/api/grains/profiles',{method:'PUT',headers:cookie(ownerA),json:{clientId:clientKey,commodities:['trigo'],source:'consultant_interview',observedAt:'2026-10-02T12:00:00.000Z'}})
 assert.equal(profile.status,200,profile.text);assert.deepEqual(Object.keys(profile.body).sort(),['profile','saved'])
 const sync=await server.call('/api/grains/cred-sync',{method:'POST',headers:cookie(ownerA)})
 assert.equal(sync.status,200);assert.deepEqual(sync.body,{enabled:false,events:0,summary:{sent:0,duplicate:0,conflict:0,rejected:0,retry:0,skipped:0,invalid:0},failures:[]})
 await new Promise(resolve=>setTimeout(resolve,300))
 assert.equal(fake.state.reads.length,reads,'sem VAL_CRED_READ_TOKEN a VAL não lê o VAL Cred')
 assert.equal(fake.state.received.length,received,'sem VAL_CRED_INBOUND_SECRET a SOG não publica')
})
