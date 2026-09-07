import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createDatabase} from '../server/db.js'
import {buildDemoProducerFixture,DEMO_PRODUCER_KEY,DEMO_PRODUCER_SOURCE,seedDemoProducer} from '../server/demo-producer.js'
import {ValRepository} from '../server/repository.js'
import {createVisitRouteService} from '../server/visit-route-service.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
import {canonicalGeometryAreaHa,decodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'
import {reconcilePipeline} from '../src/lib/opportunity-pipeline.js'
import {assertControlledDatabase,databaseSsl} from './lib/controlled-database.mjs'

// CI only: fresh synthetic identities in an explicitly named disposable test DB.
// This verifier never uses a staging/production override or external provider.
if(process.env.VAL_DEMO_ENVIRONMENT!=='test')throw new Error('O gate exige VAL_DEMO_ENVIRONMENT=test.')
const connectionString=String(process.env.DATABASE_URL||'').trim()
if(!connectionString)throw new Error('DATABASE_URL é obrigatória para o gate PostgreSQL da demonstração.')
const target=assertControlledDatabase(connectionString)
if(!/^val(?:[_-][a-z0-9]+)*[_-](?:gate|test)$/i.test(target.name))throw new Error('O gate aceita somente bancos val…gate ou val…test controlados.')

const tenantId=randomUUID()
const ownerId=randomUUID()
const otherOwnerId=randomUUID()
// Anchor synthetic dates at noon in São Paulo, independent of the CI run hour.
const fixtureDate=new Date()
fixtureDate.setUTCHours(15,0,0,0)
const fixture=buildDemoProducerFixture({tenantId,ownerId,now:fixtureDate})
const byTable=table=>fixture.rows.filter(item=>item.table===table).map(item=>item.row)
const database=createDatabase({databaseUrl:connectionString,databaseSsl:Boolean(databaseSsl(connectionString)),databaseQueryTimeoutMs:15000})
const repository=new ValRepository({db:database,tenantId,readStore:()=>{throw new Error('Fallback JSON não é permitido neste gate.')},saveStore:()=>{throw new Error('Fallback JSON não é permitido neste gate.')}})

async function provisionScope(){
  await database.transaction(async connection=>{
    await connection.query('INSERT INTO organizations (id,name,slug,status) VALUES ($1,$2,$3,\'active\')',[tenantId,'Gate sintético da demonstração VAL',`demo-gate-${tenantId}`])
    for(const [id,name] of [[ownerId,'Consultor sintético da demonstração'],[otherOwnerId,'Consultor sintético sem carteira']]){
      await connection.query('INSERT INTO users (id,name,email,status,password_hash) VALUES ($1,$2,$3,\'active\',\'gate-only-no-login\')',[id,name,`demo-gate-${id}@example.invalid`])
      await connection.query('INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope) VALUES ($1,$2,\'consultant\',\'{}\'::jsonb)',[tenantId,id])
    }
  })
}

async function persistedCounts(){
  const counts={}
  // Identifiers come only from the internal fixture; every read is tenant scoped.
  for(const table of new Set(fixture.rows.map(item=>item.table))){
    assert.match(table,/^[a-z_]+$/)
    const result=await database.query(`SELECT COUNT(*)::int count FROM ${table} WHERE tenant_id=$1`,[tenantId])
    counts[table]=result.rows[0].count
  }
  return counts
}

async function verifyDemo(){
  const seeded=await seedDemoProducer({database,tenantId,ownerId,environment:'test',now:fixtureDate})
  assert.equal(seeded.created,true)
  assert.equal(seeded.clientId,fixture.clientId)
  const counts=await persistedCounts()
  for(const [table,count] of Object.entries(counts))assert.equal(count,byTable(table).length,`Persisted ${table} count`)
  assert.equal(counts.properties,2)
  assert.equal(counts.fields,4)
  assert.equal(counts.crop_seasons,12)

  const intelligence=await repository.getIntelligence(ownerId)
  assert.equal(intelligence.clients.length,1)
  const client=intelligence.clients[0]
  assert.equal(client.id,DEMO_PRODUCER_KEY)
  assert.equal(client.commercial.synthetic,true)
  assert.ok(Number.isFinite(client.location?.lat)&&Number.isFinite(client.location?.lng))
  assert.equal(intelligence.visits.length,5)
  assert.equal(intelligence.opportunities.length,2)
  assert.equal(new Set(intelligence.opportunities.map(item=>item.candidateKey)).size,2)
  const pipeline=reconcilePipeline(intelligence.clients,intelligence.opportunities)
  assert.equal(pipeline.length,2)
  assert.equal(new Set(pipeline.map(item=>item.id)).size,2)

  const context=await repository.getClientContext({tenantId,ownerId,clientId:fixture.externalKey,client})
  assert.equal(context.client.id,fixture.externalKey)
  assert.equal(context.properties.length,2)
  const fields=context.properties.flatMap(property=>property.fields.map(field=>({...field,propertyId:property.id})))
  assert.equal(fields.length,4)
  assert.equal(fields.flatMap(field=>field.seasons).length,12)
  assert.equal(new Set(fields.flatMap(field=>field.seasons.map(season=>season.season))).size,3)
  for(const field of fields){
    const canonical=decodeCanonicalGeometryRef(field.geometry_ref,{expectedOrganizationId:tenantId})
    assert.equal(canonical.geometry.type,'Polygon')
    assert.equal(canonical.link.clientId,fixture.clientId)
    assert.equal(canonical.link.propertyId,field.propertyId)
    assert.equal(canonical.link.fieldId,field.id)
    assert.equal(canonical.geometryVersion,field.geometry_version)
    assert.equal(canonical.provenance.details.synthetic,true)
    assert.ok(Math.abs(Number(field.area_ha)-canonicalGeometryAreaHa(canonical.geometry))<.01)
    assert.equal(field.seasons.length,3)
  }
  for(const property of context.properties){
    const loaded=await repository.getPropertyProfile(fixture.externalKey,ownerId,{propertyId:property.id})
    assert.equal(loaded.source,'postgresql')
    assert.equal(loaded.property.id,property.id)
    assert.equal(loaded.properties.length,2)
    assert.equal(loaded.fields.length,property.fields.length)
    assert.ok(loaded.fields.every(field=>field.geometryStatus==='CANONICAL'&&field.points.length>=4))
  }

  assert.equal(context.soilAnalyses.length,4)
  assert.equal(context.soilAnalyses.flatMap(analysis=>analysis.measurements).length,36)
  for(const analysis of context.soilAnalyses){
    assert.equal(analysis.source,DEMO_PRODUCER_SOURCE)
    assert.match(analysis.laboratory,/SIMULADO/)
    assert.equal(analysis.validation_evidence.synthetic,true)
    assert.equal(analysis.validation_evidence.technicalApproval,false)
    assert.deepEqual(analysis.validated_flags,[])
    assert.equal(analysis.validated_at,null)
    assert.ok(fields.some(field=>field.external_key===analysis.field_external_key))
    assert.ok(analysis.measurements.every(item=>Number.isFinite(Number(item.normalized_value))&&item.normalized_unit&&item.link_version===1))
  }
  assert.equal(context.ndviObservations.length,12)
  for(const observation of context.ndviObservations){
    const field=fields.find(item=>item.external_key===observation.field_external_key)
    assert.ok(field)
    assert.equal(observation.source,DEMO_PRODUCER_SOURCE)
    assert.equal(observation.geometry_version,field.geometry_version)
    assert.match(observation.sensor,/SIMULADO/)
    assert.equal(observation.statistics.synthetic,true)
    assert.equal(observation.anomaly.requiresFieldValidation,true)
    assert.equal(observation.validated_at,null)
  }
  assert.equal(context.businessHistory.length,6)
  assert.equal(context.commitments.length,2)
  assert.equal(context.opportunities.length,2)
  assert.deepEqual(context.profile.rejectedEvidence,[])
  assert.equal(context.profile.evidence.length,9)
  const answers=JSON.parse(byTable('client_profiles')[0].answers)
  assert.equal(Object.keys(context.profile.answers).length,7)
  for(const [question,value] of Object.entries(context.profile.answers))assert.equal(value,answers[question])
  for(const evidence of context.profile.evidence){
    assert.equal(evidence.tenant_id,tenantId)
    assert.equal(evidence.context_owner_id,ownerId)
    assert.equal(evidence.producer_id,fixture.externalKey)
    assert.ok(evidence.source_locator)
    if(evidence.question_id){
      assert.equal(evidence.source_type,'producer_questionnaire')
      assert.match(evidence.source_id,/val-demo-synthetic-v1:/)
      assert.equal(evidence.epistemic_type,'QUOTE')
    }
  }
  const facts=await repository.getFastClientFacts({tenantId,ownerId,clientId:fixture.externalKey,dataPath:'BEHAVIORAL_PROFILE',now:fixtureDate})
  const response=buildFastClientResponse({facts,message:'Qual o perfil do Rafael?',organizationId:tenantId,ownerId,conversationId:'synthetic-demo-postgres-gate',contextEpoch:1,now:fixtureDate})
  assert.match(response.advice.answer,/Perfil principal: Analítico/i)
  assert.equal(response.advice.ai_reasoning.grounding.passed,true)

  const foreign=await repository.getIntelligence(otherOwnerId)
  assert.deepEqual(foreign.clients,[])
  assert.deepEqual(foreign.visits,[])
  assert.deepEqual(foreign.opportunities,[])
  await assert.rejects(repository.getClientContext({tenantId,ownerId:otherOwnerId,clientId:fixture.externalKey}),error=>error.statusCode===404)
  await assert.rejects(repository.getPropertyProfile(fixture.externalKey,otherOwnerId),error=>error.statusCode===404)

  const editedName='Produtor FICTÍCIO — nome editado no gate'
  await database.query('UPDATE clients SET name=$4,updated_at=NOW() WHERE tenant_id=$1 AND consultant_id=$2 AND id=$3',[tenantId,ownerId,fixture.clientId,editedName])
  const repeated=await seedDemoProducer({database,tenantId,ownerId,environment:'test',now:new Date(fixtureDate.getTime()+86400000)})
  assert.equal(repeated.created,false)
  assert.equal(repeated.preserved,true)
  assert.equal(repeated.name,editedName)
  assert.deepEqual(await persistedCounts(),counts)
  assert.equal((await repository.getIntelligence(ownerId)).clients[0].name,editedName)
  return counts
}

async function verifyRoutes(){
  let clock=fixtureDate.getTime()
  let providerCalls=0
  const serviceOptions={repository,clock:()=>clock,fetchImpl:async()=>{providerCalls++;throw new Error('External providers are forbidden in this gate.')}}
  const service=createVisitRouteService(serviceOptions)
  const date=fixtureDate.toISOString().slice(0,10)
  const orderedVisitIds=['visit-today-next','visit-today-active'].map(key=>fixture.rows.find(item=>item.key===key).row.id)
  const saved=await service.saveDay({ownerId,date,input:{timeZone:'America/Sao_Paulo',orderedVisitIds}})
  assert.deepEqual(saved.orderedVisitIds,orderedVisitIds)
  assert.deepEqual((await service.getDay({ownerId,date})).orderedVisitIds,orderedVisitIds)
  const started=await service.saveDay({ownerId,date,input:{tracking:true}})
  assert.equal(started.tracking,true)
  assert.equal(started.trackingStartedAt,fixtureDate.toISOString())
  const tracePoints=[
    {lat:-28.459,lng:-55.017,timestamp:new Date(clock+1000).toISOString(),accuracy:8},
    {lat:-28.4589,lng:-55.0169,timestamp:new Date(clock+2000).toISOString(),accuracy:9}
  ]
  clock+=5000
  const appended=await service.saveDay({ownerId,date,input:{tracePoints}})
  assert.deepEqual(appended.trace,tracePoints)
  const stopped=await service.saveDay({ownerId,date,input:{tracking:false}})
  assert.equal(stopped.tracking,false)
  // A new service has no shared in-process route state.
  const persisted=await createVisitRouteService(serviceOptions).getDay({ownerId,date})
  assert.deepEqual(persisted.trace,tracePoints)
  assert.deepEqual(persisted.orderedVisitIds,orderedVisitIds)
  assert.equal(persisted.tracking,false)
  const foreign=await service.getDay({ownerId:otherOwnerId,date})
  assert.deepEqual(foreign.trace,[])
  assert.deepEqual(foreign.orderedVisitIds,[])
  await assert.rejects(service.saveDay({ownerId:otherOwnerId,date,input:{orderedVisitIds}}),error=>error.code==='visit_route_visit_not_found')
  assert.equal((await database.query('SELECT 1 FROM val_visit_routes WHERE tenant_id=$1 AND owner_id=$2',[tenantId,otherOwnerId])).rowCount,0)
  const audit=await database.query('SELECT actor_id,after_data FROM audit_events WHERE tenant_id=$1 AND action=\'visit_route_updated\'',[tenantId])
  assert.equal(audit.rowCount,4)
  assert.ok(audit.rows.every(row=>row.actor_id===ownerId&&row.after_data.orderedVisitCount===2))
  assert.equal(audit.rows.reduce((sum,row)=>sum+row.after_data.addedTracePointCount,0),2)
  assert.equal(audit.rows.filter(row=>row.after_data.trackingChanged).length,2)
  assert.equal(audit.rows.filter(row=>row.after_data.tracePointCount===2).length,2)
  const auditKeys=['addedTracePointCount','orderedVisitCount','routeDate','tracePointCount','tracking','trackingChanged'].sort()
  for(const row of audit.rows)assert.deepEqual(Object.keys(row.after_data).sort(),auditKeys)
  assert.equal(providerCalls,0)
  return {orderedVisits:2,persistedSyntheticGpsPoints:2,auditRows:audit.rowCount,ownerIsolation:'PASS',auditExcludesCoordinates:'PASS',externalProviderCalls:providerCalls}
}

try{
  assert.equal((await database.query('SELECT current_database() name')).rows[0].name,target.name)
  const version=String((await database.query('SHOW server_version')).rows[0].server_version)
  assert.match(version,/^16\./)
  await provisionScope()
  const counts=await verifyDemo()
  const routes=await verifyRoutes()
  console.log(JSON.stringify({schema:'val.demo-producer.postgres-gate.v1',verifiedAt:new Date().toISOString(),postgresVersion:version,syntheticDataOnly:true,counts,checks:{canonicalGeometry:'PASS',soilAndNdvi:'PASS',distinctPipelineOpportunities:'PASS',groundedQuestionnaireProfile:'PASS',ownerIsolation:'PASS',repeatSeedPreservesEdits:'PASS',routes}},null,2))
}finally{
  await database.close()
}
