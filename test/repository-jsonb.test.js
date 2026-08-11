import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository,jsonbParameter,parseCultivatedArea} from '../server/repository.js'

const repositoryWith=db=>new ValRepository({
  db,
  tenantId:'00000000-0000-4000-8000-000000000001',
  readStore:()=>({surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[]}}),
  saveStore:()=>{}
})

test('parâmetro JSONB serializa objetos e arrays vazios ou preenchidos como JSON válido',()=>{
  assert.equal(jsonbParameter([]),'[]')
  assert.equal(jsonbParameter({}),'{}')
  assert.deepEqual(JSON.parse(jsonbParameter(['signal-1',{source:'field'}])),['signal-1',{source:'field'}])
  assert.equal(jsonbParameter(undefined),null)
})

test('faixa de área permanece texto e hectare exato permanece número',()=>{
  assert.deepEqual(parseCultivatedArea('Acima de 1.000 hectares'),{totalAreaHa:null,areaBand:'Acima de 1.000 hectares'})
  assert.deepEqual(parseCultivatedArea('De 501 a 1.000 hectares'),{totalAreaHa:null,areaBand:'De 501 a 1.000 hectares'})
  assert.deepEqual(parseCultivatedArea('1.000 hectares'),{totalAreaHa:1000,areaBand:null})
})

test('perfil assistido envia answers, evidence e snapshot como strings JSONB',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO clients'))return {rowCount:1,rows:[{id:'client-db-id'}]}
    return {rowCount:1,rows:[]}
  }
  const db={configured:true,transaction:work=>work({query})}
  const repository=repositoryWith(db)
  await repository.saveSurveyProfile({
    answers:{7:'Segurança'},
    result:{id:'cliente-externo',name:'Cliente Canônico',decisionDriver:'Segurança',scores:{analitico:4},commercial:{priority:'Alta'}},
    source:'assisted_survey'
  })

  const clientCall=calls.find(call=>call.sql.includes('INSERT INTO clients'))
  const profileCall=calls.find(call=>call.sql.includes('INSERT INTO client_profiles'))
  assert.deepEqual(JSON.parse(clientCall.params[9]),{priority:'Alta'})
  assert.deepEqual(JSON.parse(profileCall.params[6]),{7:'Segurança'})
  assert.deepEqual(JSON.parse(profileCall.params[7]),[{source:'assisted_survey',self_reported:true}])
  assert.equal(JSON.parse(profileCall.params[8]).decisionDriver,'Segurança')
  assert.equal(JSON.parse(profileCall.params[8]).profileVersion,'producer-360-v1')
  assert.match(profileCall.params[9],/^assisted_survey:cliente-externo:[a-f0-9]{64}$/)
  assert.match(profileCall.sql,/ON CONFLICT \(tenant_id,client_id,source_key\)/)
  assert.match(profileCall.sql,/assessed_at=NOW\(\)/)
  assert.ok(calls.find(call=>call.sql.includes('pg_advisory_xact_lock')))
})

test('perfil 360 mantém Q27 no snapshot e não sobrescreve oportunidade comercial canônica',async()=>{
  const run=async currentCommercial=>{
    const calls=[]
    const query=async(sql,params=[])=>{
      calls.push({sql,params})
      if(sql.startsWith('SELECT c.commercial_profile'))return {rowCount:1,rows:[{commercial_profile:currentCommercial,profile_snapshot:{additionalNeed:'Ampliar armazenagem',commercial:{opportunity:'Ampliar armazenagem'}}}]}
      if(sql.includes('INSERT INTO clients'))return {rowCount:1,rows:[{id:'client-db-id'}]}
      return {rowCount:1,rows:[]}
    }
    const repository=repositoryWith({configured:true,transaction:work=>work({query})})
    await repository.saveSurveyProfile({answers:{27:'Não.'},result:{id:'cliente',name:'Cliente',additionalNeed:'Não.',commercial:{priority:'A avaliar',opportunity:'Não.'}}})
    return calls
  }

  const legacyCalls=await run({property:'Talhão 1',opportunity:'Ampliar armazenagem'})
  const legacyClient=legacyCalls.find(call=>call.sql.includes('INSERT INTO clients'))
  const legacySnapshot=legacyCalls.find(call=>call.sql.includes('INSERT INTO client_profiles'))
  assert.deepEqual(JSON.parse(legacyClient.params[9]),{priority:'A avaliar',property:'Talhão 1'})
  assert.equal(JSON.parse(legacySnapshot.params[8]).commercial.opportunity,'')
  assert.deepEqual(JSON.parse(legacySnapshot.params[8]).commercial.opportunityProvenance,{origin:'producer_360',field:'q27',state:'none_declared'})

  const independentCalls=await run({property:'Talhão 1',opportunity:'Comparativos técnicos',opportunityProvenance:{origin:'consultant',field:'validated_opportunity',state:'reported'},potential:50_000,potentialValidated:true})
  const independent=JSON.parse(independentCalls.find(call=>call.sql.includes('INSERT INTO clients')).params[9])
  assert.equal(independent.opportunity,'Comparativos técnicos')
  assert.equal(independent.opportunityProvenance.origin,'consultant')
  assert.equal(independent.potential,50_000)
})

