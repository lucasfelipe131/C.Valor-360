// Offline deterministic replay; never constructs an AI client or calls a provider.
import {readFileSync,writeFileSync} from 'node:fs'
import {selectKnowledge,curatedAnswerCoverageDecision} from '../../server/knowledge/selection.js'
import {buildGeneralNoClientResponse} from '../../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../../server/decision-copilot/capability-router.js'
const fixtures=JSON.parse(readFileSync(new URL('../../test/fixtures/k5-offline-general.json',import.meta.url)))
const observations=JSON.parse(readFileSync(new URL('../../test/fixtures/k5-historical-observations.json',import.meta.url)))
const cases=[]
for(const f of fixtures){
 const historical=observations.find(o=>o.id===f.id)
 const route=routeSystemCapability({message:f.question,intentHint:historical.intent,hasClient:false})
 const selection=selectKnowledge({query:f.question,modules:['MCTX','MDI','MVV','MIA','MIC'],limit:1,now:new Date(historical.started_at)})
 const coverage=selection.items[0]?curatedAnswerCoverageDecision(f.question,selection.items[0]):null
 // No model: inspect existing deterministic coverage only. MODEL_UNAVAILABLE is
 // a property of this replay and MUST NOT be attributed to the historical run.
 const response=await buildGeneralNoClientResponse({message:f.question,route})
 const trace=response.responseMetadata.decisionTrace
 cases.push({CASE_ID:f.id,QUESTION:f.question,HISTORICAL:historical,
  REPLAY:{intent:route.intent,route:route.path,retrieval_expected_in_existing_path:true,retrieval_required_by_question:false,
   deterministic_answer_sufficient:response.advice.ai_reasoning.run.tool_result?.status==='EXECUTED',
   specific_clarification_triggered:response.responseMetadata.generalKnowledge.topicClarification,
   context_required:response.responseMetadata.generalKnowledge.contextRequired,
   candidate_count:selection.audit.decision.candidate_count,selected_count:selection.items.length,
   selected_ids:selection.items.map(i=>i.knowledge_item_id),rejected_ids:trace.rejected_ids,
   candidate_rejections:trace.rejected_candidates,delivery_rejected_ids:trace.delivery_rejected_ids,
   retrieval_reason:selection.audit.decision.retrieval_reason,rejection_reason:coverage?.reason||'NO_SELECTED_STATEMENT',
   eligibility_rejection_counts:selection.audit.excluded_reason_counts,
   grounding_decision:trace.selection_grounding_decision,
   language_validation_decision:'NOT_IN_GENERAL_ANSWER_PATH',
   selected_statements:selection.items.map(i=>({id:i.knowledge_item_id,statement:i.statement})),
   replay_matches_observed_ids:JSON.stringify(selection.items.map(i=>i.knowledge_item_id))===JSON.stringify(historical.selected_ids)},
  FINAL_FALLBACK_ORIGIN:'GENERAL_DETERMINISTIC_NO_COVERAGE (rendered text and code path)',
  FINAL_ROOT_CAUSE:'UNKNOWN_MISSING_PROVIDER_OUTPUT_OR_VALIDATION_DIAGNOSTICS',
  IMPROPER_GENERIC_FALLBACK:'NOT_PROVEN',CORRECT_FINAL_NO_DATA:'NOT_PROVEN',
  CLASSIFICATION:{A_correct_no_data:'Retrieval-stage absence only; final NO_DATA correctness not proven',B_specific_clarification:'No material clarification trigger in deterministic replay',C_routing_failure:'Not observed: ASK_GENERAL/CONTEXT reaches provider',D_retrieval_failure:'Rule decision replayed; no source outage proved',E_selection_failure:coverage?'Candidate rejected before delivery; no acceptance bug proved':'No candidate selected',F_language_enhancer_rejection:'Not in this direct general-answer path',G_grounding_blocked:'Final generated-answer decision not recorded',H_provider_failure:'Two completed provider usage events; no provider failure proved',I_generic_deterministic_fallback:'Observed',J_other_proven:'Historical observability gap; exact internal rejection cannot be inferred from mocks'}})
}
const report={baseline_sha:'345ed8ec1a054dfa6f9ac31a3771693d4bbc415c',checkpoint_sha:'fbca0acf4e79569023b17d7fcb64310ef89b17e8',paid_calls:0,root_cause_known:0,root_cause_groups:0,deterministic_prefix_groups:5,deterministic_prefix_explained:15,cases,
 evidence_limit:'Observed fields come from historical logs. REPLAY fields use the unchanged knowledge corpus/rules with observed intent and historical time. No original provider output is available. Authored mock rejection reasons are not historical root causes.'}
const output=process.argv[2]
if(!output)throw new Error('Provide an output JSON path')
writeFileSync(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({cases:cases.length,historical_ids_matched:cases.filter(c=>c.REPLAY.replay_matches_observed_ids).length,root_cause_known:0,paid_calls:0}))
