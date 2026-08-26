import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ValRepository} from '../server/repository.js'

const root=join(fileURLToPath(new URL('.',import.meta.url)),'..')
const read=path=>readFileSync(join(root,path),'utf8')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='00000000-0000-4000-8000-000000000010'
const scopedFieldKey=(propertyKey,fieldIdentity)=>{
  const normalized=String(fieldIdentity).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,180)
  const shortHash=value=>createHash('sha256').update(value).digest('hex').slice(0,20)
  return `manual-field:${shortHash(propertyKey)}:${shortHash(normalized)}:${normalized}`.slice(0,180)
}

test('Manual trata vínculo de solo como transição explícita e preserva a identidade lógica',()=>{
  const page=read('manual/app/page.tsx')
  for(const state of ['UNLINKED','LINKED_TO_CLIENT','LINKED_TO_PROPERTY','LINKED_TO_FIELD'])assert.match(page,new RegExp(`"${state}"`))
  assert.match(page,/linkVersion: number/)
  assert.match(page,/linkHistory: SoilLinkHistoryEntry\[\]/)
  assert.match(page,/linkProvenance: SoilLinkProvenance/)
  assert.match(page,/Vincular análise/)
  assert.match(page,/Alterar vínculo/)
  assert.match(page,/Desvincular/)
  assert.match(page,/id: analysis\.recordId/)
  assert.match(page,/disabled=\{recognizedCount === 0 \|\| hasPendingLinkChange\}/)
  assert.doesNotMatch(page,/setSoilAnalyses\(\(current\) => \[\s*\{[^}]*values:\s*\{\}/)
})

test('produtor órfão preserva o vínculo até uma ação explícita do usuário',()=>{
  const page=read('manual/app/page.tsx')
  assert.doesNotMatch(page,/preserveOrphanSoilAnalysis/)
  assert.doesNotMatch(page,/workspace-reconciliation/)
  assert.doesNotMatch(page,/TARGET_NOT_FOUND/)
  assert.match(page,/function unlinkAnalysis\(\)/)
  assert.match(page,/onClick=\{unlinkAnalysis\}/)
})

test('publicação separa evento versionado da chave central estável e inclui análises desvinculadas',()=>{
  const integration=read('manual/app/lib/valor360.ts')
  assert.match(integration,/analysisExternalId = `manual-soil:\$\{text\(ownerUserId, 36\) \|\| "workspace"\}:\$\{logicalId\}`/)
  assert.match(integration,/externalId: `manual-soil-event:[^`]+:v\$\{linkVersion\}:\$\{fingerprint\(specializedPayload\)\}`/)
  assert.match(integration,/clientExternalKey: linkedClientKey/)
  assert.match(integration,/const soilQueue = soilAnalyses\.slice\(0, 2500\)/)
  assert.match(integration,/specializedRecordEvent\(record, ownerUserId\)/)
  assert.match(integration,/if \(text\(item\.linkState, 40\)\.toUpperCase\(\) === "UNLINKED"\) return false/)
  assert.match(integration,/!text\(item\.property\)[\s\S]*property: text\(producer\.properties\)/)
  assert.match(integration,/linkState === "LINKED_TO_FIELD" \? "Propriedade principal"/)
  assert.match(integration,/propertyScopedFieldKey\(linkedPropertyKey, payload\.fieldId \|\| payload\.fieldName\)/)
  assert.match(integration,/propertyName: text\(linkedPropertyValue, 180\)/)
  assert.match(integration,/fieldName: text\(linkedField\?\.name\)/)
})

test('identidade do produtor permanece estável quando o nome muda',()=>{
  const integration=read('manual/app/lib/valor360.ts')
  const page=read('manual/app/page.tsx')
  const clientKeyBlock=integration.match(/function clientKeyFor[\s\S]*?\n\}/)?.[0]||''
  assert.ok(clientKeyBlock.indexOf('producer.id')>=0)
  assert.ok(clientKeyBlock.indexOf('producer.id')<clientKeyBlock.indexOf('producerName(producer)'))
  assert.ok(clientKeyBlock.indexOf('producer.crmCode')<clientKeyBlock.indexOf('producerName(producer)'))
  const recordKeyBlock=integration.match(/function recordProducerKey[\s\S]*?\n\}/)?.[0]||''
  assert.ok(recordKeyBlock.indexOf('payload.producerId')<recordKeyBlock.indexOf('record.producerName'))
  assert.match(integration,/valor360ExternalKey: clientKeyFor\(producer\)/)
  assert.match(integration,/const identity = producerIdentityFor\(producer, clientExternalKey\)/)
  assert.match(integration,/allowLegacyKeyMigration: !explicitExternalKey/)
  assert.match(page,/valor360LegacyExternalKeys: legacyExternalKeys/)
})

test('cutover da chave estável migra o cliente legado dentro da mesma carteira sem perder seu id',async()=>{
  const calls=[];const legacyClientId='00000000-0000-4000-8000-000000000020'
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-cutover'}]}
    if(sql.startsWith('SELECT DISTINCT client_external_key'))return {rowCount:1,rows:[{client_external_key:'antonio-carlos-costa-beber'}]}
    if(sql.startsWith('SELECT id,external_key,name,commercial_profile FROM clients'))return {rowCount:1,rows:[{id:legacyClientId,external_key:'antonio-carlos-costa-beber',name:'Antonio Carlos Costa Beber',commercial_profile:{property:'Fazenda Legado'}}]}
    if(sql.startsWith('UPDATE clients SET external_key'))return {rowCount:1,rows:[{id:legacyClientId,external_key:'crm-00042'}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:legacyClientId}]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  await repository.ingestEvent({tenantId,ownerId,signals:[],event:{
    type:'manual.producer.updated',schemaVersion:1,source:'manual-do-agronomo',externalId:'producer-cutover',occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:'cutover-hash',clientExternalKey:'crm-00042',
    payload:{producer:{id:'producer-stable-42',name:'Antônio C. Costa Beber'},identity:{producerId:'producer-stable-42',allowLegacyKeyMigration:true,legacyExternalKeys:['antonio-carlos-costa-beber']}},
  }})
  const candidate=calls.find(call=>call.sql.startsWith('SELECT id,external_key,name,commercial_profile FROM clients'))
  const migration=calls.find(call=>call.sql.startsWith('UPDATE clients SET external_key'))
  const upsert=calls.find(call=>call.sql.includes('INSERT INTO clients'))
  assert.match(candidate.sql,/account\.tenant_id=\$1 AND account\.consultant_id=\$2/)
  assert.deepEqual(candidate.params.slice(0,3),[tenantId,ownerId,'crm-00042'])
  assert.deepEqual(migration.params.slice(0,4),[tenantId,ownerId,legacyClientId,'crm-00042'])
  assert.equal(JSON.parse(migration.params[4]).property,'Fazenda Legado')
  assert.ok(JSON.parse(migration.params[4]).manual_identity.external_key_aliases.includes('antonio-carlos-costa-beber'))
  assert.equal(upsert.params[2],'crm-00042')
  assert.ok(calls.some(call=>call.sql.includes("'manual_client_external_key_migrated'")&&call.params[2]===legacyClientId))
})

test('cutover de produtor falha fechado quando o nome/alias identifica mais de um cliente da carteira',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-ambiguous'}]}
    if(sql.startsWith('SELECT DISTINCT client_external_key'))return {rowCount:0,rows:[]}
    if(sql.startsWith('SELECT id,external_key,name,commercial_profile FROM clients'))return {rowCount:2,rows:[
      {id:'client-a',external_key:'joao-silva',name:'João Silva',commercial_profile:{}},
      {id:'client-b',external_key:'joao-silva-2',name:'João Silva',commercial_profile:{}},
    ]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  await assert.rejects(repository.ingestEvent({tenantId,ownerId,signals:[],event:{
    type:'manual.producer.updated',schemaVersion:1,source:'manual-do-agronomo',externalId:'producer-ambiguous',occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:'ambiguous-hash',clientExternalKey:'producer-stable-new',
    payload:{producer:{id:'producer-stable-new',name:'João Silva'},identity:{producerId:'producer-stable-new',allowLegacyKeyMigration:true,legacyExternalKeys:['joao-silva']}},
  }}),error=>error?.statusCode===409&&error?.code==='manual_client_identity_ambiguous')
  assert.equal(calls.some(call=>call.sql.startsWith('UPDATE clients SET external_key')),false)
  assert.equal(calls.some(call=>call.sql.includes('INSERT INTO clients')),false)
})

test('Manual expõe falha parcial da integração sem alegar sincronização concluída',()=>{
  const workspaceRoute=read('manual/app/api/workspace/route.ts')
  const recordsRoute=read('manual/app/api/records/route.ts')
  const syncRoute=read('manual/app/api/integrations/valor360/sync/route.ts')
  const records=read('manual/app/records.ts')
  const page=read('manual/app/page.tsx')
  const styles=read('manual/app/globals.css')
  assert.match(workspaceRoute,/!integration\.configured/)
  assert.match(workspaceRoute,/integration\.skipped > 0/)
  assert.match(workspaceRoute,/status: integrationNeedsAttention \? 207 : 200/)
  assert.match(recordsRoute,/integrationSummary\.skipped > 0/)
  assert.match(recordsRoute,/status: integrationNeedsAttention \? 207 : 200/)
  assert.match(syncRoute,/synchronized: !partial/)
  assert.match(syncRoute,/recordSummary\.skipped > 0/)
  assert.match(syncRoute,/status: partial \? 207 : 200/)
  assert.match(records,/SERVER_SYNC_VERSION = "valor360-v2"/)
  assert.match(records,/result\.integration\?\.configured === false/)
  assert.match(records,/Number\(result\.integration\?\.failed \?\? 0\) > 0/)
  assert.match(records,/Number\(result\.integration\?\.skipped \?\? 0\) > 0/)
  assert.match(page,/"attention"/)
  assert.match(page,/Backup salvo; integração VAL requer atenção/)
  assert.match(page,/result\.integration\?\.configured === false/)
  assert.match(page,/result\.integration\?\.skipped/)
  assert.match(page,/result\.integration\?\.truncated === true/)
  assert.match(styles,/\.cloud-sync-badge\.attention/)
})

test('evento de produtor cria propriedade e talhões com as mesmas chaves usadas pelo vínculo de solo',async()=>{
  const calls=[]
  const clientId='00000000-0000-4000-8000-000000000020'
  const propertyId='00000000-0000-4000-8000-000000000021'
  const fieldId='00000000-0000-4000-8000-000000000022'
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-producer'}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:clientId}]}
    if(sql.includes('INSERT INTO properties'))return {rowCount:1,rows:[{id:propertyId}]}
    if(sql.includes('INSERT INTO fields'))return {rowCount:1,rows:[{id:fieldId}]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  await repository.ingestEvent({
    tenantId,ownerId,signals:[],
    event:{
      type:'manual.producer.updated',schemaVersion:1,source:'manual-do-agronomo',externalId:'producer-sync-1',
      occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:'producer-hash',clientExternalKey:'antonio-costa',
      payload:{producer:{name:'Antônio Costa',city:'Sorriso',properties:'Fazenda São José',area:320,fields:[{id:'talhao-01',name:'Talhão 01',area:80,crop:'Soja',season:'2026/27'}]}},
    },
  })

  const clientUpsert=calls.find(call=>call.sql.includes('INSERT INTO clients'))
  const propertyUpsert=calls.find(call=>call.sql.includes('INSERT INTO properties'))
  const fieldUpsert=calls.find(call=>call.sql.includes('INSERT INTO fields'))
  const cropSeason=calls.find(call=>call.sql.includes('INSERT INTO crop_seasons'))
  assert.ok(clientUpsert&&propertyUpsert&&fieldUpsert&&cropSeason)
  assert.deepEqual(propertyUpsert.params.slice(0,4),[tenantId,clientId,'antonio-costa:fazenda-sao-jose','Fazenda São José'])
  assert.deepEqual(fieldUpsert.params.slice(0,4),[tenantId,propertyId,scopedFieldKey('antonio-costa:fazenda-sao-jose','talhao-01'),'Talhão 01'])
  assert.deepEqual(cropSeason.params.slice(0,4),[tenantId,fieldId,'2026/27','Soja'])
  assert.match(propertyUpsert.sql,/ON CONFLICT \(tenant_id,client_id,external_key\) WHERE external_key IS NOT NULL/)
  assert.match(fieldUpsert.sql,/ON CONFLICT \(tenant_id,property_id,external_key\) WHERE external_key IS NOT NULL/)
})

test('writer reutiliza chave legacy somente dentro da propriedade correta sem duplicar o talhão',async()=>{
  const calls=[]
  const clientId='00000000-0000-4000-8000-000000000020'
  const propertyId='00000000-0000-4000-8000-000000000021'
  const legacyFieldId='00000000-0000-4000-8000-000000000022'
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-legacy'}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:clientId}]}
    if(sql.includes('INSERT INTO properties'))return {rowCount:1,rows:[{id:propertyId}]}
    if(sql.startsWith('SELECT id,external_key FROM fields'))return {rowCount:1,rows:[{id:legacyFieldId,external_key:'produtor-1:talhao-01'}]}
    if(sql.startsWith('UPDATE fields'))return {rowCount:1,rows:[{id:legacyFieldId}]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  await repository.ingestEvent({tenantId,ownerId,signals:[],event:{
    type:'manual.producer.updated',schemaVersion:1,source:'manual-do-agronomo',externalId:'producer-legacy-field',occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:'legacy-hash',clientExternalKey:'produtor-1',
    payload:{producer:{name:'Produtor 1',properties:'Fazenda 1',fields:[{id:'talhao-01',name:'Talhão renomeado'}]}},
  }})
  const compatibilityLookup=calls.find(call=>call.sql.startsWith('SELECT id,external_key FROM fields'))
  assert.deepEqual(compatibilityLookup.params,[tenantId,propertyId,scopedFieldKey('produtor-1:fazenda-1','talhao-01'),'produtor-1:talhao-01'])
  assert.ok(calls.some(call=>call.sql.startsWith('UPDATE fields')&&call.params[2]===legacyFieldId))
  assert.equal(calls.some(call=>call.sql.includes('INSERT INTO fields')),false)
})

test('writer materializa propriedade livre e resolve o mesmo fieldId dentro da propriedade após renome',async()=>{
  const calls=[]
  const clientId='00000000-0000-4000-8000-000000000020'
  const propertyIds=new Map([
    ['produtor-1:fazenda-antiga','00000000-0000-4000-8000-000000000021'],
    ['produtor-1:fazenda-renomeada','00000000-0000-4000-8000-000000000024'],
  ])
  const fieldIds=new Map()
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:`event-${calls.length}`}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:clientId}]}
    if(sql.includes('INSERT INTO properties'))return {rowCount:1,rows:[{id:propertyIds.get(params[2])}]}
    if(sql.includes('INSERT INTO fields')){
      const fieldId=`field-${params[1]}`;fieldIds.set(`${params[1]}:${params[2]}`,fieldId)
      return {rowCount:1,rows:[{id:fieldId}]}
    }
    if(sql.startsWith('SELECT property.id')){
      const propertyId=propertyIds.get(params[2]);return {rowCount:propertyId?1:0,rows:propertyId?[{id:propertyId,client_id:clientId}]:[]}
    }
    if(sql.startsWith('SELECT field.id')){
      const fieldId=fieldIds.get(`${params[3]}:${params[2]}`);return {rowCount:fieldId?1:0,rows:fieldId?[{id:fieldId,property_id:params[3],client_id:clientId}]:[]}
    }
    if(sql.includes('INSERT INTO soil_analyses'))return {rowCount:1,rows:[{id:'analysis-row'}]}
    if(sql.startsWith('UPDATE soil_measurements'))return {rowCount:0,rows:[]}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  const fieldIdentity='campo-estavel-01'
  const send=async({propertyName,version})=>{
    const propertyExternalKey=`produtor-1:${propertyName==='Fazenda Antiga'?'fazenda-antiga':'fazenda-renomeada'}`
    return repository.ingestEvent({tenantId,ownerId,signals:[],event:{
      type:'soil_analysis.completed',schemaVersion:1,source:'manual-do-agronomo',externalId:`soil-free-property-v${version}`,
      occurredAt:`2026-08-${20+version}T12:00:00.000Z`,payloadHash:`hash-free-${version}`,
      clientExternalKey:'produtor-1',propertyExternalKey,fieldExternalKey:scopedFieldKey(propertyExternalKey,fieldIdentity),
      payload:{analysisExternalId:`manual-soil:${ownerId}:free-property`,propertyName,fieldId:fieldIdentity,fieldName:'Talhão Norte',linkState:'LINKED_TO_FIELD',linkVersion:version,measurements:[]},
    }})
  }
  await send({propertyName:'Fazenda Antiga',version:1})
  await send({propertyName:'Fazenda Renomeada',version:2})

  const propertyWrites=calls.filter(call=>call.sql.includes('INSERT INTO properties'))
  assert.deepEqual(propertyWrites.map(call=>call.params.slice(2,4)),[
    ['produtor-1:fazenda-antiga','Fazenda Antiga'],
    ['produtor-1:fazenda-renomeada','Fazenda Renomeada'],
  ])
  const fieldWrites=calls.filter(call=>call.sql.includes('INSERT INTO fields'))
  assert.equal(fieldWrites.length,2)
  assert.notEqual(fieldWrites[0].params[2],fieldWrites[1].params[2])
  assert.equal(fieldWrites[0].params[2],scopedFieldKey('produtor-1:fazenda-antiga',fieldIdentity))
  assert.equal(fieldWrites[1].params[2],scopedFieldKey('produtor-1:fazenda-renomeada',fieldIdentity))
  const fieldReads=calls.filter(call=>call.sql.startsWith('SELECT field.id'))
  assert.deepEqual(fieldReads.map(call=>call.params[3]),[...propertyIds.values()])
  assert.ok(fieldReads.every(call=>/field\.property_id=COALESCE\(\$4::uuid,field\.property_id\)/.test(call.sql)))
  assert.ok(fieldReads.every(call=>call.params[4]==='produtor-1:campo-estavel-01'))
  assert.deepEqual(fieldReads.map(call=>call.params[5]),[
    scopedFieldKey('produtor-1:fazenda-antiga',fieldIdentity),
    scopedFieldKey('produtor-1:fazenda-renomeada',fieldIdentity),
  ])
})

test('migration conserva versões substituídas e o snapshot carrega só medições correntes',()=>{
  const migration=read('database/migrations/20260825_006_soil_measurement_sets_expand.sql')
  const schema=read('database/schema.sql')
  const repository=read('server/repository.js')
  for(const column of ['link_version','source_event_id','superseded_at']){
    assert.match(migration,new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
    assert.match(schema,new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`))
  }
  assert.match(migration,/idx_soil_measurements_current_logical/)
  assert.doesNotMatch(schema,/idx_soil_measurements_current_logical/)
  assert.doesNotMatch(schema,/ranked_soil_measurements/)
  assert.match(migration,/WHERE superseded_at IS NULL/)
  assert.match(migration,/soil_measurements_source_event_fkey/)
  assert.match(schema,/soil_measurements_source_event_fkey/)
  assert.doesNotMatch(schema,/SET link_version=CASE/)
  assert.match(migration,/measurement\.source_event_id IS NULL\s+AND measurement\.superseded_at IS NULL/)
  assert.match(migration,/MAX\(integration\.occurred_at\)/)
  assert.match(migration,/integration\.payload->>'analysisExternalId'=analysis\.external_id/)
  assert.match(migration,/integration\.tenant_id=analysis\.tenant_id/)
  assert.match(migration,/analysis\.external_id LIKE 'manual-soil:'\|\|integration\.owner_user_id::TEXT/)
  assert.match(migration,/GREATEST\(analysis\.created_at,latest\.occurred_at\)/)
  assert.match(migration,/SET accepted_event_occurred_at=created_at\s+WHERE accepted_event_occurred_at IS NULL/)
  assert.match(migration,/\^\[0-9\]\{1,64\}\$/)
  assert.match(migration,/LEAST\(\(analysis\.validation_evidence->'linkage'->>'version'\)::NUMERIC,1000000000\)::BIGINT/)
  assert.doesNotMatch(migration,/DELETE FROM soil_measurements/)
  assert.match(repository,/FROM soil_measurements WHERE tenant_id=\$1 AND analysis_id=soil\.id AND superseded_at IS NULL/)
  assert.match(repository,/'soil_measurement_set_replaced'/)
})

