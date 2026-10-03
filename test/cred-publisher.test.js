import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {GrainRepository} from '../server/grain-repository.js'
import {asciiJson,signCredBody,credPublisherConfig,buildSogEvents,backfillWorkspace,publishToCred,publishSogChange,backfillOwnerToCred,summarizeCredResults,CRED_EVENTS_PATH} from '../server/cred-publisher.js'

const TENANT='00000000-0000-4000-8000-000000000001'
const OWNER='5f0c2a8e-1b7d-4c3e-9a10-2b3c4d5e6f70'
const CLIENT_UUID='9d1e8f00-3a2b-4c5d-8e7f-001122334455'
const SECRET='segredo-de-teste-val-cred'
const ON={VAL_CRED_BASE_URL:'https://cred.example.test/',VAL_CRED_INBOUND_SECRET:SECRET}
const OFF={VAL_CRED_BASE_URL:'',VAL_CRED_INBOUND_SECRET:''}
const ascii=/^[\x00-\x7f]*$/
const silent=null
const future=days=>new Date(Date.now()+days*86_400_000).toISOString().slice(0,10)

const intentDto=(over={})=>({id:'7b1f4c1e-0000-4000-8000-0000000000a1',clientId:'joao-da-silva',clientName:'João da Silva',municipality:'Passo Fundo',commodity:'soja',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:150.5,priceUnit:'BRL/sc_60kg',deliveryStart:'2027-03-01',deliveryEnd:'2027-04-30',deliveryLocation:'Armazém São João',qualitySpecs:'umidade 14%',status:'confirmed',confidence:90,source:'producer_confirmation',sourceDetails:'Ligação com CPF 123.456.789-09',notes:'nota interna',observedAt:'2026-10-01T12:00:00.000Z',createdAt:'2026-10-01T12:00:00.000Z',updatedAt:'2026-10-02T08:30:00.000Z',tenantId:TENANT,contextOwnerId:OWNER,...over})
const profileDto=(over={})=>({id:'7b1f4c1e-0000-4000-8000-0000000000b1',clientId:'joao-da-silva',clientName:'João da Silva',municipality:'Passo Fundo',commodities:['soja','milho'],storageCapacityT:800,storageStructure:'Silo próprio',logisticsMode:'FOB',usualDeliveryLocations:'Cooperativa',marketingNotes:'nota',source:'producer_confirmation',sourceDetails:'Visita',observedAt:'2026-10-01T10:00:00.000Z',confirmedAt:'2026-10-01T10:00:00.000Z',createdAt:'2026-10-01T10:00:00.000Z',updatedAt:'2026-10-01T10:00:00.000Z',tenantId:TENANT,contextOwnerId:OWNER,...over})
const marketDto=(over={})=>({id:'7b1f4c1e-0000-4000-8000-0000000000c1',commodity:'soja',marketKind:'spot',region:'Passo Fundo',price:152,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,sourceName:'Cotação da cooperativa',sourceType:'cooperative',sourceUrl:'https://example.com/cotacao',confidence:95,notes:'',observedAt:'2026-10-02T09:00:00.000Z',status:'active',createdAt:'2026-10-02T09:00:00.000Z',updatedAt:'2026-10-02T09:00:00.000Z',tenantId:TENANT,contextOwnerId:OWNER,scope:'MARKET',...over})
const reply=(status,body)=>async()=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})

test('asciiJson escapa todo caractere fora do ASCII e preserva o conteúdo',()=>{
 const value={nome:'Armazém São João',emoji:'grão 🌾',linha:'a\u2028b',del:'\u007f'}
 const raw=asciiJson(value)
 assert.match(raw,ascii)
 assert.ok(raw.includes('Armaz\\u00e9m'))
 assert.deepEqual(JSON.parse(raw),value)
})

test('signCredBody assina o corpo bruto com HMAC-SHA256 em hex',()=>{
 const raw=asciiJson({a:'ção'})
 assert.equal(signCredBody(raw,SECRET),'sha256='+createHmac('sha256',SECRET).update(raw).digest('hex'))
 assert.match(signCredBody(raw,SECRET),/^sha256=[0-9a-f]{64}$/)
})

