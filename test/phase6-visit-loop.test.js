import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {validateActionPlan,validateCommitment,validatePrepareVisit} from '../server/execution/contracts.js'
import {prepareVisitExecution} from '../server/execution/service.js'
import {runWithRequestContext} from '../server/observability.js'
import {createMockTranscriptionProvider} from '../server/visit-loop/audio.js'
import {validateLearningCandidate,validateOutcome,validateVisitReport} from '../server/visit-loop/contracts.js'
import {legacyVisitLifecycle,transitionVisitLifecycle} from '../server/visit-loop/lifecycle.js'
import {buildLearningCandidate,buildOutcome,buildVisitReport,confirmVisitReport,confirmedMemoryWrites,resolveVisitDueDate,reviseVisitReport} from '../server/visit-loop/report.js'
import {createVisitLoopService} from '../server/visit-loop/service.js'
import {explicitNoAction,phase6ActorA,phase6ActorB,phase6AudioA,phase6InitialStore,phase6ReportText,phase6Repository,phase6TenantA,phase6TenantB,phase6VisitA,phase6VisitB} from '../support/phase6-test-context.js'

const now=new Date('2026-08-23T15:00:00.000Z')
const requestId='00000000-0000-4000-8000-000000000699'

async function candidate(options={}){
 const context=phase6Repository(options)
 const service=createVisitLoopService({repository:context.repository,transcriptionProvider:options.transcriptionProvider})
 const response=await service.createReport({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:phase6ActorA,visitId:options.visitId||phase6VisitA,input:{source_type:options.sourceType||'TEXT',text:options.text??phase6ReportText,attachment_id:options.attachmentId,idempotency_key:options.idempotencyKey},requestId,now})
 return {...context,service,response,report:response.visit_report}
}

async function confirmed(options={}){
 const context=await candidate(options)
 const ids=context.report.commitments_proposed.filter(item=>item.due_at&&!item.date_confirmation_required).map(item=>item.item_id)
 const response=await context.service.confirmReport({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:phase6ActorA,visitId:options.visitId||phase6VisitA,input:{visit_report_id:context.report.visit_report_id,confirm_commitment_ids:ids,outcome_type:options.outcomeType||'NO_DECISION',result:options.result||{decision:'pending'}},requestId,now:new Date('2026-08-23T15:10:00.000Z')})
 return {...context,confirmation:response}
}

test('Fase 6 1 — visita planejada transita explicitamente para preparada',()=>{
 const visit={id:phase6VisitA,tenantId:phase6TenantA,status:'Agendada'}
 assert.equal(legacyVisitLifecycle(visit),'PLANNED')
 const lifecycle=transitionVisitLifecycle(visit,'PREPARED',{organizationId:phase6TenantA,actorId:phase6ActorA,reasonCode:'VISIT_PREPARED',now})
 assert.equal(lifecycle.status,'PREPARED')
 assert.equal(lifecycle.transition.from_status,'PLANNED')
 assert.equal(lifecycle.revision,1)
})

test('Fase 6 2 — preparação é versionada sem apagar a anterior',async()=>{
 const {repository,read}=phase6Repository()
 await prepareVisitExecution({repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitA,requestId:'00000000-0000-4000-8000-000000000691',now})
 await prepareVisitExecution({repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitA,requestId:'00000000-0000-4000-8000-000000000692',now:new Date('2026-08-23T15:01:00.000Z')})
 assert.deepEqual(read().val.visitPreparations.map(item=>item.versionNo),[1,2])
 assert.equal(read().val.visitPreparations[0].contextSnapshotId!==read().val.visitPreparations[1].contextSnapshotId,true)
})

test('Fase 6 3 — texto pós-visita gera VisitReport candidato',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:phase6ReportText,visitObjective:'Negociar.',now})
 assert.deepEqual(validateVisitReport(report),[])
 assert.equal(report.confirmation_status,'PENDING_REVIEW')
 assert.equal(report.source_type,'TEXT')
})

test('Fase 6 4 — áudio mock gera transcript e report sem consolidar automaticamente',async()=>{
 const result=await candidate({sourceType:'AUDIO',attachmentId:phase6AudioA,transcriptionProvider:createMockTranscriptionProvider({text:phase6ReportText})})
 assert.equal(result.response.transcript_ref.status,'COMPLETED')
 assert.equal(result.report.source_type,'AUDIO')
 assert.equal(result.read().val.visitTranscripts.length,1)
 assert.equal(result.read().val.memories.length,0)
})

