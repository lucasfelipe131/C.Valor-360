import {createHash,randomUUID} from 'node:crypto'

export const capabilityExecutorVersion='val.capability_executor.v1'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const idOf=item=>clean(item?.id??item?.opportunity_id??item?.commitment_id??item?.external_key??item?.externalId??item?.candidateKey,180)
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif'])
const supportedAgroTools=new Set(['solo','produtores','diagnostico','calculadoras','bulas','mercado','clima','manual','biblioteca','observacoes'])

const navigation=Object.freeze({
 AREA_MAPPING:{tool:'area_mapping',title:'Mapeamento de áreas',page:'agro',manual_page:'produtores',mode:'mapping'},
 CALCULATORS:{tool:'calculators',title:'Calculadoras agronômicas',page:'agro',manual_page:'calculadoras',mode:'calculator'},
 SOIL_ANALYSIS:{tool:'soil_analysis',title:'Análise de solo',page:'agro',manual_page:'solo',mode:'soil'},
 IMAGE_DIAGNOSIS:{tool:'image_diagnosis',title:'Diagnóstico por imagem',page:'agro',manual_page:'diagnostico',mode:'diagnosis'},
 NUTRISCAN:{tool:'nutriscan',title:'NutriScan',page:'agro',manual_page:'diagnostico',mode:'nutrition'},
 FITOSCAN:{tool:'fitoscan',title:'FitoScan',page:'agro',manual_page:'diagnostico',mode:'disease'},
 SESSION_COMMAND:{tool:'session_command',title:'Comando da conversa',page:'copilot',manual_page:null,mode:'session'},
 MARKET_COMMODITY:{tool:'market',title:'Mercado e commodities',page:'agro',manual_page:'mercado',mode:'live_data'},
 WEATHER:{tool:'weather',title:'Clima',page:'agro',manual_page:'inicio',mode:'live_data'},
 LABELS:{tool:'labels',title:'Bulas e registros',page:'agro',manual_page:'bulas',mode:'live_data'}
 ,CLIENT_CONTEXT:{tool:'client_fact',title:'Contexto do produtor',page:'copilot',manual_page:null,mode:'fast'}
 ,CONFIRMED_MEMORY:{tool:'confirmed_memory',title:'Memória confirmada',page:'copilot',manual_page:null,mode:'fast'}
 ,COMMERCIAL_HISTORY:{tool:'commercial_history',title:'Histórico comercial',page:'copilot',manual_page:null,mode:'fast'}
})

const contextCollections=Object.freeze({
 opportunity:'opportunities',visit:'visits',visit_draft:'visits',soil_analysis:'soilAnalyses',analysis:'soilAnalyses',property:'properties'
})

function fieldRecords(context={}){
 return list(context.properties).flatMap(property=>list(property?.fields).map(field=>({...field,property_id:idOf(property)})))
}

function scopeError(message,statusCode=404,code='val_active_context_scope_invalid'){
 return Object.assign(new Error(message),{statusCode,code})
}

export function validateActiveContext({activeContext,context={},clientId=''}={}){
 if(activeContext==null)return null
 if(!activeContext||typeof activeContext!=='object'||Array.isArray(activeContext))throw scopeError('O contexto ativo enviado não é válido.',400,'val_active_context_invalid')
 const type=clean(activeContext.type,80).toLowerCase()
 const id=clean(activeContext.id,180)
 if(!type||!id)throw scopeError('O contexto ativo precisa informar tipo e identificador.',400,'val_active_context_invalid')
 if(type==='agronomic_tool'){
  if(!supportedAgroTools.has(id))throw scopeError('A ferramenta agronômica informada não existe neste ambiente.')
  return Object.freeze({type,id,label:clean(activeContext.label,180),source_ref:`agronomic_tool:${id}`})
 }
 if(type==='client'){
  if(String(id)!==String(clientId)&&String(id)!==String(context?.client?.id))throw scopeError('O produtor do contexto ativo não pertence à conversa atual.')
  return Object.freeze({type,id:String(clientId||id),label:clean(context?.client?.name||activeContext.label,180),source_ref:`client:${clientId||id}`})
 }
 const collection=type==='field'?fieldRecords(context):list(context[contextCollections[type]])
 if(!contextCollections[type]&&type!=='field')throw scopeError('O tipo de contexto ativo não é suportado.',400,'val_active_context_type_invalid')
 const record=collection.find(item=>idOf(item)===id)
 if(!record)throw scopeError('O objeto ativo não pertence ao produtor e à carteira autenticados.')
 return Object.freeze({type,id,label:clean(record.name||record.title||record.objective||record.laboratory||activeContext.label,180),source_ref:`${type}:${id}`})
}