test('nova linkVersion substitui pH 5,5 por 5,8 como conjunto corrente e preserva histórico auditável',async()=>{
  const calls=[]
  const currentMeasurements=[]
  const measurementHistory=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:`event-${calls.length}`}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000020'}]}
    if(sql.startsWith('SELECT property.id'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000021',client_id:'00000000-0000-4000-8000-000000000020'}]}
    if(sql.startsWith('SELECT field.id'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000022',property_id:'00000000-0000-4000-8000-000000000021',client_id:'00000000-0000-4000-8000-000000000020'}]}
    if(sql.includes('INSERT INTO soil_analyses'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000023'}]}
    if(sql.startsWith('UPDATE soil_measurements')){
      const replaced=currentMeasurements.splice(0)
      measurementHistory.push(...replaced)
      return {rowCount:replaced.length,rows:replaced}
    }
    if(sql.includes('INSERT INTO soil_measurements')){
      currentMeasurements.push({rawValue:params[4],linkVersion:params[11],sourceEventId:params[12]})
      return {rowCount:1,rows:[]}
    }
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({
    db:{configured:true,transaction:work=>work({query})},
    tenantId,
    readStore:()=>({}),
    saveStore:()=>{},
  })
  const base={
    type:'soil_analysis.completed',schemaVersion:1,source:'manual-do-agronomo',
    occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:'hash-v2',
    clientExternalKey:'produtor-1',propertyExternalKey:'produtor-1:fazenda',fieldExternalKey:'produtor-1:talhao-1',
    payload:{
      analysisId:'analysis-logical-1',analysisExternalId:`manual-soil:${ownerId}:analysis-logical-1`,
      linkState:'LINKED_TO_FIELD',linkVersion:2,linkHistory:[{version:2,action:'LINK'}],
      linkProvenance:{source:'manual-do-agronomo'},validation:{status:'pending'},
      measurements:[{sampleKey:'A1',analyte:'ph',rawValue:'5,5',method:'CaCl2'}],
    },
  }
  await repository.ingestEvent({tenantId,ownerId,event:{...base,externalId:'soil-event-v2'},signals:[]})
  await repository.ingestEvent({
    tenantId,ownerId,
    event:{
      ...base,externalId:'soil-event-v3',payloadHash:'hash-v3',
      payload:{...base.payload,linkState:'UNLINKED',linkVersion:3,linkHistory:[...base.payload.linkHistory,{version:3,action:'UNLINK'}],measurements:[{sampleKey:'A1',analyte:'ph',rawValue:'5,8',method:'CaCl2'}]},
    },
    signals:[],
  })

  const analyses=calls.filter(call=>call.sql.includes('INSERT INTO soil_analyses'))
  assert.equal(analyses.length,2)
  assert.equal(analyses[0].params[8],analyses[1].params[8])
  assert.equal(analyses[0].params[8],`manual-soil:${ownerId}:analysis-logical-1`)
  assert.deepEqual(analyses[0].params.slice(1,7),[
    '00000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022',
    'produtor-1','produtor-1:fazenda','produtor-1:talhao-1',
  ])
  assert.deepEqual(analyses[1].params.slice(1,7),[null,null,null,null,null,null])
  assert.equal(JSON.parse(analyses[1].params[15]).linkage.state,'UNLINKED')
  assert.equal(JSON.parse(analyses[1].params[15]).linkage.version,3)
  assert.match(analyses[1].sql,/client_external_key=EXCLUDED\.client_external_key/)
  assert.match(analyses[1].sql,/validation_evidence->'linkage'->>'version'/)

  const measurements=calls.filter(call=>call.sql.includes('INSERT INTO soil_measurements'))
  assert.equal(measurements.length,2)
  assert.deepEqual(measurements.map(call=>call.params[4]),[5.5,5.8])
  assert.deepEqual(measurements.map(call=>call.params[11]),[2,3])
  assert.deepEqual(currentMeasurements,[{rawValue:5.8,linkVersion:3,sourceEventId:measurements[1].params[12]}])
  assert.deepEqual(measurementHistory,[{rawValue:5.5,linkVersion:2,sourceEventId:measurements[0].params[12]}])
  const replacements=calls.filter(call=>call.sql.startsWith('UPDATE soil_measurements'))
  assert.equal(replacements.length,2)
  assert.ok(replacements.every(call=>/superseded_at=NOW\(\)/.test(call.sql)))
  assert.ok(measurements.every(call=>!/DELETE FROM soil_measurements/.test(call.sql)))
  const audit=calls.filter(call=>call.sql.includes("'soil_measurement_set_replaced'"))
  assert.equal(audit.length,2)
  assert.deepEqual(JSON.parse(audit[1].params[4]),{activeCount:1,linkVersion:3,sourceEventId:measurements[1].params[12],occurredAt:'2026-08-25T12:00:00.000Z'})
})

const soilEvent=({state='LINKED_TO_FIELD',suffix='target'}={})=>({
  type:'soil_analysis.completed',schemaVersion:1,source:'manual-do-agronomo',externalId:`soil-${suffix}`,
  occurredAt:'2026-08-25T12:00:00.000Z',payloadHash:`hash-${suffix}`,
  clientExternalKey:state==='UNLINKED'?null:'produtor-1',
  propertyExternalKey:['LINKED_TO_PROPERTY','LINKED_TO_FIELD'].includes(state)?'fazenda-1':null,
  fieldExternalKey:state==='LINKED_TO_FIELD'?'talhao-1':null,
  payload:{analysisExternalId:`manual-soil:${ownerId}:${suffix}`,linkState:state,linkVersion:1,measurements:[]},
})

const soilTargetRepository=({clientRow=null,propertyRow=null,fieldRow=null,calls=[]})=>new ValRepository({
  db:{configured:true,transaction:work=>work({query:async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:`event-${calls.length}`}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:clientRow?1:0,rows:clientRow?[clientRow]:[]}
    if(sql.startsWith('SELECT property.id'))return {rowCount:propertyRow?1:0,rows:propertyRow?[propertyRow]:[]}
    if(sql.startsWith('SELECT field.id'))return {rowCount:fieldRow?1:0,rows:fieldRow?[fieldRow]:[]}
    if(sql.includes('INSERT INTO soil_analyses'))return {rowCount:1,rows:[{id:'analysis-row'}]}
    return {rowCount:1,rows:[]}
  }})},
  tenantId,readStore:()=>({}),saveStore:()=>{},
})

test('mesma versão rejeita duas medições contraditórias para amostra + analito antes de trocar o conjunto',async()=>{
  const calls=[]
  const clientRow={id:'client-a'}
  const propertyRow={id:'property-a',client_id:'client-a'}
  const fieldRow={id:'field-a',property_id:'property-a',client_id:'client-a'}
  const repository=soilTargetRepository({clientRow,propertyRow,fieldRow,calls})
  const event=soilEvent({suffix:'duplicate-measurement'})
  event.payload.measurements=[
    {sampleKey:'A1',analyte:'pH',rawValue:'5,5'},
    {sampleKey:'A1',analyte:' ph ',rawValue:'5,8'},
  ]
  await assert.rejects(
    repository.ingestEvent({tenantId,ownerId,event,signals:[]}),
    error=>error?.statusCode===422&&error?.code==='soil_measurement_set_conflict',
  )
  assert.equal(calls.some(call=>call.sql.startsWith('UPDATE soil_measurements')),false)
  assert.equal(calls.some(call=>call.sql.includes('INSERT INTO soil_measurements')),false)
})

test('analysisExternalId do Manual é isolado pelo owner autenticado',async()=>{
  const calls=[]
  const ownerB='00000000-0000-4000-8000-000000000011'
  const repository=soilTargetRepository({calls})
  await assert.rejects(
    repository.ingestEvent({tenantId,ownerId:ownerB,event:soilEvent({suffix:'owner-a-analysis'}),signals:[]}),
    error=>error?.statusCode===403&&error?.code==='soil_analysis_owner_scope_invalid',
  )
  assert.equal(calls.length,0)
})

test('ingestão rejeita vínculo de solo quando property/field não pertencem à cadeia client→property',async()=>{
  const clientA='00000000-0000-4000-8000-000000000020'
  const clientB='00000000-0000-4000-8000-000000000099'
  const propertyA='00000000-0000-4000-8000-000000000021'
  const propertyB='00000000-0000-4000-8000-000000000098'

  const crossClientCalls=[]
  const crossClient=soilTargetRepository({
    calls:crossClientCalls,clientRow:{id:clientA},propertyRow:{id:propertyA,client_id:clientB},
    fieldRow:{id:'field-b',property_id:propertyA,client_id:clientB},
  })
  await assert.rejects(
    crossClient.ingestEvent({tenantId,ownerId,event:soilEvent({suffix:'cross-client'}),signals:[]}),
    error=>error?.statusCode===422&&error?.code==='soil_link_target_invalid'&&/não pertence ao produtor/i.test(error.message),
  )
  assert.equal(crossClientCalls.some(call=>call.sql.includes('INSERT INTO soil_analyses')),false)
  assert.ok(crossClientCalls.filter(call=>/^SELECT (?:id FROM clients|property\.id|field\.id)/.test(call.sql)).every(call=>call.params[0]===tenantId&&call.params[1]===ownerId))

  const crossPropertyCalls=[]
  const crossProperty=soilTargetRepository({
    calls:crossPropertyCalls,clientRow:{id:clientA},propertyRow:{id:propertyA,client_id:clientA},
    fieldRow:{id:'field-b',property_id:propertyB,client_id:clientA},
  })
  await assert.rejects(
    crossProperty.ingestEvent({tenantId,ownerId,event:soilEvent({suffix:'cross-property'}),signals:[]}),
    error=>error?.statusCode===422&&error?.code==='soil_link_target_invalid'&&/não pertence à propriedade/i.test(error.message),
  )
  assert.equal(crossPropertyCalls.some(call=>call.sql.includes('INSERT INTO soil_analyses')),false)
})

test('todo estado LINKED rejeita 422 quando seu alvo obrigatório não existe',async()=>{
  const clientRow={id:'client-a'}
  const propertyRow={id:'property-a',client_id:'client-a'}
  const cases=[
    {state:'LINKED_TO_CLIENT',suffix:'missing-client',clientRow:null,propertyRow:null,fieldRow:null},
    {state:'LINKED_TO_PROPERTY',suffix:'missing-property',clientRow,propertyRow:null,fieldRow:null},
    {state:'LINKED_TO_FIELD',suffix:'missing-field',clientRow,propertyRow,fieldRow:null},
  ]
  for(const item of cases){
    const calls=[]
    const repository=soilTargetRepository({...item,calls})
    await assert.rejects(
      repository.ingestEvent({tenantId,ownerId,event:soilEvent(item),signals:[]}),
      error=>error?.statusCode===422&&error?.code==='soil_link_target_invalid',
      item.state,
    )
    assert.equal(calls.some(call=>call.sql.includes('INSERT INTO soil_analyses')),false,item.state)
  }
})

test('evento antigo da mesma linkVersion não regride metadados, flags, evidências, sinais ou medições',async()=>{
  const calls=[];const currentMeasurements=[];let analysisState=null;let measurementClock=null;let eventSequence=0
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:`stale-event-${++eventSequence}`}]}
    if(sql.includes('INSERT INTO soil_analyses')){
      const incoming={id:'analysis-stale',client_id:params[1],property_id:params[2],field_id:params[3],client_external_key:params[4],property_external_key:params[5],field_external_key:params[6],laboratory:params[9],method:params[10],depth_from_cm:params[11],depth_to_cm:params[12],sampled_at:params[13],validated_flags:JSON.parse(params[14]),validation_evidence:JSON.parse(params[15]),validated_at:params[16],accepted_event_occurred_at:params[17],accepted_event_source_event_id:params[18]}
      const incomingVersion=Number(params[19]);const currentVersion=Number(analysisState?.validation_evidence?.linkage?.version??-1)
      const accepted=!analysisState||incomingVersion>currentVersion||(incomingVersion===currentVersion&&Date.parse(incoming.accepted_event_occurred_at)>Date.parse(analysisState.accepted_event_occurred_at))
      if(!accepted)return {rowCount:0,rows:[]}
      analysisState=incoming;return {rowCount:1,rows:[{id:incoming.id}]}
    }
    if(sql.startsWith('SELECT id,client_id,property_id,field_id'))return {rowCount:analysisState?1:0,rows:analysisState?[analysisState]:[]}
    if(sql.startsWith('UPDATE soil_analyses SET measurement_set_occurred_at')){
      const accepted=!measurementClock||Date.parse(params[2])>Date.parse(measurementClock.occurredAt)||(params[2]===measurementClock.occurredAt&&Number(params[4])>measurementClock.linkVersion)
      if(!accepted)return {rowCount:0,rows:[]}
      measurementClock={occurredAt:params[2],sourceEventId:params[3],linkVersion:Number(params[4])};return {rowCount:1,rows:[measurementClock]}
    }
    if(sql.startsWith('UPDATE soil_measurements')){const rows=currentMeasurements.splice(0);return {rowCount:rows.length,rows}}
    if(sql.includes('INSERT INTO soil_measurements')){currentMeasurements.push({rawValue:params[4],method:params[8],linkVersion:params[11]});return {rowCount:1,rows:[]}}
    return {rowCount:1,rows:[]}
  }
  const repository=new ValRepository({db:{configured:true,transaction:work=>work({query})},tenantId,readStore:()=>({}),saveStore:()=>{}})
  const send=({externalId,occurredAt,laboratory,method,flag,evidence,value})=>repository.ingestEvent({tenantId,ownerId,signals:[{type:'soil_follow_up',severity:'attention',title:externalId,evidence:{},commercialHypothesis:'',requiresAgronomist:true,status:'new'}],event:{
    type:'soil_analysis.completed',schemaVersion:1,source:'manual-do-agronomo',externalId,occurredAt,payloadHash:`hash-${externalId}`,
    payload:{analysisExternalId:`manual-soil:${ownerId}:stale-guard`,linkState:'UNLINKED',linkVersion:4,laboratory,method,validatedFlags:[flag],validation:{status:'approved',reviewerId:'agronomo-1',reviewedAt:'2020-01-01T00:00:00.000Z',evidence},measurements:[{sampleKey:'A1',analyte:'pH',rawValue:value,method}]},
  }})
  await send({externalId:'soil-newer',occurredAt:'2026-08-25T13:00:00.000Z',laboratory:'Lab novo',method:'Método novo',flag:'FLAG_NOVA',evidence:'evidência nova',value:'5,8'})
  const staleResult=await send({externalId:'soil-older',occurredAt:'2026-08-25T12:00:00.000Z',laboratory:'Lab antigo',method:'Método antigo',flag:'FLAG_ANTIGA',evidence:'evidência antiga',value:'5,5'})

  assert.equal(staleResult.measurementSetStatus,'stale_ignored')
  assert.equal(staleResult.signals,0)
  assert.equal(analysisState.laboratory,'Lab novo')
  assert.equal(analysisState.method,'Método novo')
  assert.deepEqual(analysisState.validated_flags,['FLAG_NOVA'])
  assert.equal(analysisState.validation_evidence.evidence,'evidência nova')
  assert.equal(analysisState.accepted_event_occurred_at,'2026-08-25T13:00:00.000Z')
  assert.deepEqual(currentMeasurements,[{rawValue:5.8,method:'Método novo',linkVersion:4}])
  assert.equal(calls.filter(call=>call.sql.startsWith('UPDATE soil_measurements')).length,1)
  assert.equal(calls.filter(call=>call.sql.includes('INSERT INTO agronomic_signals')).length,1)
  const staleAudit=calls.find(call=>call.sql.includes("'soil_analysis_stale_ignored'"))
  assert.ok(staleAudit)
  assert.equal(JSON.parse(staleAudit.params[3]).laboratory,'Lab novo')
  assert.equal(JSON.parse(staleAudit.params[4]).laboratory,'Lab antigo')
})