test('configuração: desligada sem URL ou sem segredo, URL precisa ser http(s) e perde a barra final',()=>{
 assert.equal(credPublisherConfig(OFF).enabled,false)
 assert.equal(credPublisherConfig({VAL_CRED_BASE_URL:'https://cred.example.test',VAL_CRED_INBOUND_SECRET:''}).enabled,false)
 assert.equal(credPublisherConfig({VAL_CRED_BASE_URL:'ftp://cred.example.test',VAL_CRED_INBOUND_SECRET:SECRET}).enabled,false)
 const on=credPublisherConfig(ON)
 assert.equal(on.enabled,true)
 assert.equal(on.eventsUrl,'https://cred.example.test'+CRED_EVENTS_PATH)
 assert.equal(credPublisherConfig({credBaseUrl:'http://localhost:8787',credInboundSecret:SECRET}).eventsUrl,'http://localhost:8787/api/v1/integrations/val/events')
})

test('intenção vira sog.intent.upserted com payload fechado do contrato e externalId por versão',()=>{
 const [event]=buildSogEvents({kind:'intent',dto:intentDto(),ownerUserId:OWNER,tenantId:TENANT})
 assert.deepEqual(Object.keys(event),['schemaVersion','type','externalId','occurredAt','source','tenantId','ownerUserId','clientExternalKey','payload'])
 assert.equal(event.schemaVersion,1);assert.equal(event.type,'sog.intent.upserted');assert.equal(event.source,'val')
 assert.equal(event.clientExternalKey,'joao-da-silva');assert.equal(event.tenantId,TENANT);assert.equal(event.ownerUserId,OWNER)
 assert.equal(event.occurredAt,'2026-10-02T08:30:00.000Z')
 assert.match(event.externalId,new RegExp(`^sog-intent:${intentDto().id}:${Date.parse('2026-10-02T08:30:00.000Z')}:[0-9a-f]{12}$`))
 assert.deepEqual(Object.keys(event.payload),['id','commodity','direction','season','volume','volumeUnit','targetPrice','priceUnit','deliveryStart','deliveryEnd','deliveryLocation','status','confidence','source','observedAt','updatedAt'])
 assert.equal(event.payload.volume,1000);assert.equal(event.payload.targetPrice,150.5);assert.equal(event.payload.confidence,90)
 const serialized=JSON.stringify(event)
 for(const leaked of ['João da Silva','nota interna','123.456.789-09','umidade','clientId'])assert.ok(!serialized.includes(leaked),leaked)
 assert.deepEqual(buildSogEvents({kind:'intent',dto:intentDto(),ownerUserId:OWNER,tenantId:TENANT}),[event],'mesma versão, mesmo envelope')
 assert.notEqual(buildSogEvents({kind:'intent',dto:intentDto({status:'negotiating',updatedAt:'2026-10-03T08:30:00.000Z'})})[0].externalId,event.externalId)
 assert.notEqual(buildSogEvents({kind:'intent',dto:intentDto({status:'negotiating'})})[0].externalId,event.externalId,'conteúdo novo com o mesmo updatedAt também muda o id')
})

test('perfil, cotação e cliente seguem o contrato; sem chave ou sem data não há evento',()=>{
 const [profile]=buildSogEvents({kind:'profile',dto:profileDto(),ownerUserId:OWNER,tenantId:TENANT})
 assert.equal(profile.type,'sog.profile.upserted')
 assert.deepEqual(Object.keys(profile.payload),['id','commodities','storageCapacityT','storageStructure','logisticsMode','usualDeliveryLocations','source','observedAt','confirmedAt'])
 assert.match(profile.externalId,/^sog-profile:[^:]+:\d{13}:[0-9a-f]{12}$/)
 const [market]=buildSogEvents({kind:'market',dto:marketDto(),ownerUserId:OWNER,tenantId:TENANT,clientExternalKey:'ignorado'})
 assert.equal(market.type,'sog.market.snapshot');assert.equal(market.clientExternalKey,undefined)
 assert.deepEqual(Object.keys(market.payload),['id','commodity','marketKind','region','price','priceUnit','sourceName','sourceUrl','confidence','observedAt','status'])
 const [client]=buildSogEvents({kind:'client',dto:{id:CLIENT_UUID,externalKey:'joao-da-silva'},ownerUserId:OWNER,tenantId:TENANT})
 assert.equal(client.type,'val.client.upserted');assert.deepEqual(client.payload,{id:CLIENT_UUID});assert.equal(client.clientExternalKey,'joao-da-silva')
 assert.match(client.externalId,new RegExp(`^val-client:${CLIENT_UUID}:[0-9a-f]{12}$`))
 const withClient=buildSogEvents({kind:'intent',dto:intentDto(),clientUuid:CLIENT_UUID,ownerUserId:OWNER})
 assert.deepEqual(withClient.map(item=>item.type),['val.client.upserted','sog.intent.upserted'])
 assert.deepEqual(buildSogEvents({kind:'intent',dto:intentDto({clientId:''})}),[])
 assert.deepEqual(buildSogEvents({kind:'market',dto:marketDto({observedAt:null})}),[])
 assert.deepEqual(buildSogEvents({kind:'client',dto:{id:'joao-da-silva',externalKey:'joao-da-silva'}}),[])
 assert.deepEqual(buildSogEvents({kind:'desconhecido',dto:intentDto()}),[])
 assert.deepEqual(buildSogEvents({kind:'intent',dto:null}),[])
 const loose=buildSogEvents({kind:'intent',dto:intentDto(),tenantId:'tenant',ownerUserId:'consultor@example.com'})[0]
 assert.equal('tenantId' in loose,false);assert.equal('ownerUserId' in loose,false)
})