test('recomendação e model_run serializam arrays e detalhes de erro explicitamente',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.startsWith('SELECT id,external_key FROM clients'))return {rowCount:1,rows:[{id:'client-db-id',external_key:'client-ext'}]}
    return {rowCount:1,rows:[]}
  }
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  await repository.recordRecommendation({
    clientId:'client-ext',question:'Próxima ação?',mode:'daily',model:'model-test',context:{signals:[]},
    advice:{evidence_used:[{source_id:'signal-1'}],confidence:{score:60},human_review:{required:false}},
    modelRun:{model:'model-test',status:'failed',errorDetails:{causes:['timeout']}}
  })

  const recommendation=calls.find(call=>call.sql.includes('INSERT INTO val_recommendations'))
  const modelRun=calls.find(call=>call.sql.includes('INSERT INTO model_runs'))
  assert.deepEqual(JSON.parse(recommendation.params[9]),{signals:[]})
  assert.deepEqual(JSON.parse(recommendation.params[10]),['signal-1'])
  assert.equal(JSON.parse(recommendation.params[11]).confidence.score,60)
  assert.deepEqual(JSON.parse(modelRun.params[10]),{causes:['timeout']})
})

test('ingestão especializada serializa payload, arrays validados, achados e evidências',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-db-id'}]}
    if(sql.includes('INSERT INTO field_reports'))return {rowCount:1,rows:[{id:'report-db-id'}]}
    return {rowCount:1,rows:[]}
  }
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  const event={
    externalId:'field-001',type:'field_report.completed',schemaVersion:1,source:'manual-do-agronomo',
    occurredAt:'2026-08-08T12:00:00.000Z',payloadHash:'hash',
    payload:{
      validatedActions:['vistoria'],findings:[{type:'weed',confidence:70}],
      validation:{status:'approved',reviewerId:'agronomo-1',reviewedAt:'2026-08-08T12:00:00.000Z'}
    }
  }
  await repository.ingestEvent({event,signals:[{type:'field_follow_up',severity:'attention',title:'Vistoria',evidence:{actions:['vistoria']},commercialHypothesis:'Confirmar em campo',requiresAgronomist:true,status:'new'}]})

  const envelope=calls.find(call=>call.sql.includes('INSERT INTO integration_events'))
  const report=calls.find(call=>call.sql.includes('INSERT INTO field_reports'))
  const finding=calls.find(call=>call.sql.includes('INSERT INTO field_observations'))
  const signal=calls.find(call=>call.sql.includes('INSERT INTO agronomic_signals'))
  assert.equal(JSON.parse(envelope.params[10]).validatedActions[0],'vistoria')
  assert.deepEqual(JSON.parse(report.params[12]),['vistoria'])
  assert.equal(JSON.parse(report.params[13]).status,'approved')
  assert.equal(JSON.parse(finding.params[3]).type,'weed')
  assert.deepEqual(JSON.parse(signal.params[11]),{actions:['vistoria']})
})

