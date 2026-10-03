import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {after,before,test} from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import TestRenderer,{act} from 'react-test-renderer'
import {build} from 'esbuild'
import {PGlite} from '@electric-sql/pglite'
import {
 CRED_SUMMARY_CACHE_TTL_MS,CRED_SUMMARY_FAILURE_TTL_MS,buildCreditView,credReadConfig,fetchCreditSummary,
 listCredEvents,normalizeCreditSummary,toCredEventView
} from '../server/cred-client.js'

// Parte C do contrato val-cred-integration.v1: a VAL lê o resumo de crédito do VAL Cred e mostra
// na ficha do Cliente 360. Nunca lança, nunca mostra outro produtor, nunca deixa passar campo
// fora do contrato (CPF/CNPJ, documentos), e a decisão de crédito continua humana.

const root=fileURLToPath(new URL('..',import.meta.url))
const config={baseUrl:'https://cred.example.test/',readToken:'read-token-test'}
const contractSummary=(overrides={})=>({
 schemaVersion:1,source:'val-cred',clientExternalKey:'fazenda-aurora',generatedAt:'2026-10-02T12:00:00.000Z',
 producer:{name:'Fazenda Aurora',municipality:'Palotina',unit:{code:'PAL',name:'Unidade Palotina'},cpf:'123.456.789-00'},
 properties:[
  {name:'Sede',municipality:'Palotina',areaHa:'320.5',tenure:'Própria',mapped:true,registryConfirmed:true,activeLiens:1,matricula:'MAT-1',document:'x'},
  {name:'Arrendada Sul',municipality:'Assis',areaHa:null,tenure:'Arrendamento',mapped:false,registryConfirmed:false,activeLiens:null}
 ],
 requests:[
  {id:'req-1',title:'Custeio soja 26/27',status:'analisada',principal:850000,termMonths:12,analysis:{fresh:true,coverage:1.35,coversPayments:true,stressCoversPayments:false,at:'2026-10-01T10:00:00.000Z',score:900},updatedAt:'2026-10-01T09:00:00.000Z',cnpj:'00.000.000/0001-00'},
  {id:'req-2',title:'Investimento armazém',status:'rascunho',principal:'1200000',termMonths:60,analysis:{fresh:false,coverage:0.8,coversPayments:false,stressCoversPayments:false,at:'2026-09-01T10:00:00.000Z'},updatedAt:'2026-09-20T09:00:00.000Z'}
 ],
 governance:{automaticDecision:false,humanDecisionRequired:true,documentsShared:false},
 documents:[{name:'matricula.pdf'}],
 ...overrides
})
const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const recordingFetcher=(responder)=>{const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return responder(url,options)};fetcher.calls=calls;return fetcher}

test('sem VAL_CRED_BASE_URL ou VAL_CRED_READ_TOKEN a leitura fica desligada e nada sai da VAL',async()=>{
 const fetcher=recordingFetcher(()=>jsonResponse(contractSummary()))
 for(const partial of [{},{baseUrl:'https://cred.example.test'},{readToken:'t'},{baseUrl:'  ',readToken:'  '}]){
  assert.deepEqual(await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config:partial,fetcher,cache:new Map()}),{configured:false,status:'not_configured'})
 }
 const invalid=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config:{baseUrl:'ftp://cred',readToken:'t'},fetcher,cache:new Map()})
 assert.equal(invalid.status,'not_configured');assert.match(invalid.error,/VAL_CRED_BASE_URL/)
 assert.equal(fetcher.calls.length,0)
 assert.deepEqual(credReadConfig({}),{baseUrl:'',readToken:''})
 assert.deepEqual(credReadConfig({VAL_CRED_BASE_URL:' https://cred.example.test/// ',VAL_CRED_READ_TOKEN:' abc '}),{baseUrl:'https://cred.example.test',readToken:'abc'})
})

test('chama o contrato C com Bearer, chave codificada, sem seguir redirecionamento e com prazo',async()=>{
 const fetcher=recordingFetcher(()=>jsonResponse(contractSummary({clientExternalKey:'chave com/barra'})))
 const read=await fetchCreditSummary({clientExternalKey:'chave com/barra',config,fetcher,cache:new Map()})
 assert.equal(read.status,'ok');assert.equal(read.configured,true)
 assert.equal(fetcher.calls.length,1)
 const {url,options}=fetcher.calls[0]
 assert.equal(url,'https://cred.example.test/api/v1/integrations/val/producers/chave%20com%2Fbarra/credit-summary')
 assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer read-token-test');assert.equal(options.redirect,'error')
 assert.ok(options.signal instanceof AbortSignal)
})