function descriptor(capability,{status='EXECUTED',summary='',context=null,toolResult={}}={}){
 const target=navigation[capability]||{tool:capability.toLowerCase(),title:capability,page:null,manual_page:null,mode:null}
 return Object.freeze({
  status,capability,tool:target.tool,title:target.title,summary:clean(summary,1200),
  page:target.page,manual_page:target.manual_page,mode:target.mode,context:context||null,
  ...toolResult
 })
}

function result(capability,status,toolResult,sourceRef=null){
 return Object.freeze({capability,status,source_ref:sourceRef||null,tool_result:toolResult})
}

function mappingResult({context,clientId,activeContext}){
 const properties=list(context.properties)
 const fields=fieldRecords(context)
 const mapped=fields.filter(item=>item?.geometry_ref||item?.geometryRef).length
 const summary=properties.length
  ?`${properties.length} propriedade(s) e ${fields.length} talhão(ões) autorizados; ${mapped} com geometria registrada.`
  :'Nenhuma propriedade vinculada foi encontrada; a ferramenta pode iniciar um mapeamento sem inventar geometria.'
 const tool=descriptor('AREA_MAPPING',{summary,context:{client_id:clientId||null,active_context:activeContext||null},toolResult:{facts:{properties:properties.length,fields:fields.length,mapped_fields:mapped}}})
 return result('AREA_MAPPING','EXECUTED',tool,activeContext?.source_ref||context?.contextSnapshot?.context_snapshot_id||null)
}

function costPerHectare(message=''){
 const normalized=String(message).replace(/\./g,'').replace(/,(?=\d{1,2}\b)/g,'.')
 const costMatch=normalized.match(/(?:custo(?:\s+total)?|total)\s*(?:de|=|:)?\s*(?:r\$\s*)?(\d+(?:\.\d+)?)/i)||normalized.match(/r\$\s*(\d+(?:\.\d+)?)/i)
 const areaMatch=normalized.match(/(?:area|em)\s*(?:de|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:ha|hectares?)/i)||normalized.match(/(\d+(?:\.\d+)?)\s*(?:ha|hectares?)/i)
 const total=Number(costMatch?.[1]);const area=Number(areaMatch?.[1])
 if(!(total>0&&area>0))return null
 return {total_cost:total,area_ha:area,cost_per_ha:Number((total/area).toFixed(2)),currency:'BRL',formula:'total_cost / area_ha'}
}

function calculatorResult({message,clientId,activeContext}){
 const values=costPerHectare(message)
 const askingToCalculate=/\b(?:calcule|calcular|quanto|resultado|custo\s*\/\s*ha)\b/i.test(message)
 if(askingToCalculate&&!values){
  const tool=descriptor('CALCULATORS',{status:'INPUT_REQUIRED',summary:'Informe o custo total e a área em hectares para calcular custo/ha sem assumir valores.',context:{client_id:clientId||null,active_context:activeContext||null},toolResult:{required_inputs:['total_cost_brl','area_ha']}})
  return result('CALCULATORS','INPUT_REQUIRED',tool,null)
 }
 const summary=values?`Custo calculado: R$ ${values.cost_per_ha.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}/ha, usando custo total e área informados.`:'Calculadoras abertas com os valores ainda sob controle do consultor.'
 const tool=descriptor('CALCULATORS',{summary,context:{client_id:clientId||null,active_context:activeContext||null},toolResult:values?{facts:values}:{}})
 return result('CALCULATORS','EXECUTED',tool,values?'calculator:cost_per_ha':null)
}

