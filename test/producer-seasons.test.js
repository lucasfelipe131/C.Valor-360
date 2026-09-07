import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSeasonInput,readProducerSeasons,saveProducerSeason} from '../server/producer-seasons.js'
import {emptySeasonCrops,cropPotential,previousYield,validSeasonCode} from '../src/lib/producer-seasons.js'
import {seasonReportHtml} from '../src/lib/season-report.js'
const input=()=>({season:'2627V',revision:0,sourceNote:'Levantamento de teste explícito',observedOn:'2026-09-07',crops:emptySeasonCrops()})
test('season budgets preserve missing inputs and do not manufacture available grain',()=>{
 const row={...emptySeasonCrops()[0],areaHa:100,expectedYield:60}
 assert.equal(cropPotential(row).productionSc,6000);assert.equal(cropPotential(row).availableSc,null)
 Object.assign(row,{retainedSc:100,otherBuyersSc:900,targetSharePct:40,deliveredSc:500})
 assert.deepEqual(cropPotential(row),{productionSc:6000,actualProductionSc:null,availableSc:5000,targetSc:2000,remainingSc:1500,achievementPct:25,conflict:false})
 assert.equal(cropPotential({...row,otherBuyersSc:7000}).availableSc,null)
 assert.equal(cropPotential({...row,areaHa:0,retainedSc:0,otherBuyersSc:0}).availableSc,0)
 assert.equal(validSeasonCode('2727I'),true);assert.equal(validSeasonCode('2627V'),true);assert.equal(validSeasonCode('2726V'),false)
})
test('prior yield is area weighted, prior seasons only, matching season type and crop',()=>{
 const seasons=[{season:'2425V',crops:[{crop:'Soja',areaHa:10,actualYield:40}]},{season:'2526V',crops:[{crop:'Soja',areaHa:30,actualYield:60}]},{season:'2727I',crops:[{crop:'Soja',areaHa:100,actualYield:100}]}]
 assert.deepEqual(previousYield(seasons,'2627V','Soja'),{yield:55,count:2})
 assert.equal(previousYield(seasons,'2627V','Milho'),null)
})
test('validation rejects invalid inputs, duplicate crops, bad date and negative quantities',()=>{
 for(const patch of [{season:'bad'},{revision:-1},{sourceNote:''},{observedOn:'2026-02-30'},{crops:Array(4).fill({crop:'Soja'})}])assert.throws(()=>normalizeSeasonInput({...input(),...patch}))
 for(const value of ['abc',Infinity,-1,true,[],{}]){const row=input();row.crops[0].areaHa=value;assert.throws(()=>normalizeSeasonInput(row))}
 const row=input();row.crops[0].targetSharePct=101;assert.throws(()=>normalizeSeasonInput(row))
 assert.equal(normalizeSeasonInput(input()).crops[0].areaHa,null)
})
test('season persistence owns scope, detects concurrent edits and stores inputs only',async()=>{
 let store={val:{}};const repository={tenantId:'t',db:{configured:false},getIntelligence:async owner=>({clients:owner==='o'?[{id:'a',isDemo:true}]:[]}),readStore:()=>structuredClone(store),saveStore:value=>{store=value}}
 await assert.rejects(readProducerSeasons(repository,'a',null),{statusCode:401})
 await assert.rejects(saveProducerSeason(repository,'foreign','o',input()),{statusCode:404})
 const saved=await saveProducerSeason(repository,'a','o',{...input(),ownerId:'attacker',tenantId:'other',isDemo:false,availableSc:999})
 assert.equal(saved.ownerId,'o');assert.equal(saved.tenantId,'t');assert.equal(saved.isDemo,true);assert.equal(saved.revision,1);assert.equal(saved.availableSc,undefined)
 await assert.rejects(saveProducerSeason(repository,'a','o',input()),{statusCode:409})
 assert.equal((await readProducerSeasons(repository,'a','o')).seasons.length,1)
 await assert.rejects(readProducerSeasons(repository,'a','other'),{statusCode:404})
 const updated=await saveProducerSeason(repository,'a','o',{...input(),revision:1});assert.equal(updated.revision,2)
 assert.equal(store.val.producerSeasons.length,1)
})
test('SQL write checks ownership and revision inside a locked transaction',async()=>{
 const queries=[];const db={configured:true,transaction:async work=>work(db),query:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('SELECT id,source'))return {rows:[{id:'canonical',source:'manual'}]};if(sql.startsWith('SELECT revision'))return {rows:[]};return {rows:[{season:'2627V',revision:1,crops:emptySeasonCrops(),source_note:'Test',observed_on:'2026-09-07',is_demo:false}]}}}
 await saveProducerSeason({tenantId:'t',db},'external','o',input())
 assert.match(queries[0].sql,/consultant_id=\$2/);assert.match(queries[0].sql,/FOR UPDATE/)
 assert.deepEqual(queries[0].args,['t','o','external'])
 assert.deepEqual(queries[2].args.slice(0,3),['t','canonical','o'])
 assert.equal(queries[2].args[8],false)
})
test('report escapes producer input and labels projections without creating a cross-crop total',()=>{
 const report=seasonReportHtml({name:'<script>alert(1)</script>'},{...input(),isDemo:true})
 assert.ok(!report.includes('<script>'));assert.ok(report.includes('&lt;script&gt;'));assert.ok(report.includes('DEMONSTRATIVO'));assert.ok(report.includes('não são somadas'))
})
