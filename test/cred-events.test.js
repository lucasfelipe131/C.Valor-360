import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {deriveSignals,normalizeIntegrationEvent,supportedIntegrationEvents} from '../server/ingestion.js'
import {CRED_CONTRACT,CRED_SOURCE,assertCredTenant,credEventTypes,credPropertyMetadata,handleCredEvent,listCredEvents,normalizeCredEvent,stripDocuments,summarizeCredEvents} from '../server/cred-events.js'
import {ValRepository} from '../server/repository.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='00000000-0000-4000-8000-000000000010'
const otherTenant='00000000-0000-4000-8000-000000000099'
const clientId='00000000-0000-4000-8000-000000000020'
const propertyId='00000000-0000-4000-8000-000000000030'
const secret='segredo-val-cred-teste'
const unit={code:'C149',name:'Unidade C149',uf:'RS',valTenantId:tenantId}

// Mesmo formato do VAL Cred: não-ASCII escapado e HMAC hex do corpo bruto.
const asciiJson=value=>JSON.stringify(value).replace(/[\u007f-￿]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
const sign=raw=>`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`
const envelope=(type,payload,extra={})=>({schemaVersion:1,type,externalId:`valcred:${type}:0001`,occurredAt:'2026-10-03T13:00:00.000Z',source:'val-cred',ownerUserId:ownerId,clientExternalKey:'joao-da-silva',...extra,payload:{contract:CRED_CONTRACT,sentAt:'2026-10-03T13:00:01.000Z',unit,...payload}})
const property={name:'Fazenda São João',municipality:'Cruz Alta',areaHa:320.5,tenure:'propria',location:{lat:-28.64,lng:-53.6,source:'val-cred'},mapping:{revision:2,totalHa:318,productiveHa:280},registry:{matricula:'12.345',cartorio:'1º RI',cnm:'',car:'RS-123',sigef:'',georeferenced:true,confirmed:true,activeLienTypes:['hipoteca']},details:{activities:['graos'],crops:['soja'],irrigation:'',arableHa:290,storageCapacityT:null,carStatus:'ativo'},crosscheck:{at:'2026-10-02T10:00:00.000Z',summary:'ok',divergences:[{severity:'baixa',code:'area'}]}}
const propertyEvent=(extra={})=>envelope('credit.property.updated',{reason:'mapping',property},{externalId:'valcred:property:p1',propertyExternalKey:'joao-da-silva:fazenda-sao-joao',...extra})
const samples={
  'credit.request.updated':envelope('credit.request.updated',{request:{id:'r1',title:'Custeio soja',status:'analisada',revision:3,purpose:'custeio',periodStart:'2026-11-01',principal:150000,termMonths:12,properties:['Fazenda São João']}}),
  'credit.analysis.completed':envelope('credit.analysis.completed',{analysis:{id:'a1',requestId:'r1',revision:3,model:'cashflow-price-12m-v1',status:'calculated',coverage:1.71,coversPayments:true,stressCoverage:1.12,stressCoversPayments:true,installment:14000,missing:0,warnings:1}}),
  'credit.decision.recorded':envelope('credit.decision.recorded',{decision:{id:'d1',requestId:'r1',analysisId:'a1',decision:'favoravel',humanDecision:true}}),
  'credit.property.updated':propertyEvent(),
  'cooperative.unit.upserted':(({ownerUserId,clientExternalKey,...rest})=>({...rest,externalId:'valcred:unit:u1',payload:{contract:CRED_CONTRACT,sentAt:'2026-10-03T13:00:01.000Z',unit:{id:'u1',code:'C149',name:'Unidade C149',municipality:'Cruz Alta',uf:'RS',active:true,valTenantId:tenantId}}}))(envelope('cooperative.unit.upserted',{}))
}

test('Manual mantém o conjunto compartilhado e não aceita tipos de crédito',()=>{
  assert.deepEqual([...supportedIntegrationEvents].sort(),['agronomic.scan.completed','business.closed','business.lost','business.updated','field_report.completed','manual.producer.updated','manual.record.saved','manual.workspace.updated','ndvi.observation','soil_analysis.completed'])
  for(const type of credEventTypes){
    assert.equal(supportedIntegrationEvents.has(type),false)
    assert.throws(()=>normalizeIntegrationEvent({...samples[type],source:'manual-do-agronomo'}),/não suportado/)
  }
  const manual=normalizeIntegrationEvent({type:'business.closed',externalId:'manual-0001',payload:{}})
  assert.equal(manual.source,'manual-do-agronomo')
  assert.equal(normalizeIntegrationEvent({type:'business.closed',externalId:'manual-0002',source:'erp',payload:{}}).source,'erp')
})

test('normalizeIntegrationEvent aceita lista própria de tipos e origem forçada sem mexer no padrão',()=>{
  const event=normalizeIntegrationEvent(samples['credit.request.updated'],{allowedTypes:[...credEventTypes],source:'val-cred'})
  assert.equal(event.type,'credit.request.updated');assert.equal(event.source,'val-cred')
  assert.equal(normalizeIntegrationEvent({...samples['credit.request.updated'],source:'manual-do-agronomo'},{allowedTypes:credEventTypes,source:'val-cred'}).source,'val-cred')
  assert.throws(()=>normalizeIntegrationEvent({type:'business.closed',externalId:'manual-0003',payload:{}},{allowedTypes:credEventTypes}),/não suportado/)
})

test('rota do VAL Cred aceita só os cinco tipos e força a origem val-cred',()=>{
  for(const [type,sample] of Object.entries(samples)){
    const event=normalizeCredEvent({...sample,source:'manual-do-agronomo'})
    assert.equal(event.type,type);assert.equal(event.source,CRED_SOURCE);assert.equal(event.fieldExternalKey,'')
    assert.deepEqual(deriveSignals(event),[])
  }
  for(const type of supportedIntegrationEvents)assert.throws(()=>normalizeCredEvent({...samples['credit.request.updated'],type}),error=>error.statusCode===400&&/não suportado/.test(error.message))
  assert.throws(()=>normalizeCredEvent('{'),/JSON inválido/)
  assert.equal(normalizeCredEvent(asciiJson(samples['credit.decision.recorded'])).type,'credit.decision.recorded')
})

test('CPF, CNPJ, documentos e credenciais são descartados antes do hash',()=>{
  const base=samples['credit.request.updated']
  const clean=normalizeCredEvent(base)
  const onlyBlocked=normalizeCredEvent({...base,payload:{...base.payload,cpf:'123.456.789-00',request:{...base.payload.request,token:'t'}}})
  assert.equal(onlyBlocked.payloadHash,clean.payloadHash)
  const dirty=normalizeCredEvent({...base,payload:{...base.payload,cpf:'123.456.789-00',request:{...base.payload.request,borrower:{cnpj:'00.000.000/0001-00',documentNumber:'x',documento:'y',name:'ok'},token:'t'}}})
  const serialized=JSON.stringify(dirty.payload)
  assert.doesNotMatch(serialized,/cpf|cnpj|document|123\.456|0001-00|"token"/i)
  assert.equal(dirty.payload.request.borrower.name,'ok')
  assert.deepEqual(stripDocuments({a:[{CPF:'1',b:2}],Cnpj:'3'}),{a:[{b:2}]})
  const extras=normalizeCredEvent({...samples['credit.request.updated'],payload:{...samples['credit.request.updated'].payload,request:{...samples['credit.request.updated'].payload.request,campoNovo:'aceito'}}})
  assert.equal(extras.payload.request.campoNovo,'aceito')
})

test('envelope e payload inválidos são recusados com 400 definitivo',()=>{
  const reject=(input,pattern)=>assert.throws(()=>normalizeCredEvent(input),error=>error.statusCode===400&&pattern.test(error.message))
  const decision=samples['credit.decision.recorded']
  reject({...decision,externalId:'abc'},/externalId/)
  reject({...decision,externalId:'x'.repeat(181)},/externalId/)
  reject({...decision,ownerUserId:'nao-e-uuid'},/ownerUserId/)
  reject({...decision,payload:{...decision.payload,contract:'outro'}},/payload\.contract/)
  reject({...decision,payload:{...decision.payload,decision:{...decision.payload.decision,decision:'aprovado'}}},/favoravel/)
  reject({...decision,payload:{...decision.payload,decision:{...decision.payload.decision,humanDecision:false}}},/pessoa/)
  reject({...decision,clientExternalKey:''},/clientExternalKey/)
  reject({...decision,payload:{...decision.payload,unit:{...unit,valTenantId:'abc'}}},/valTenantId/)
  const request=samples['credit.request.updated']
  reject({...request,payload:{...request.payload,request:{...request.payload.request,termMonths:0}}},/termMonths/)
  reject({...request,payload:{...request.payload,request:{...request.payload.request,id:''}}},/request\.id/)
  const analysis=samples['credit.analysis.completed']
  reject({...analysis,payload:{...analysis.payload,analysis:{...analysis.payload.analysis,coversPayments:'sim'}}},/coversPayments/)
  reject({...analysis,payload:{...analysis.payload,analysis:{...analysis.payload.analysis,requestId:null}}},/requestId/)
  reject(propertyEvent({propertyExternalKey:''}),/propertyExternalKey/)
  reject(propertyEvent({propertyExternalKey:'outro-produtor:fazenda-sao-joao'}),/pertencer/)
  reject({...propertyEvent(),payload:{...propertyEvent().payload,property:{...property,location:{lat:-128,lng:-53}}}},/location\.lat/)
  reject({...propertyEvent(),payload:{...propertyEvent().payload,property:{...property,name:''}}},/property\.name/)
  const unitEvent=samples['cooperative.unit.upserted']
  reject({...unitEvent,clientExternalKey:'joao-da-silva'},/unidade/)
  reject({...unitEvent,payload:{...unitEvent.payload,unit:{...unitEvent.payload.unit,uf:'RSX'}}},/uf/)
  assert.equal(normalizeCredEvent({...propertyEvent(),payload:{...propertyEvent().payload,property:{...property,location:null,mapping:null,crosscheck:null}}}).payload.property.location,null)
})

test('tenant vem do servidor e o VAL Cred só pode confirmá-lo',()=>{
  const event=normalizeCredEvent(samples['credit.request.updated'])
  assert.doesNotThrow(()=>assertCredTenant({},event,tenantId))
  assert.throws(()=>assertCredTenant({tenantId:otherTenant},event,tenantId),error=>error.statusCode===403)
  const foreign=normalizeCredEvent({...samples['credit.request.updated'],payload:{...samples['credit.request.updated'].payload,unit:{...unit,valTenantId:otherTenant}}})
  assert.throws(()=>assertCredTenant({},foreign,tenantId),error=>error.statusCode===403&&error.code==='cred_tenant_mismatch')
})

const fakeAccess=()=>{
  const calls={owners:[],usage:[]}
  return {calls,async resolveIntegrationOwner(id){calls.owners.push(id);if(id&&id!==ownerId)throw Object.assign(new Error('O login proprietário da integração não está ativo.'),{statusCode:403});return ownerId},async recordUsage(actor,input){calls.usage.push({actor,...input});return true}}
}
const fakeRepository=(outcome)=>{
  const calls=[]
  return {calls,tenantId,db:{configured:true,health:async()=>({ready:true})},async ingestEvent(input){calls.push(input);if(outcome instanceof Error)throw outcome;return outcome||{duplicate:false,canonicalClientId:clientId,signals:0}}}
}
const deliver=async(body,{config={credWebhookSecret:secret},repository=fakeRepository(),accessRepository=fakeAccess(),headers}={})=>{
  const raw=typeof body==='string'?body:asciiJson(body)
  const result=await handleCredEvent({rawBody:Buffer.from(raw),headers:headers||{'x-valor-signature':sign(raw),'content-type':'application/json'},config,repository,accessRepository,tenantId})
  return {...result,repository,accessRepository}
}

test('rota fica desligada sem segredo e exige HMAC próprio, sem Bearer',async()=>{
  assert.equal((await deliver(samples['credit.request.updated'],{config:{}})).status,503)
  const raw=asciiJson(samples['credit.request.updated'])
  const bearerOnly=await deliver(raw,{headers:{authorization:`Bearer ${secret}`},config:{credWebhookSecret:secret,integrationToken:secret}})
  assert.equal(bearerOnly.status,401);assert.equal(bearerOnly.repository.calls.length,0)
  const manualSecret=await deliver(raw,{headers:{'x-valor-signature':`sha256=${createHmac('sha256','segredo-do-manual').update(raw).digest('hex')}`},config:{credWebhookSecret:secret,manualWebhookSecret:'segredo-do-manual'}})
  assert.equal(manualSecret.status,401)
  const tampered=await deliver(raw.replace('Custeio','Custeia'),{headers:{'x-valor-signature':sign(raw)}})
  assert.equal(tampered.status,401)
})

test('evento assinado é aceito com 202 no formato do webhook do Manual',async()=>{
  const result=await deliver(samples['credit.analysis.completed'])
  assert.equal(result.status,202)
  assert.deepEqual(result.body,{accepted:true,duplicate:false,canonicalClientId:clientId,signals:0,eventType:'credit.analysis.completed',externalId:'valcred:credit.analysis.completed:0001'})
  const [ingest]=result.repository.calls
  assert.equal(ingest.tenantId,tenantId);assert.equal(ingest.ownerId,ownerId);assert.deepEqual(ingest.signals,[])
  assert.equal(ingest.event.source,'val-cred');assert.equal(ingest.event.payload.analysis.coverage,1.71)
  assert.deepEqual(result.accessRepository.calls.owners,[ownerId])
  assert.equal(result.accessRepository.calls.usage[0].eventType,'cred_sync')
  assert.equal(result.ownerId,ownerId);assert.equal(result.processed,true)
})

test('unidade sem dono usa o dono padrão da integração e cabeçalho com maiúsculas é aceito',async()=>{
  const raw=asciiJson(samples['cooperative.unit.upserted'])
  const result=await deliver(raw,{headers:{'X-Valor-Signature':sign(raw)}})
  assert.equal(result.status,202)
  assert.deepEqual(result.accessRepository.calls.owners,[''])
})

test('duplicado responde 200, conflito 409 e recusa de dono 403',async()=>{
  const duplicate=await deliver(samples['credit.request.updated'],{repository:fakeRepository({duplicate:true,signals:0})})
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.accepted,true)
  assert.equal(duplicate.accessRepository.calls.usage.length,0)
  const conflict=await deliver(samples['credit.request.updated'],{repository:fakeRepository(Object.assign(new Error('O externalId já foi usado com um conteúdo diferente.'),{statusCode:409}))})
  assert.equal(conflict.status,409);assert.equal(conflict.body.accepted,false);assert.equal(conflict.body.status,'CONFLICT')
  const owner=await deliver({...samples['credit.request.updated'],ownerUserId:'00000000-0000-4000-8000-000000000077'})
  assert.equal(owner.status,403);assert.equal(owner.repository.calls.length,0)
  const unavailable=await deliver(samples['credit.request.updated'],{repository:fakeRepository(Object.assign(new Error('Não foi possível persistir.'),{statusCode:503}))})
  assert.equal(unavailable.status,503)
  await assert.rejects(()=>deliver(samples['credit.request.updated'],{repository:fakeRepository(new TypeError('bug'))}),TypeError)
})