test('a resposta é normalizada para os campos do contrato: sem CPF/CNPJ, documentos, matrícula ou score',async()=>{
 const read=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher:async()=>jsonResponse(contractSummary()),cache:new Map()})
 assert.equal(read.status,'ok')
 const s=read.summary
 assert.deepEqual(Object.keys(s).sort(),['clientExternalKey','generatedAt','governance','producer','properties','requests','schemaVersion','source'])
 assert.deepEqual(s.producer,{name:'Fazenda Aurora',municipality:'Palotina',unit:{code:'PAL',name:'Unidade Palotina'}})
 assert.deepEqual(s.properties[0],{name:'Sede',municipality:'Palotina',areaHa:320.5,tenure:'Própria',mapped:true,registryConfirmed:true,activeLiens:1})
 assert.equal(s.properties[1].areaHa,null);assert.equal(s.properties[1].activeLiens,null)
 assert.deepEqual(s.requests[0],{id:'req-1',title:'Custeio soja 26/27',status:'analisada',principal:850000,termMonths:12,analysis:{fresh:true,coverage:1.35,coversPayments:true,stressCoversPayments:false,at:'2026-10-01T10:00:00.000Z'},updatedAt:'2026-10-01T09:00:00.000Z'})
 assert.equal(s.requests[1].principal,1200000)
 assert.deepEqual(s.governance,{automaticDecision:false,humanDecisionRequired:true,documentsShared:false})
 const serialized=JSON.stringify(s)
 for(const forbidden of ['cpf','cnpj','123.456.789','matricula','MAT-1','"document"','"documents"','score'])assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden)
})

test('nunca mostra outro produtor nem versão desconhecida do contrato',async()=>{
 const other=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher:async()=>jsonResponse(contractSummary({clientExternalKey:'outro-produtor'})),cache:new Map()})
 assert.equal(other.status,'unavailable');assert.equal(other.summary,undefined);assert.match(other.error,/fora do contrato/)
 const v2=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher:async()=>jsonResponse(contractSummary({schemaVersion:2})),cache:new Map()})
 assert.equal(v2.status,'unavailable')
 assert.equal(normalizeCreditSummary([],'x'),null);assert.equal(normalizeCreditSummary(null,'x'),null)
})

test('404 vira not_linked; chave vazia não chama o VAL Cred',async()=>{
 const fetcher=recordingFetcher(()=>jsonResponse({error:'Produtor não vinculado no VAL Cred.'},404))
 assert.deepEqual(await fetchCreditSummary({clientExternalKey:'sem-vinculo',config,fetcher,cache:new Map()}),{configured:true,status:'not_linked'})
 for(const key of ['',null,undefined,'   ','x'.repeat(181),42])assert.equal((await fetchCreditSummary({clientExternalKey:key,config,fetcher,cache:new Map()})).status,'not_linked')
 assert.equal(fetcher.calls.length,1)
})

test('falhas viram unavailable com mensagem em português, sem lançar e sem vazar o token',async()=>{
 const cases=[
  [async()=>jsonResponse({error:'x'},401),/recusou o token/],
  [async()=>jsonResponse({error:'x'},403),/recusou o token/],
  [async()=>jsonResponse({error:'x'},503),/erro \(503\)/],
  [async()=>new Response('<html>',{status:200}),/JSON válido/],
  [async()=>new Response('x'.repeat(1_000_001),{status:200}),/tamanho/],
  [async()=>{throw new TypeError('fetch failed')},/Não foi possível falar com o VAL Cred/],
  [()=>{throw new Error('síncrono')},/Não foi possível falar com o VAL Cred/],
  [async()=>({ok:true,status:200}),/JSON válido/]
 ]
 for(const [fetcher,message] of cases){
  const read=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache:new Map()})
  assert.equal(read.status,'unavailable');assert.equal(read.configured,true);assert.match(read.error,message)
  assert.equal(read.error.includes('read-token-test'),false)
 }
 assert.equal((await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher:'nao-e-funcao',cache:new Map()})).status,'unavailable')
})

