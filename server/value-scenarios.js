import {rankOpportunityPortfolio} from './sales-playbook.js'

const array=value=>Array.isArray(value)?value:[]
const text=(value,max=600)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const number=value=>{
 if(value===''||value==null)return null
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null
 const raw=String(value).trim().replace(/\s/g,'')
 const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw
 const parsed=Number(normalized)
 return Number.isFinite(parsed)&&parsed>=0?parsed:null
}
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
 const result={areaHa:null,costPerHa:null,unitPrice:null,scenarios:{conservative:null,base:null,optimistic:null},evidence:{areaHa:null,costPerHa:null,unitPrice:null,scenarios:{conservative:null,base:null,optimistic:null}}}
 for(const entry of messages(context)){
  const source=evidenceId('recommendation-question',entry.item,entry.index)
  const values={
   areaHa:parseValue(entry.message,[/(\d{1,7}(?:[.,]\d+)?)\s*(?:ha|hectares?)\b/i]),
   costPerHa:parseValue(entry.message,[/(?:r\$\s*)?(\d{1,7}(?:[.,]\d+)?)\s*(?:reais?)?\s*(?:\/\s*ha|por\s+ha)\b/i]),
   unitPrice:parseValue(entry.message,[/(?:saca|sc)\s*(?:a|vale|em|por|=|:)\s*(?:r\$\s*)?(\d{1,7}(?:[.,]\d+)?)/i,/(?:r\$\s*)(\d{1,7}(?:[.,]\d+)?)\s*(?:\/\s*(?:sc|saca)|por\s+saca)\b/i]),
   conservative:parseValue(entry.message,[/conservador(?:a)?\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i]),
   base:parseValue(entry.message,[/\bbase\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i]),
   optimistic:parseValue(entry.message,[/otimist(?:a|o)\s*(?:de|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:sc|sacas?)\s*\/\s*ha/i])
  }
  for(const key of ['areaHa','costPerHa','unitPrice'])if(result[key]===null&&values[key]!==null){result[key]=values[key];result.evidence[key]=source}
  for(const key of ['conservative','base','optimistic'])if(result.scenarios[key]===null&&values[key]!==null){result.scenarios[key]=values[key];result.evidence.scenarios[key]=source}
 }
 return result
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
 const structuredScenarios=Object.fromEntries(['conservative','base','optimistic'].map(key=>[key,structuredScenario(valueCases,key)]))
 const scenarios={
  conservative:structuredScenarios.conservative??parsed.scenarios.conservative,
  base:structuredScenarios.base??parsed.scenarios.base,
  optimistic:structuredScenarios.optimistic??parsed.scenarios.optimistic
 }
 const opportunityEvidence=opportunity?evidenceId('opportunity',opportunity):null
 const structuredEvidence=valueCases.length?`${opportunityEvidence||'client'}:value-case`:null
 const inputEvidence={
  areaHa:structuredArea?structuredEvidence:parsed.evidence.areaHa,
  costPerHa:structuredCost?structuredEvidence:parsed.evidence.costPerHa,
  unitPrice:structuredPrice?structuredEvidence:parsed.evidence.unitPrice,
  scenarios:Object.fromEntries(Object.entries(scenarios).map(([key,value])=>[key,value!==null?(structuredScenarios[key]!==null?structuredEvidence:parsed.evidence.scenarios[key]):null]))
 }
 const missingCore=[]
 if(areaHa===null||areaHa<=0)missingCore.push('área exata da decisão em hectares')
 if(costPerHa===null)missingCore.push('investimento por hectare')
 if(unitPrice===null||unitPrice<=0)missingCore.push('preço confirmado da unidade de comparação')
 const missingScenarios=Object.entries(scenarios).filter(([,value])=>value===null).map(([key])=>key==='conservative'?'resultado conservador em sc/ha':key==='base'?'resultado-base em sc/ha':'resultado otimista em sc/ha')
 const investmentTotal=missingCore.length?null:areaHa*costPerHa
 const breakEvenPerHa=missingCore.length?null:costPerHa/unitPrice
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
