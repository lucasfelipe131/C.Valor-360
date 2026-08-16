import {createHash} from 'node:crypto'

const VERSION='val-language-enhancer-v1'
const MAX_TIMEOUT_MS=18_000
const MAX_OUTPUT_TOKENS=1_600

const enhancementSchema={
  type:'json_schema',
  name:'val_language_enhancement',
  strict:true,
  schema:{
    type:'object',
    additionalProperties:false,
    properties:{
      answer:{type:'string'},
      opening:{type:'string'},
      headline:{type:'string'}
    },
    required:['answer','opening','headline']
  }
}

const clean=(value,max=6_000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,20_000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/®/g,'').replace(/[^a-z0-9]+/g,' ').trim()
const array=value=>Array.isArray(value)?value:[]
const clone=value=>structuredClone(value&&typeof value==='object'?value:{})
const genericText=/\b(?:converse com (?:o )?cliente|entenda (?:as )?necessidades|apresente os benef[ií]cios|fa[cç]a contato|acompanhe de perto|mostre o valor agregado)\b/i
const unsafePromise=/\b(?:garante|garantido|controle total|elimina(?:r)? completamente|zera(?:r)? o risco|sem falha|resultado certo|vai render|vai produzir)\b/i
const applicationRate=/\b\d+(?:[.,]\d+)?\s*(?:ml|l|g|kg)\s*\/\s*(?:ha|hectares?)\b/i
const numberTokens=value=>[...String(value||'').matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map(match=>match[0].replace('.','').replace(',','.'))
const unique=items=>[...new Set(items.filter(Boolean))]

function safeFailure(error){
  const status=Number(error?.status||0)
  const code=String(error?.code||error?.name||'provider_error').slice(0,80)
  if(status===401)return {code:'authentication',status}
  if(status===429)return {code:'rate_limit',status}
  if(code.toLocaleLowerCase('pt-BR').includes('timeout')||status===408)return {code:'timeout',status}
  if(status>=500)return {code:'provider_unavailable',status}
  return {code,status}
}

function requiredProducts(orchestration={}){
  const continuity=orchestration.continuity||{}
  const plan=orchestration.technicalCommercialPlan||{}
  return unique([
    ...array(continuity.productNames),
    ...array(plan.contextProducts),
    plan.focusProduct?.name
  ].map(item=>clean(item,120)))
}

function allowedNumbers({message,advice,orchestration}){
  const plan=orchestration?.technicalCommercialPlan||{}
  const corpus=[
    message,
    advice?.answer,
    advice?.next_best_action,
    advice?.next_question?.question,
    JSON.stringify(plan)
  ].join(' ')
  return new Set(numberTokens(corpus))
}

function validEnhancement(payload,{message,advice,orchestration}){
  const answer=clean(payload?.answer,4_500)
  const opening=clean(payload?.opening,1_000)
  const headline=clean(payload?.headline,220)
  if(answer.length<80||opening.length<20||headline.length<8)return {ok:false,reason:'too_short'}
  if(genericText.test(answer))return {ok:false,reason:'generic'}
  if(unsafePromise.test(answer)||applicationRate.test(answer))return {ok:false,reason:'unsafe_claim'}

  const normalizedAnswer=normalize(answer)
  for(const product of requiredProducts(orchestration)){
    if(!normalizedAnswer.includes(normalize(product)))return {ok:false,reason:`missing_product:${normalize(product)}`}
  }

  const allowed=allowedNumbers({message,advice,orchestration})
  const extra=numberTokens(answer).filter(token=>!allowed.has(token))
  if(extra.length)return {ok:false,reason:`invented_number:${extra[0]}`}

  return {ok:true,payload:{answer,opening,headline}}
}

function compactInput({context,message,advice,orchestration}){
  const continuity=orchestration?.continuity||{}
  const plan=orchestration?.technicalCommercialPlan||{}
  const conversion=advice?.conversion_intelligence||{}
  return {
    request:clean(message,3_000),
    producer:{
      id:clean(context?.client?.id,160),
      name:clean(context?.client?.name,180),
      municipality:clean(context?.client?.municipality,140),
      cultures:clean(context?.client?.cultures,500),
      area:context?.client?.area??null
    },
    continuity:{
      carryForward:Boolean(continuity.carryForward),
      operation:clean(continuity.operation,160),
      products:array(continuity.productNames).slice(0,12),
      targets:array(continuity.targets).slice(0,8),
      costPerHa:continuity.costPerHa??null,
      areaHa:continuity.areaHa??null,
      previousContext:clean(continuity.contextSentence,1_000)
    },
    deterministicDecision:{
      answer:clean(advice?.answer,3_500),
      headline:clean(advice?.executive_brief?.headline,300),
      action:clean(advice?.executive_brief?.action||advice?.next_best_action,1_200),
      question:clean(advice?.executive_brief?.question||advice?.next_question?.question,900),
      deadline:clean(advice?.executive_brief?.deadline,160),
      score:conversion.score??conversion.selected_opportunity?.score??null,
      opportunity:clean(conversion.selected_opportunity?.title,220)
    },
    technicalCommercialPlan:{
      focusProduct:plan.focusProduct||null,
      contextProducts:array(plan.contextProducts).slice(0,12),
      target:clean(plan.target,180),
      costPerHa:plan.costPerHa??null,
      totalInvestment:plan.totalInvestment??null,
      breakEvenBagsPerHa:plan.breakEvenBagsPerHa??null,
      nextQuestion:clean(plan.nextQuestion,800),
      commercialValue:plan.commercialValue||null,
      technicalBoundary:clean(plan.technicalBoundary,1_200)
    }
  }
}

function mergeLanguage(advice,payload,metadata){
  const result=clone(advice)
  result.answer=payload.answer
  result.executive_brief={...(result.executive_brief||{}),headline:payload.headline}
  result.conversation_plan={...(result.conversation_plan||{}),opening:payload.opening}
  result.language_enhancement=metadata
  return result
}

export async function enhanceDecisionLanguage({client,config,context={},message='',advice={},orchestration={},signal}){
  const startedAt=Date.now()
  const model=String(config?.modelFast||'gpt-5.6-luna')
  const baseMetadata={version:VERSION,requested:true,used:false,model,status:'fallback',latencyMs:0}
  if(!client)return {advice:mergeLanguage(advice,{answer:advice.answer||'',opening:advice.conversation_plan?.opening||'',headline:advice.executive_brief?.headline||''},{...baseMetadata,status:'not_configured'}),used:false,status:'not_configured',model,latencyMs:0}

  try{
    const input=compactInput({context,message,advice,orchestration})
    const tools=orchestration?.route?.retrieval&&config?.knowledgeVectorStoreId
      ?[{type:'file_search',vector_store_ids:[config.knowledgeVectorStoreId],max_num_results:4}]
      :undefined
    const response=await client.responses.create({
      model,
      instructions:`Você é apenas a camada de linguagem da VAL. A decisão já foi calculada por regras e não pode ser alterada.
Reescreva a fala principal em português brasileiro natural, específica para o produtor e para o caso informado.
Regras obrigatórias:
- preserve todos os produtos citados e a sequência operacional;
- preserve exatamente custos, área, score, prazo e demais números recebidos; não crie nenhum número;
- não invente dose, taxa, momento de aplicação, resultado, produtividade, perda, probabilidade ou alegação de controle;
- não prometa superioridade, garantia, controle total ou retorno;
- deixe claro quando a execução depende de rótulo, bula, receituário e validação técnica;
- use no máximo 7 frases curtas;
- termine preparando a próxima decisão, sem trocar a pergunta calculada;
- não use frases genéricas como “entenda as necessidades” ou “apresente os benefícios”.
Devolva somente o JSON solicitado.`,
      input:[{role:'user',content:[{type:'input_text',text:`CONTEXTO CALCULADO E NÃO EDITÁVEL\n${JSON.stringify(input)}`}]}],
      reasoning:{effort:'low'},
      text:{format:enhancementSchema},
      store:false,
      max_output_tokens:MAX_OUTPUT_TOKENS,
      safety_identifier:createHash('sha256').update(String(context?.client?.id||context?.client?.name||'val-language')).digest('hex'),
      ...(tools?{tools}:{})
    },{
      timeout:Math.min(MAX_TIMEOUT_MS,Math.max(5_000,Number(config?.openaiTimeoutMs)||MAX_TIMEOUT_MS)),
      maxRetries:0,
      ...(signal?{signal}:{})
    })

    if(response.status!=='completed'||!response.output_text)throw Object.assign(new Error('language_incomplete'),{code:'language_incomplete',status:response.status})
    const parsed=JSON.parse(response.output_text)
    const validation=validEnhancement(parsed,{message,advice,orchestration})
    if(!validation.ok)throw Object.assign(new Error(validation.reason),{code:'invalid_language_output'})
    const latencyMs=Date.now()-startedAt
    const metadata={...baseMetadata,used:true,status:'enhanced',latencyMs,responseId:response.id||null}
    return {advice:mergeLanguage(advice,validation.payload,metadata),used:true,status:'enhanced',model,latencyMs,responseId:response.id||null}
  }catch(error){
    const latencyMs=Date.now()-startedAt
    const failure=safeFailure(error)
    const metadata={...baseMetadata,status:'fallback',latencyMs,failureCode:failure.code,failureStatus:failure.status||null}
    console.warn('[VAL_LANGUAGE_ENHANCER]',JSON.stringify({model,latencyMs,code:failure.code,status:failure.status||null}))
    return {
      advice:mergeLanguage(advice,{answer:advice.answer||'',opening:advice.conversation_plan?.opening||'',headline:advice.executive_brief?.headline||''},metadata),
      used:false,
      status:'fallback',
      model,
      latencyMs,
      failureCode:failure.code,
      failureStatus:failure.status||null
    }
  }
}

export function preserveEnhancedLanguage(reconciled={},incoming={}){
  if(incoming?.language_enhancement?.used!==true)return reconciled
  const result=clone(reconciled)
  result.answer=clean(incoming.answer,4_500)||result.answer
  result.executive_brief={...(result.executive_brief||{}),headline:clean(incoming.executive_brief?.headline,220)||result.executive_brief?.headline}
  result.conversation_plan={...(result.conversation_plan||{}),opening:clean(incoming.conversation_plan?.opening,1_000)||result.conversation_plan?.opening}
  result.language_enhancement=incoming.language_enhancement
  return result
}

export const languageEnhancerVersion=VERSION