test('CPF/CNPJ em texto livre não sai da VAL',()=>{
 const [intent]=buildSogEvents({kind:'intent',dto:intentDto({deliveryLocation:'Entrega CPF 123.456.789-09 / CNPJ 12.345.678/0001-90 / 12345678909'})})
 assert.equal(intent.payload.deliveryLocation,'Entrega CPF [documento omitido] / CNPJ [documento omitido] / [documento omitido]')
 const [market]=buildSogEvents({kind:'market',dto:marketDto({sourceUrl:'https://example.com/empresa/12345678000190',sourceName:'Corretora 12.345.678/0001-90'})})
 assert.equal(market.payload.sourceUrl,'');assert.equal(market.payload.sourceName,'Corretora [documento omitido]')
 const [kept]=buildSogEvents({kind:'intent',dto:intentDto({deliveryLocation:'Rodovia BR-277 km 590, CEP 85800-000'})})
 assert.equal(kept.payload.deliveryLocation,'Rodovia BR-277 km 590, CEP 85800-000')
})

test('publishToCred sem configuração não envia nada',async()=>{
 let calls=0
 const results=await publishToCred(buildSogEvents({kind:'intent',dto:intentDto()}),{config:OFF,fetcher:async()=>{calls+=1;return new Response('{}')},logger:silent})
 assert.equal(calls,0)
 assert.deepEqual(results.map(item=>item.outcome),['skipped'])
 assert.deepEqual(await publishToCred(null,{config:ON,logger:silent}),[])
})

test('publishToCred assina o corpo ASCII, usa a rota do contrato e classifica as respostas sem lançar',async()=>{
 const sent=[]
 const capture=async(url,init)=>{sent.push({url,init});return new Response(JSON.stringify({accepted:true,duplicate:false,status:'applied'}),{status:202})}
 const [event]=buildSogEvents({kind:'intent',dto:intentDto()})
 const [ok]=await publishToCred([event],{config:ON,fetcher:capture,logger:silent})
 assert.equal(ok.outcome,'sent');assert.equal(ok.credStatus,'applied');assert.equal(ok.ok,true)
 assert.equal(sent[0].url,'https://cred.example.test/api/v1/integrations/val/events')
 assert.equal(sent[0].init.method,'POST')
 assert.match(sent[0].init.body,ascii)
 assert.equal(sent[0].init.headers['x-valor-signature'],signCredBody(sent[0].init.body,SECRET))
 assert.equal(sent[0].init.headers['content-type'],'application/json')
 assert.match(sent[0].init.headers['x-request-id'],/^[0-9a-f-]{36}$/)
 assert.deepEqual(JSON.parse(sent[0].init.body),event)
 const cases=[[200,{accepted:true,duplicate:true},'duplicate',false],[409,{error:'conflito'},'conflict',false],[400,{error:'inválido'},'rejected',false],[401,{},'rejected',false],[403,{},'rejected',false],[404,{},'rejected',false],[503,{error:'não configurada'},'retry',true],[500,{},'retry',true]]
 for(const [status,body,outcome,retryable] of cases){
  const [result]=await publishToCred([event],{config:ON,fetcher:reply(status,body),logger:silent})
  assert.equal(result.outcome,outcome,String(status));assert.equal(result.retryable,retryable,String(status));assert.equal(result.status,status)
 }
 const [down]=await publishToCred([event],{config:ON,fetcher:async()=>{throw new TypeError('fetch failed')},logger:silent})
 assert.equal(down.outcome,'retry');assert.equal(down.error,'VAL Cred indisponível.')
 const [sync]=await publishToCred([event],{config:ON,fetcher:()=>{throw new Error('síncrono')},logger:silent})
 assert.equal(sync.outcome,'retry')
 // O timer do AbortSignal.timeout não segura o event loop (unref); o socket de um fetch real seguraria.
 const hang=(url,init)=>new Promise((resolve,reject)=>{const alive=setTimeout(()=>{},5_000);init.signal.addEventListener('abort',()=>{clearTimeout(alive);reject(init.signal.reason)})})
 const [slow]=await publishToCred([event],{config:ON,fetcher:hang,timeoutMs:30,logger:silent})
 assert.equal(slow.outcome,'retry');assert.equal(slow.error,'Tempo esgotado ao enviar para o VAL Cred.')
 const [invalid]=await publishToCred([{...event,type:'credit.request.updated'}],{config:ON,fetcher:capture,logger:silent})
 assert.equal(invalid.outcome,'invalid');assert.equal(sent.length,1,'evento fora do contrato não é enviado')
})