test('idempotência rejeita o mesmo externalId quando o payload_hash diverge',async()=>{
  const event={externalId:'event-001',type:'business.closed',schemaVersion:1,source:'manual',occurredAt:'2026-08-08T12:00:00.000Z',payload:{value:100},payloadHash:'hash-novo'}
  const makeRepository=existingHash=>repositoryWith({configured:true,transaction:work=>work({query:async sql=>{
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:0,rows:[]}
    if(sql.startsWith('SELECT payload_hash'))return {rowCount:1,rows:[{payload_hash:existingHash}]}
    return {rowCount:1,rows:[]}
  }})})

  assert.deepEqual(await makeRepository('hash-novo').ingestEvent({event,signals:[]}),{duplicate:true,signals:0})
  await assert.rejects(makeRepository('hash-antigo').ingestEvent({event,signals:[]}),error=>error.statusCode===409&&/conteúdo diferente/.test(error.message))
})

test('sincronização do Manual enriquece cliente existente sem criar carteira comercial',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO integration_events'))return {rowCount:1,rows:[{id:'event-db-id'}]}
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:0,rows:[]}
    return {rowCount:1,rows:[]}
  }
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  await repository.ingestEvent({
    ownerId:'00000000-0000-4000-8000-000000000010',
    event:{externalId:'producer-001',type:'manual.producer.updated',schemaVersion:1,source:'manual-do-agronomo',occurredAt:'2026-08-10T12:00:00.000Z',payloadHash:'hash',clientExternalKey:'producer-1',payload:{producer:{name:'Produtor 1',areaHa:120}}},
    signals:[]
  })
  assert.ok(calls.some(call=>call.sql.startsWith('UPDATE clients SET name=')))
  assert.equal(calls.some(call=>call.sql.includes('INSERT INTO clients')),false)
})

test('visão global calcula o potencial e cruza somente o workspace do mesmo login',async()=>{
  const tenantId='00000000-0000-4000-8000-000000000001'
  const ownerId='00000000-0000-4000-8000-000000000010'
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('SELECT id,external_key,name,commercial_profile FROM clients'))return {rowCount:1,rows:[{id:'00000000-0000-4000-8000-000000000020',external_key:'produtor-teste',name:'Produtor Teste',commercial_profile:{purchaseCurrentSeason:100_000,purchasePreviousSeason:80_000,potentialTotal:250_000,creditLimit:50_000,creditUsed:12_000,grossMarginPercent:15}}]}
    if(sql.includes('MAX(occurred_at) FILTER'))return {rows:[{purchase_total:180_000,purchase_count:3,known_outcomes:3,wins:2,losses:1,margin_total:20_000,last_purchase_at:new Date('2026-08-01T12:00:00Z')}]}
    if(sql.includes("TO_CHAR(DATE_TRUNC('month'"))return {rows:[{month_key:'2026-08',won_value:100_000,open_value:0,won_count:1}]}
    if(sql.includes("COALESCE(NULLIF(category,''),NULLIF(product,''),'Não categorizado') label"))return {rows:[{label:'Sementes',value:100_000,count:1}]}
    if(sql.includes('SELECT stage,COUNT(*)'))return {rows:[{stage:'Diagnóstico',count:1,value:50_000,weighted_value:15_000,overdue:0}]}
    if(sql.includes('(SELECT COUNT(*) FROM properties'))return {rows:[{properties:0,fields:0,crop_seasons:0,field_reports:1,soil_analyses:0,ndvi:0,manual_events:2,last_manual_sync:new Date('2026-08-10T12:00:00Z')}]}
    if(sql.includes('FROM app_workspace_data'))return {rows:[{producers:[{id:'manual-1',name:'Produtor Teste',city:'Sorriso',area:150,cultures:['Soja'],properties:'Fazenda Sul; Sítio Norte',fields:[{season:'2026/27',ndviScenes:[{},{}]},{season:'2026/27',ndviScenes:[]},{season:'2025/26',ndviScenes:[{}]}]}],soil_analyses:[{producerId:'manual-1'},{producerId:'manual-1'}],updated_at:new Date('2026-08-10T12:00:00Z')}]}
    if(sql.includes('FROM app_records'))return {rows:[{id:'00000000-0000-4000-8000-000000000030',record_type:'season_report',title:'Fechamento 2025/26',producer_name:'Produtor Teste',updated_at:new Date('2026-08-09T12:00:00Z')}]}
    throw new Error(`Consulta inesperada: ${sql}`)
  }
  const repository=repositoryWith({configured:true,query})
  const overview=await repository.getClientOverview('produtor-teste',ownerId)
  const ownerCheck=calls.find(call=>call.sql.includes('SELECT id,external_key,name,commercial_profile FROM clients'))
  const workspaceCheck=calls.find(call=>call.sql.includes('FROM app_workspace_data'))
  const recordsCheck=calls.find(call=>call.sql.includes('FROM app_records'))
  assert.deepEqual(ownerCheck.params,[tenantId,ownerId,'produtor-teste'])
  assert.deepEqual(workspaceCheck.params,[ownerId])
  assert.deepEqual(recordsCheck.params,[ownerId])
  assert.equal(overview.business.openPotential,150_000)
  assert.equal(overview.business.weightedPipeline,15_000)
  assert.equal(overview.business.forecast,115_000)
  assert.equal(overview.business.creditAvailable,38_000)
  assert.equal(overview.business.estimatedMargin,15_000)
  assert.equal(overview.business.conversionRate,2/3*100)
  assert.equal(overview.monthly[0].month,'2026-08')
  assert.equal(overview.technical.properties,2)
  assert.equal(overview.technical.fields,3)
  assert.equal(overview.technical.cropSeasons,2)
  assert.equal(overview.technical.ndvi,3)
  assert.equal(overview.technical.soilAnalyses,2)
  assert.equal(overview.technical.recentRecords[0].title,'Fechamento 2025/26')
  assert.equal(overview.cloud.ownerScoped,true)
  assert.equal('ownerId' in overview.cloud,false)
  const monthlyCheck=calls.find(call=>call.sql.includes("TO_CHAR(DATE_TRUNC('month'"))
  assert.match(monthlyCheck.sql,/AS month_key/)
  assert.doesNotMatch(monthlyCheck.sql,/\)\s+month[,\s]/)
})