test('o prazo de 8 s aborta a chamada e responde unavailable',async()=>{
 const fetcher=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
 const started=Date.now()
 const read=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache:new Map(),timeoutMs:40})
 assert.equal(read.status,'unavailable');assert.match(read.error,/demorou além do limite/)
 assert.ok(Date.now()-started<2_000)
})

test('cache de 60 s por chave, chamadas simultâneas viram uma só e o retorno é cópia',async()=>{
 let clock=1_000_000;const now=()=>clock;const cache=new Map()
 const fetcher=recordingFetcher(async url=>jsonResponse(contractSummary({clientExternalKey:decodeURIComponent(url.split('/producers/')[1].split('/')[0])})))
 const [a,b]=await Promise.all([fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now}),fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})])
 assert.equal(fetcher.calls.length,1);assert.deepEqual(a,b)
 a.summary.requests.length=0
 clock+=CRED_SUMMARY_CACHE_TTL_MS-1
 const c=await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})
 assert.equal(fetcher.calls.length,1);assert.equal(c.summary.requests.length,2,'mutar o retorno não pode corromper o cache')
 await fetchCreditSummary({clientExternalKey:'outra-chave',config,fetcher,cache,now})
 assert.equal(fetcher.calls.length,2,'a chave faz parte do cache')
 clock+=2
 await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})
 assert.equal(fetcher.calls.length,3,'depois de 60 s lê de novo')
})

test('falha fica só 10 s no cache para não martelar um VAL Cred caído',async()=>{
 let clock=0;const now=()=>clock;const cache=new Map();let up=false
 const fetcher=recordingFetcher(async()=>up?jsonResponse(contractSummary()):jsonResponse({},502))
 assert.equal((await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})).status,'unavailable')
 up=true;clock+=CRED_SUMMARY_FAILURE_TTL_MS-1
 assert.equal((await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})).status,'unavailable')
 assert.equal(fetcher.calls.length,1)
 clock+=2
 assert.equal((await fetchCreditSummary({clientExternalKey:'fazenda-aurora',config,fetcher,cache,now})).status,'ok')
 assert.equal(fetcher.calls.length,2)
})

const eventRow=(type,payload,extra={})=>({id:`ev-${type}`,event_type:type,occurred_at:new Date('2026-10-02T10:00:00Z'),ingested_at:'2026-10-02T10:00:01Z',status:'received',payload,...extra})

test('eventos val-cred viram fatos mínimos para o cartão, sem payload bruto',()=>{
 const request=toCredEventView(eventRow('credit.request.updated',{contract:'val-cred-integration.v1',request:{id:'req-1',title:'Custeio',status:'analisada',revision:3,principal:1,properties:['Sede']}}))
 assert.deepEqual(request,{id:'ev-credit.request.updated',type:'credit.request.updated',occurredAt:'2026-10-02T10:00:00.000Z',receivedAt:'2026-10-02T10:00:01.000Z',status:'received',request:{id:'req-1',title:'Custeio',status:'analisada',revision:3}})
 assert.deepEqual(toCredEventView(eventRow('credit.analysis.completed',{analysis:{requestId:'req-1',status:'complete',coverage:1.2,coversPayments:true,stressCoverage:0.9,stressCoversPayments:false,installment:5000}})).analysis,{requestId:'req-1',status:'complete',coverage:1.2,coversPayments:true,stressCoverage:0.9,stressCoversPayments:false})
 assert.deepEqual(toCredEventView(eventRow('credit.decision.recorded',{decision:{requestId:'req-1',decision:'favoravel',humanDecision:true}})).decision,{requestId:'req-1',decision:'favoravel',humanDecision:true})
 assert.equal(toCredEventView(eventRow('credit.decision.recorded',{decision:{decision:'aprovado_automatico'}})).decision.decision,null)
 const property=toCredEventView(eventRow('credit.property.updated',JSON.stringify({property:{name:'Sede',municipality:'Palotina',mapping:{revision:2},registry:{matricula:'MAT-9',cartorio:'1º RI',confirmed:true,activeLienTypes:['hipoteca','penhor']},crosscheck:{divergences:[{severity:'alta',code:'area'}]}}})))
 assert.deepEqual(property.property,{name:'Sede',municipality:'Palotina',mapped:true,registryConfirmed:true,activeLiens:2,divergences:1})
 assert.equal(JSON.stringify(property).includes('MAT-9'),false)
 assert.deepEqual(toCredEventView(eventRow('cooperative.unit.upserted',{unit:{id:'u1',code:'PAL',name:'Palotina',valTenantId:'t'}})).unit,{code:'PAL',name:'Palotina'})
 assert.equal(toCredEventView(eventRow('manual.record.saved',{})),null)
 assert.equal(toCredEventView(null),null)
})

