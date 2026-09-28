import test from 'node:test'
import assert from 'node:assert/strict'
import {generalAnswerTopicDecision,generalAnswerTopicMatches,generalTopicDiagnostic} from '../server/knowledge/selection.js'
import {evaluateReasoningGrounding} from '../server/decision-copilot/response-grounding.js'
import {applyGeneralTopicGrounding} from '../server/decision-copilot/general-topic-grounding.js'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {runWithRequestContext} from '../server/observability.js'
const question='Minhocas abundantes bastam para concluir que o solo está bem estruturado?'
const answer='Minhocas abundantes indicam atividade biológica, não asseguram agregação, porosidade nem resistência adequada ao crescimento radicular.'
function grounded({q=question,a=answer,clientId='',sourcePatch={},trusted=true,toolPatch={}}={}){
 const sources=[{id:'system:ai-general-knowledge:v1',source_ref:'system:ai-general-knowledge:v1',source_type:'model_general_knowledge',epistemic_type:'FACT',evidence_type:'FACT',scope:'GENERAL_KNOWLEDGE',capability:'AI_GENERAL_KNOWLEDGE',tenant_id:'test',owner_id:'test',statement:a,observed_at:new Date().toISOString(),...sourcePatch}]
 const grounding=evaluateReasoningGrounding({question:q,domain:'AGRONOMY',evidence:sources,activeProducerId:clientId,tenantId:'test',ownerId:'test',blocks:{'recommended_strategy.reading':a}})
 const tool={capability:'AI_GENERAL_KNOWLEDGE',status:'EXECUTED',context:{client_id:null,private_memory_used:false},...toolPatch}
 const input={grounding,question:q,summary:a,clientId,sources,tool,trusted}
 return {input,raw:grounding,result:applyGeneralTopicGrounding(input)}
}
async function respond(q,answers){const requests=[];const result=await buildGeneralNoClientResponse({message:q,route:routeSystemCapability({message:q,hasClient:false}),organizationId:'test',ownerId:'test',aiModel:'offline-fixture',aiClient:{responses:{create:async input=>{requests.push(input);return {status:'completed',output_text:answers[Math.min(requests.length-1,answers.length-1)]}}}}});return {result,requests}}
test('A/G: valid paraphrase passes only lexical second gate; unverified evidence retained',async()=>{
 const g=grounded();assert.equal(g.raw.passed,false);assert.equal(g.raw.question_relevance_reason,'LEXICAL_OVERLAP');assert.equal(g.result.passed,true);assert.equal(g.result.question_relevance,'GENERAL_TOPIC_VALIDATED')
 const {result,requests}=await respond(question,[answer]);assert.equal(result.advice.answer,answer);assert.equal(requests.length,1);assert.equal(result.responseMetadata.decisionTrace.GROUNDING_OVERRIDE,'GENERAL_TOPIC_VALIDATED');assert.equal(result.advice.ai_reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
})
for(const [name,options] of [
 ['B private source',{sourcePatch:{scope:'PRODUCER',producer_id:'foreign'}}],
 ['B selected private producer',{clientId:'private'}],
 ['C current quote without authorized source',{a:'Hoje a soja está cotada a R$ 120 por saca.'}],
 ['D regulated brand claim',{a:answer+' Premier controla pragas no milho.'}],
 ['E invalid tenant provenance',{sourcePatch:{tenant_id:'foreign'}}],
 ['F off-topic answer',{a:'O fósforo pode ficar retido nos minerais do solo.'}],
 ['untrusted execution',{trusted:false}],
 ['wrong capability',{toolPatch:{capability:'GENERAL_GUIDANCE'}}]
])test(name+' cannot override grounding',()=>{const g=grounded(options);assert.equal(g.result.grounding_override,'NONE');assert.equal(g.result.passed,false)})
for(const key of ['unsupported_claims','scope_violations','incompatible_evidence','provenance_violations','temporal_violations'])test('nonempty '+key+' always fails closed',()=>{
 const g=grounded();const changed={...g.raw,[key]:['synthetic-violation']};const result=applyGeneralTopicGrounding({...g.input,grounding:changed});assert.equal(result.passed,false);assert.equal(result.grounding_override,'NONE')
})
test('domain/facet rejection is not a lexical exception',()=>{
 const g=grounded();for(const reason of ['DOMAIN_MISMATCH','FACET_CONFLICT','FACET_EVIDENCE_MISSING','PROFILE_REQUIREMENTS']){
  const r=applyGeneralTopicGrounding({...g.input,grounding:{...g.raw,question_relevance_reason:reason}});assert.equal(r.passed,false)
 }
})
test('topic decision preserves every-anchor and historical adversarial nouns',()=>{
 for(const noun of ['souvenir','Valter','Premier','Cruiser','hamster','caviar']){
  const q=`Como lidar com ${noun} diante da resistência de plantas daninhas?`,a='A resistência de plantas daninhas exige diversificação de manejo.'
  const d=generalAnswerTopicDecision(q,a);assert.equal(d.accepted,false);assert.ok(d.missingAnchors.length);assert.equal(generalAnswerTopicMatches(q,a),false)
 }
 const d=generalAnswerTopicDecision(question,answer);assert.equal(d.accepted,true);assert.deepEqual(d.missingAnchors,[])
})
test('AG-011 sequence: topic rejection then validated paraphrase, no case-ID branch',async()=>{
 const q='O calcário corrige imediatamente toda a profundidade explorada pelas raízes?'
 const first='A correção depende da umidade e do contato com o solo.'
 const second='O calcário não tem efeito imediato; profundidades exploráveis por raízes podem permanecer ácidas.'
 const {result,requests}=await respond(q,[first,second]);assert.equal(requests.length,2);assert.equal(result.advice.answer,second)
 assert.equal(result.responseMetadata.decisionTrace.validation_checks[0].reason,'TOPIC_MISMATCH')
 assert.equal(result.responseMetadata.decisionTrace.GROUNDING_OVERRIDE,'GENERAL_TOPIC_VALIDATED')
 const missing=generalAnswerTopicDecision(q,first).missingAnchors
 assert.ok(missing.length);for(const anchor of missing)assert.ok(requests[1].instructions.includes(anchor))
 assert.doesNotMatch(requests[0].instructions,/termos materiais do pedido/)
 assert.match(requests[1].instructions,/termos materiais do pedido/)
 assert.doesNotMatch(requests[1].instructions,/AG-011|profundidades exploráveis/)
})
test('second attempt remains subject to same validator',async()=>{
 const {result,requests}=await respond(question,['O fósforo pode ficar retido nos minerais.']);assert.equal(requests.length,2);assert.equal(result.responseMetadata.decisionTrace.GENERAL_VALIDATION_REASON,'TOPIC_MISMATCH');assert.notEqual(result.advice.answer,'O fósforo pode ficar retido nos minerais.')
})
for(const unsafe of ['Aplique 2 L/ha.','Premier controla pragas no milho.','João possui 500 hectares.'])test('no targeted retry for mixed topic/safety or private violation: '+unsafe,async()=>{
 const {requests}=await respond(question,['O fósforo pode ficar retido nos minerais. '+unsafe]);assert.equal(requests.length,2);assert.doesNotMatch(requests[1].instructions,/termos materiais do pedido/)
})
test('topic telemetry contains stable identifiers and no raw private anchors',async()=>{
 const events=[];await runWithRequestContext({path:'/api/val/chat',method:'POST'},()=>respond('Como avaliar SegredoPrivado no solo?',['O fósforo pode ficar retido nos minerais.']),{logger:line=>events.push(JSON.parse(line))})
 const serialized=JSON.stringify(events);assert.doesNotMatch(serialized,/SegredoPrivado|segredoprivado|fosforo/i);assert.match(serialized,/topicMissingAnchors/)
 const diagnostic=generalTopicDiagnostic(generalAnswerTopicDecision('Como avaliar SegredoPrivado no solo?','O solo tem poros.'));assert.ok(diagnostic.TOPIC_MISSING_ANCHORS.every(x=>/^ANCHOR_[a-f0-9]{16}$/.test(x)))
})
for(const [label,q,a] of [
 ['infiltration','Por que a água infiltra devagar numa faixa do terreno e depressa na faixa vizinha?','A água infiltra devagar numa faixa do terreno por compactação e depressa na faixa vizinha por maior porosidade. Textura, cobertura e umidade também afetam a infiltração; são hipóteses que precisam de observação do perfil.'],
 ['yellowing','O que devo verificar antes de relacionar folha amarelada à falta de nitrogênio?','Antes de relacionar folha amarelada à falta de nitrogênio, observe quais folhas amarelam, distribuição dos sintomas e condição das raízes. Encharcamento, doenças e outras deficiências também podem causar amarelecimento; confirme com histórico e análise.'],
 ['foliar stages','Por que não se deve comparar análise foliar de estádios diferentes sem critério?','Não se deve comparar análise foliar de estádios diferentes sem critério porque a concentração muda com o crescimento e a redistribuição de nutrientes. Use o mesmo estádio, órgão amostrado e referência de interpretação.']
])test('topic retry missing anchors: '+label,async()=>{
 const first='O solo possui poros que permitem circulação de água.'
 const {result,requests}=await respond(q,[first,a]);assert.equal(requests.length,2);assert.equal(result.advice.answer,a)
 for(const anchor of generalAnswerTopicDecision(q,first).missingAnchors)assert.ok(requests[1].instructions.includes(anchor))
})
test('cache rejection cannot supply topic retry anchors for a length-limited first attempt',async()=>{
 const requests=[]
 await buildGeneralNoClientResponse({message:question,route:routeSystemCapability({message:question,hasClient:false}),organizationId:'test',ownerId:'test',aiModel:'offline',sharedAnswerCache:{resolve:async({validate,generate})=>{validate('O solo possui poros.');return generate()}},aiClient:{responses:{create:async input=>{requests.push(input);return requests.length===1?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:''}:{status:'completed',output_text:answer}}}}})
 assert.equal(requests.length,2);assert.doesNotMatch(requests[1].instructions,/termos materiais do pedido/)
})
