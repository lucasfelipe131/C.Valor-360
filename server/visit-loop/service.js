import {observe} from '../observability.js'
import {createUnavailableTranscriptionProvider,transcribeVisitAudio} from './audio.js'
import {buildLearningCandidate,buildOutcome,buildVisitReport,confirmVisitReport,confirmedCommitments,confirmedMemoryWrites,confirmedOpportunityWrites,reviseVisitReport,visitReflection} from './report.js'

const text=(value,max=4000)=>String(value??'').trim().slice(0,max)

export function createVisitLoopService({repository,transcriptionProvider=createUnavailableTranscriptionProvider()}={}){
 if(!repository)throw new TypeError('VisitLoopService exige repositório.')
 return Object.freeze({
  async createReport({tenantId,ownerId,actorId=ownerId,visitId,input={},requestId,now}={}){
   const started=Date.now()
   const visit=await repository.getVisit({tenantId,ownerId,id:visitId})
   if(!visit)throw Object.assign(new Error('Visita não encontrada na carteira autorizada.'),{code:'visit_not_found',statusCode:404})
   const sourceType=text(input.source_type??input.sourceType,30).toUpperCase()||'TEXT'
   let transcript=null;let sourceText=text(input.text??input.source_text,20_000);let sourceRef=null
   if(sourceType==='AUDIO'){
    const attachment=await repository.getAttachment({tenantId,ownerId,id:text(input.attachment_id??input.attachmentId,180)})
    if(!attachment)throw Object.assign(new Error('Áudio não encontrado na carteira autorizada.'),{code:'visit_audio_not_found',statusCode:404})
    if(String(attachment.clientId)!==String(visit.clientId))throw Object.assign(new Error('Áudio não encontrado na carteira autorizada.'),{code:'visit_audio_not_found',statusCode:404})
    try{
     transcript=await transcribeVisitAudio({provider:transcriptionProvider,attachment,organizationId:tenantId,visitId:visit.id,clientId:visit.clientId,createdBy:actorId,now})
     await repository.saveVisitTranscript({tenantId,ownerId,transcript})
     sourceText=transcript.transcript_text;sourceRef=`visit-transcript:${transcript.transcript_id}`
    }catch(error){
     if(error.transcript)await repository.saveVisitTranscript({tenantId,ownerId,transcript:error.transcript})
     observe('visit.transcription.failed',{visitId:visit.id,transcriptId:error.transcript?.transcript_id,status:'503',errorCode:String(error?.code||'transcription_failed'),durationMs:Math.max(0,Date.now()-started),outcome:'error'})
     throw error
    }
   }
   const report=buildVisitReport({organizationId:tenantId,visitId:visit.id,clientId:visit.clientId,createdBy:actorId,sourceType,sourceText,sourceRef,transcriptId:transcript?.transcript_id,visitObjective:visit.objective,idempotencyKey:input.idempotency_key??input.idempotencyKey,consultantNotes:input.consultant_notes,occurredAt:input.occurred_at??input.occurredAt??now,now})
   const stored=await repository.saveVisitReport({tenantId,ownerId,report,requestId,now})
   observe('visit.report.candidate.created',{visitId:visit.id,visitReportId:stored.visit_report_id,transcriptId:transcript?.transcript_id,confirmationStatus:stored.confirmation_status,modulesCalled:'MEX,MMI,MCTX,VIS',durationMs:Math.max(0,Date.now()-started),outcome:'ok'})
   return {contract_version:'val.visit_report.response.v1',visit_report:stored,...(transcript?{transcript_ref:{id:transcript.transcript_id,version:transcript.version,status:transcript.status}}:{})}
  },

  async createReportFromTranscript({tenantId,ownerId,actorId=ownerId,visitId,transcriptText,transcriptRef,voiceInteractionId,requestId,now}={}){
   const started=Date.now()
   const visit=await repository.getVisit({tenantId,ownerId,id:visitId})
   if(!visit)throw Object.assign(new Error('Visita não encontrada na carteira autorizada.'),{code:'visit_not_found',statusCode:404})
   const report=buildVisitReport({organizationId:tenantId,visitId:visit.id,clientId:visit.clientId,createdBy:actorId,sourceType:'AUDIO',sourceText:transcriptText,sourceRef:`voice-interaction:${text(voiceInteractionId,180)}`,transcriptRef:text(transcriptRef,240),transcriptId:null,visitObjective:visit.objective,idempotencyKey:`voice:${text(voiceInteractionId,160)}`,occurredAt:now,now})
   const stored=await repository.saveVisitReport({tenantId,ownerId,report,requestId,now})
   observe('visit.report.candidate.created',{visitId:visit.id,visitReportId:stored.visit_report_id,voiceInteractionId,confirmationStatus:stored.confirmation_status,modulesCalled:'MEX,MMI,MCTX,VIS',durationMs:Math.max(0,Date.now()-started),outcome:'ok'})
   return {contract_version:'val.visit_report.response.v1',visit_report:stored,transcript_ref:{id:transcriptRef,version:'val.voice_transcript.v1',status:'COMPLETED'}}
  },

  async getReport({tenantId,ownerId,visitId}={}){
   const report=await repository.getVisitReport({tenantId,ownerId,visitId})
   if(!report)throw Object.assign(new Error('A visita ainda não possui report.'),{code:'visit_report_not_found',statusCode:404})
   return {contract_version:'val.visit_report.response.v1',visit_report:report}
  },

  async confirmReport({tenantId,ownerId,actorId=ownerId,visitId,input={},voiceConfirmation=null,requestId,now}={}){
   const started=Date.now()
   const current=await repository.getVisitReport({tenantId,ownerId,visitId,id:input.visit_report_id??input.visitReportId})
   if(!current)throw Object.assign(new Error('Report não encontrado na carteira autorizada.'),{code:'visit_report_not_found',statusCode:404})
   const revised=(input.fields||input.additions||input.remove_item_ids||input.removeItemIds)?reviseVisitReport(current,input):current
   const selectedIds=new Set((Array.isArray(input.confirm_commitment_ids)?input.confirm_commitment_ids:[]).map(String))
   if(selectedIds.size)revised.commitments_confirmed=revised.commitments_proposed.filter(item=>selectedIds.has(String(item.item_id)))
   if(Array.isArray(input.commitments_confirmed))revised.commitments_confirmed=input.commitments_confirmed
   if(Array.isArray(input.next_steps))revised.next_steps=input.next_steps
   const report=confirmVisitReport(revised,{actorId,now})
   const commitments=confirmedCommitments(report,{actorId,requestId,now})
   const outcome=buildOutcome({organizationId:tenantId,visitId,clientId:report.client_id,visitReportId:report.visit_report_id,recommendationId:input.recommendation_id,actionPlanId:input.action_plan_id,commitmentId:commitments[0]?.commitment_id,outcomeType:input.outcome_type??input.outcomeType,result:input.result,evidenceRefs:input.evidence_refs,measuredAt:input.measured_at,recordedBy:actorId,confidence:input.outcome_confidence??report.confidence,notes:input.outcome_notes,now})
   const learningCandidate=buildLearningCandidate({report,outcome,createdBy:actorId,now})
   const memoryMap=new Map()
   for(const memory of [...confirmedMemoryWrites(report,{actorId,now}),...(Array.isArray(voiceConfirmation?.memory_writes)?voiceConfirmation.memory_writes:[])]){
    const evidenceId=memory?.evidence?.[0]?.id
    const key=evidenceId?`candidate:${evidenceId}`:`memory:${memory.source_ref||''}:${memory.key||''}`
    if(!memoryMap.has(key))memoryMap.set(key,memory)
   }
   const memories=[...memoryMap.values()]
   const result=await repository.confirmVisitReport({tenantId,ownerId,actorId,report,commitments,memories,opportunities:confirmedOpportunityWrites(report),outcome,learningCandidate,reflection:visitReflection(report,outcome),voiceConfirmation,requestId,now})
   if(result.idempotent_visit_report){
    const context=result.visit?result:await repository.getVisitLearningContext({tenantId,ownerId,visitId})
    observe('visit.report.confirmed',{visitId,visitReportId:report.visit_report_id,confirmationStatus:'CONFIRMED',modulesCalled:'NONE',durationMs:Math.max(0,Date.now()-started),outcome:'idempotent'})
    return {contract_version:'val.visit_confirmation.response.v1',...context,...(result.voice_interaction?{voice_interaction:result.voice_interaction}:{}),idempotent:true,message:'Esta visita já estava confirmada.'}
   }
   observe('visit.report.confirmed',{visitId,visitReportId:report.visit_report_id,interactionId:result.interaction?.id,transcriptId:report.transcript_id,commitmentIds:result.commitments.map(item=>item.commitment_id).join(','),outcomeIds:result.outcome?.outcome_id,learningCandidateIds:result.learning_candidate?.candidate_id,confirmationStatus:'CONFIRMED',modulesCalled:'MMI,MCTX,MIC,MDI,MVV,MEX,VIS,MAO',durationMs:Math.max(0,Date.now()-started),outcome:'ok'})
   return {contract_version:'val.visit_confirmation.response.v1',...result,message:'Visita registrada. Sua próxima preparação já foi atualizada.'}
  },

  async recordOutcome({tenantId,ownerId,actorId=ownerId,input={},requestId,now}={}){
   const visit=await repository.getVisit({tenantId,ownerId,id:text(input.visit_id??input.visitId,180)})
   if(!visit)throw Object.assign(new Error('Visita não encontrada na carteira autorizada.'),{code:'visit_not_found',statusCode:404})
   const outcome=buildOutcome({organizationId:tenantId,visitId:visit.id,clientId:visit.clientId,visitReportId:input.visit_report_id,recommendationId:input.recommendation_id,actionPlanId:input.action_plan_id,commitmentId:input.commitment_id,outcomeType:input.outcome_type,result:input.result,evidenceRefs:input.evidence_refs,measuredAt:input.measured_at,recordedBy:actorId,confidence:input.confidence,notes:input.notes,now})
   const saved=await repository.saveVisitOutcome({tenantId,ownerId,actorId,outcome,requestId})
   return {contract_version:'val.outcome.response.v1',outcome:saved}
  },

  async learningContext({tenantId,ownerId,visitId}={}){
   const context=await repository.getVisitLearningContext({tenantId,ownerId,visitId})
   if(!context)throw Object.assign(new Error('Visita não encontrada na carteira autorizada.'),{code:'visit_not_found',statusCode:404})
   return {contract_version:'val.visit_learning_context.v1',...context}
  }
 })
}