test('payload inválido, tenant estranho e banco indisponível não chegam ao repositório',async()=>{
  const invalid=await deliver({...samples['credit.decision.recorded'],payload:{...samples['credit.decision.recorded'].payload,decision:{id:'d1',requestId:'r1',decision:'favoravel'}}})
  assert.equal(invalid.status,400);assert.equal(invalid.repository.calls.length,0)
  const broken=await deliver('{"schemaVersion":1,')
  assert.equal(broken.status,400)
  const foreign=await deliver({...samples['credit.request.updated'],tenantId:otherTenant})
  assert.equal(foreign.status,403);assert.equal(foreign.repository.calls.length,0)
  const repository=fakeRepository();repository.db.health=async()=>({ready:false})
  const offline=await deliver(samples['credit.request.updated'],{repository})
  assert.equal(offline.status,503);assert.equal(repository.calls.length,0)
})

// Banco falso no formato dos outros testes de ingestEvent.
const credDatabase=({client=true,property=true,stored=null,metadataApplied=true}={})=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return stored?{rowCount:0,rows:[]}:{rowCount:1,rows:[{id:'event-cred-1'}]}
    if(sql.startsWith('SELECT payload_hash FROM integration_events'))return {rowCount:1,rows:[{payload_hash:stored}]}
    if(sql.startsWith('SELECT id FROM clients'))return client?{rowCount:1,rows:[{id:clientId}]}:{rowCount:0,rows:[]}
    if(sql.startsWith('SELECT property.id,property.client_id'))return property?{rowCount:1,rows:[{id:propertyId,client_id:clientId}]}:{rowCount:0,rows:[]}
    if(sql.startsWith('UPDATE properties SET metadata'))return metadataApplied?{rowCount:1,rows:[{id:propertyId}]}:{rowCount:0,rows:[]}
    return {rowCount:1,rows:[]}
  }
  return {calls,db:{configured:true,health:async()=>({ready:true}),query,transaction:work=>work({query})}}
}
const repositoryWith=database=>new ValRepository({db:database.db,tenantId,readStore:()=>({}),saveStore:()=>{}})