test('Fase 6 5 — report não confirmado não altera memória consolidada',async()=>{
 const result=await candidate()
 assert.equal(result.report.confirmation_status,'PENDING_REVIEW')
 assert.equal(result.read().val.memories.length,0)
 assert.equal(result.read().interactions.length,0)
})

test('Fase 6 6 — confirmação humana grava somente fatos e sinais aprovados',async()=>{
 const result=await confirmed()
 assert.equal(result.confirmation.visit_report.confirmation_status,'CONFIRMED')
 assert.ok(result.read().val.memories.some(item=>item.key==='visit_report.objection'&&item.memory_state==='FACT'))
 assert.ok(result.confirmation.memories_written.length>0)
})

test('Fase 6 7 — consultor edita interpretação antes de confirmar',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'Conversamos e combinamos nova visita em 2026-08-29.',visitObjective:'Acompanhar.',now})
 const revised=reviseVisitReport(report,{fields:{summary:'Resumo corrigido pelo consultor.'}})
 assert.equal(revised.summary,'Resumo corrigido pelo consultor.')
 assert.equal(revised.revision_no,2)
})

test('Fase 6 8 — consultor remove fato candidato antes da consolidação',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:phase6ReportText,visitObjective:'Negociar.',now})
 const removed=report.objections[0].item_id
 const revised=reviseVisitReport(report,{remove_item_ids:[removed]})
 assert.equal(revised.objections.some(item=>item.item_id===removed),false)
 assert.equal(confirmedMemoryWrites({...revised,confirmation_status:'CONFIRMED',confirmed_at:now.toISOString()},{actorId:phase6ActorA,now}).some(item=>item.key==='visit_report.objection'),false)
})

test('Fase 6 9 — objeção de preço permanece fato candidato rastreável',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'O produtor disse que o preço está caro.',visitObjective:'Negociar.',now})
 assert.equal(report.objections[0].epistemic_status,'FACT_CANDIDATE')
 assert.equal(report.objections[0].category,'PRICE')
 assert.ok(report.objections[0].source_ref)
})

test('Fase 6 10 — compromisso confirmado vira Commitment v1 aceito',async()=>{
 const result=await confirmed()
 assert.equal(result.confirmation.commitments.length,1)
 assert.equal(result.confirmation.commitments[0].version,'val.commitment.v1')
 assert.equal(result.confirmation.commitments[0].status,'ACCEPTED')
 assert.ok(result.confirmation.commitments[0].owner_id)
 assert.ok(result.confirmation.commitments[0].due_at)
})

test('Fase 6 11 — data ambígua exige confirmação e nunca é inventada',()=>{
 const resolution=resolveVisitDueDate('Retornar na semana que vem.',{anchor:now})
 assert.equal(resolution.ambiguous,true)
 assert.equal(resolution.due_at,null)
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'Retornar na semana que vem.',visitObjective:'Retorno.',now})
 report.commitments_confirmed=[report.commitments_proposed[0]]
 assert.throws(()=>confirmVisitReport(report,{actorId:phase6ActorA,now}),error=>error.code==='ambiguous_commitment_date')
})

test('Fase 6 12 — próximo passo é obrigatório ou explicitamente nenhuma ação',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'Conversamos sobre a safra.',visitObjective:'Relacionamento.',now})
 assert.throws(()=>confirmVisitReport(report,{actorId:phase6ActorA,now}),error=>error.code==='explicit_next_step_required')
 report.next_steps=explicitNoAction(report)
 assert.equal(confirmVisitReport(report,{actorId:phase6ActorA,now}).next_steps[0].type,'NO_ACTION')
})