test('publishToCred respeita a ordem dos resultados com concorrência e registra falhas sem dados do payload',async()=>{
 const lines=[]
 const logger={info:line=>lines.push(['info',line]),warn:line=>lines.push(['warn',line])}
 const events=[1,2,3,4,5].map(n=>buildSogEvents({kind:'market',dto:marketDto({id:`m-${n}`})})[0])
 const fetcher=async(url,init)=>{const id=JSON.parse(init.body).payload.id;await new Promise(resolve=>setTimeout(resolve,id==='m-1'?20:1));return new Response('{}',{status:id==='m-3'?409:202})}
 const results=await publishToCred(events,{config:ON,fetcher,logger,concurrency:3})
 assert.deepEqual(results.map(item=>item.externalId),events.map(item=>item.externalId))
 assert.deepEqual(summarizeCredResults(results),{sent:4,duplicate:0,conflict:1,rejected:0,retry:0,skipped:0,invalid:0})
 assert.equal(lines.filter(([level])=>level==='warn').length,1)
 assert.ok(lines.every(([,line])=>!line.includes('Passo Fundo')&&!line.includes(SECRET)))
})

test('backfill transforma o bootstrap em eventos idempotentes e só cotações ativas',async()=>{
 const workspace={producers:[],profiles:[profileDto()],intentions:[intentDto(),intentDto({id:'7b1f4c1e-0000-4000-8000-0000000000a2',status:'cancelled'})],marketSnapshots:[marketDto(),marketDto({id:'inativa',status:'inactive'})]}
 const clients=[{id:CLIENT_UUID,externalKey:'joao-da-silva'},{id:'11111111-2222-4333-8444-555555555555',externalKey:'sem-registro-sog'},{id:'nao-uuid',externalKey:'joao-da-silva'}]
 const events=backfillWorkspace(workspace,{ownerUserId:OWNER,tenantId:TENANT,clients})
 assert.deepEqual(events.map(item=>item.type),['val.client.upserted','sog.profile.upserted','sog.intent.upserted','sog.intent.upserted','sog.market.snapshot'])
 assert.ok(!JSON.stringify(events).includes('sem-registro-sog'),'cliente sem registro na SOG não sai')
 assert.deepEqual(backfillWorkspace(workspace,{ownerUserId:OWNER,tenantId:TENANT,clients}),events)
 assert.deepEqual(backfillWorkspace(null),[])
})