test('buildCreditView monta o corpo exato de GET /api/clients/:id/credit',()=>{
 const summary=normalizeCreditSummary(contractSummary(),'fazenda-aurora')
 const view=buildCreditView({result:{configured:true,status:'ok',summary},events:[eventRow('credit.decision.recorded',{decision:{decision:'desfavoravel'}}),eventRow('manual.record.saved',{})]})
 assert.deepEqual(Object.keys(view).sort(),['configured','contract','events','eventsAvailable','status','summary'])
 assert.equal(view.contract,'val-cred-integration.v1');assert.equal(view.events.length,1);assert.equal(view.events[0].decision.decision,'desfavoravel')
 const projected=buildCreditView({result:{configured:true,status:'ok',summary},events:view.events})
 assert.deepEqual(projected.events,view.events,'aceita também eventos já projetados por listCredEvents')
 assert.deepEqual(buildCreditView({result:{configured:true,status:'unavailable',error:'fora',summary},events:null}),{contract:'val-cred-integration.v1',configured:true,status:'unavailable',summary:null,events:[],eventsAvailable:false,error:'fora'})
 assert.equal(buildCreditView({result:{status:'qualquer'}}).status,'unavailable')
 assert.deepEqual(buildCreditView({result:{configured:false,status:'not_configured'},events:[]}),{contract:'val-cred-integration.v1',configured:false,status:'not_configured',summary:null,events:[],eventsAvailable:true})
})

let pg
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerA='00000000-0000-4000-8000-0000000000a1'
const ownerB='00000000-0000-4000-8000-0000000000b2'
before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text) ON CONFLICT DO NOTHING',[tenantId,'TEST organization'])
 for(const [id,email] of [[ownerA,'cred-a@example.test'],[ownerB,'cred-b@example.test']])await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[id,'TEST consultor',email])
 const insert=(owner,source,externalId,type,occurredAt,key,payload)=>pg.query('INSERT INTO integration_events(tenant_id,owner_user_id,external_id,event_type,source,occurred_at,client_external_key,payload,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenantId,owner,externalId,type,source,occurredAt,key,JSON.stringify(payload),'received'])
 await insert(ownerA,'val-cred','valcred:request:r1:v1','credit.request.updated','2026-10-01T10:00:00Z','fazenda-aurora',{request:{id:'r1',title:'Custeio',status:'rascunho'}})
 await insert(ownerA,'val-cred','valcred:analysis:a1','credit.analysis.completed','2026-10-02T10:00:00Z','fazenda-aurora',{analysis:{requestId:'r1',coverage:1.4,coversPayments:true,stressCoversPayments:true}})
 await insert(ownerA,'val-cred','valcred:request:r9:v1','credit.request.updated','2026-10-02T11:00:00Z','outro-produtor',{request:{id:'r9',title:'Outro'}})
 await insert(ownerB,'val-cred','valcred:request:r1:v1','credit.request.updated','2026-10-02T12:00:00Z','fazenda-aurora',{request:{id:'r1',title:'De outro login'}})
 await insert(ownerA,'manual-do-agronomo','manual:1','manual.record.saved','2026-10-02T13:00:00Z','fazenda-aurora',{})
})
after(async()=>{await pg?.close()})