test('visão global não consulta métricas quando o produtor pertence a outro login',async()=>{
  let calls=0
  const repository=repositoryWith({configured:true,query:async()=>{calls++;return {rowCount:0,rows:[]}}})
  await assert.rejects(()=>repository.getClientOverview('cliente-alheio','00000000-0000-4000-8000-000000000010'),error=>error.statusCode===404)
  assert.equal(calls,1)
})

test('feedback atualizado retorna o id persistido pelo UPSERT',async()=>{
  const repository=repositoryWith({configured:true,query:async()=>({rowCount:1,rows:[{id:'feedback-existente'}]})})
  const id=await repository.recordFeedback({recommendationId:'recommendation-id',rating:5})
  assert.equal(id,'feedback-existente')
})

test('contexto técnico expira a versão ativa e insere uma nova memória append-only',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.startsWith('SELECT id FROM clients'))return {rowCount:1,rows:[{id:'client-db-id'}]}
    if(sql.startsWith('UPDATE val_memories'))return {rowCount:2,rows:[{id:'memory-1'},{id:'memory-2'}]}
    return {rowCount:1,rows:[]}
  }
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  await repository.saveTechnicalContext('client-ext',{property:'Fazenda Sul',soil:'Argiloso',goal:'Produtividade'})

  const clientLock=calls.find(call=>call.sql.startsWith('SELECT id FROM clients'))
  const expiration=calls.find(call=>call.sql.startsWith('UPDATE val_memories'))
  const insertion=calls.find(call=>call.sql.includes('INSERT INTO val_memories'))
  assert.match(clientLock.sql,/FOR UPDATE/)
  assert.match(expiration.sql,/status='expired'/)
  assert.match(expiration.sql,/valid_until=NOW\(\)/)
  assert.doesNotMatch(expiration.sql,/SET value=/)
  assert.deepEqual(JSON.parse(insertion.params[2]),{property:'Fazenda Sul',crops:'',area:'',weeds:'',diseases:'',insects:'',soil:'Argiloso',goal:'Produtividade',competitors:'',notes:''})
  assert.deepEqual(JSON.parse(insertion.params[3])[0].supersedes,['memory-1','memory-2'])
})

test('fallback demonstrativo também mantém histórico do contexto técnico',async()=>{
  let store={surveys:[],imports:[],val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],technicalContexts:{}}}
  const repository=new ValRepository({db:{configured:false},tenantId:'tenant',readStore:()=>store,saveStore:next=>{store=next}})
  await repository.saveTechnicalContext('client-ext',{property:'Versão 1'})
  await repository.saveTechnicalContext('client-ext',{property:'Versão 2'})
  assert.equal(store.val.technicalContexts['client-ext'].property,'Versão 2')
  assert.equal(store.val.technicalContextHistory.length,1)
  assert.equal(store.val.technicalContextHistory[0].property,'Versão 1')
  assert.equal(store.val.technicalContextHistory[0].status,'expired')
})