test('credit.property.updated faz merge aditivo em metadata.valCred da propriedade existente',async()=>{
  const database=credDatabase()
  const event=normalizeCredEvent(propertyEvent())
  const result=await repositoryWith(database).ingestEvent({tenantId,ownerId,event,signals:deriveSignals(event)})
  assert.equal(result.valCredMaterialization,'APPLIED');assert.equal(result.duplicate,false)
  const insert=database.calls.find(call=>call.sql.includes('INSERT INTO integration_events'))
  assert.equal(insert.params[5],'val-cred');assert.equal(insert.params[3],'credit.property.updated')
  const update=database.calls.find(call=>call.sql.startsWith('UPDATE properties SET metadata'))
  assert.match(update.sql,/jsonb_build_object\('valCred'/)
  assert.doesNotMatch(update.sql,/'\{location\}'|metadata->'location'|\bname=|area_ha=|municipality=|updated_at=/)
  assert.deepEqual(update.params.slice(0,3),[tenantId,clientId,propertyId])
  assert.equal(update.params[4],'2026-10-03T13:00:00.000Z')
  const valCred=JSON.parse(update.params[3])
  assert.equal(valCred.contract,CRED_CONTRACT);assert.equal(valCred.externalId,'valcred:property:p1')
  assert.deepEqual(valCred.location,{lat:-28.64,lng:-53.6,source:'val-cred'})
  assert.equal(valCred.registry.activeLienTypes[0],'hipoteca');assert.deepEqual(valCred.unit,{code:'C149',name:'Unidade C149',uf:'RS'})
  assert.equal(database.calls.filter(call=>/INSERT INTO (properties|fields|clients|agronomic_signals)/.test(call.sql)).length,0)
  assert.deepEqual(credPropertyMetadata(event),valCred)
})

test('sem cliente, sem propriedade ou com chave de outro nome nada é materializado',async()=>{
  for(const [options,input] of [[{client:false},propertyEvent()],[{property:false},propertyEvent()],[{},{...propertyEvent(),payload:{...propertyEvent().payload,property:{...property,name:'Outra Fazenda'}}}]]){
    const database=credDatabase(options)
    const event=normalizeCredEvent(input)
    const result=await repositoryWith(database).ingestEvent({tenantId,ownerId,event,signals:[]})
    assert.equal(result.valCredMaterialization,'NO_TARGET')
    assert.equal(database.calls.some(call=>call.sql.startsWith('UPDATE properties')),false)
    assert.ok(database.calls.some(call=>call.sql.includes('INSERT INTO integration_events')))
  }
  const stale=credDatabase({metadataApplied:false})
  const event=normalizeCredEvent(propertyEvent())
  assert.equal((await repositoryWith(stale).ingestEvent({tenantId,ownerId,event,signals:[]})).valCredMaterialization,'STALE_IGNORED')
})

test('demais tipos de crédito ficam só em integration_events',async()=>{
  for(const type of ['credit.request.updated','credit.analysis.completed','credit.decision.recorded','cooperative.unit.upserted']){
    const database=credDatabase()
    const event=normalizeCredEvent(samples[type])
    const result=await repositoryWith(database).ingestEvent({tenantId,ownerId,event,signals:deriveSignals(event)})
    assert.equal(result.duplicate,false);assert.equal(result.signals,0);assert.equal(result.valCredMaterialization,undefined)
    const writes=database.calls.filter(call=>/^\s*(INSERT|UPDATE|DELETE)/.test(call.sql))
    assert.deepEqual(writes.map(call=>call.sql.trim().split(/\s+/).slice(0,3).join(' ')),['INSERT INTO integration_events'])
  }
})

test('fluxo HTTP completo com o repositório real: 202, 200 duplicado e 409 conflito',async()=>{
  const event=normalizeCredEvent(propertyEvent())
  const accepted=await deliver(propertyEvent(),{repository:repositoryWith(credDatabase())})
  assert.equal(accepted.status,202);assert.equal(accepted.body.valCredMaterialization,'APPLIED')
  const duplicate=await deliver(propertyEvent(),{repository:repositoryWith(credDatabase({stored:event.payloadHash}))})
  assert.equal(duplicate.status,200);assert.deepEqual(duplicate.body,{accepted:true,duplicate:true,signals:0,eventType:'credit.property.updated',externalId:'valcred:property:p1'})
  const conflict=await deliver(propertyEvent(),{repository:repositoryWith(credDatabase({stored:'f'.repeat(64)}))})
  assert.equal(conflict.status,409);assert.equal(conflict.body.accepted,false)
})

test('resumo da ficha junta solicitação, análise atual, parecer humano e propriedade mais recente',()=>{
  const at=(iso,item)=>({...item,occurredAt:iso,receivedAt:iso})
  const summary=summarizeCredEvents([
    at('2026-10-01T10:00:00.000Z',{id:'1',type:'credit.request.updated',externalId:'e1',payload:{unit,request:{id:'r1',title:'Custeio',status:'em_analise',revision:2}}}),
    at('2026-10-02T10:00:00.000Z',{id:'2',type:'credit.analysis.completed',externalId:'e2',payload:{analysis:{id:'a1',requestId:'r1',revision:3,coverage:1.7,coversPayments:true}}}),
    at('2026-10-02T10:00:01.000Z',{id:'3',type:'credit.request.updated',externalId:'e3',payload:{request:{id:'r1',title:'Custeio',status:'analisada',revision:3}}}),
    at('2026-10-03T10:00:00.000Z',{id:'4',type:'credit.decision.recorded',externalId:'e4',payload:{decision:{id:'d1',requestId:'r1',analysisId:'a1',decision:'favoravel',humanDecision:true}}}),
    at('2026-09-01T10:00:00.000Z',{id:'5',type:'credit.property.updated',externalId:'e5',propertyExternalKey:'joao-da-silva:fazenda-sao-joao',payload:{property:{...property,areaHa:100}}}),
    at('2026-10-01T10:00:00.000Z',{id:'6',type:'credit.property.updated',externalId:'e6',propertyExternalKey:'joao-da-silva:fazenda-sao-joao',payload:{property}})
  ],{clientExternalKey:'joao-da-silva'})
  assert.equal(summary.source,'val-cred');assert.deepEqual(summary.unit,{code:'C149',name:'Unidade C149',uf:'RS'})
  assert.equal(summary.requests.length,1)
  const [request]=summary.requests
  assert.equal(request.status,'analisada');assert.equal(request.analysis.fresh,true);assert.equal(request.analysis.coverage,1.7)
  assert.equal(request.decision.decision,'favoravel');assert.equal(request.decision.humanDecision,true)
  assert.equal(summary.properties.length,1);assert.equal(summary.properties[0].areaHa,320.5)
  assert.deepEqual(summary.events.map(item=>item.id),['4','3','2','1','6','5'])
  assert.deepEqual(summary.governance,{automaticDecision:false,humanDecisionRequired:true,documentsShared:false})
})

test('listCredEvents lê só o tenant, o dono, a origem e o produtor pedidos',async()=>{
  const calls=[]
  const db={configured:true,query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:'row-1',external_id:'valcred:analysis:a1',event_type:'credit.analysis.completed',occurred_at:new Date('2026-10-03T13:00:00Z'),ingested_at:new Date('2026-10-03T13:00:02Z'),property_external_key:null,payload:{contract:CRED_CONTRACT,analysis:{id:'a1',requestId:'r1',revision:1,coverage:1.2}}}]}}}
  const repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})
  const summary=await listCredEvents({repository,tenantId,ownerId,clientExternalKey:'joao-da-silva',limit:500})
  assert.match(calls[0].sql,/tenant_id=\$1 AND owner_user_id=\$2 AND source=\$3 AND client_external_key=\$4/)
  assert.deepEqual(calls[0].params,[tenantId,ownerId,'val-cred','joao-da-silva',200])
  assert.equal(summary.events[0].occurredAt,'2026-10-03T13:00:00.000Z');assert.equal(summary.requests[0].analysis.coverage,1.2);assert.equal(summary.requests[0].analysis.fresh,null)
  assert.equal((await listCredEvents({repository,tenantId,ownerId:'demo@valor360.local',clientExternalKey:'joao-da-silva'})).events.length,0)
  assert.equal((await listCredEvents({repository,tenantId,ownerId,clientExternalKey:''})).events.length,0)
  assert.equal(calls.length,1)
  await assert.rejects(()=>listCredEvents({repository,tenantId:otherTenant,ownerId,clientExternalKey:'joao-da-silva'}),error=>error.statusCode===403)
})

test('sem PostgreSQL a leitura usa o armazenamento local com o mesmo escopo',async()=>{
  const store={val:{integrationEvents:[
    {...normalizeCredEvent(samples['credit.request.updated']),tenantId,ownerId,ingestedAt:'2026-10-03T13:00:02.000Z'},
    {...normalizeCredEvent(samples['credit.request.updated']),tenantId,ownerId:'outro-dono',ingestedAt:'2026-10-03T13:00:02.000Z'},
    {type:'business.closed',source:'manual-do-agronomo',externalId:'m1',clientExternalKey:'joao-da-silva',tenantId,ownerId,payload:{}}
  ]}}
  const repository=new ValRepository({db:{configured:false},tenantId,readStore:()=>store,saveStore:()=>{}})
  const summary=await listCredEvents({repository,tenantId,ownerId,clientExternalKey:'joao-da-silva'})
  assert.equal(summary.events.length,1);assert.equal(summary.requests[0].status,'analisada')
})