function soilResult({context,clientId,activeContext}){
 const analyses=list(context.soilAnalyses)
 const selected=activeContext&&['soil_analysis','analysis'].includes(activeContext.type)?analyses.find(item=>idOf(item)===activeContext.id):analyses[0]
 if(!selected){
  const tool=descriptor('SOIL_ANALYSIS',{status:'INPUT_REQUIRED',summary:'Nenhuma análise de solo autorizada foi encontrada. Anexe ou selecione um laudo para interpretar.',context:{client_id:clientId||null,active_context:activeContext||null}})
  return result('SOIL_ANALYSIS','INPUT_REQUIRED',tool,null)
 }
 const measurements=list(selected.measurements)
 const summary=`Análise de solo ${idOf(selected)} localizada com ${measurements.length} medição(ões); interpretação continua sujeita a método, unidade, vigência e revisão técnica.`
 const tool=descriptor('SOIL_ANALYSIS',{summary,context:{client_id:clientId||null,analysis_id:idOf(selected),active_context:activeContext||null},toolResult:{facts:{analysis_id:idOf(selected),sampled_at:selected.sampled_at||selected.sampledAt||null,laboratory:clean(selected.laboratory,180)||null,measurement_count:measurements.length},human_review_required:true}})
 return result('SOIL_ANALYSIS','EXECUTED',tool,idOf(selected))
}

function imageResult({capability,attachments,clientId,activeContext}){
 const image=list(attachments).find(item=>imageTypes.has(String(item?.mimeType||item?.mime_type||'').toLowerCase()))
 if(!image){
  const tool=descriptor(capability,{status:'INPUT_REQUIRED',summary:'Envie uma foto de campo para iniciar a triagem; nenhuma imagem foi presumida.',context:{client_id:clientId||null,active_context:activeContext||null},toolResult:{required_inputs:['image']}})
  return result(capability,'INPUT_REQUIRED',tool,null)
 }
 const analysis=image.analysis&&typeof image.analysis==='object'?image.analysis:null
 const interpreted=analysis&&clean(analysis.summary,1200)
 const status=interpreted?'EXECUTED':'READY'
 const summary=interpreted||'Imagem autorizada recebida. A triagem ainda precisa ser executada e não constitui diagnóstico ou prescrição.'
 const tool=descriptor(capability,{status,summary,context:{client_id:clientId||null,attachment_id:idOf(image),active_context:activeContext||null},toolResult:{human_review_required:true,diagnostic_status:analysis?.diagnosticStatus||'not_a_diagnosis'}})
 return result(capability,status,tool,interpreted?idOf(image):null)
}

function sessionCommandResult({route,context,clientId}){
 const command=route.session_command?.command
 const latest=list(context.priorRecommendations)[0]||null
 if(route.session_command?.requires_previous_turn&&!latest){
  const tool=descriptor('SESSION_COMMAND',{status:'INPUT_REQUIRED',summary:'Este comando precisa de uma resposta anterior na mesma conversa.',context:{client_id:clientId||null,command}})
  return result('SESSION_COMMAND','INPUT_REQUIRED',tool,null)
 }
 const summaries={OUTPUT_TEXT:'Preferência desta conversa alterada para texto.',OUTPUT_AUDIO:'Preferência desta conversa alterada para áudio.',DO_NOT_REGISTER:'Nada será registrado na memória confirmada.',REGISTER_LAST:'A última informação precisa passar por revisão e confirmação humana.',REPEAT:'A resposta anterior foi localizada na conversa.',SUMMARIZE:'A resposta anterior foi localizada para resumo.',EXPLAIN:'A resposta anterior foi localizada para explicação.',GOLDEN_QUESTIONS:'As perguntas materiais da resposta anterior foram localizadas.',SHOW_NUMBERS:'Os dados numéricos da resposta anterior foram solicitados.',DEEPEN:'A próxima resposta pode usar raciocínio aprofundado.',BRIEF:'A próxima resposta deve trazer apenas o essencial.'}
 const tool=descriptor('SESSION_COMMAND',{summary:summaries[command]||'Comando da conversa reconhecido.',context:{client_id:clientId||null,command,conversation_only:true}})
 return result('SESSION_COMMAND','EXECUTED',tool,latest?idOf(latest):`session:${command}`)
}

function liveDataResult({capability,liveData}){
 const record=liveData?.[capability]||liveData?.[capability.toLowerCase()]||null
 const current=record&&record.source&&record.observed_at&&record.status!=='UNAVAILABLE'
 if(!current){
  const tool=descriptor(capability,{status:'NO_DATA',summary:'A fonte atual autorizada não devolveu um registro com origem e data. A VAL falhou fechada.',context:{current_data_required:true}})
  return result(capability,'NO_DATA',tool,null)
 }
 const tool=descriptor(capability,{summary:clean(record.summary||'Fonte atual consultada com origem e data identificadas.',1200),context:{current_data_required:true,observed_at:record.observed_at,source:clean(record.source,180)}})
 return result(capability,'EXECUTED',tool,clean(record.source_ref||record.id,180)||null)
}

