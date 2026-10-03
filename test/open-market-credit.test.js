import test from 'node:test'
import assert from 'node:assert/strict'
import {parseUsdaGrainReport,createOpenMarketFeed,withOpenMarketReferences} from '../server/open-market-feed.js'
import {createValCreditService,creditPresentation} from '../server/val-credit-service.js'
import {buildFastMarketResponse,buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {evaluateResponseGrounding} from '../server/decision-copilot/response-grounding.js'
import {buildGrainOpportunities} from '../server/grain-intelligence.js'

const now=new Date('2026-10-03T11:00:00Z')
const report='Grain Report for 10/2/2026 - Final State Average Price: Corn -- $4.55 Soybeans -- $12.19 Futures Settlements CBOT Corn 497.75 (Dec 26) CBOT Soybeans 1278.25 (Nov 26) CBOT Wheat 683.00 (Dec 26)'
const scope={tenantId:'tenant-a',ownerId:'owner-a',clientId:'client-a'}
test('USDA dollar benchmarks never become local BRL trade targets',()=>{
 const [opportunity]=buildGrainOpportunities({intentions:[{id:'i1',clientId:'client-a',commodity:'soja',direction:'sell',volume:100,volumeUnit:'sc_60kg',targetPrice:150,priceUnit:'BRL/sc_60kg',status:'confirmed',confidence:90,observedAt:now.toISOString()}],marketSnapshots:parseUsdaGrainReport(report,{now})},{now})
 assert.equal(opportunity.marketReference,null);assert.equal(opportunity.priceGapPercent,null)
})
test('USDA retains USD/bushel, cash/futures, contract month and publication date',()=>{
 const rows=parseUsdaGrainReport(report,{now});assert.equal(rows.length,5)
 assert.deepEqual(rows.map(r=>r.price),[4.55,12.19,4.9775,12.7825,6.83])
 assert.ok(rows.every(r=>r.priceUnit==='USD/bu'&&r.observedDate==='2026-10-02'&&r.timePrecision==='DAY'))
 assert.equal(rows.at(-1).deliveryEnd,'2026-12-31')
 assert.throws(()=>parseUsdaGrainReport(report.replace('10/2/2026','10/4/2026'),{now}),/USDA_REPORT_DATE_INVALID/)
 assert.throws(()=>parseUsdaGrainReport('unknown'),/USDA_REPORT_DATE_MISSING/)
})
test('public cache materializes distinct owner evidence; failures keep original observation date',async()=>{
 let clock=now,failed=false,calls=0
 const feed=createOpenMarketFeed({clock:()=>clock,extractPdf:async()=>report,fetchImpl:async url=>{calls++;if(failed)throw new Error('offline');return new Response(String(url).endsWith('.pdf')?'pdf':JSON.stringify([{data:'02/10/2026',valor:'5.30'}]))}})
 const first=await feed.read(scope),second=await feed.read({...scope,ownerId:'owner-b'})
 assert.equal(calls,2);assert.notEqual(first.marketSnapshots[0].id,second.marketSnapshots[0].id)
 assert.equal(first.marketSnapshots[0].contextOwnerId,'owner-a');assert.equal(second.marketSnapshots[0].contextOwnerId,'owner-b')
 failed=true;clock=new Date(now.getTime()+16*60*1000)
 const cached=await feed.read(scope);assert.equal(cached.cacheStatus,'STALE_CACHE');assert.equal(cached.marketSnapshots[0].observedDate,'2026-10-02')
 await assert.rejects(feed.read({}),/MARKET_AUTHENTICATED_SCOPE_REQUIRED/)
})
test('Copilot market overview independently grounds all three grains without local price conversion',async()=>{
 const feed=createOpenMarketFeed({clock:()=>now,extractPdf:async()=>report,fetchImpl:async url=>new Response(String(url).endsWith('.pdf')?'pdf':'[]')})
 const workspace=await withOpenMarketReferences({marketSnapshots:[]},feed,scope)
 const result=buildFastMarketResponse({workspace,message:'Como está o mercado?',organizationId:scope.tenantId,ownerId:scope.ownerId,now})
 const reasoning=result.advice.ai_reasoning
 assert.match(reasoning.situation_summary,/soja/i);assert.match(reasoning.situation_summary,/milho/i);assert.match(reasoning.situation_summary,/trigo/i)
 assert.equal(reasoning.facts_used.length,3)
 for(const item of reasoning.facts_used)assert.equal(evaluateResponseGrounding({question:'mercado',answer:item.statement,domain:'GRAINS',evidence:[item],tenantId:scope.tenantId,ownerId:scope.ownerId,now,checkQuestionRelevance:false}).passed,true)
 assert.match(reasoning.situation_summary,/EUA/);assert.doesNotMatch(reasoning.situation_summary,/R\$ 12/)
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