test('listCredEvents lê só eventos val-cred do produtor, do login e do tenant, mais recentes primeiro',async()=>{
 const db={configured:true,query:(...args)=>pg.query(...args)}
 const events=await listCredEvents(db,{tenantId,ownerId:ownerA,clientExternalKey:'fazenda-aurora'})
 assert.deepEqual(events.map(item=>item.type),['credit.analysis.completed','credit.request.updated'])
 assert.equal(events[0].analysis.coverage,1.4);assert.equal(events[1].request.title,'Custeio')
 assert.equal((await listCredEvents(db,{tenantId,ownerId:ownerA,clientExternalKey:'fazenda-aurora',limit:1})).length,1)
 assert.deepEqual((await listCredEvents(db,{tenantId,ownerId:ownerB,clientExternalKey:'fazenda-aurora'})).map(item=>item.request.title),['De outro login'])
 assert.deepEqual(await listCredEvents(db,{tenantId,ownerId:ownerA,clientExternalKey:''}),[])
 assert.deepEqual(await listCredEvents({configured:false,query:()=>{throw new Error('sem banco')}},{tenantId,ownerId:ownerA,clientExternalKey:'fazenda-aurora'}),[])
 assert.equal(await listCredEvents({configured:true,query:async()=>{throw new Error('timeout')}},{tenantId,ownerId:ownerA,clientExternalKey:'fazenda-aurora'}),null)
})

// ---- Cartão no Cliente 360 ----

