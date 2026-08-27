import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createDatabase} from '../server/db.js'
import {normalizeIntegrationEvent} from '../server/ingestion.js'
import {technicalBootstrapFromValClients} from '../server/agronomic-geometry-bridge.js'
import {ValRepository} from '../server/repository.js'
import {decodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'
import {assertControlledDatabase,databaseSsl} from './lib/controlled-database.mjs'

const connectionString=String(process.env.DATABASE_URL||'').trim()
if(!connectionString)throw new Error('DATABASE_URL é obrigatória para o gate PostgreSQL vNext.')
const target=assertControlledDatabase(connectionString,{confirmation:process.env.CONFIRM_CONTROLLED_STAGING,requiredConfirmation:'STAGING_ONLY'})
const mode=String(process.env.VNEXT_VERIFY_MODE||'source').trim().toLowerCase()
if(!['source','repeat','restore'].includes(mode))throw new Error('VNEXT_VERIFY_MODE deve ser source, repeat ou restore.')

const tenantA='71000000-0000-4000-8000-000000000001'
const tenantB='72000000-0000-4000-8000-000000000002'
const ownerA='73000000-0000-4000-8000-000000000003'
const ownerB='74000000-0000-4000-8000-000000000004'
const clientExternalKey='vnext-client-a'
const polygonFieldName='Talhão Polygon vNext'
const multipolygonFieldName='Talhão MultiPolygon vNext'
const invalidFieldName='Talhão Inválido vNext'
const geometryExternalId='vnext-postgres:geometry:valid'
const invalidGeometryExternalId='vnext-postgres:geometry:invalid'

const database=createDatabase({databaseUrl:connectionString,databaseSsl:Boolean(databaseSsl(connectionString))})
const repository=tenantId=>new ValRepository({
  db:database,
  tenantId,
  readStore:()=>({}),
  saveStore:()=>{throw new Error('Fallback JSON não é permitido no gate PostgreSQL vNext.')}
})

const scanSource=(attachment,patch={})=>({
  attachmentId:attachment.id,
  association:attachment.association,
  organizationId:attachment.organizationId,
  clientId:attachment.clientId||'',
  createdAt:attachment.createdAt,
  sha256:attachment.sha256,
  ...patch
})

function scanEvent({attachment,externalId,analysisType,resultReference,property=null,field=null}){
  const linked=attachment.association==='LINKED_CLIENT'
  return normalizeIntegrationEvent({
    schemaVersion:1,
    type:'agronomic.scan.completed',
    source:'manual-do-agronomo',
    externalId,
    occurredAt:'2026-08-27T12:30:00.000Z',
    clientExternalKey:linked?clientExternalKey:'',
    propertyExternalKey:property?.external_key||'',
    fieldExternalKey:field?.external_key||'',
    payload:{
      provenanceContractVersion:'AgronomicScanProvenance.v1',
      analysisType,
      resultReference,
      resultCreatedAt:'2026-08-27T12:29:00.000Z',
      context:{
        clientId:linked?clientExternalKey:'',
        propertyId:property?.external_key||'',
        fieldId:field?.external_key||''
      },
      sourceAttachments:[scanSource(attachment,{
        propertyId:property?.id||'',
        fieldId:field?.id||''
      })],
      result:{
        summary:analysisType==='NUTRISCAN'?'Triagem nutricional sintética para validação do gate.':'Triagem fitossanitária sintética para validação do gate.',
        imageQuality:'adequada',
        analyzedAt:'2026-08-27T12:28:00.000Z'
      },
      safety:{classification:'ASSISTED_TRIAGE_NOT_PRESCRIPTION'}
    }
  })
}

async function seedScopes(){
  await database.transaction(async connection=>{
    await connection.query(`INSERT INTO organizations (id,name,slug,status) VALUES
      ($1,'Gate vNext tenant A','gate-vnext-tenant-a','active'),
      ($2,'Gate vNext tenant B','gate-vnext-tenant-b','active')
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status='active',updated_at=NOW()`,[tenantA,tenantB])
    await connection.query(`INSERT INTO users (id,name,email,status,password_hash) VALUES
      ($1,'Consultor sintético vNext A','gate-vnext-a@example.invalid','active','gate-only'),
      ($2,'Consultor sintético vNext B','gate-vnext-b@example.invalid','active','gate-only')
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status='active',updated_at=NOW()`,[ownerA,ownerB])
    await connection.query(`INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope) VALUES
      ($1,$2,'consultant','{}'::jsonb),($3,$4,'consultant','{}'::jsonb)
      ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role`,[tenantA,ownerA,tenantB,ownerB])
  })
}

async function createSourceRecords(){
  await seedScopes()
  const repositoryA=repository(tenantA)
  const geometryEvent=normalizeIntegrationEvent({
    schemaVersion:1,
    type:'manual.producer.updated',
    source:'manual-do-agronomo',
    externalId:geometryExternalId,
    occurredAt:'2026-08-27T12:00:00.000Z',
    clientExternalKey,
    payload:{producer:{
      id:'producer-vnext-a',
      name:'Produtor sintético vNext A',
      city:'Sorriso',
      properties:'Fazenda Sintética vNext',
      fields:[
        {
          id:'field-polygon-vnext',name:polygonFieldName,crop:'Soja',season:'2026/27',geometryAction:'UPSERT',
          points:[
            {lat:-12,lng:-55},{lat:-12,lng:-54.999},{lat:-12.001,lng:-54.999},{lat:-12.001,lng:-55}
          ],
          geometryProvenance:{method:'physical-gate-fixture',details:{fixture:'polygon'}}
        },
        {
          id:'field-multipolygon-vnext',name:multipolygonFieldName,crop:'Milho',season:'2026/27',geometryAction:'UPSERT',
          geometry:{type:'MultiPolygon',coordinates:[
            [[[-55.01,-12.01],[-55.0095,-12.01],[-55.0095,-12.0105],[-55.01,-12.0105]]],
            [[[-55.02,-12.02],[-55.0195,-12.02],[-55.0195,-12.0205],[-55.02,-12.0205]]]
          ]},
          geometryProvenance:{method:'physical-gate-fixture',details:{fixture:'multipolygon'}}
        }
      ]
    }}
  })
  const geometryIngested=await repositoryA.ingestEvent({tenantId:tenantA,ownerId:ownerA,event:geometryEvent,signals:[]})
  assert.equal(geometryIngested.duplicate,false)

  const geometryRows=await database.query(`SELECT
    c.id client_id,c.external_key client_external_key,p.id property_id,p.external_key property_external_key,
    f.id,f.external_key,f.name,f.area_ha,f.geometry_ref,f.geometry_version
    FROM clients c JOIN properties p ON p.tenant_id=c.tenant_id AND p.client_id=c.id
    JOIN fields f ON f.tenant_id=p.tenant_id AND f.property_id=p.id
    WHERE c.tenant_id=$1 AND c.consultant_id=$2 AND c.external_key=$3
      AND f.name=ANY($4::text[]) ORDER BY f.name`,[tenantA,ownerA,clientExternalKey,[polygonFieldName,multipolygonFieldName]])
  assert.equal(geometryRows.rowCount,2)
  const polygon=geometryRows.rows.find(row=>row.name===polygonFieldName)
  const multipolygon=geometryRows.rows.find(row=>row.name===multipolygonFieldName)
  assert.ok(polygon)
  assert.ok(multipolygon)
  const property={id:polygon.property_id,external_key:polygon.property_external_key}

  const invalidEvent=normalizeIntegrationEvent({
    schemaVersion:1,
    type:'manual.producer.updated',
    source:'manual-do-agronomo',
    externalId:invalidGeometryExternalId,
    occurredAt:'2026-08-27T12:05:00.000Z',
    clientExternalKey,
    payload:{producer:{
      id:'producer-vnext-a',name:'Produtor sintético vNext A',properties:'Fazenda Sintética vNext',
      fields:[{id:'field-invalid-vnext',name:invalidFieldName,geometryAction:'UPSERT',points:[
        {lat:-12,lng:-55},{lat:95,lng:-54.9},{lat:-12.1,lng:-54.9}
      ]}]
    }}
  })
  await assert.rejects(
    repositoryA.ingestEvent({tenantId:tenantA,ownerId:ownerA,event:invalidEvent,signals:[]}),
    error=>error?.statusCode===422&&error?.code==='geometry_coordinate_out_of_range'
  )
  assert.equal((await database.query('SELECT 1 FROM integration_events WHERE tenant_id=$1 AND external_id=$2',[tenantA,invalidGeometryExternalId])).rowCount,0)
  assert.equal((await database.query('SELECT 1 FROM fields WHERE tenant_id=$1 AND name=$2',[tenantA,invalidFieldName])).rowCount,0)

  const linked=await repositoryA.createAttachment({
    tenantId:tenantA,ownerId:ownerA,clientId:clientExternalKey,association:'LINKED_CLIENT',
    originalName:'folha-vnext.jpg',mimeType:'image/jpeg',sizeBytes:8,dataBase64:'dm5leHQtYQ==',deduplicate:false
  })
  const unlinked=await repositoryA.createAttachment({
    tenantId:tenantA,ownerId:ownerA,association:'UNLINKED',
    originalName:'sem-vinculo-vnext.jpg',mimeType:'image/jpeg',sizeBytes:8,dataBase64:'dm5leHQtYg==',deduplicate:false
  })
  await repositoryA.ingestEvent({
    tenantId:tenantA,ownerId:ownerA,signals:[],
    event:scanEvent({attachment:linked,externalId:'vnext-postgres:scan:nutriscan',analysisType:'NUTRISCAN',resultReference:'vnext-result:nutriscan:1',property,field:polygon})
  })
  await repositoryA.ingestEvent({
    tenantId:tenantA,ownerId:ownerA,signals:[],
    event:scanEvent({attachment:unlinked,externalId:'vnext-postgres:scan:fitoscan-unlinked',analysisType:'FITOSCAN',resultReference:'vnext-result:fitoscan:1'})
  })

  const foreignEvent=scanEvent({attachment:linked,externalId:'vnext-postgres:scan:foreign-owner',analysisType:'NUTRISCAN',resultReference:'vnext-result:foreign:1',property,field:polygon})
  await assert.rejects(
    repositoryA.ingestEvent({tenantId:tenantA,ownerId:ownerB,event:foreignEvent,signals:[]}),
    error=>error?.statusCode===404&&error?.code==='scan_attachment_scope_invalid'
  )
  assert.equal((await database.query('SELECT 1 FROM integration_events WHERE tenant_id=$1 AND owner_user_id=$2 AND external_id=$3',[tenantA,ownerB,foreignEvent.externalId])).rowCount,0)

  return {
    clientId:String(polygon.client_id),
    propertyId:String(polygon.property_id),
    fieldIds:{polygon:String(polygon.id),multipolygon:String(multipolygon.id)},
    attachmentIds:{linked:linked.id,unlinked:unlinked.id}
  }
}

async function loadSourceReferences(){
  const path=String(process.env.VNEXT_SOURCE_EVIDENCE_FILE||'').trim()
  if(!path)throw new Error('VNEXT_SOURCE_EVIDENCE_FILE é obrigatório nos modos repeat/restore.')
  const evidence=JSON.parse(await readFile(path,'utf8'))
  assert.equal(evidence.schema,'val.vnext.postgres-gate.v1')
  return evidence.references
}

async function validatePersisted(references){
  const databaseName=String((await database.query('SELECT current_database() name')).rows[0].name)
  assert.equal(databaseName,target.name)
  const version=String((await database.query('SHOW server_version')).rows[0].server_version)
  assert.match(version,/^16\./)

  const nullable=await database.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='val_attachments' AND column_name='client_id'")
  assert.equal(nullable.rows[0]?.is_nullable,'YES')
  const unlinkedIndex=await database.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='val_attachments' AND indexname='idx_val_attachments_unlinked_date'")
  assert.equal(unlinkedIndex.rowCount,1)
  assert.match(String(unlinkedIndex.rows[0].indexdef),/WHERE \(client_id IS NULL\)/i)
  const migration=await database.query("SELECT checksum FROM schema_migrations WHERE version='20260827_007_attachment_scan_provenance_expand'")
  assert.equal(migration.rowCount,1)
  assert.match(String(migration.rows[0].checksum).trim(),/^[0-9a-f]{64}$/)

  const fieldRows=await database.query(`SELECT p.id property_id,p.client_id,f.id,f.name,f.area_ha,f.geometry_ref,f.geometry_version
    FROM fields f JOIN properties p ON p.tenant_id=f.tenant_id AND p.id=f.property_id
    WHERE f.tenant_id=$1 AND f.id=ANY($2::uuid[]) ORDER BY f.name`,[tenantA,Object.values(references.fieldIds)])
  assert.equal(fieldRows.rowCount,2)
  const geometryTypes={}
  for(const row of fieldRows.rows){
    assert.equal(String(row.property_id),references.propertyId)
    assert.equal(String(row.client_id),references.clientId)
    assert.ok(Number(row.area_ha)>0)
    const canonical=decodeCanonicalGeometryRef(row.geometry_ref,{expectedOrganizationId:tenantA})
    assert.equal(canonical.adapterVersion,'AgronomicGeometryAdapter.v1')
    assert.equal(canonical.geometryVersion,row.geometry_version)
    assert.equal(canonical.link.propertyId,references.propertyId)
    assert.equal(canonical.link.fieldId,String(row.id))
    geometryTypes[row.name]=canonical.geometry.type
    assert.throws(()=>decodeCanonicalGeometryRef(row.geometry_ref,{expectedOrganizationId:tenantB}),error=>error?.code==='cross_tenant_geometry_denied')
  }
  assert.equal(geometryTypes[polygonFieldName],'Polygon')
  assert.equal(geometryTypes[multipolygonFieldName],'MultiPolygon')
  assert.equal((await database.query('SELECT 1 FROM integration_events WHERE tenant_id=$1 AND external_id=$2',[tenantA,invalidGeometryExternalId])).rowCount,0)
  assert.equal((await database.query('SELECT 1 FROM fields WHERE tenant_id=$1 AND name=$2',[tenantA,invalidFieldName])).rowCount,0)

  const repositoryA=repository(tenantA)
  const repositoryB=repository(tenantB)
  const bootstrap=technicalBootstrapFromValClients(await repositoryA.getTechnicalBootstrap(ownerA),{organizationId:tenantA})
  const producer=bootstrap.producers.find(item=>item.id===clientExternalKey)
  assert.ok(producer)
  assert.equal(producer.fields.filter(item=>item.geometryStatus==='CANONICAL').length,2)
  assert.equal(bootstrap.geometryIssues.length,0)
  assert.equal((await repositoryB.getTechnicalBootstrap(ownerB)).some(item=>item.id===clientExternalKey),false)

  const linked=await repositoryA.getAttachment({tenantId:tenantA,ownerId:ownerA,id:references.attachmentIds.linked})
  const unlinked=await repositoryA.getAttachment({tenantId:tenantA,ownerId:ownerA,id:references.attachmentIds.unlinked})
  assert.ok(linked)
  assert.ok(unlinked)
  assert.equal(linked.clientId,clientExternalKey)
  assert.equal(linked.association,'LINKED_CLIENT')
  assert.equal(linked.analysis.latestScanResult.contract_version,'AgronomicScanProvenance.v1')
  assert.equal(linked.analysis.latestScanResult.attachment_id,linked.id)
  assert.equal(linked.analysis.latestScanResult.organization_id,tenantA)
  assert.equal(linked.analysis.latestScanResult.client_id,references.clientId)
  assert.equal(linked.analysis.latestScanResult.property_id,references.propertyId)
  assert.equal(linked.analysis.latestScanResult.field_id,references.fieldIds.polygon)
  assert.equal(linked.analysis.latestScanResult.analysis_type,'NUTRISCAN')
  assert.equal(linked.analysis.latestScanResult.result_reference,'vnext-result:nutriscan:1')
  assert.equal(unlinked.clientId,null)
  assert.equal(unlinked.association,'UNLINKED')
  assert.equal(unlinked.analysis.latestScanResult.attachment_id,unlinked.id)
  assert.equal(unlinked.analysis.latestScanResult.organization_id,tenantA)
  assert.equal(unlinked.analysis.latestScanResult.client_id,null)
  assert.equal(unlinked.analysis.latestScanResult.property_id,null)
  assert.equal(unlinked.analysis.latestScanResult.field_id,null)
  assert.equal(unlinked.analysis.latestScanResult.analysis_type,'FITOSCAN')
  assert.equal(unlinked.analysis.latestScanResult.result_reference,'vnext-result:fitoscan:1')
  assert.equal(await repositoryA.getAttachment({tenantId:tenantA,ownerId:ownerB,id:linked.id}),null)
  assert.equal(await repositoryB.getAttachment({tenantId:tenantB,ownerId:ownerB,id:linked.id}),null)

  const audit=await database.query("SELECT COUNT(*)::int count FROM audit_events WHERE tenant_id=$1 AND actor_id=$2 AND action='agronomic_scan_provenance_recorded'",[tenantA,ownerA])
  assert.equal(audit.rows[0].count,2)
  const attachmentCounts=await database.query(`SELECT
    COUNT(*) FILTER (WHERE client_id IS NULL)::int unlinked,
    COUNT(*) FILTER (WHERE client_id IS NOT NULL)::int linked
    FROM val_attachments WHERE tenant_id=$1 AND consultant_id=$2 AND id=ANY($3::uuid[])`,[tenantA,ownerA,Object.values(references.attachmentIds)])
  assert.deepEqual(attachmentCounts.rows[0],{unlinked:1,linked:1})

  return {
    database:databaseName,
    postgresVersion:version,
    migration:{version:'20260827_007_attachment_scan_provenance_expand',clientIdNullable:true,unlinkedIndex:true},
    geometry:{adapterVersion:'AgronomicGeometryAdapter.v1',polygon:'PASS',multipolygon:'PASS',invalidCoordinatesRollback:'PASS',roundTrip:'PASS',crossTenant:'PASS'},
    scanProvenance:{contractVersion:'AgronomicScanProvenance.v1',linkedNutriScan:'PASS',unlinkedFitoScan:'PASS',sourceAttachmentReference:'PASS',crossTenantAndOwner:'PASS',auditRows:audit.rows[0].count},
    tenantIsolation:'PASS'
  }
}

try{
  const references=mode==='source'?await createSourceRecords():await loadSourceReferences()
  const checks=await validatePersisted(references)
  const evidence={
    schema:'val.vnext.postgres-gate.v1',
    verifiedAt:new Date().toISOString(),
    mode,
    syntheticDataOnly:true,
    references,
    checks
  }
  const output=String(process.env.VNEXT_EVIDENCE_FILE||'').trim()
  if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2))}
  console.log(JSON.stringify(evidence,null,2))
}finally{
  await database.close()
}
