import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseBrazilGrainReport,createOpenMarketFeed,withOpenMarketReferences} from '../server/open-market-feed.js'
import {createValCreditService,creditPresentation} from '../server/val-credit-service.js'
import {answerCurrentMarket,buildFastMarketResponse,buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
const now=new Date('2026-10-03T11:00:00Z')
const report=readFileSync(new URL('./fixtures/deral-grain-2026-10-02.html',import.meta.url),'utf8')
const scope={tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a'}
test('Brazil bulletin reads statewide means, retaining BRL/sack and original publication day',()=>{
 const rows=parseBrazilGrainReport(report,{now})
 assert.deepEqual(rows.map(r=>r.price),[55.53,139.11,80.09])
 assert.ok(rows.every(r=>r.priceUnit==='BRL/sc_60kg'&&r.region==='Paraná, Brasil'&&r.observedDate==='2026-10-02'&&r.timePrecision==='DAY'))
 assert.throws(()=>parseBrazilGrainReport(report.replace('02/10/2026','04/10/2026'),{now}),/BRAZIL_REPORT_DATE_INVALID/)
 assert.throws(()=>parseBrazilGrainReport(report.replace('02/10/2026','31/02/2026'),{now}),/BRAZIL_REPORT_DATE_INVALID/)
 assert.throws(()=>parseBrazilGrainReport(report.replace('MÉDIA<br>DIA','MÉDIA MENSAL'),{now}),/BRAZIL_REPORT_LAYOUT_CHANGED/)
 assert.throws(()=>parseBrazilGrainReport('unknown'),/BRAZIL_REPORT_DATE_MISSING/)
})
test('Brazil cache isolates portfolios and outage never changes observation dates or retries continuously',async()=>{
 let clock=now,failed=false,calls=0
 const feed=createOpenMarketFeed({clock:()=>clock,fetchImpl:async()=>{calls++;if(failed)throw new Error('offline');return new Response(report)}})
 const first=await feed.read(scope),second=await feed.read({...scope,ownerId:'owner-b'})
 assert.equal(calls,1);assert.notEqual(first.marketSnapshots[0].id,second.marketSnapshots[0].id)
 assert.equal(second.marketSnapshots[0].contextOwnerId,'owner-b')
 failed=true;clock=new Date(now.getTime()+16*60*1000)
 const cached=await feed.read(scope);assert.equal(cached.cacheStatus,'STALE_CACHE');assert.equal(cached.marketSnapshots[0].observedDate,'2026-10-02')
 await feed.read(scope);assert.equal(calls,2)
 await assert.rejects(feed.read({}),/MARKET_AUTHENTICATED_SCOPE_REQUIRED/)
})
test('Brazil source honors ISO-8859-1 declared inside an HTML page',async()=>{
 const feed=createOpenMarketFeed({clock:()=>now,fetchImpl:async()=>new Response(Buffer.from('<meta charset="ISO-8859-1">'+report,'latin1'),{headers:{'Content-Type':'text/html'}})})
 const current=await feed.read(scope)
 assert.equal(current.status,'AVAILABLE');assert.equal(current.marketSnapshots[1].price,139.11)
})
test('VAL SOG is the principal source; synthetic quotes are excluded and state averages do not substitute a requested local plaza',async()=>{
 const feed=createOpenMarketFeed({clock:()=>now,fetchImpl:async()=>new Response(report)})
 const local={id:'sog-soja',commodity:'soja',marketKind:'spot',region:'São Luiz Gonzaga/RS',price:145,priceUnit:'BRL/sc_60kg',sourceName:'Cooperativa regional',observedAt:'2026-10-01T15:00:00Z',tenantId:scope.tenantId,contextOwnerId:scope.ownerId,scope:'MARKET'}
 const synthetic={...local,id:'fake',price:999,sourceName:'VAL G2 SINTÉTICO — NÃO É COTAÇÃO REAL',observedAt:now.toISOString()}
 const workspace=await withOpenMarketReferences({marketSnapshots:[local,synthetic]},feed,scope)
 assert.equal(workspace.marketBase,'VAL_SOG')
 assert.match(answerCurrentMarket({workspace,message:'Preço da soja?',now}).answer,/145/)
 assert.match(answerCurrentMarket({workspace,message:'Preço da soja?',now}).answer,/VAL SOG/)
 assert.doesNotMatch(answerCurrentMarket({workspace,message:'Preço da soja?',now}).answer,/999/)
 const publicOnly=await withOpenMarketReferences({marketSnapshots:[synthetic]},feed,scope)
 assert.equal(answerCurrentMarket({workspace:publicOnly,message:'Preço da soja em São Luiz Gonzaga?',now}).status,'UNAVAILABLE')
 assert.match(answerCurrentMarket({workspace:publicOnly,message:'Preço da soja?',now}).answer,/139,11/)
})
test('Copilot independently grounds three Brazilian grains with dated, statewide qualification',async()=>{
 const feed=createOpenMarketFeed({clock:()=>now,fetchImpl:async()=>new Response(report)})
 const workspace=await withOpenMarketReferences({marketSnapshots:[]},feed,scope)
 const result=buildFastMarketResponse({workspace,message:'Como está o mercado?',organizationId:scope.tenantId,ownerId:scope.ownerId,now})
 const reasoning=result.advice.ai_reasoning
 for(const label of ['soja','milho','trigo'])assert.match(reasoning.situation_summary,new RegExp(label,'i'))
 assert.equal(reasoning.facts_used.length,3)
 for(const item of reasoning.facts_used)assert.equal(evaluateResponseGrounding({question:'mercado',answer:item.statement,domain:'GRAINS',evidence:[item],tenantId:scope.tenantId,ownerId:scope.ownerId,now,checkQuestionRelevance:false}).passed,true)
 assert.match(reasoning.situation_summary,/Média estadual brasileira/);assert.doesNotMatch(reasoning.situation_summary,/EUA|USD/)
})
test('credit response rejects another portfolio and removes outdated decisions',async()=>{
 const good={contract:'val.credit.v1',status:'LINKED',...scope,producer:{id:'cred-a',name:'Produtor A'},requests:[{id:'r1',title:'Custeio',status:'rascunho',principal:100000,revision:2,observedAt:'2026-10-02T10:00:00Z',analysisStatus:'OUTDATED_REVISION',decision:{value:'aprovado'}}],fetchedAt:now.toISOString()}
 const service=createValCreditService({baseUrl:'https://credit.example/',token:'x'.repeat(32),fetchImpl:async()=>Response.json(good)})
 const context=await service.read(scope);assert.equal(context.requests[0].decision,null)
 const malicious=createValCreditService({baseUrl:'https://credit.example/',token:'x'.repeat(32),fetchImpl:async()=>Response.json({...good,ownerId:'owner-b'})})
 await assert.rejects(malicious.read(scope),e=>e.code==='credit_scope_mismatch')
 const facts={client:{id:scope.clientId,name:'Produtor A',tenant_id:scope.tenantId,owner_id:scope.ownerId,producer_id:scope.clientId}}
 const result=buildFastClientResponse({facts,presentationOverride:creditPresentation(context,scope),message:'Como está o crédito dele?',organizationId:scope.tenantId,ownerId:scope.ownerId,contextDomain:'CREDIT',now})
 assert.equal(result.advice.ai_reasoning.grounding.passed,true)
 assert.match(result.advice.ai_reasoning.situation_summary,/análise anterior/)
 assert.doesNotMatch(result.advice.ai_reasoning.situation_summary,/aprovado/)
})