test('DTO devolvido ao salvar e DTO do bootstrap geram o mesmo externalId (republicação idempotente)',async()=>{
 let store={imports:[{tenantId:TENANT,ownerId:OWNER,clients:[{id:'joao-da-silva',name:'João da Silva',municipality:'Passo Fundo'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const repository=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:TENANT})
 const profile=await repository.saveProfile({clientId:'joao-da-silva',commodities:['soja'],storageCapacityT:800,storageStructure:'Silo',logisticsMode:'FOB',usualDeliveryLocations:'Cooperativa',marketingNotes:'',source:'producer_confirmation',sourceDetails:'',observedAt:new Date().toISOString(),confirmed:true},OWNER)
 const intent=await repository.saveIntent({clientId:'joao-da-silva',commodity:'soja',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:150,priceUnit:'BRL/sc_60kg',deliveryStart:future(30),deliveryEnd:future(60),deliveryLocation:'Armazém',qualitySpecs:'',status:'confirmed',confidence:90,source:'producer_confirmation',sourceDetails:'',notes:'',observedAt:new Date().toISOString()},OWNER)
 const market=await repository.saveMarketSnapshot({commodity:'soja',marketKind:'spot',region:'Passo Fundo',price:152,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,sourceName:'Cooperativa',sourceType:'cooperative',sourceUrl:'',confidence:95,notes:'',observedAt:new Date().toISOString(),status:'active'},OWNER)
 const live=[['profile',profile],['intent',intent],['market',market]].flatMap(([kind,dto])=>buildSogEvents({kind,dto,ownerUserId:OWNER,tenantId:TENANT}))
 const replay=backfillWorkspace(await repository.getWorkspace(OWNER),{ownerUserId:OWNER,tenantId:TENANT})
 assert.equal(live.length,3)
 assert.deepEqual(replay.map(item=>item.externalId).sort(),live.map(item=>item.externalId).sort())
 assert.deepEqual(replay.map(item=>item.payload).sort((a,b)=>a.id.localeCompare(b.id)),live.map(item=>item.payload).sort((a,b)=>a.id.localeCompare(b.id)))
 assert.ok(live.every(item=>/:\d{13}:[0-9a-f]{12}$/.test(item.externalId)),'todo DTO salvo carrega updatedAt')
})

test('updateIntentStatus no PostgreSQL devolve a chave externa do cliente, como o bootstrap',async()=>{
 const calls=[]
 const row={id:'i-1',tenant_id:TENANT,owner_user_id:OWNER,client_id:CLIENT_UUID,commodity:'soja',direction:'sell',season:'2026/27',volume:'1000.000',volume_unit:'sc_60kg',target_price:'150.0000',price_unit:'BRL/sc_60kg',delivery_start:null,delivery_end:null,delivery_location:null,status:'confirmed',confidence:90,source:'producer_confirmation',observed_at:new Date('2026-10-01T12:00:00Z'),created_at:new Date('2026-10-01T12:00:00Z'),updated_at:new Date('2026-10-01T12:00:00Z')}
 const connection={query:async(sql,params)=>{calls.push({sql,params});if(/^SELECT/.test(sql))return {rowCount:1,rows:[{...row,client_external_key:'joao-da-silva',client_name:'João da Silva',municipality:'Passo Fundo'}]};return {rowCount:1,rows:[{...row,status:'negotiating',updated_at:new Date('2026-10-03T12:00:00Z')}]}}}
 const repository=new GrainRepository({db:{configured:true,transaction:fn=>fn(connection)},readStore:()=>({}),saveStore:()=>{},tenantId:TENANT})
 const intention=await repository.updateIntentStatus('i-1','negotiating',OWNER)
 assert.equal(intention.clientId,'joao-da-silva');assert.equal(intention.clientName,'João da Silva');assert.equal(intention.status,'negotiating')
 assert.equal(intention.updatedAt,'2026-10-03T12:00:00.000Z');assert.equal(intention.volume,1000)
 assert.match(calls[0].sql,/JOIN clients c ON c\.id=i\.client_id AND c\.tenant_id=i\.tenant_id/);assert.match(calls[0].sql,/FOR UPDATE OF i$/)
 assert.deepEqual(calls[0].params,[TENANT,OWNER,'i-1'])
 assert.match(buildSogEvents({kind:'intent',dto:intention})[0].clientExternalKey,/^joao-da-silva$/)
})

test('clientLinks lê UUID e chave dos clientes ativos do dono; sem PostgreSQL devolve vazio',async()=>{
 const calls=[]
 const repository=new GrainRepository({db:{configured:true,query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:CLIENT_UUID,external_key:'joao-da-silva'}]}}},readStore:()=>({}),saveStore:()=>{},tenantId:TENANT})
 assert.deepEqual(await repository.clientLinks(OWNER,{keys:['joao-da-silva','',' joao-da-silva ']}),[{id:CLIENT_UUID,externalKey:'joao-da-silva'}])
 assert.match(calls[0].sql,/tenant_id=\$1 AND consultant_id=\$2 AND status='active' AND \(id::text=ANY\(\$3::text\[\]\) OR external_key=ANY\(\$3::text\[\]\)\)/)
 assert.deepEqual(calls[0].params,[TENANT,OWNER,['joao-da-silva']])
 await repository.clientLinks(OWNER)
 assert.deepEqual(calls[1].params,[TENANT,OWNER]);assert.doesNotMatch(calls[1].sql,/\$3/)
 const failing=new GrainRepository({db:{configured:true,query:async()=>{throw new Error('down')}},readStore:()=>({}),saveStore:()=>{},tenantId:TENANT})
 await assert.rejects(()=>failing.clientLinks(OWNER),error=>error.statusCode===503)
 const fallback=new GrainRepository({db:{configured:false},readStore:()=>({}),saveStore:()=>{},tenantId:TENANT})
 assert.deepEqual(await fallback.clientLinks(OWNER),[])
})