test('Fase 6 13 — Outcome WON é contratualmente válido e aceita evidência',()=>{
 const outcome=buildOutcome({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',outcomeType:'WON',result:{order:'pedido-1'},evidenceRefs:[{id:'pedido:1'}],recordedBy:phase6ActorA,now})
 assert.deepEqual(validateOutcome(outcome),[])
 assert.equal(outcome.outcome_type,'WON')
 assert.equal(outcome.evidence_refs.length,1)
})

test('Fase 6 14 — Outcome NO_DECISION não é confundido com perda',()=>{
 const outcome=buildOutcome({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',outcomeType:'NO_DECISION',result:{reason:'outro decisor'},recordedBy:phase6ActorA,now})
 assert.equal(outcome.outcome_type,'NO_DECISION')
 assert.notEqual(outcome.outcome_type,'LOST')
})

test('Fase 6 15 — Outcome técnico existe sem depender de fechamento comercial',()=>{
 const outcome=buildOutcome({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',outcomeType:'TECHNICAL_RESULT',result:{observation:'coleta solicitada'},recordedBy:phase6ActorA,now})
 assert.equal(outcome.outcome_type,'TECHNICAL_RESULT')
 assert.deepEqual(validateOutcome(outcome),[])
})

test('Fase 6 16 — visita confirmada cria LearningCandidate',async()=>{
 const result=await confirmed()
 assert.equal(result.confirmation.learning_candidate.version,'val.learning_candidate.v1')
 assert.equal(result.confirmation.learning_candidate.status,'CANDIDATE')
 assert.deepEqual(validateLearningCandidate(result.confirmation.learning_candidate),[])
})

test('Fase 6 17 — LearningCandidate nunca vira conhecimento automaticamente',async()=>{
 const result=await confirmed()
 assert.equal(result.read().val.learningCandidates.length,1)
 assert.equal(result.read().val.learningCandidates[0].status,'CANDIDATE')
 assert.equal('knowledgeItems' in result.read().val,false)
 assert.equal(result.read().val.memories.some(item=>item.memory_state==='VALIDATED_KNOWLEDGE'),false)
})

test('Fase 6 18 — perfil recebe sinal observável sem virar certeza',async()=>{
 const result=await confirmed()
 const signal=result.read().val.memories.find(item=>item.key==='visit_report.behavioral_signal')
 assert.equal(signal.memory_state,'INFERENCE')
 assert.equal(signal.value.profile_certainty,false)
 assert.ok(signal.confidence<100)
})

test('Fase 6 19 — oportunidade secundária confirmada permanece hipótese segura',async()=>{
 const result=await confirmed()
 assert.equal(result.confirmation.opportunities_written.length,1)
 const opportunity=result.read().opportunities[0]
 assert.match(opportunity.title,/buva/i)
 assert.equal(opportunity.evidence.some(item=>item.value==='REQUIRES_MIA'),true)
})

test('Fase 6 20 — report cross-tenant é bloqueado antes da leitura',async()=>{
 const {repository}=phase6Repository();const service=createVisitLoopService({repository})
 await assert.rejects(()=>service.createReport({tenantId:phase6TenantB,ownerId:phase6ActorA,visitId:phase6VisitA,input:{source_type:'TEXT',text:'Relato.'},now}),error=>error.code==='cross_tenant_denied'||error.statusCode===403)
})

test('Fase 6 21 — outcome cross-tenant é bloqueado antes da escrita',async()=>{
 const {repository}=phase6Repository();const service=createVisitLoopService({repository})
 await assert.rejects(()=>service.recordOutcome({tenantId:phase6TenantB,ownerId:phase6ActorA,input:{visit_id:phase6VisitA,outcome_type:'NO_CHANGE',result:{}},now}),error=>error.code==='cross_tenant_denied'||error.statusCode===403)
})

test('Fase 6 22 — learning context de outro tenant ou ator não é recuperável',async()=>{
 const result=await confirmed()
 await assert.rejects(()=>result.service.learningContext({tenantId:phase6TenantB,ownerId:phase6ActorA,visitId:phase6VisitA}),error=>error.code==='cross_tenant_denied'||error.statusCode===403)
 await assert.rejects(()=>result.service.learningContext({tenantId:phase6TenantA,ownerId:phase6ActorB,visitId:phase6VisitA}),error=>error.statusCode===404)
})

test('Fase 6 23 — relato agronômico permanece observação e exige MIA',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'O produtor comentou buva numa área.',visitObjective:'Acompanhar.',now})
 assert.equal(report.technical_observations[0].requires_technical_review,true)
 assert.equal(report.opportunities_detected[0].technical_claims_status,'REQUIRES_MIA')
 assert.equal(report.opportunities_detected[0].epistemic_status,'HYPOTHESIS')
 assert.equal(/dose|produto recomendado/i.test(report.summary),false)
})

test('Fase 6 24 — APIs legadas permanecem e rotas v1 são somente aditivas',()=>{
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 assert.match(source,/pathname==='\/api\/visits'/)
 assert.match(source,/visitReportMatch=url\.pathname\.match\(\/\^\\\/api\\\/v1\\\/visits/)
 assert.match(source,/pathname==='\/api\/v1\/outcomes'/)
})

test('Fase 6 25 — PrepareVisit v1 permanece válido no ciclo novo',async()=>{
 const {repository}=phase6Repository()
 const result=await prepareVisitExecution({repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitA,requestId,now})
 assert.equal(result.preparation.version,'val.prepare_visit.v1')
 assert.deepEqual(validatePrepareVisit(result.preparation),[])
})

test('Fase 6 26 — ActionPlan e Commitment v1 permanecem válidos',async()=>{
 const {repository}=phase6Repository()
 const prepared=await prepareVisitExecution({repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitA,requestId,now})
 assert.deepEqual(validateActionPlan(prepared.action_plan),[])
 const result=await confirmed()
 assert.deepEqual(validateCommitment(result.confirmation.commitments[0]),[])
})

async function twoVisitScenario(){
 const context=phase6Repository()
 const service=createVisitLoopService({repository:context.repository})
 const first=await prepareVisitExecution({repository:context.repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitA,requestId:'00000000-0000-4000-8000-000000000681',now:new Date('2026-08-23T10:00:00.000Z')})
 const report=(await service.createReport({tenantId:phase6TenantA,ownerId:phase6ActorA,visitId:phase6VisitA,input:{source_type:'TEXT',text:phase6ReportText},requestId:'00000000-0000-4000-8000-000000000682',now})).visit_report
 await service.confirmReport({tenantId:phase6TenantA,ownerId:phase6ActorA,visitId:phase6VisitA,input:{visit_report_id:report.visit_report_id,confirm_commitment_ids:report.commitments_proposed.map(item=>item.item_id),outcome_type:'NO_DECISION',result:{decision:'pending'}},requestId:'00000000-0000-4000-8000-000000000683',now:new Date('2026-08-23T15:10:00.000Z')})
 const second=await prepareVisitExecution({repository:context.repository,tenantId:phase6TenantA,actor:{id:phase6ActorA,role:'consultant'},visitId:phase6VisitB,requestId:'00000000-0000-4000-8000-000000000684',now:new Date('2026-08-24T10:00:00.000Z')})
 return {first,second,...context}
}

test('Fase 6 27 — segunda preparação usa a visita anterior',async()=>{
 const {second}=await twoVisitScenario()
 assert.match(second.preparation.probable_objection,/preço|investimento/i)
 assert.ok(second.preparation.proofs_to_take.some(item=>/comparativo solicitado/i.test(item)))
 assert.equal(second.preparation.profile_approach.known,true)
 assert.match(second.preparation.main_opportunity.title,/buva/i)
 assert.match(second.preparation.why_now,/sem decisão.*compromisso/i)
 assert.ok(second.preparation.missing_information.some(item=>/buva|impacto econômico/i.test(item)))
})

test('Fase 6 28 — segunda preparação é materialmente melhor que a primeira',async()=>{
 const {first,second}=await twoVisitScenario()
 const score=preparation=>Number(/preço|investimento/i.test(preparation.probable_objection))+Number(preparation.profile_approach.known)+Number(preparation.proofs_to_take.some(item=>/solicitado/i.test(item)))+Number(/buva/i.test(preparation.main_opportunity.title))+Number(/sem decisão|compromisso/i.test(preparation.why_now))
 assert.ok(score(second.preparation)>=5)
 assert.ok(score(second.preparation)>score(first.preparation))
})

test('Fase 6 29 — ausência de dados permanece lacuna explícita',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'O preço está caro e há buva.',visitObjective:'Entender.',now})
 assert.ok(report.missing_information.some(item=>item.code==='PRICE_IMPACT_NOT_QUANTIFIED'))
 assert.ok(report.missing_information.some(item=>item.code==='TECHNICAL_OBSERVATION_LOCATION_MISSING'))
 assert.equal(report.missing_information.every(item=>item.epistemic_status==='FACT_CANDIDATE'),true)
})

test('Fase 6 30 — falha de transcrição degrada com segurança',async()=>{
 const context=phase6Repository();const service=createVisitLoopService({repository:context.repository,transcriptionProvider:createMockTranscriptionProvider({fail:true})})
 await assert.rejects(()=>service.createReport({tenantId:phase6TenantA,ownerId:phase6ActorA,visitId:phase6VisitA,input:{source_type:'AUDIO',attachment_id:phase6AudioA},now}),error=>error.code==='transcription_fixture_failure')
 assert.equal(context.read().val.visitTranscripts[0].status,'FAILED')
 assert.equal(context.read().val.visitReports.length,0)
 assert.equal(context.read().val.memories.length,0)
})

test('Fase 6 30b — áudio de outro produtor é recusado antes de chamar a transcrição',async()=>{
 const context=phase6Repository();const foreignAudio='00000000-0000-4000-8000-000000000629';let providerCalls=0
 context.read().val.attachments.push({id:foreignAudio,tenantId:phase6TenantA,tenant_id:phase6TenantA,ownerId:phase6ActorA,clientId:'producer-b',client_external_key:'producer-b',original_name:'outro.webm',mime_type:'audio/webm',size_bytes:24,content_base64:'YXVkaW8tZml4dHVyZQ==',sha256:'foreign-audio-fixture',status:'received',analysis:{},created_at:now.toISOString(),updated_at:now.toISOString()})
 const service=createVisitLoopService({repository:context.repository,transcriptionProvider:{name:'must-not-run',async transcribe(){providerCalls++;return {text:phase6ReportText}}}})
 await assert.rejects(()=>service.createReport({tenantId:phase6TenantA,ownerId:phase6ActorA,visitId:phase6VisitA,input:{source_type:'AUDIO',attachment_id:foreignAudio},now}),error=>error.code==='visit_audio_not_found'&&error.statusCode===404)
 assert.equal(providerCalls,0)
 assert.equal(context.read().val.visitTranscripts.length,0)
 assert.equal(context.read().val.visitReports.length,0)
})

test('Fase 6 31 — conteúdo de áudio e transcrição não entra na telemetria',async()=>{
 const secret='CONTEUDO-SENSIVEL-DO-AUDIO-NAO-LOGAR'
 const logs=[];const context=phase6Repository();const service=createVisitLoopService({repository:context.repository,transcriptionProvider:createMockTranscriptionProvider({text:`${secret}. Pediu retorno em 2026-08-29.`})})
 await runWithRequestContext({requestId,tenantId:phase6TenantA,actorId:phase6ActorA,method:'POST',path:`/api/v1/visits/${phase6VisitA}/report`},()=>service.createReport({tenantId:phase6TenantA,ownerId:phase6ActorA,visitId:phase6VisitA,input:{source_type:'AUDIO',attachment_id:phase6AudioA},requestId,now}),{logger:value=>logs.push(value)})
 assert.equal(logs.length>0,true)
 assert.equal(logs.join('\n').includes(secret),false)
 assert.equal(logs.every(line=>!line.includes('transcript_text')&&!line.includes('sourceText')),true)
})

test('Fase 6 32 — usuário registra visita somente por texto sem áudio',async()=>{
 const result=await confirmed({text:'Conversamos sobre fertilizante. Retornar em 2026-08-29 com dados.',sourceType:'TEXT',outcomeType:'FOLLOW_UP'})
 assert.equal(result.confirmation.visit.lifecycleStatus,'COMPLETED')
 assert.equal(result.read().val.visitTranscripts.length,0)
 assert.equal(result.confirmation.visit_report.source_type,'TEXT')
})

test('contratos JSON da Fase 6 e OpenAPI permanecem publicados',()=>{
 for(const file of ['visit-lifecycle','visit-transcript','visit-report','outcome','learning-candidate']){
  const schema=JSON.parse(readFileSync(new URL(`../contracts/v1/${file}.schema.json`,import.meta.url),'utf8'))
  assert.match(schema.title,/v1/i)
 }
 const openapi=readFileSync(new URL('../openapi/val-core-v1.yaml',import.meta.url),'utf8')
 for(const path of ['/api/v1/visits/{visitId}/report','/api/v1/visits/{visitId}/confirm','/api/v1/visits/{visitId}/learning-context','/api/v1/outcomes'])assert.match(openapi,new RegExp(path.replace(/[{}]/g,'\\$&')))
})

test('UI mínima mantém um único gatilho Registrar visita e revisão humana',()=>{
 const source=readFileSync(new URL('../src/pages/Visits.jsx',import.meta.url),'utf8')
 assert.equal((source.match(/Registrar visita/g)||[]).length,1)
 assert.match(source,/Confirmar visita/)
 assert.match(source,/type="file"[^>]*accept="audio\/\*"/)
 assert.match(source,/Nenhuma ação necessária/)
})

test('store de teste da Fase 6 não contém tenant adversarial por padrão',()=>{
 const store=phase6InitialStore()
 assert.equal(store.visits.some(item=>item.tenantId===phase6TenantB),false)
})

test('LearningCandidate isolado exige report humano confirmado',()=>{
 const report=buildVisitReport({organizationId:phase6TenantA,visitId:phase6VisitA,clientId:'producer-a',createdBy:phase6ActorA,sourceType:'TEXT',sourceText:'Retornar em 2026-08-29.',visitObjective:'Retorno.',now})
 assert.throws(()=>buildLearningCandidate({report,createdBy:phase6ActorA,now}),error=>error.code==='confirmed_visit_report_required')
})