test('importação não fabrica data ou desfecho e serializa o registro aceito',async()=>{
  const calls=[]
  const query=async(sql,params=[])=>{
    calls.push({sql,params})
    if(sql.includes('INSERT INTO clients'))return {rowCount:1,rows:[{id:'client-db-id',external_key:'fazenda-a-importado'}]}
    return {rowCount:1,rows:[]}
  }
  const repository=repositoryWith({configured:true,transaction:work=>work({query})})
  await repository.ingestCommercialImport({
    summary:{id:'import-1',fileName:'historico.xlsx',rowCount:3,createdAt:'2026-08-08T12:00:00.000Z'},
    clients:[{id:'fazenda-a-importado',name:'Fazenda A',commercial:{categories:[]}}],
    mapping:{client:'Cliente',status:'Status',date:'Data',value:'Valor'},
    rows:[
      {Cliente:'Fazenda A',Status:'Fechado',Data:'01/08/2026',Valor:'100'},
      {Cliente:'Fazenda A',Status:'Em análise',Data:'02/08/2026',Valor:'200'},
      {Cliente:'Fazenda A',Status:'Perdido',Data:'',Valor:'300'}
    ]
  })

  const imports=calls.find(call=>call.sql.includes('INSERT INTO import_jobs'))
  const client=calls.find(call=>call.sql.includes('INSERT INTO clients'))
  const events=calls.filter(call=>call.sql.includes('INSERT INTO business_events'))
  assert.equal(JSON.parse(imports.params[6]).fileName,'historico.xlsx')
  assert.deepEqual(JSON.parse(client.params[7]),{categories:[]})
  assert.equal(events.length,1)
  assert.equal(events[0].params[5],'won')
  assert.match(events[0].params[4],/^2026-08-01T/)
  assert.equal(JSON.parse(events[0].params[10]).status,'Fechado')
})

test('leitura reidrata o snapshot sem permitir que ele substitua campos canônicos',async()=>{
  const db={configured:true,query:async sql=>{
    if(sql.startsWith('SELECT summary'))return {rows:[]}
    return {rows:[{
      external_key:'client-ext',name:'Nome Canônico',municipality:'Município Canônico',total_area_ha:'150',cultures:'Soja',preferred_channel:'Visita',
      commercial_profile:{priority:'Média',opportunity:'Não.'},primary_profile:'Analítico',secondary_profile:'Relacional',irt_score:'72',nps_score:9,
      profile_snapshot:{name:'Nome Antigo',municipality:'Município Antigo',decisionDriver:'Segurança',servicePreference:'WhatsApp',scoresScale:{trust:8},additionalNeed:'Não.',commercial:{priority:'Alta',property:'Talhão 1',opportunity:'Não.'},profileVersion:'producer-360-v1'},
      profile_assessed_at:new Date('2026-08-01T12:00:00Z'),profile_valid_until:new Date('2027-02-01T12:00:00Z')
    }]}
  }}
  const result=await repositoryWith(db).getIntelligence()
  const [client]=result.clients
  assert.equal(client.name,'Nome Canônico')
  assert.equal(client.municipality,'Município Canônico')
  assert.equal(client.decisionDriver,'Segurança')
  assert.deepEqual(client.scoresScale,{trust:8})
  assert.equal(client.servicePreference,'Visita')
  assert.equal(client.additionalNeed,'Não.')
  assert.equal(client.additionalNeedStatus,'none_declared')
  assert.deepEqual(client.commercial,{priority:'Média',property:'Talhão 1',opportunity:'',opportunityProvenance:{origin:'producer_360',field:'q27',state:'none_declared'}})
  assert.equal(client.profileVersion,'producer-360-v1')
  assert.equal(client.profileUpdatedAt,'2026-08-01T12:00:00.000Z')
})