test('publishSogChange resolve o cliente pelo repositório, nunca rejeita e não consulta nada desligado',async()=>{
 let lookups=0
 const repository={clientLinks:async(owner,{keys})=>{lookups+=1;assert.equal(owner,OWNER);assert.deepEqual(keys,['joao-da-silva']);return [{id:CLIENT_UUID,externalKey:'joao-da-silva'}]}}
 assert.deepEqual(await publishSogChange({kind:'intent',dto:intentDto(),ownerUserId:OWNER,tenantId:TENANT,repository,config:OFF}),[])
 assert.equal(lookups,0)
 const bodies=[]
 const fetcher=async(url,init)=>{bodies.push(JSON.parse(init.body));return new Response('{"accepted":true,"duplicate":false}',{status:202})}
 const results=await publishSogChange({kind:'intent',dto:intentDto(),ownerUserId:OWNER,tenantId:TENANT,repository,config:ON,fetcher,logger:silent})
 assert.deepEqual(results.map(item=>item.outcome),['sent','sent'])
 assert.deepEqual(bodies.map(item=>item.type).sort(),['sog.intent.upserted','val.client.upserted'])
 const broken={clientLinks:async()=>{throw new Error('down')}}
 const fallback=await publishSogChange({kind:'intent',dto:intentDto(),ownerUserId:OWNER,repository:broken,config:ON,fetcher,logger:silent})
 assert.deepEqual(fallback.map(item=>item.type),['sog.intent.upserted'])
 assert.deepEqual(await publishSogChange({kind:'market',dto:marketDto(),config:ON,fetcher:()=>{throw new Error('x')},logger:silent}).then(items=>items.map(item=>item.outcome)),['retry'])
 assert.deepEqual(await publishSogChange(),[])
})

test('backfillOwnerToCred nunca rejeita quando o repositório falha',async()=>{
 const result=await backfillOwnerToCred({repository:{getWorkspace:async()=>{throw new Error('down')}},ownerUserId:OWNER,config:ON,logger:silent})
 assert.equal(result.events,0);assert.ok(result.error)
 assert.equal((await backfillOwnerToCred({repository:{},config:OFF})).enabled,false)
})

// Compatibilidade REAL com o VAL Cred: importa os módulos do outro repositório e faz o evento atravessar
// verifySignature + ingestInbound + normalizeIntent/Profile/Market do lado de lá.
const credRoot=process.env.VAL_CRED_REPO_DIR||'C:\\Users\\gate\\Desktop\\DCREDC149'
const cred=await (async()=>{try{return {integration:await import(pathToFileURL(path.join(credRoot,'server','val-integration.mjs')).href),sog:await import(pathToFileURL(path.join(credRoot,'server','sog.mjs')).href)}}catch(error){return {error}}})()
const skipCred=cred.error?`VAL Cred indisponível em ${credRoot}: ${cred.error.code||cred.error.message}`:false

function credDatabase({producers=[]}={}){
 const state={inbox:[],records:new Map(),producerUpdates:[]}
 const query=async(sql,params)=>{
  if(sql.startsWith('SELECT payload_hash,status FROM integration_inbox'))return {rows:state.inbox.filter(row=>row.source===params[0]&&row.external_id===params[1])}
  if(sql.startsWith('SELECT id FROM producers'))return {rows:producers.filter(item=>item.val_client_key===params[0]||item.val_client_id===params[0]).map(item=>({id:item.id}))}
  if(sql.includes('INSERT INTO sog_records')){state.records.set(`${params[1]}:${params[2]}`,{kind:params[1],producerId:params[3],clientKey:params[4],data:JSON.parse(params[6])});return {rows:[]}}
  if(sql.startsWith('UPDATE producers')){state.producerUpdates.push(params);return {rows:[]}}
  if(sql.startsWith('INSERT INTO integration_inbox')){state.inbox.push({source:params[1],external_id:params[2],type:params[3],payload_hash:params[5],status:params[7],error:params[8]});return {rows:[]}}
  throw new Error('SQL inesperado no VAL Cred simulado: '+sql.slice(0,60))
 }
 return {state,db:{query,tx:fn=>fn({query})}}
}
// Fetcher que entrega o corpo bruto ao ingestInbound real do VAL Cred e devolve a resposta HTTP que a rota dele daria.
const credFetcher=(db,env)=>async(url,init)=>{
 const headers=Object.fromEntries(Object.entries(init.headers).map(([key,value])=>[key.toLowerCase(),value]))
 try{const result=await cred.integration.ingestInbound(db,Buffer.from(init.body,'utf8'),headers,env);return new Response(JSON.stringify(result.body),{status:result.status})}
 catch(error){return new Response(JSON.stringify({error:error.message}),{status:error.status||500})}
}