let bundleDir,CreditSummaryCard,CreditSummaryView
before(async()=>{
 bundleDir=await mkdtemp(join(root,'.cred-card-render-test-'))
 await build({entryPoints:[join(root,'src/components/CreditSummaryCard.jsx')],outfile:join(bundleDir,'card.js'),bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'})
 ;({default:CreditSummaryCard,CreditSummaryView}=await import(pathToFileURL(join(bundleDir,'card.js')).href))
})
after(async()=>{if(bundleDir)await rm(bundleDir,{recursive:true,force:true})})

const okView=()=>buildCreditView({result:{configured:true,status:'ok',summary:normalizeCreditSummary(contractSummary(),'fazenda-aurora')},events:[
 eventRow('credit.decision.recorded',{decision:{requestId:'req-1',decision:'favoravel',humanDecision:true}}),
 eventRow('credit.analysis.completed',{analysis:{coverage:1.35,coversPayments:true,stressCoversPayments:false}})
]})
const textOf=html=>html.replace(/<[^>]+>/g,' ').replace(/&#x27;/g,"'").replace(/\s+/g,' ')

test('o cartão mostra unidade, solicitações, análise atual/desatualizada, cenários, propriedades e eventos',()=>{
 const text=textOf(renderToStaticMarkup(React.createElement(CreditSummaryView,{data:okView()})))
 assert.match(text,/Crédito no VAL Cred/)
 assert.match(text,/PAL/);assert.match(text,/unidade • Unidade Palotina/)
 assert.match(text,/ANALISADA/);assert.match(text,/RASCUNHO/)
 assert.match(text,/Custeio soja 26\/27/);assert.match(text,/12 meses/)
 assert.match(text,/: atual/);assert.match(text,/desatualizada — a solicitação mudou depois dela/)
 assert.match(text,/Cobertura 1,35× • cenário base: cobre as parcelas • cenário adverso: não cobre as parcelas/)
 assert.match(text,/Sede/);assert.match(text,/320,5 ha/)
 assert.match(text,/Mapa: mapeada • Matrícula: conferida • Ônus vigentes: 1/)
 assert.match(text,/Mapa: sem mapa • Matrícula: não conferida • Ônus vigentes: não informado/)
 assert.match(text,/1\/2/)
 assert.match(text,/Parecer humano registrado/);assert.match(text,/Parecer favorável — decisão humana/)
 assert.match(text,/Análise concluída/)
})

test('o cartão deixa explícito que a decisão é humana e que não há score, sem dados pessoais',()=>{
 const text=textOf(renderToStaticMarkup(React.createElement(CreditSummaryView,{data:okView()})))
 assert.match(text,/A decisão de crédito é humana; não há score nem aprovação automática/)
 assert.match(text,/DECISÃO HUMANA/);assert.match(text,/SEM SCORE/);assert.match(text,/Não existe nota de crédito/)
 assert.equal(/Fazenda Aurora/.test(text),false,'o nome do produtor já está na ficha; o cartão não repete')
 for(const forbidden of ['123.456.789','00.000.000/0001','MAT-1','matricula.pdf'])assert.equal(text.includes(forbidden),false,forbidden)
})

test('estados do cartão: desligado some; não vinculado, indisponível e falha da rota explicam o que houve',()=>{
 const render=props=>textOf(renderToStaticMarkup(React.createElement(CreditSummaryView,props)))
 assert.equal(renderToStaticMarkup(React.createElement(CreditSummaryView,{data:buildCreditView({result:{configured:false,status:'not_configured'},events:[]})})),'')
 assert.equal(renderToStaticMarkup(React.createElement(CreditSummaryView,{data:null})),'')
 assert.match(render({data:null,loading:true}),/Consultando o VAL Cred/)
 const notLinked=render({data:buildCreditView({result:{configured:true,status:'not_linked'},events:[]})})
 assert.match(notLinked,/ainda não está vinculado no VAL Cred/);assert.match(notLinked,/Nenhum evento do VAL Cred recebido/)
 assert.equal(/SOLICITAÇÕES/.test(notLinked),false)
 const down=render({data:buildCreditView({result:{configured:true,status:'unavailable',error:'O VAL Cred demorou além do limite para responder.'},events:[eventRow('credit.request.updated',{request:{title:'Custeio',status:'complementacao'}})]})})
 assert.match(down,/VAL Cred indisponível agora/);assert.match(down,/demorou além do limite/)
 assert.match(down,/Custeio — Complementação/,'os eventos já recebidos continuam visíveis com o VAL Cred fora do ar')
 assert.match(render({data:buildCreditView({result:{configured:true,status:'ok',summary:normalizeCreditSummary(contractSummary(),'fazenda-aurora')},events:null})}),/Os eventos recebidos não puderam ser lidos agora/)
 assert.match(render({data:null,error:'Não foi possível consultar o crédito no VAL Cred.'}),/Leitura indisponível.*Não foi possível consultar o crédito no VAL Cred/)
})

test('o cartão busca /api/clients/:id/credit e nunca mostra o crédito do produtor anterior',async()=>{
 const urls=[];let release
 const previousFetch=globalThis.fetch,previousWindow=globalThis.window
 globalThis.window={dispatchEvent(){},addEventListener(){},removeEventListener(){}}
 globalThis.fetch=async url=>{urls.push(String(url));if(String(url).includes('c%202'))return new Promise(resolve=>{release=()=>resolve(jsonResponse(buildCreditView({result:{configured:true,status:'not_linked'},events:[]})))});return jsonResponse(okView())}
 let renderer
 try{
  await act(async()=>{renderer=TestRenderer.create(React.createElement(CreditSummaryCard,{client:{id:'c 1'}}))})
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})
  assert.equal(urls[0],'/api/clients/c%201/credit')
  assert.match(JSON.stringify(renderer.toJSON()),/Custeio soja 26\/27/)
  await act(async()=>{renderer.update(React.createElement(CreditSummaryCard,{client:{id:'c 2'}}))})
  assert.equal(JSON.stringify(renderer.toJSON()).includes('Custeio soja'),false,'trocar de ficha não pode mostrar o crédito do anterior')
  await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,20))})
  assert.match(JSON.stringify(renderer.toJSON()),/ainda não está vinculado/)
 }finally{
  await act(async()=>{renderer?.unmount()})
  globalThis.fetch=previousFetch
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow
 }
})

test('o cartão é montado na ficha do Cliente 360, no negócio, logo após a visão global, sem tocar no resto',()=>{
 const page=readFileSync(join(root,'src/pages/Client360Details.jsx'),'utf8')
 assert.match(page,/^import CreditSummaryCard from '\.\.\/components\/CreditSummaryCard'\r?$/m)
 assert.match(page,/<ProducerBusinessOverview client=\{client\} refreshToken=\{overviewRevision\}\/>\r?\n\s*<CreditSummaryCard client=\{client\} refreshToken=\{overviewRevision\}\/>/)
 assert.equal(page.match(/CreditSummaryCard/g).length,3,'só o import (nome e caminho) e a linha de montagem')
 const card=readFileSync(join(root,'src/components/CreditSummaryCard.jsx'),'utf8')
 assert.equal(/decision-copilot|copilot|memory|context-|val-engine|grounding/i.test(card.split('\n').filter(line=>line.startsWith('import')).join('\n')),false)
 const server=readFileSync(join(root,'server/cred-client.js'),'utf8')
 assert.equal(/^import /m.test(server),false,'o cliente do VAL Cred não depende de outras camadas da VAL')
})