test('contexto entregue à VAL também neutraliza oportunidade negativa persistida',async()=>{
  const db={configured:true,query:async()=>({rowCount:1,rows:[{
    external_key:'client-ext',name:'Cliente',commercial_profile:{opportunity:'Não.'},profile_snapshot:{additionalNeed:'Não.',commercial:{opportunity:'Não.'}},
    answers:{1:'Cliente',2:'Município'},profile_evidence:[{source:'producer_360',self_reported:true}],profile_assessed_at:new Date('2026-08-01T12:00:00Z'),signals:[],learning:{},feedback_learning:{},memories:[],business_history:[{id:'business-1'}],visits:[{id:'visit-1'}],interactions:[{id:'interaction-1'}],opportunities:[{id:'opportunity-1'}],properties:[{id:'property-1'}],field_reports:[{id:'report-1'}],soil_analyses:[{id:'soil-1'}],ndvi_observations:[{id:'ndvi-1'}],manual_records:[{id:'manual-1'}],prior_recommendations:[{id:'recommendation-1'}]
  }]})}
  const context=await repositoryWith(db).getClientContext({clientId:'client-ext'})
  assert.equal(context.client.additionalNeedStatus,'none_declared')
  assert.equal(context.client.commercial.opportunity,'')
  assert.equal(context.client.commercial.opportunityProvenance.state,'none_declared')
  assert.deepEqual(context.profile.answers,{1:'Cliente',2:'Município'})
  assert.equal(context.profile.assessedAt,'2026-08-01T12:00:00.000Z')
  for(const key of ['businessHistory','visits','interactions','opportunities','properties','fieldReports','soilAnalyses','ndviObservations','manualRecords','priorRecommendations'])assert.equal(context[key].length,1,key)
})

test('oportunidade comercial legada com evidência vence Q27 negativa',async()=>{
  const db={configured:true,query:async sql=>sql.startsWith('SELECT summary')?{rows:[]}:{rows:[{
    external_key:'client-ext',name:'Cliente',commercial_profile:{opportunity:'Comparativos técnicos e condições',potential:96_000,potentialValidated:true},
    profile_snapshot:{additionalNeed:'Não.',commercial:{opportunity:'Não.'}}
  }]}}
  const [client]=(await repositoryWith(db).getIntelligence()).clients
  assert.equal(client.additionalNeedStatus,'none_declared')
  assert.equal(client.commercial.opportunity,'Comparativos técnicos e condições')
  assert.equal(client.commercial.opportunityProvenance.origin,'legacy_commercial')
})

test('visitas e avanço do pipeline são persistidos como contexto canônico da VAL',async()=>{
  const calls=[]
  const db={configured:true,query:async(sql,params=[])=>{calls.push({sql,params});if(sql.includes('INSERT INTO visits'))return {rowCount:1,rows:[{id:'visit-db',client_external_key:'client-ext',scheduled_at:new Date('2026-08-10T17:00:00Z'),objective:'Validar prioridade',status:'Agendada',created_at:new Date(),updated_at:new Date()}]};return {rowCount:1,rows:[{id:'opp-db',client_external_key:'client-ext',external_key:'pipeline:key',title:'Ampliar armazenagem',estimated_value:50_000,stage:'Proposta',evidence:[{type:'manual_advance',from:'Diagnóstico',to:'Proposta',at:'2026-08-08T12:00:00.000Z',candidateKey:'producer_360_q27:ampliar armazenagem'}],updated_at:new Date()}]}}}
  const repository=repositoryWith(db)
  const visit=await repository.saveVisit({clientId:'client-ext',scheduledAt:'2026-08-10T14:00:00-03:00',objective:'Validar prioridade'})
  const opportunity=await repository.saveOpportunity({clientId:'client-ext',title:'Ampliar armazenagem',value:50_000,stage:'Proposta',candidateKey:'producer_360_q27:ampliar armazenagem',stageEvidence:{type:'manual_advance',from:'Diagnóstico',to:'Proposta',at:'2026-08-08T12:00:00.000Z',candidateKey:'producer_360_q27:ampliar armazenagem'}})
  assert.equal(visit.clientId,'client-ext')
  assert.equal(opportunity.stage,'Proposta')
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO visits')))
  const opportunityCall=calls.find(call=>call.sql.includes('INSERT INTO opportunities'))
  assert.match(opportunityCall.params[2],/^pipeline:/)
  assert.deepEqual(JSON.parse(opportunityCall.params[10])[0],{type:'manual_advance',from:'Diagnóstico',to:'Proposta',at:'2026-08-08T12:00:00.000Z',candidateKey:'producer_360_q27:ampliar armazenagem'})
})
