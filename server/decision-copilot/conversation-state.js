export const conversationStateVersion='val.conversation_state.v1'

export const conversationStateLimits=Object.freeze({
 turns:20,
 entities:16,
 clients:6,
 toolResults:12,
 questions:12,
 facts:16,
 hypotheses:12
})

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=600)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const identifier=(value,max=180)=>clean(value,max).replace(/[^a-zA-Z0-9._:@/-]/g,'')
const iso=(value,fallback=new Date())=>{const date=new Date(value||fallback);return Number.isNaN(date.getTime())?fallback.toISOString():date.toISOString()}
const uniqueBy=(items,keyOf,limit)=>{
 const seen=new Set();const output=[]
 for(const item of items){const key=keyOf(item);if(!key||seen.has(key))continue;seen.add(key);output.push(item);if(output.length>=limit)break}
 return output
}
const normalize=value=>clean(value,4000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')

const cropLabels=Object.freeze({milho:'Milho',soja:'Soja',trigo:'Trigo',canola:'Canola',sorgo:'Sorgo',arroz:'Arroz',feijao:'Feijão',algodao:'Algodão',pastagem:'Pastagem'})

function entityRef(value,type='entity'){
 if(!value||typeof value!=='object')return null
 const id=identifier(value.id??value.client_id??value.clientId)
 const label=clean(value.label??value.name??value.title,180)
 if(!id&&!label)return null
 return {type:clean(value.type||type,80).toLowerCase()||type,id:id||null,label:label||null}
}

function cropFrom(text=''){
 const source=normalize(text);let selected='';let at=-1
 for(const [key,label] of Object.entries(cropLabels)){
  const pattern=new RegExp(`\\b${key}\\b`,'g');let match
  while((match=pattern.exec(source))){if(match.index>=at){selected=label;at=match.index}}
 }
 return selected
}

function seasonFrom(text=''){
 const matches=[...clean(text,4000).matchAll(/\b(20\d{2})\s*[\/_-]\s*((?:20)?\d{2})\b/g)]
 const match=matches.at(-1)
 if(!match)return ''
 return `${match[1]}/${match[2].slice(-2)}`
}

function topicFrom(text=''){
 const source=normalize(text)
 const topics=[
  ['nutrição',/\b(?:nutricao|fertilidade|adubacao|fertilizante)\b/],
  ['inseticidas',/\b(?:inseticida|cigarrinha|lagarta|percevejo|praga)\b/],
  ['herbicidas',/\b(?:herbicida|dessecacao|daninha)\b/],
  ['fungicidas',/\b(?:fungicida|doenca|ferrugem)\b/],
  ['mercado',/\b(?:mercado|cotacao|commodity|preco da saca)\b/],
  ['análise de solo',/\b(?:analise de solo|laudo de solo)\b/],
  ['mapeamento',/\b(?:mapa|mapeamento|talhao|poligono)\b/],
  ['preparação de visita',/\b(?:visita|preparar conversa|perguntas de ouro)\b/]
 ]
 return topics.find(([,pattern])=>pattern.test(source))?.[0]||''
}

const explicitSubjectClientId=value=>identifier(value?.subject_client_id??value?.subjectClientId??value?.client_id??value?.clientId??(String(value?.subject?.type||'').toLowerCase()==='client'?value?.subject?.id:null))
const explicitOwnerId=value=>identifier(value?.owner_id??value?.ownerId??value?.subject_owner_id??value?.subjectOwnerId??value?.owner?.id??(typeof value?.owner==='string'?value.owner:null))
const clientIds=value=>uniqueBy(list(value).map(item=>identifier(item)).filter(Boolean),item=>item,conversationStateLimits.clients)

function comparisonSubject(value,comparedClients=[]){
 const candidates=list(comparedClients).map(item=>entityRef(item,'client')).filter(item=>item?.id)
 if(!candidates.length)return {subjectClientId:null,subjectClientIds:[]}
 const source=normalize(value?.statement??value?.claim??value?.label??value)
 const matches=candidates.filter(item=>item.label&&source.includes(normalize(item.label)))
 if(matches.length===1)return {subjectClientId:matches[0].id,subjectClientIds:[matches[0].id]}
 return {subjectClientId:null,subjectClientIds:candidates.map(item=>item.id)}
}

function sessionItem(value,epistemicStatus,{fallbackClientId=null,comparedClients=[]}={}){
 const statement=clean(value?.statement??value?.claim??value?.label??value,700)
 if(!statement)return null
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const comparison=explicitClientId||explicitClientIds.length?{subjectClientId:explicitClientId||(explicitClientIds.length===1?explicitClientIds[0]:null),subjectClientIds:explicitClientIds}:{...comparisonSubject(value,comparedClients)}
 const subjectClientId=comparison.subjectClientId||(!comparison.subjectClientIds.length?identifier(fallbackClientId):null)
 const subjectClientIds=uniqueBy([subjectClientId,...comparison.subjectClientIds].filter(Boolean),item=>item,conversationStateLimits.clients)
 const ownerId=explicitOwnerId(value)
 return {
  statement,
  epistemic_status:epistemicStatus,
  persistence:'SESSION_ONLY',
  source_ref:clean(value?.id??value?.source_ref??value?.source_id,180)||null,
  ...(subjectClientId?{subject_client_id:subjectClientId}:{}),
  ...(subjectClientIds.length>1?{subject_client_ids:subjectClientIds}:{}),
  ...(ownerId?{owner_id:ownerId}:{})
 }
}

const sessionItemKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${normalize(item?.statement)}`

function scopedFields(value,{fallbackClientId=null,subjectClientIds=[]}={}){
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const subjects=uniqueBy([...explicitClientIds,...clientIds(subjectClientIds)].filter(Boolean),item=>item,conversationStateLimits.clients)
 const subjectClientId=explicitClientId||(!subjects.length?identifier(fallbackClientId):subjects.length===1?subjects[0]:null)
 return {
  ...(subjectClientId?{subject_client_id:subjectClientId}:{}),
  ...(subjects.length>1?{subject_client_ids:subjects}:{})
 }
}

function toolResult(value,scope={}){
 if(!value||typeof value!=='object')return null
 const capability=clean(value.capability,80)
 if(!capability)return null
 return {
  capability,
  status:clean(value.status,80),
  source_ref:clean(value.source_ref,180)||null,
  summary:clean(value.summary,500)||null,
  ...scopedFields(value,scope)
 }
}

const toolResultKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${item?.capability}:${item?.source_ref||item?.status}`

function questionItem(value,{comparedClients=[]}={}){
 const question=clean(value?.question??value,700)
 if(!question)return null
 const explicitClientId=explicitSubjectClientId(value)
 const explicitClientIds=clientIds(value?.subject_client_ids??value?.subjectClientIds)
 const comparison=explicitClientId||explicitClientIds.length
  ?{subjectClientId:explicitClientId||(explicitClientIds.length===1?explicitClientIds[0]:null),subjectClientIds:explicitClientIds}
  :comparisonSubject({statement:question},comparedClients)
 const subjectClientIds=uniqueBy([comparison.subjectClientId,...comparison.subjectClientIds].filter(Boolean),item=>item,conversationStateLimits.clients)
 // Mantém string[] para perguntas legadas/single-client. Apenas itens que
 // precisam de isolamento carregam metadados aditivos de sujeito.
 if(!subjectClientIds.length)return question
 return {
  question,
  ...(subjectClientIds.length===1?{subject_client_id:subjectClientIds[0]}:{subject_client_ids:subjectClientIds})
 }
}

const questionItemKey=item=>`${item?.subject_client_id||clientIds(item?.subject_client_ids).join(',')||'unscoped'}:${normalize(item?.question??item)}`

function turn(value,scope={}){
 if(!value||typeof value!=='object')return null
 const role=['user','assistant','system'].includes(String(value.role))?String(value.role):'user'
 const text=clean(value.text??value.message??value.summary,1200)
 if(!text)return null
 return {role,text,modality:['text','voice','photo','file','tool'].includes(String(value.modality))?String(value.modality):'text',intent:clean(value.intent,80)||null,created_at:iso(value.created_at??value.at),...scopedFields(value,scope)}
}

export function normalizeConversationState(value={},scope={}){
 const now=iso(value.updated_at??scope.now)
 const client=entityRef(value.current_client??scope.client,'client')
 const scopedClientId=identifier(scope.clientId??scope.client?.id)
 const fallbackClientId=scopedClientId||client?.id||null
 if(client?.id&&scopedClientId&&client.id!==scopedClientId)throw Object.assign(new Error('O cliente do estado conversacional não pertence ao escopo solicitado.'),{code:'conversation_state_client_mismatch'})
 const active=value.active_object??scope.activeContext
 const activeRef=entityRef(active,active?.type||'entity')
 const state={
  contract_version:conversationStateVersion,
  conversation_id:identifier(value.conversation_id??scope.conversationId),
  persistence_mode:'NONE',
  persistent_memory_unchanged:true,
  current_client:client,
  recent_clients:uniqueBy(list(value.recent_clients).map(item=>entityRef(item,'client')).filter(Boolean),item=>item.id||item.label,conversationStateLimits.clients),
  current_property:entityRef(value.current_property,'property'),
  current_field:entityRef(value.current_field,'field'),
  current_crop:clean(value.current_crop,80)||null,
  current_season:clean(value.current_season,40)||null,
  current_opportunity:entityRef(value.current_opportunity,'opportunity'),
  current_visit:entityRef(value.current_visit,'visit'),
  current_objective:clean(value.current_objective,900)||null,
  current_topic:clean(value.current_topic,180)||null,
  current_decision_thesis:value.current_decision_thesis&&typeof value.current_decision_thesis==='object'?{
   thesis:clean(value.current_decision_thesis.thesis,1000)||null,
   uncertainty:clean(value.current_decision_thesis.uncertainty,700)||null,
   next_action:clean(value.current_decision_thesis.next_action,700)||null,
   ...scopedFields(value.current_decision_thesis,{fallbackClientId})
  }:null,
  recent_entities:uniqueBy(list(value.recent_entities).map(item=>entityRef(item)).filter(Boolean),item=>`${item.type}:${item.id||item.label}`,conversationStateLimits.entities),
  recent_tool_results:uniqueBy(list(value.recent_tool_results).map(item=>toolResult(item)).filter(Boolean),toolResultKey,conversationStateLimits.toolResults),
  recent_questions:uniqueBy(list(value.recent_questions).map(item=>questionItem(item)).filter(Boolean),questionItemKey,conversationStateLimits.questions),
  session_facts:uniqueBy(list(value.session_facts).map(item=>sessionItem(item,'SESSION_FACT',{fallbackClientId})).filter(Boolean),sessionItemKey,conversationStateLimits.facts),
  session_hypotheses:uniqueBy(list(value.session_hypotheses).map(item=>sessionItem(item,'SESSION_HYPOTHESIS',{fallbackClientId})).filter(Boolean),sessionItemKey,conversationStateLimits.hypotheses),
  conversation_turns:list(value.conversation_turns).map(item=>turn(item,{fallbackClientId})).filter(Boolean).slice(-conversationStateLimits.turns),
  input_modality:['text','voice','photo','file'].includes(String(value.input_modality))?String(value.input_modality):'text',
  response_mode:['text','audio','both'].includes(String(value.response_mode))?String(value.response_mode):'text',
  conversation_mode:Boolean(value.conversation_mode),
  active_object:activeRef,
  created_at:iso(value.created_at??scope.now),
  updated_at:now
 }
 if(activeRef?.type==='property')state.current_property=activeRef
 if(activeRef?.type==='field')state.current_field=activeRef
 if(activeRef?.type==='opportunity')state.current_opportunity=activeRef
 if(['visit','visit_draft'].includes(activeRef?.type))state.current_visit={...activeRef,type:'visit'}
 return Object.freeze(state)
}

export function createConversationState(scope={}){
 return normalizeConversationState({},scope)
}

export function switchConversationClient(current={},client,scope={}){
 const previous=normalizeConversationState(current,{conversationId:scope.conversationId,now:scope.now})
 const nextClient=entityRef(client,'client')
 if(!nextClient?.id)throw Object.assign(new Error('A troca de produtor exige uma referência autorizada.'),{code:'conversation_client_required'})
 if(previous.current_client?.id===nextClient.id)return previous
 return normalizeConversationState({
  ...previous,
  current_client:nextClient,
  recent_clients:uniqueBy([nextClient,previous.current_client,...previous.recent_clients].filter(Boolean),item=>item.id||item.label,conversationStateLimits.clients),
  current_property:null,
  current_field:null,
  current_crop:null,
  current_season:null,
  current_opportunity:null,
  current_visit:null,
  current_objective:null,
  current_topic:null,
  current_decision_thesis:null,
  recent_entities:[nextClient],
  recent_tool_results:[],
  recent_questions:[],
  session_facts:[],
  session_hypotheses:[],
  conversation_turns:[],
  active_object:null,
  updated_at:iso(scope.now)
 },{...scope,clientId:nextClient.id,client:nextClient,activeContext:null})
}

function responseReasoning(response={}){return response?.advice?.ai_reasoning||response?.recommendation?.advice?.ai_reasoning||{}}

export function advanceConversationState(current={},event={}){
 const previous=normalizeConversationState(current,event.scope||{})
 const message=clean(event.message,3000)
 const reasoning=responseReasoning(event.response)
 const client=entityRef(event.client??previous.current_client,'client')
 const active=entityRef(event.activeContext??previous.active_object,event.activeContext?.type||previous.active_object?.type||'entity')
 const comparedClients=list(event.response?.responseMetadata?.comparedClients??event.response?.comparisonResolution?.clients)
 const comparedClientIds=comparedClients.map(item=>entityRef(item,'client')?.id).filter(Boolean)
 const turnScope=comparedClientIds.length>1?{subjectClientIds:comparedClientIds}:{fallbackClientId:client?.id}
 const userTurn=message?turn({role:'user',text:message,modality:event.inputModality||previous.input_modality,intent:event.intent,created_at:event.now},turnScope):null
 const reading=clean(reasoning.recommended_strategy?.reading??event.response?.advice?.answer,1200)
 const assistantTurn=reading?turn({role:'assistant',text:reading,modality:event.responseMode==='audio'?'voice':'text',intent:reasoning.intent??event.intent,created_at:event.now},turnScope):null
 const capabilityResults=list(reasoning.run?.capability_results).map(item=>toolResult(item,turnScope)).filter(Boolean)
 const tool=reasoning.run?.tool_result
 if(tool?.capability)capabilityResults.unshift(toolResult(tool,turnScope))
 const newQuestions=[...list(reasoning.decision_interview?.questions),...list(reasoning.golden_questions)].map(item=>questionItem(item,{comparedClients})).filter(Boolean)
 const facts=list(reasoning.facts_used).map(item=>sessionItem(item,'SESSION_FACT',{fallbackClientId:client?.id,comparedClients})).filter(Boolean)
 const hypotheses=list(reasoning.hypotheses).map(item=>sessionItem(item,'SESSION_HYPOTHESIS',{fallbackClientId:client?.id,comparedClients})).filter(Boolean)
 const mentionedEntities=[client,active].filter(Boolean)
 const next={
  ...previous,
  current_client:client,
  active_object:active,
  current_crop:cropFrom(message)||previous.current_crop,
  current_season:seasonFrom(message)||previous.current_season,
  current_objective:clean(event.objective??reasoning.objective??previous.current_objective,900)||null,
  current_topic:topicFrom(message)||previous.current_topic,
  current_decision_thesis:reasoning.decision_thesis?{
   thesis:clean(reasoning.decision_thesis.THESIS,1000)||null,
   uncertainty:clean(reasoning.decision_thesis.KEY_UNCERTAINTY,700)||null,
   next_action:clean(reasoning.recommended_strategy?.action??reasoning.next_commitment,700)||null,
   ...scopedFields(reasoning.decision_thesis,turnScope)
  }:previous.current_decision_thesis,
  recent_entities:uniqueBy([...mentionedEntities,...previous.recent_entities],item=>`${item.type}:${item.id||item.label}`,conversationStateLimits.entities),
  recent_tool_results:uniqueBy([...capabilityResults,...previous.recent_tool_results].filter(item=>item?.capability),toolResultKey,conversationStateLimits.toolResults),
  recent_questions:uniqueBy([...newQuestions,...previous.recent_questions].filter(Boolean),questionItemKey,conversationStateLimits.questions),
  session_facts:uniqueBy([...facts,...previous.session_facts],sessionItemKey,conversationStateLimits.facts),
  session_hypotheses:uniqueBy([...hypotheses,...previous.session_hypotheses],sessionItemKey,conversationStateLimits.hypotheses),
  conversation_turns:[...previous.conversation_turns,userTurn,assistantTurn].filter(Boolean).slice(-conversationStateLimits.turns),
  input_modality:['text','voice','photo','file'].includes(String(event.inputModality))?String(event.inputModality):previous.input_modality,
  response_mode:['text','audio','both'].includes(String(event.responseMode))?String(event.responseMode):previous.response_mode,
  conversation_mode:event.conversationMode===undefined?previous.conversation_mode:Boolean(event.conversationMode),
  updated_at:iso(event.now)
 }
 return normalizeConversationState(next,{...(event.scope||{}),client,activeContext:active,now:event.now})
}

function itemMatchesClient(item,clientId,includeCrossClient){
 if(includeCrossClient)return true
 const expected=identifier(clientId)
 if(!expected)return !item?.subject_client_id&&!clientIds(item?.subject_client_ids).length
 const explicit=identifier(item?.subject_client_id)
 if(explicit)return explicit===expected
 const subjects=clientIds(item?.subject_client_ids)
 // Um agregado que mistura dois produtores só é disponibilizado quando o
 // chamador declara explicitamente que está construindo contexto comparativo.
 if(subjects.length)return subjects.length===1&&subjects[0]===expected
 return true
}

export function conversationStateContext(state={},options={}){
 const current=normalizeConversationState(state)
 const clientId=identifier(options.clientId??current.current_client?.id)
 const includeCrossClient=options.includeCrossClient===true||options.scope==='comparison'
 return Object.freeze({
  contract_version:current.contract_version,
  conversation_id:current.conversation_id,
  persistence_mode:'NONE',
  persistent_memory_unchanged:true,
  current_client:current.current_client,
  recent_clients:current.recent_clients,
  current_property:current.current_property,
  current_field:current.current_field,
  current_crop:current.current_crop,
  current_season:current.current_season,
  current_opportunity:current.current_opportunity,
  current_visit:current.current_visit,
  current_objective:current.current_objective,
  current_topic:current.current_topic,
  current_decision_thesis:itemMatchesClient(current.current_decision_thesis,clientId,includeCrossClient)?current.current_decision_thesis:null,
  recent_entities:current.recent_entities,
  recent_tool_results:current.recent_tool_results.filter(item=>itemMatchesClient(item,clientId,includeCrossClient)),
  recent_questions:current.recent_questions.filter(item=>itemMatchesClient(item,clientId,includeCrossClient)),
  session_facts:current.session_facts.filter(item=>itemMatchesClient(item,clientId,includeCrossClient)),
  session_hypotheses:current.session_hypotheses.filter(item=>itemMatchesClient(item,clientId,includeCrossClient)),
  conversation_turns:current.conversation_turns.filter(item=>itemMatchesClient(item,clientId,includeCrossClient)),
  input_modality:current.input_modality,
  response_mode:current.response_mode,
  conversation_mode:current.conversation_mode
 })
}

// A comparison is reusable only while it is the immediately preceding
// assistant turn. This keeps deterministic follow-ups on the compared pair
// without reopening older cross-client material after an unrelated turn.
export function activeComparisonClientIds(state={}){
 const current=normalizeConversationState(state)
 const latest=current.conversation_turns.at(-1)
 if(latest?.role!=='assistant')return Object.freeze([])
 const subjects=clientIds(latest.subject_client_ids)
 return Object.freeze(subjects.length>1?subjects:[])
}

export function conversationStatePromptContext(state={}){
 const current=normalizeConversationState(state)
 return [
  current.current_client?.label&&`produtor ${current.current_client.label}`,
  current.current_property?.label&&`propriedade ${current.current_property.label}`,
  current.current_field?.label&&`talhão ${current.current_field.label}`,
  current.current_crop&&`cultura ${current.current_crop}`,
  current.current_season&&`safra ${current.current_season}`,
  current.current_topic&&`assunto ${current.current_topic}`,
  current.current_objective&&`objetivo ${current.current_objective}`
 ].filter(Boolean).join('; ')
}

export function messageNeedsSessionReference(message=''){
 const source=normalize(message)
 return /\b(?:ele|ela|dele|dela|essa area|esse talhao|essa analise|esse produto|aquela visita|isso|o filho dele|a primeira aplicacao|volta pro|volte para)\b/.test(source)||clean(message).length<=90&&/^(?:e|agora|mas|entao|por que|porque|aprofunda|resume|repete)\b/.test(source)
}
