import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {register} from 'node:module'
import test from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {technicalBootstrapFromValClients} from '../server/agronomic-geometry-bridge.js'
import {normalizeIntegrationEvent,verifyWebhookSignature} from '../server/ingestion.js'
import {listVersionedMigrations} from '../server/migration-runner.js'
import {ValRepository} from '../server/repository.js'
import {decodeCanonicalGeometryRef,encodeCanonicalGeometryRef,manualToCanonicalValGeometry} from '../src/lib/agronomic-geometry-adapter.js'

// Only the Next.js marker is replaced, as in manual/integration-smoke.mjs.
register('data:text/javascript,export async function resolve(s,c,n){if(s==="server-only")return{url:"data:text/javascript,export%20default%20%7B%7D",shortCircuit:true};return n(s,c)}',import.meta.url)
const {publishWorkspaceToValor,publishManualRecordToValor}=await import('../manual/app/lib/valor360.ts')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='00000000-0000-4000-8000-000000000710'
const ring=[[-54,-28],[-53.99,-28],[-53.99,-28.01],[-54,-28.01],[-54,-28]]
const inner=[[-53.998,-28.002],[-53.995,-28.002],[-53.995,-28.005],[-53.998,-28.005],[-53.998,-28.002]]

test('Manual preserva geometria no percurso bootstrap → publisher HMAC → ingestão PostgreSQL',async t=>{
 const pg=new PGlite()
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 const repository=new ValRepository({db,tenantId,readStore:()=>({}),saveStore:()=>{}})
 const received=[]
 const signingSecret='synthetic-local-manual-regression-only'
 const server=createServer(async(request,response)=>{
  let raw='';for await(const chunk of request)raw+=chunk
  try{
   if(!verifyWebhookSignature(raw,request.headers['x-valor-signature'],signingSecret))throw Object.assign(new Error('invalid signature'),{statusCode:401})
   const event=normalizeIntegrationEvent(JSON.parse(raw));received.push(event)
   assert.equal(event.ownerUserId,ownerId)
   const result=await repository.ingestEvent({tenantId,ownerId,event,signals:[]})
   response.writeHead(result.duplicate?200:202,{'content-type':'application/json'});response.end(JSON.stringify({accepted:true,...result}))
  }catch(error){response.writeHead(error.statusCode||500,{'content-type':'application/json'});response.end(JSON.stringify({error:error.message,code:error.code}))}
 })
 const originalUrl=process.env.VALOR360_WEBHOOK_URL
 const originalSecret=process.env.VALOR360_WEBHOOK_SECRET
 try{
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const migration of await listVersionedMigrations())await pg.exec(migration.sql)
  await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'Synthetic Manual owner','manual-geometry@example.test'])
  await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  process.env.VALOR360_WEBHOOK_URL=`http://127.0.0.1:${server.address().port}/events`
  process.env.VALOR360_WEBHOOK_SECRET=signingSecret

  for(const [label,geometry] of [
   ['polygon',{type:'Polygon',coordinates:[ring]}],
   ['polygon-hole',{type:'Polygon',coordinates:[ring,inner]}],
   ['multipolygon',{type:'MultiPolygon',coordinates:[[ring,inner],[ring.map(([lng,lat])=>[lng+0.02,lat])]]}],
   ['dense-polygon',{type:'Polygon',coordinates:[Array.from({length:400},(_,i)=>[-54+Math.cos(i*2*Math.PI/400)*0.01,-28+Math.sin(i*2*Math.PI/400)*0.01])]}],
  ])await t.test(label,async()=>{
   const externalKey=`manual-hml-${label}`
   const canonical=manualToCanonicalValGeometry({organizationId:tenantId,clientId:externalKey,propertyId:'synthetic-property',fieldId:'synthetic-field',sourceFieldId:`field-${label}`,fieldName:`Synthetic ${label}`,geometry})
   const {producers,geometryIssues}=technicalBootstrapFromValClients([{id:externalKey,name:`Synthetic ${label}`,properties:[{id:'synthetic-property',name:'Synthetic farm',fields:[{id:'synthetic-field',name:`Synthetic ${label}`,geometry_ref:encodeCanonicalGeometryRef(canonical)}]}]}],{organizationId:tenantId})
   assert.deepEqual(geometryIssues,[])
   producers[0].password='MUST-NOT-LEAVE-PUBLISHER'
   producers[0].fields[0].geometry.secret='MUST-NOT-LEAVE-PUBLISHER'
   const result=await publishWorkspaceToValor(producers,[],ownerId)
   assert.equal(result.failed,0,JSON.stringify(result.errors))
   assert.equal(result.delivered,1)
   assert.equal(result.skipped,0)
   const envelope=received.at(-1)
   assert.deepEqual(envelope.payload.producer.fields[0].geometry,canonical.geometry)
   assert.ok(!JSON.stringify(envelope).includes('MUST-NOT-LEAVE-PUBLISHER'))
   const saved=await pg.query('SELECT f.geometry_ref FROM fields f JOIN properties p ON p.id=f.property_id JOIN clients c ON c.id=p.client_id WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.external_key=$3',[tenantId,ownerId,externalKey])
   assert.equal(saved.rows.length,1)
   const restored=decodeCanonicalGeometryRef(saved.rows[0].geometry_ref,{expectedOrganizationId:tenantId})
   assert.deepEqual(restored.geometry,canonical.geometry)
   assert.equal(restored.geometryVersion,canonical.geometryVersion)
   assert.equal(restored.measurements.calculatedAreaHa,canonical.measurements.calculatedAreaHa)
   const repeat=await publishWorkspaceToValor(producers,[],ownerId)
   assert.equal(repeat.failed,0)
   assert.equal((await pg.query('SELECT COUNT(*)::integer total FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND client_external_key=$3',[tenantId,ownerId,externalKey])).rows[0].total,1)
  })

  await t.test('geometria inválida continua rejeitada e transação é revertida',async()=>{
   const result=await publishWorkspaceToValor([{id:'manual-hml-invalid',name:'Synthetic invalid',properties:'Synthetic farm',fields:[{id:'invalid-field',name:'Invalid',geometry:{type:'Polygon',coordinates:[[[181,-28],[182,-28],[181,-29],[181,-28]]]}}]}],[],ownerId)
   assert.equal(result.failed,1)
   assert.equal(result.errors[0].status,422)
   assert.match(result.errors[0].error,/geometry_coordinate_out_of_range/)
   assert.equal((await pg.query("SELECT COUNT(*)::integer total FROM clients WHERE external_key='manual-hml-invalid'")).rows[0].total,0)
  })

  await t.test('contorno acima do limite falha por item e preserva os próximos lotes',async()=>{
   const count=received.length
   const excessive={type:'Polygon',coordinates:[Array.from({length:5001},()=>[-54,-28])]}
   const result=await publishWorkspaceToValor([
    {id:'manual-hml-excess',fields:[{geometry:excessive}]},
    ...Array.from({length:6},(_,i)=>({id:`manual-hml-after-excess-${i}`,name:`Synthetic next batch ${i}`})),
   ],[],ownerId)
   assert.equal(result.attempted,7)
   assert.equal(result.failed,1)
   assert.equal(result.delivered,6)
   assert.equal(result.errors[0].status,422)
   assert.match(result.errors[0].error,/5000 posições/)
   assert.equal(received.length,count+6)
   assert.equal(received.at(-1).clientExternalKey,'manual-hml-after-excess-5')
   const recordResult=await publishManualRecordToValor({id:'synthetic-record-excess',type:'field_analysis',title:'Synthetic record',payload:{geometry:excessive}},ownerId)
   assert.equal(recordResult[0].ok,false)
   assert.equal(recordResult[0].status,422)
   assert.match(recordResult[0].error,/5000 posições/)
   assert.equal(received.length,count+6)
  })
 }finally{
  if(originalUrl===undefined)delete process.env.VALOR360_WEBHOOK_URL;else process.env.VALOR360_WEBHOOK_URL=originalUrl
  if(originalSecret===undefined)delete process.env.VALOR360_WEBHOOK_SECRET;else process.env.VALOR360_WEBHOOK_SECRET=originalSecret
  await new Promise(resolve=>server.close(resolve))
  await pg.close()
 }
})
