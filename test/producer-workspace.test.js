import test from 'node:test'
import assert from 'node:assert/strict'
import {readProducerWorkspace} from '../server/producer-workspace.js'
import {seasonDisplay,nextPlanAction} from '../src/lib/producer-display.js'

test('workspace refuses missing session and foreign producer before reading resources',async()=>{
 const repository={tenantId:'t',db:{configured:false},getIntelligence:async()=>({clients:[]}),readStore:()=>{throw new Error('must not read')}}
 await assert.rejects(readProducerWorkspace(repository,'a',null),{statusCode:401})
 await assert.rejects(readProducerWorkspace(repository,'a','owner'),{statusCode:404})
})
test('local workspace isolates producer, tenant and owner without changing store',async()=>{
 const good={tenantId:'t',ownerId:'o',clientId:'a',property:{id:'p'},fields:[{id:'f'}]}
 const store={val:{propertyProfiles:[good,{...good,tenantId:'other'},{...good,ownerId:'other'},{...good,clientId:'other'}]}}
 const before=JSON.stringify(store)
 const result=await readProducerWorkspace({tenantId:'t',db:{configured:false},getIntelligence:async()=>({clients:[{id:'a',isDemo:true}]}),readStore:()=>store},'a','o')
 assert.equal(result.properties.length,1);assert.equal(result.fields.length,1);assert.equal(result.isDemo,true)
 assert.equal(JSON.stringify(store),before)
})
test('SQL workspace scopes every read and marks truncated coverage incomplete',async()=>{
 const calls=[]
 const db={configured:true,query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT id,source'))return {rows:[{id:'a',source:'manual'}]};if(sql.startsWith('SELECT p.'))return {rows:Array.from({length:201},(_,i)=>({id:`p${i}`}))};return {rows:[]}}}
 const result=await readProducerWorkspace({tenantId:'t',db},'external-a','o')
 assert.equal(result.complete,false);assert.equal(result.properties.length,200);assert.equal(calls.length,5)
 for(const call of calls){assert.match(call.sql,/^SELECT /);assert.match(call.sql,/tenant_id=\$1/);assert.match(call.sql,/consultant_id=\$2/);assert.deepEqual(call.args.slice(0,2),['t','o'])}
 for(const call of calls.slice(1))assert.equal(call.args[2],'a')
})
test('season estimates require complete crop-specific areas and compatible units',()=>{
 const rows=[{fieldId:'a',crop:'Soja',season:'2026/27',areaHa:10,productivityTarget:60,unit:'sc/ha'},{fieldId:'b',crop:'Milho',season:'2026/27',areaHa:20,productivityTarget:100,unit:'sc/ha'}]
 const opts={season:'2026/27'}
 assert.deepEqual(seasonDisplay(rows,opts).map(r=>r.estimatedProductionSc),[600,2000])
 assert.equal(seasonDisplay(rows,{...opts,complete:false})[0].estimatedProductionSc,null)
 assert.equal(seasonDisplay([rows[0],rows[0]],opts)[0].areaHa,null)
 assert.equal(seasonDisplay([{...rows[0],unit:'kg/ha'}],opts)[0].estimatedProductionSc,null)
 assert.equal(seasonDisplay([{...rows[0],areaHa:null}],opts)[0].areaHa,null)
 assert.equal(seasonDisplay([{...rows[0],isDemo:true}],opts).length,0)
 assert.equal(seasonDisplay([{...rows[0],areaHa:0}],opts)[0].estimatedProductionSc,0)
})
test('next action excludes completed, expired and unsupported proposals',()=>{
 const action={status:'PROPOSED',title:'Revisar registro',source_refs:[{id:'visit:a'}],due_at:'2027-01-01'}
 assert.equal(nextPlanAction({status:'PROPOSED',priorities:[action]},{now:Date.parse('2026-09-07')}).title,action.title)
 assert.equal(nextPlanAction({status:'COMPLETED',priorities:[action]}),null)
 assert.equal(nextPlanAction({status:'PROPOSED',priorities:[{...action,source_refs:[]}]}),null)
 assert.equal(nextPlanAction({status:'PROPOSED',priorities:[action]},{now:Date.parse('2028-01-01')}),null)
})
