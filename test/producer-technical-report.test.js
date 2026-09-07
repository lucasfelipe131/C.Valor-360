import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformWithEsbuild} from 'vite'
const source=readFileSync('manual/app/SeasonReports.tsx','utf8')
const block=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)))
const helpers=[block('const grainCrops:', 'const chartColors'),block('function blankReport(', 'function categoryLabel('),block('function defaultPriceBasis(', 'function priceUnit(')].join('\n')
const result=await transformWithEsbuild(helpers+'\nexport {blankReport,normalizeReport,costPerHa,decimal,money};','report-helpers.ts',{loader:'ts'})
const actual=await import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`)
test('reused Manual report preserves missing values through JSON and calculates declared costs with original unit conversions',()=>{
 const blank=actual.blankReport({id:'test',name:'Fixture',area:100,fields:[{id:'f',area:100,crop:'Soja'}]},true)
 assert.equal(blank.crop,'');assert.equal(blank.fieldId,'');assert.ok(Number.isNaN(blank.area))
 const restored=actual.normalizeReport(JSON.parse(JSON.stringify(blank)))
 assert.equal(actual.money(restored.yieldScHa),'—');assert.equal(actual.decimal(restored.area),'—')
 assert.ok(Number.isNaN(restored.grainPrices.Soja))
 assert.ok(Number.isNaN(actual.costPerHa({dose:1,unit:'kg/ha',unitPrice:Number.NaN,priceBasis:'R$/kg'})))
 assert.equal(actual.costPerHa({dose:200,unit:'kg/ha',unitPrice:3000,priceBasis:'R$/t'}),600)
 assert.equal(actual.costPerHa({dose:500,unit:'mL/ha',unitPrice:100,priceBasis:'R$/L'}),50)
 assert.equal(actual.costPerHa({dose:0,unit:'kg/ha',unitPrice:100,priceBasis:'R$/kg'}),0)
})
test('producer report reuses Manual functions and records with explicit account and client scope',()=>{
 const entry=readFileSync('manual/app/producer-report/ProducerReport.tsx','utf8')
 assert.match(entry,/strictData recordsApi=\{recordsApi\}/)
 assert.match(entry,/clientExternalKey===clientId/)
 assert.match(entry,/scope=producer-profile/)
 assert.match(readFileSync('manual/app/api/records/route.ts','utf8'),/get\("scope"\) === "producer-profile"\) return user.id/)
 assert.match(readFileSync('src/pages/Client360.jsx','utf8'),/\['documents','Documentos',FileText\],\['technical-report','Relatório técnico',FileText\]/)
})
const scopeCode=await transformWithEsbuild(readFileSync('manual/app/lib/producer-report-scope.ts','utf8'),'scope.ts',{loader:'ts'})
const {authorizeProducerReport}=await import(`data:text/javascript;base64,${Buffer.from(scopeCode.code).toString('base64')}`)
test('technical report authorizes canonical owner and derives demo from the producer, never caller flags',async()=>{
 const calls=[]
 const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:params[1]==='owner'&&params[2]==='demo-client'?[{id:'canonical',external_key:'demo-client',source:'val-demo-synthetic-v1'}]:[]}}}
 await assert.rejects(authorizeProducerReport(db,'tenant',null,'demo-client'),e=>e.status===403)
 assert.equal(calls.length,0)
 await assert.rejects(authorizeProducerReport(db,'tenant','other-owner','demo-client'),e=>e.status===404)
 const producer=await authorizeProducerReport(db,'tenant','owner','demo-client')
 assert.equal(producer.isDemo,true);assert.equal(producer.id,'canonical')
 assert.deepEqual(calls.at(-1).params,['tenant','owner','demo-client'])
 assert.match(calls.at(-1).sql,/tenant_id=\$1 AND consultant_id=\$2/)
 const real=await authorizeProducerReport({query:async()=>({rows:[{id:'real',source:'import'}]})},'tenant','owner','real')
 assert.equal(real.isDemo,false)
})