test('mesma linkVersion só aceita atualização quando estado e alvo permanecem idênticos',async()=>{
  const calls=[]
  const clientId='client-a';const propertyId='property-a';const fieldId='field-a'
  const repository=new ValRepository({
    db:{configured:true,transaction:work=>work({query:async(sql,params=[])=>{
      calls.push({sql,params})
      if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-version-conflict'}]}
      if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:clientId}]}
      if(sql.startsWith('SELECT property.id'))return {rowCount:1,rows:[{id:propertyId,client_id:clientId}]}
      if(sql.startsWith('SELECT field.id'))return {rowCount:1,rows:[{id:fieldId,property_id:propertyId,client_id:clientId}]}
      if(sql.includes('INSERT INTO soil_analyses'))return {rowCount:0,rows:[]}
      return {rowCount:1,rows:[]}
    }})},tenantId,readStore:()=>({}),saveStore:()=>{},
  })
  await assert.rejects(
    repository.ingestEvent({tenantId,ownerId,event:soilEvent({suffix:'same-version-new-target'}),signals:[]}),
    error=>error?.statusCode===409&&error?.code==='soil_link_version_conflict',
  )
  const upsert=calls.find(call=>call.sql.includes('INSERT INTO soil_analyses'))
  assert.match(upsert.sql,/validation_evidence->'linkage'->>'version'.*< \$20/s)
  assert.match(upsert.sql,/\^\[0-9\]\{1,64\}\$/)
  assert.match(upsert.sql,/LEAST\(\(soil_analyses\.validation_evidence->'linkage'->>'version'\)::numeric,1000000000\)::bigint/)
  assert.match(upsert.sql,/soil_analyses\.client_id IS NOT DISTINCT FROM EXCLUDED\.client_id/)
  assert.match(upsert.sql,/soil_analyses\.property_id IS NOT DISTINCT FROM EXCLUDED\.property_id/)
  assert.match(upsert.sql,/soil_analyses\.field_id IS NOT DISTINCT FROM EXCLUDED\.field_id/)
  assert.match(upsert.sql,/linkage'->>'state'.*=COALESCE\(EXCLUDED\.validation_evidence/s)
  assert.match(upsert.sql,/accepted_event_occurred_at<EXCLUDED\.accepted_event_occurred_at/)
})

test('Manual embedded aceita navegação dirigida e remove apenas sua navegação própria',()=>{
  const page=read('manual/app/page.tsx')
  const styles=read('manual/app/globals.css')
  assert.match(page,/searchParams\.get\("page"\)/)
  assert.match(page,/event\.origin !== window\.location\.origin/)
  assert.match(page,/message\?\.type !== "valor360:navigate"/)
  assert.match(styles,/\.valor360-embedded \.sidebar,[\s\S]*\.valor360-embedded \.bottom-nav[\s\S]*display: none !important/)
  assert.match(styles,/\.valor360-embedded \.main \{[\s\S]*width: 100%;[\s\S]*margin-left: 0;/)
  assert.doesNotMatch(styles,/(^|\n)\.sidebar,[\s\S]{0,180}display: none !important/)
})