test('VAL Cred real: assinatura, formato e normalização aceitam os eventos da VAL',{skip:skipCred},()=>{
 const {integration,sog}=cred
 const events=backfillWorkspace({profiles:[profileDto()],intentions:[intentDto()],marketSnapshots:[marketDto()]},{ownerUserId:OWNER,tenantId:TENANT,clients:[{id:CLIENT_UUID,externalKey:'joao-da-silva'}]})
 assert.deepEqual(events.map(item=>item.type).sort(),[...integration.inboundTypes].sort())
 for(const event of events){
  const raw=asciiJson(event)
  assert.equal(raw,integration.asciiJson(event),'mesmos bytes do serializador do VAL Cred')
  assert.equal(integration.verifySignature(Buffer.from(raw),signCredBody(raw,SECRET),SECRET),true)
  assert.equal(integration.verifySignature(Buffer.from(raw),signCredBody(raw,'outro'),SECRET),false)
 }
 const byType=Object.fromEntries(events.map(item=>[item.type,item]))
 const intent=sog.normalizeIntent({clientId:byType['sog.intent.upserted'].clientExternalKey,...byType['sog.intent.upserted'].payload})
 assert.equal(intent.client_key,'joao-da-silva');assert.equal(intent.volume,1000);assert.equal(intent.target_price,150.5);assert.equal(intent.status,'confirmed')
 assert.equal(intent.delivery_location,'Armazém São João');assert.equal(intent.updated_at,'2026-10-02T08:30:00.000Z')
 const profile=sog.normalizeProfile({clientId:byType['sog.profile.upserted'].clientExternalKey,...byType['sog.profile.upserted'].payload})
 assert.equal(profile.client_key,'joao-da-silva');assert.deepEqual(profile.commodities,['soja','milho']);assert.equal(profile.storage_capacity_t,800)
 const market=sog.normalizeMarket(byType['sog.market.snapshot'].payload)
 assert.equal(market.price,152);assert.equal(market.source_url,'https://example.com/cotacao');assert.equal(market.observed_at,'2026-10-02T09:00:00.000Z')
})

