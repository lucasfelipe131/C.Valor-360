import {rankOpportunityPortfolio} from './sales-playbook.js'

const array=value=>Array.isArray(value)?value:[]
const text=(value,max=600)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const number=value=>{if(value===''||value==null)return null;const parsed=Number(String(value).replace(/\./g,'').replace(',','.'));return Number.isFinite(parsed)&&parsed>=0?parsed:null}
const closed=value=>/^(?:fechado|ganho|conclu[ií]do|perdido|cancelado|closed|won|lost)$/i.test(text(value))
const unique=items=>[...new Set(items.filter(Boolean))]
const evidenceId=(prefix,item,index=0)=>`${prefix}:${text(item?.id||item?.external_key||item?.externalKey||index,160)}`

function firstNumber(objects,keys){
 for(const object of objects)for(const key of keys){const value=number(object?.[key]);if(value!==null)return {value,key}}
 return null
}

function valueCaseOf(opportunity,context){
 return [opportunity?.value_case,opportunity?.valueCase,opportunity?.payload?.value_case,opportunity?.payload?.valueCase,context?.client?.commercial?.value_case,context?.client?.commercial?.valueCase].filter(value=>value&&typeof value==='object')
}

function messages(context){
 return array(context.priorRecommendations).map((item,index)=>({item,index,at:new Date(item?.created_at||item?.createdAt||0).getTime()||0,message:text(item?.user_question||item?.question,1600)})).filter(item=>item.message).sort((a,b)=>b.at-a.at)
}

function parseValue(message,patterns){
 for(const pattern of patterns){const match=message.match(pattern);if(match){const value=number(match[1]);if(value!==null)return value}}
 return null
}

function parsedInputs(context){
 for(const entry of messages(context)){
  const areaHa=parseValue(entry.message,[/(\d{1,7}(?:[.,]\d+)?)\s*(?:ha|hectares?)\b/i])
  const costPerHa=parseValue(entry.message,[/(?:r\$\s*)?(\d{1,7}(?:[.,]\d+)?)\s*(?:reais?)?\s*(?:\/\s*ha|por\s+ha)\b/i])
  const unitPrice=parseValue(entry.message,[/(?:saca|sc)\s*(?:a|vale|em|por|=|:)\s*(?:r\$\s*)?(\d{1,7}(?:[.,]\d+)?)/i,/(?:r\$\s*)(\d{1,7}(?:[.,]\d+)?)\s*(?:\/\s*(?:sc|saca)|por\s+saca)\b/i])
  const conservative=parseValue(entry.message,[/conservador(?:a)?\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i])
  const base=parseValue(entry.message,[/\bbase\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i])
  const optimistic=parseValue(entry.message,[/otimist(?:a|o)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i])
  if([areaHa,costPerHa,unitPrice,conservative,base,optimistic].some(value=>value!==null))return {areaHa,costPerHa,unitPrice,scenarios:{conservative,base,optimistic},evidenceId:evidenceId('recommendation-question',entry.item,entry.index),sourceText:entry.message}
 }
 return {areaHa:null,costPerHa:null,unitPrice:null,scenarios:{conservative:null,base:null,optimistic:null},evidenceId:null,sourceText:''}
}

function structuredScenario(valueCases,key){
 const names=key==='conservative'?['conservative','conservador']:key==='optimistic'?['optimistic','otimista']:['base']
 for(const valueCase of valueCases)for(const name of names){
  const scenario=valueCase?.scenarios?.[name]||valueCase?.[name]
  const value=number(scenario?.units_per_ha??scenario?.unitsPerHa??scenario?.sc_per_ha??scenario?.scPerHa??scenario)
  if(value!==null)return value
 }
 return null
}