function confirmedMemoryValue(item={}){
 const value=item.value&&typeof item.value==='object'?item.value:{}
 return clean(value.decision_maker||value.decisionMaker||value.decisor||value.who_decides||value.whoDecides||value.name||'',300)
}

function fastContextResult({capability,message,context,clientId}){
 const source=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(capability==='CONFIRMED_MEMORY'&&/\b(?:quem decide|decisor)\b/.test(source)){
  const memory=list(context.memories).find(item=>String(item?.status||'').toLowerCase()==='verified'&&String(item?.memory_state||item?.memoryState||'FACT').toUpperCase()==='FACT'&&(/decis|quem decide/i.test(String(item?.key||''))||confirmedMemoryValue(item)))
  const value=memory&&confirmedMemoryValue(memory)
  const status=value?'EXECUTED':'NO_DATA';const summary=value?`Decisor confirmado: ${value}.`:'Nenhum decisor confirmado foi localizado para este produtor.'
  return result(capability,status,descriptor(capability,{status,summary,context:{client_id:clientId,confirmed_memory_only:true}}),value?idOf(memory):null)
 }
 if(capability==='COMMERCIAL_HISTORY'&&/\bcompromisso\b/.test(source)){
  const open=list(context.commitments).filter(item=>!['COMPLETED','CANCELLED','REJECTED','DONE','CONCLUIDO','CANCELADO'].includes(String(item?.status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase())).sort((left,right)=>new Date(left?.due_at||left?.dueAt||left?.updated_at||0)-new Date(right?.due_at||right?.dueAt||right?.updated_at||0))[0]
  const description=clean(open?.description||open?.action,500);const due=clean(open?.due_at||open?.dueAt,40)
  const status=description?'EXECUTED':'NO_DATA';const summary=description?`Compromisso aberto: ${description}${due?` — prazo ${due}`:''}.`:'Nenhum compromisso aberto foi localizado.'
  return result(capability,status,descriptor(capability,{status,summary,context:{client_id:clientId,commitment_id:idOf(open)||null}}),description?idOf(open):null)
 }
 if(capability==='CLIENT_CONTEXT'&&/\b(?:resume|resuma|resumo)\b/.test(source)){
  const clientName=clean(context?.client?.name,180)||'Produtor';const visits=list(context.visits).length;const opportunities=list(context.opportunities).filter(item=>String(item?.stage||'').toLowerCase()!=='fechado').length
  return result(capability,'EXECUTED',descriptor(capability,{summary:`${clientName}: ${visits} visita(s) e ${opportunities} oportunidade(s) aberta(s) no contexto autorizado.`,context:{client_id:clientId}}),context?.contextSnapshot?.context_snapshot_id||null)
 }
 return result(capability,'PLANNED',null,null)
}

export async function executeCapabilityPlan({route={},message='',context={},attachments=[],clientId='',activeContext=null,liveData={}}={}){
 const validatedContext=activeContext?validateActiveContext({activeContext,context,clientId}):null
 const results=[]
 for(const capability of list(route.capabilities)){
  if(capability==='SESSION_COMMAND')results.push(sessionCommandResult({route,context,clientId}))
  else if(capability==='AREA_MAPPING')results.push(mappingResult({context,clientId,activeContext:validatedContext}))
  else if(capability==='CALCULATORS')results.push(calculatorResult({message,clientId,activeContext:validatedContext}))
  else if(capability==='SOIL_ANALYSIS')results.push(soilResult({context,clientId,activeContext:validatedContext}))
  else if(['IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(capability))results.push(imageResult({capability,attachments,clientId,activeContext:validatedContext}))
  else if(['MARKET_COMMODITY','WEATHER','LABELS'].includes(capability)&&route.path==='LIVE_DATA')results.push(liveDataResult({capability,liveData}))
  else if(route.path==='FAST'&&['CLIENT_CONTEXT','CONFIRMED_MEMORY','COMMERCIAL_HISTORY'].includes(capability))results.push(fastContextResult({capability,message,context,clientId}))
  else results.push(result(capability,'PLANNED',null,null))
 }
 const used=results.filter(item=>item.status==='EXECUTED').map(item=>item.capability)
 const primary=results.find(item=>item.tool_result&&['EXECUTED','INPUT_REQUIRED','READY','NO_DATA'].includes(item.status))?.tool_result||null
 return Object.freeze({
  version:capabilityExecutorVersion,
  path:route.path,
  capabilities_planned:[...list(route.capabilities)],
  capabilities_used:used,
  capability_results:results,
  tool_result:primary,
  active_context:validatedContext,
  reasoning_required:Boolean(route.materiality?.engine_required&&(route.path!=='TOOL'||['READY','EXECUTED'].includes(primary?.status)))
 })
}

function generalAnswer(message=''){
 const source=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/\bmargem\b/.test(source))return 'Margem é a diferença entre receita e custos. Em percentual, divida a margem em valor pela receita e multiplique por 100; confirme quais custos entram na comparação.'
 if(/\broi\b|retorno sobre investimento/.test(source))return 'ROI compara o ganho líquido com o investimento: (retorno menos investimento) dividido pelo investimento. Informe período, custos e premissas para evitar uma precisão falsa.'
 if(/\bcusto\s*\/\s*ha|custo por hectare/.test(source))return 'Custo por hectare é o custo total dividido pela área efetivamente considerada. Informe ambos com unidade e período para a VAL calcular.'
 if(/\bctc\b/.test(source))return 'CTC representa a capacidade do solo de reter e trocar cátions. Sua interpretação depende do método, da camada amostrada, do pH e das demais medições do laudo.'
 return 'Posso tratar esta dúvida sem selecionar um produtor e sem consultar memória privada. Informe a cultura, o conceito ou a decisão geral que deseja entender; dados atuais e recomendações técnicas continuam exigindo fonte, contexto e revisão.'
}

export function buildCapabilityExecutionResponse({execution,route,message='',organizationId='unknown',clientId='',clientName='',conversationId='',now=new Date()}={}){
 const createdAt=(now instanceof Date?now:new Date(now)).toISOString()
 const tool=execution?.tool_result||null
 const summary=clean(tool?.summary||'A capacidade solicitada não produziu resultado factual.',1200)
 const sourceRefs=list(execution?.capability_results).filter(item=>item.status==='EXECUTED'&&item.source_ref).map(item=>({id:item.source_ref,source_type:'system_capability'}))
 const client={id:clientId||'portfolio',name:clean(clientName,180)||'Carteira'}
 const hash=createHash('sha256').update(JSON.stringify({organizationId,clientId,message,tool:tool?.tool||null,createdAt:createdAt.slice(0,13)})).digest('hex')
 const reasoning={
  contract_version:'val.ai_reasoning_result.v1',reasoning_id:randomUUID(),organization:{id:String(organizationId)},client,
  context_snapshot:{id:`tool-${hash.slice(0,16)}`,version:'val.tool_context.v1',confidence:{level:execution?.capabilities_used?.length?'VERIFICADO':'INSUFICIENTE'},hash},
  conversation_id:clean(conversationId,180)||'stateless',intent:route?.intent||'ASK_GENERAL',persistence_mode:'NONE',objective:clean(message,1200)||tool?.title||'Executar capacidade',situation_summary:summary,
  key_signals:[],facts_used:sourceRefs,hypotheses:[],missing_information:tool?.required_inputs||[],
  decision_thesis:{CURRENT_SITUATION:summary,WHAT_MATTERS:'A ferramenta precisa produzir evidência própria antes de qualquer síntese.',KEY_UNCERTAINTY:tool?.status==='INPUT_REQUIRED'?'Faltam entradas materiais para executar com segurança.':'O resultado ainda depende de validação humana quando houver decisão técnica.',THESIS:summary,WHY:'A resposta reflete somente o adapter e os dados autorizados desta requisição.',WHAT_TO_VALIDATE:'Confirme contexto, unidades, fonte e vínculo antes de usar o resultado.',WHAT_WOULD_CHANGE_MY_VIEW:'Novas entradas confirmadas ou uma execução técnica revisada.'},
  golden_questions:[],recommended_strategy:{reading:summary,action:tool?.status==='INPUT_REQUIRED'?'Forneça apenas as entradas faltantes.':'Revise o resultado e abra a ferramenta para aprofundar.',do_not_do:'Não transformar disponibilidade da ferramenta em cálculo, diagnóstico ou prescrição.'},evidence_to_use:sourceRefs,
  agronomic_context:{status:['AREA_MAPPING','CALCULATORS','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','NUTRISCAN','FITOSCAN'].includes(tool?.capability)?'tool_result':'not_applicable',human_review_required:Boolean(tool?.human_review_required),sources:{}},commercial_context:{status:'not_applicable'},next_commitment:tool?.status==='INPUT_REQUIRED'?'Completar as entradas materiais.':'Validar o resultado antes de decidir.',risks:[],confidence:{level:execution?.capabilities_used?.length?'VERIFICADO':'INSUFICIENTE',score:execution?.capabilities_used?.length?.9:.2,rationale:'Confiança limitada à execução factual da capability; nenhuma capability planejada é contada como usada.'},reasoning_confidence:{version:'val.reasoning_confidence.v1',context:execution?.active_context?.source_ref?.length?.9:.5,thesis:.8,question:.8,agronomy:tool?.human_review_required?.5:null,knowledge:1,threshold:{ask_below:.72,answer_at_or_above:.72}},knowledge_refs:[],memory_refs:[],created_at:createdAt,model:'rules-capability-executor-v1',prompt_version:'val-performance-architecture-v2',
  run:{provider:'capability-executor',model:'rules-capability-executor-v1',prompt_version:'val-performance-architecture-v2',context_hash:hash,latency_ms:0,status:'completed',fallback:false,path:route?.path||execution?.path||'TOOL',capabilities_planned:execution?.capabilities_planned||[],capabilities_used:execution?.capabilities_used||[],capability_results:execution?.capability_results||[],tool_result:tool,latency_breakdown:{AUTH:null,CONTEXT_RETRIEVAL:null,MEMORY:null,DATABASE:null,MCA:null,MIA:null,EXTERNAL_DATA:null,MODEL_INPUT:null,MODEL_INFERENCE:null,VALIDATION:null,RESPONSE:null}},
  premises:{recomputed_for_request:true,source:'authorized_capability_execution',profile_specific:Boolean(clientId),conversation_is_not_confirmed_memory:true,confirmed_memory_refs:[]},voice_output:{version:'val.voice_output.v1',speakable_text:summary,persistence:'NONE',automatic_memory_effect:false},decision_interview:{version:'val.decision_interview.v1',status:tool?.status==='INPUT_REQUIRED'?'NEEDS_INPUT':'NOT_NEEDED',questions:[],material_missing_information:tool?.required_inputs||[],non_material_missing_information:[],session_context:{conversation_id:clean(conversationId,180)||'stateless',persistence_mode:'NONE'},explanation:tool?.status==='INPUT_REQUIRED'?'Faltam entradas materiais; nenhum valor foi inventado.':'A capability respondeu sem alterar memória.'},quality:{status:'NOT_EVALUATED',dimensions:{},automatic_tests:{}}
 }
 return {route:route?.path||execution?.path||'TOOL',engineMode:'rules',model:'rules-capability-executor-v1',warning:'',responseMetadata:{toolExecutionVersion:capabilityExecutorVersion},advice:{answer:summary,executive_brief:{headline:tool?.title||'Capacidade da VAL',reason:summary,action:reasoning.recommended_strategy.action},next_best_action:reasoning.recommended_strategy.action,ai_reasoning:reasoning}}
}

export function buildGeneralNoClientResponse({message='',route={},organizationId='unknown',conversationId='',now=new Date()}={}){
 const summary=generalAnswer(message)
 const execution={path:route.path,capabilities_planned:route.capabilities||['KNOWLEDGE_LIBRARY'],capabilities_used:[],capability_results:list(route.capabilities).map(capability=>({capability,status:'PLANNED',source_ref:null,tool_result:null})),tool_result:{status:'EXECUTED',capability:'GENERAL_GUIDANCE',tool:'general_guidance',title:'Orientação geral',summary,page:'copilot',manual_page:null,mode:'general',context:{client_id:null,private_memory_used:false}},active_context:null}
 const response=buildCapabilityExecutionResponse({execution,route,message,organizationId,conversationId,now})
 response.advice.ai_reasoning.client={id:'portfolio',name:'Conversa geral'}
 response.advice.ai_reasoning.premises.profile_specific=false
 response.advice.ai_reasoning.premises.source='general_request_without_private_context'
 return response
}