test('VAL Cred real: backfill entra (202), republicação volta duplicate (200) e mudança de estado vira versão nova',{skip:skipCred},async()=>{
 const {state,db}=credDatabase({producers:[{id:'producer-1',val_client_key:'joao-da-silva'}]})
 const env={VAL_INBOUND_SECRET:SECRET}
 const fetcher=credFetcher(db,env)
 let store={imports:[{tenantId:TENANT,ownerId:OWNER,clients:[{id:'joao-da-silva',name:'João da Silva',municipality:'Passo Fundo'}]}],grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 const grains=new GrainRepository({db:{configured:false},readStore:()=>structuredClone(store),saveStore:next=>{store=structuredClone(next)},tenantId:TENANT})
 await grains.saveProfile({clientId:'joao-da-silva',commodities:['soja','milho'],storageCapacityT:800,storageStructure:'Silo próprio',logisticsMode:'FOB',usualDeliveryLocations:'Cooperativa',marketingNotes:'',source:'producer_confirmation',sourceDetails:'',observedAt:new Date().toISOString(),confirmed:true},OWNER)
 const saved=await grains.saveIntent({clientId:'joao-da-silva',commodity:'soja',direction:'sell',season:'2026/27',volume:1000,volumeUnit:'sc_60kg',targetPrice:150,priceUnit:'BRL/sc_60kg',deliveryStart:future(30),deliveryEnd:future(60),deliveryLocation:'Armazém São João (CPF 123.456.789-09)',qualitySpecs:'',status:'confirmed',confidence:90,source:'producer_confirmation',sourceDetails:'',notes:'não enviar',observedAt:new Date().toISOString()},OWNER)
 await grains.saveMarketSnapshot({commodity:'soja',marketKind:'spot',region:'Passo Fundo',price:152,priceUnit:'BRL/sc_60kg',deliveryStart:null,deliveryEnd:null,sourceName:'Cooperativa',sourceType:'cooperative',sourceUrl:'',confidence:95,notes:'',observedAt:new Date().toISOString(),status:'active'},OWNER)
 const repository={getWorkspace:owner=>grains.getWorkspace(owner),clientLinks:async()=>[{id:CLIENT_UUID,externalKey:'joao-da-silva'}],updateIntentStatus:(...args)=>grains.updateIntentStatus(...args)}
 const config={VAL_CRED_BASE_URL:'https://cred.example.test',VAL_CRED_INBOUND_SECRET:SECRET}

 const first=await backfillOwnerToCred({repository,ownerUserId:OWNER,tenantId:TENANT,config,fetcher,logger:silent})
 assert.equal(first.events,4)
 assert.deepEqual(first.summary,{sent:4,duplicate:0,conflict:0,rejected:0,retry:0,skipped:0,invalid:0})
 assert.ok(first.results.every(item=>item.credStatus==='applied'),JSON.stringify(first.results))
 assert.deepEqual(state.producerUpdates,[['producer-1',CLIENT_UUID,OWNER]])
 const stored=state.records.get(`intent:${saved.id}`)
 assert.equal(stored.producerId,'producer-1');assert.equal(stored.clientKey,'joao-da-silva')
 assert.equal(stored.data.delivery_location,'Armazém São João (CPF [documento omitido])')
 assert.ok(!JSON.stringify([...state.records.values()]).includes('não enviar'))

 const again=await backfillOwnerToCred({repository,ownerUserId:OWNER,tenantId:TENANT,config,fetcher,logger:silent})
 assert.deepEqual(again.summary,{sent:0,duplicate:4,conflict:0,rejected:0,retry:0,skipped:0,invalid:0})
 assert.equal(state.inbox.length,4)

 const negotiating=await grains.updateIntentStatus(saved.id,'negotiating',OWNER)
 const change=await publishSogChange({kind:'intent',dto:negotiating,ownerUserId:OWNER,tenantId:TENANT,repository,config,fetcher,logger:silent})
 assert.deepEqual(change.map(item=>[item.type,item.outcome]),[['val.client.upserted','duplicate'],['sog.intent.upserted','sent']])
 assert.equal(state.records.get(`intent:${saved.id}`).data.status,'negotiating')
})

test('VAL Cred real: conflito, segredo errado, tenant diferente e entrada desligada são classificados',{skip:skipCred},async()=>{
 const {db}=credDatabase()
 const [event]=buildSogEvents({kind:'market',dto:marketDto(),ownerUserId:OWNER,tenantId:TENANT})
 const config={VAL_CRED_BASE_URL:'https://cred.example.test',VAL_CRED_INBOUND_SECRET:SECRET}
 const fetcher=credFetcher(db,{VAL_INBOUND_SECRET:SECRET})
 assert.equal((await publishToCred([event],{config,fetcher,logger:silent}))[0].outcome,'sent')
 const tampered={...event,payload:{...event.payload,price:999}}
 assert.equal((await publishToCred([tampered],{config,fetcher,logger:silent}))[0].outcome,'conflict')
 const [wrongSecret]=await publishToCred([event],{config:{...config,VAL_CRED_INBOUND_SECRET:'outro'},fetcher,logger:silent})
 assert.equal(wrongSecret.outcome,'rejected');assert.equal(wrongSecret.status,401)
 const [otherTenant]=await publishToCred([event],{config,fetcher:credFetcher(db,{VAL_INBOUND_SECRET:SECRET,VAL_TENANT_ID:'11111111-1111-4111-8111-111111111111'}),logger:silent})
 assert.equal(otherTenant.outcome,'rejected');assert.equal(otherTenant.status,403)
 const [closed]=await publishToCred([event],{config,fetcher:credFetcher(db,{}),logger:silent})
 assert.equal(closed.outcome,'retry');assert.equal(closed.status,503)
 const [badCommodity]=await publishToCred(buildSogEvents({kind:'market',dto:marketDto({id:'m-cafe',commodity:'cafe'})}),{config,fetcher,logger:silent})
 assert.equal(badCommodity.outcome,'rejected');assert.equal(badCommodity.status,400)
})