export function buildValueScenarios(context={},options={}){
 const now=options.now??Date.now()
 const opportunity=rankOpportunityPortfolio(array(context.opportunities).filter(item=>item&&!closed(item.stage)),now)[0]||null
 const valueCases=valueCaseOf(opportunity,context)
 const parsed=parsedInputs(context)
 const structuredArea=firstNumber(valueCases,['area_ha','areaHa','confirmed_area_ha','confirmedAreaHa'])
 const structuredCost=firstNumber(valueCases,['cost_per_ha','costPerHa','investment_per_ha','investmentPerHa'])
 const structuredPrice=firstNumber(valueCases,['commodity_price_per_sack','commodityPricePerSack','price_per_unit','pricePerUnit','sack_price','sackPrice'])
 const areaHa=structuredArea?.value??parsed.areaHa
 const costPerHa=structuredCost?.value??parsed.costPerHa
 const unitPrice=structuredPrice?.value??parsed.unitPrice
 const scenarios={
  conservative:structuredScenario(valueCases,'conservative')??parsed.scenarios.conservative,
  base:structuredScenario(valueCases,'base')??parsed.scenarios.base,
  optimistic:structuredScenario(valueCases,'optimistic')??parsed.scenarios.optimistic
 }
 const opportunityEvidence=opportunity?evidenceId('opportunity',opportunity):null
 const structuredEvidence=valueCases.length?`${opportunityEvidence||'client'}:value-case`:null
 const inputEvidence={
  areaHa:structuredArea?structuredEvidence:parsed.areaHa!==null?parsed.evidenceId:null,
  costPerHa:structuredCost?structuredEvidence:parsed.costPerHa!==null?parsed.evidenceId:null,
  unitPrice:structuredPrice?structuredEvidence:parsed.unitPrice!==null?parsed.evidenceId:null,
  scenarios:Object.fromEntries(Object.entries(scenarios).map(([key,value])=>[key,value!==null?(structuredScenario(valueCases,key)!==null?structuredEvidence:parsed.evidenceId):null]))
 }
 const missingCore=[]
 if(areaHa===null)missingCore.push('área exata da decisão em hectares')
 if(costPerHa===null)missingCore.push('investimento por hectare')
 if(unitPrice===null)missingCore.push('preço confirmado da unidade de comparação')
 const missingScenarios=Object.entries(scenarios).filter(([,value])=>value===null).map(([key])=>key==='conservative'?'resultado conservador em sc/ha':key==='base'?'resultado-base em sc/ha':'resultado otimista em sc/ha')
 const investmentTotal=missingCore.length?null:areaHa*costPerHa
 const breakEvenPerHa=missingCore.length?null:unitPrice>0?costPerHa/unitPrice:null
 const calculated=!missingCore.length&&!missingScenarios.length
 const rows=calculated?[
  ['conservative','Conservador',scenarios.conservative],['base','Base',scenarios.base],['optimistic','Otimista',scenarios.optimistic]
 ].map(([id,label,unitsPerHa])=>{
  const grossPerHa=unitsPerHa*unitPrice
  const grossTotal=grossPerHa*areaHa
  return {id,label,unitsPerHa,grossPerHa,grossTotal,netPerHa:grossPerHa-costPerHa,netTotal:grossTotal-investmentTotal,evidenceIds:unique([inputEvidence.areaHa,inputEvidence.costPerHa,inputEvidence.unitPrice,inputEvidence.scenarios[id]])}
 }):[]
 return {
  version:'val-value-scenarios-v1',generatedAt:new Date(now).toISOString(),
  opportunity:{id:String(opportunity?.id||''),title:text(opportunity?.title||opportunity?.category||'Oportunidade em avaliação',180)},
  status:missingCore.length?'missing_core_inputs':missingScenarios.length?'ready_for_explicit_scenarios':'calculated',
  confirmedInputs:{areaHa,costPerHa,unitPrice,unit:'sc/ha',inputEvidence},
  missingInputs:[...missingCore,...missingScenarios],investmentTotal,breakEvenPerHa,scenarios:rows,
  policy:{explicitInputsOnly:true,generatedAssumptions:false,technicalPrediction:false,scenarioKind:'user_confirmed_sensitivity'},
  guidance:missingCore.length?'Confirme os números essenciais antes de calcular qualquer cenário.':missingScenarios.length?'Investimento e ponto de equilíbrio já podem ser calculados. Para comparar três cenários, registre explicitamente os resultados conservador, base e otimista em sc/ha.':'Os três cenários são uma simulação econômica com premissas informadas; não são previsão agronômica nem garantia de resultado.',
  guardrail:'Não use a simulação como promessa de produtividade, controle ou retorno. Produto, dose, mistura e aplicação continuam sujeitos à revisão técnica habilitada.'
 }
}
