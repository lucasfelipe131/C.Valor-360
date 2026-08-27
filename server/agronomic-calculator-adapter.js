import {AGRONOMIC_CALCULATORS,agronomicCalculatorContractVersion,executeAgronomicCalculator} from '../src/lib/agronomic-calculators.js'
import {consultZarc} from './zarc-provider.js'

export const copilotCalculatorAdapterVersion='val.copilot_calculator_adapter.v1'

const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value,5000).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const numberPattern='(\\d[\\d. ]*(?:,\\d+)?)'
const localNumber=value=>{
 const raw=String(value??'').trim()
 if(!raw)return undefined
 const parsed=Number(raw.replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'))
 return Number.isFinite(parsed)?parsed:undefined
}
const captureNumber=(source,pattern)=>localNumber(source.match(new RegExp(`${pattern}\\s*(?:de|=|:)?\\s*(?:r\\$\\s*)?${numberPattern}`,'i'))?.[1])
const captureText=(source,pattern)=>clean(source.match(pattern)?.[1],180)||undefined

export function identifyAgronomicCalculator(message=''){
 const source=normalize(message)
 const matchers=[
  ['zoneamento',/\b(?:zarc|zoneamento)\b/],['reposicao',/\b(?:extracao|exportacao|reposicao)\b.*\b(?:nutrient|npk|adub|fertiliz)|\b(?:nutrient|npk|adub|fertiliz).*\b(?:extracao|exportacao|reposicao)\b/],
  ['semeadora',/\b(?:regulagem|regular)\b.*\bsemeador|\bsemeador\w*\b.*\b(?:regulagem|regular|patinagem)\b/],
  ['sementes',/\b(?:demanda|quantidade|necessidade|quantas?)\b.*\bsemente|\bsemente\w*\b.*\b(?:demanda|quantidade|necessidade|embalagens?)\b/],
  ['populacao',/\bpopulacao\b.*\b(?:ideal|plantas?|cultivar|recomenda)|\b(?:ideal|recomenda)\w*\b.*\bpopulacao\b/],
  ['colheita',/\b(?:previsao|estimar?|estimativa|quando)\b.*\bcolheit|\bcolheit\w*\b.*\b(?:previsao|estimar?|estimativa|quando)\b/],
  ['cotacao',/\b(?:cotacao|orcamento|proposta)\b.*\b(?:insumo|produto|desconto|sacos?|kg|litros?)\b/],
  ['pulverizacao',/\b(?:pulveriz|calda|tanques?)\w*\b/],['fertilizante',/\b(?:fertilizante|adubo|pontos?\s+npk|fornecimento)\b/],
 ]
 return matchers.find(([,pattern])=>pattern.test(source))?.[0]||null
}

function cropFrom(source,{zarc=false}={}){
 if(/\bsoja\b/.test(source))return zarc?'soja':'Soja'
 if(/\btrigo\b/.test(source))return zarc?'trigo':'Trigo'
 if(/\bcanola\b/.test(source))return zarc?'':'Canola'
 if(/\bmilho\b/.test(source))return zarc?(/\b(?:safrinha|2\s*(?:a|ª)?\s*safra|segunda safra)\b/.test(source)?'milho-safrinha':'milho-verao'):'Milho'
 return undefined
}

function dateFrom(source){
 const iso=source.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
 if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`
 const br=source.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/)
 return br?`${br[3]}-${String(Number(br[2])).padStart(2,'0')}-${String(Number(br[1])).padStart(2,'0')}`:undefined
}

function locationFrom(source){
 const explicit=source.match(/\bmunicipio\s+(?:de\s+)?([a-z][a-z .'-]{1,80}?)\s*(?:,|\/|-)\s*(?:uf\s*)?([a-z]{2})\b/i)
 const located=source.match(/\bem\s+([a-z][a-z .'-]{1,80}?)\s*\/\s*([a-z]{2})\b/i)
 const match=explicit||located
 const uf=match?.[2]?.toUpperCase()||source.match(/\buf\s*(?:=|:)?\s*([a-z]{2})\b/i)?.[1]?.toUpperCase()
 const municipality=clean(match?.[1],100)||captureText(source,/\bmunicipio\s*(?:=|:)?\s*([a-z][a-z .'-]{1,80}?)(?=\s*,\s*uf\b|\s+(?:solo|cultura|cultivar|grupo|ciclo|data)\b|$)/i)
 return {municipality,uf}
}

function cultivarFrom(source){
 const name=captureText(source,/\bcultivar\s*(?:=|:)?\s*([a-z0-9 ._/-]{1,80}?)(?=\s*,|\s+(?:com\s+)?ciclo\b|$)/i)
 const cycleDays=captureNumber(source,'(?:ciclo(?:\\s+central)?|gmr\\s+em\\s+dias)')
 const range=source.match(/\b(?:faixa|intervalo)(?:\s+de)?\s*(\d{2,3})\s*(?:a|-|–)\s*(\d{2,3})\s*dias?\b/i)
 if(!name&&!cycleDays&&!range)return undefined
 const min=Number(range?.[1]??Math.max(1,Number(cycleDays||0)-7))
 const max=Number(range?.[2]??Number(cycleDays||0)+7)
 return {name,cycleDays,cycleRangeDays:[min,max],cycleClass:captureText(source,/\bclasse(?:\s+de\s+ciclo)?\s*(?:=|:)?\s*([a-z]+)\b/i)}
}

function parsePlanter(source){
 return {
  populationPlantsHa:captureNumber(source,'populacao(?:\\s+(?:final|alvo))?'),spacingCm:captureNumber(source,'espacamento'),
  germinationPercent:captureNumber(source,'germinacao'),fieldSurvivalPercent:captureNumber(source,'(?:sobrevivencia|emergencia)(?:\\s+de\\s+campo)?'),
  slippagePercent:captureNumber(source,'patinagem')??0,bagSeeds:captureNumber(source,'(?:sementes\\s+por\\s+)?embalagem'),
  testDistanceM:captureNumber(source,'(?:distancia\\s+de\\s+teste|teste)'),testRows:captureNumber(source,'linhas?')??localNumber(source.match(new RegExp(`${numberPattern}\\s*linhas?\\b`,'i'))?.[1]),
  wheelCircumferenceM:captureNumber(source,'circunferencia(?:\\s+da)?\\s+roda'),
 }
}

function parsePopulation(source){
 const location=locationFrom(source)
 return {crop:cropFrom(source),cultivar:cultivarFrom(source),plantingDate:dateFrom(source),...location,
  environment:/\brestritiv[oa]\b/.test(source)?'restritivo':/\balto potencial\b|\bambiente alto\b/.test(source)?'alto':/\bambiente medio\b|\bmedio potencial\b/.test(source)?'medio':undefined,
  yieldGapPercent:captureNumber(source,'yield gap'),germinationPercent:captureNumber(source,'germinacao'),emergencePercent:captureNumber(source,'emergencia'),spacingCm:captureNumber(source,'espacamento'),
 }
}

function parseSeeds(source){
 return {areaHa:captureNumber(source,'area'),populationSeedsHa:captureNumber(source,'populacao(?:\\s+de\\s+semeadura)?'),marginPercent:captureNumber(source,'margem(?:\\s+tecnica)?')??0,bagSeeds:captureNumber(source,'(?:sementes\\s+por\\s+)?embalagem')}
}

function parseHarvest(source){
 const location=locationFrom(source)
 return {crop:cropFrom(source),cultivar:cultivarFrom(source),plantingDate:dateFrom(source),...location,latitude:captureNumber(source,'latitude'),harvestConditionDays:captureNumber(source,'(?:ajuste|condicao)(?:\\s+de\\s+colheita)?')??0}
}

function parseZarc(source){
 const location=locationFrom(source)
 const soilMatch=source.match(/\b(?:solo\s*(?:=|:)?\s*)?(ad)?\s*(\d{1,2})\b/i)
 const soilSource=soilMatch?.[1]?String(10+Number(soilMatch[2])):soilMatch?.[2]
 const roman=source.match(/\bgrupo\s*(i{1,3}|iv|v|vi)\b/i)?.[1]?.toUpperCase()
 const groups={I:'20',II:'21',III:'22',IV:'24',V:'25',VI:'26'}
 const cycle=source.match(/\b(?:grupo|ciclo)\s*(?:=|:)?\s*(2[0-6])\b/i)?.[1]||groups[roman]
 return {...location,crop:cropFrom(source,{zarc:true}),soil:soilSource,cycle}
}

function parseSpraying(source){
 const unit=source.match(/\b(ml\/ha|l\/ha|kg\/ha|g\/ha)\b/i)?.[1]
 const dose=captureNumber(source,'dose')
 const product=captureText(source,/\bproduto\s*(?:=|:)?\s*([a-z0-9 ._/-]{1,100}?)(?=\s*,|\s+dose\b|$)/i)
 const canonicalUnit=unit?.toLowerCase()==='ml/ha'?'mL/ha':unit?.toLowerCase()==='l/ha'?'L/ha':unit?.toLowerCase()==='kg/ha'?'kg/ha':unit?.toLowerCase()==='g/ha'?'g/ha':'L/ha'
 return {areaHa:captureNumber(source,'area'),sprayVolumeLHa:captureNumber(source,'(?:volume(?:\\s+de\\s+calda)?|calda)'),tankVolumeL:captureNumber(source,'(?:volume(?:\\s+do)?\\s+tanque|tanque)'),items:product&&dose?[{product,dose,unit:canonicalUnit}]:[]}
}

function parseFertilizer(source){
 const npk=source.match(/\b(\d{1,2})-(\d{1,2})-(\d{1,2})\b/)
 const bagKg=captureNumber(source,'(?:peso(?:\\s+da)?\\s+embalagem|saco|embalagem)')
 const price=captureNumber(source,'preco')
 const priceUnit=source.match(/\b(?:r\$\s*)?\/(t|kg|saco)\b/i)?.[1]?.toLowerCase()||(/\bpor tonelada\b/.test(source)?'t':/\bpor saco\b/.test(source)?'saco':'kg')
 const pricePerKg=price===undefined?undefined:priceUnit==='t'?price/1000:priceUnit==='saco'?price/Math.max(1,bagKg||0):price
 return {areaHa:captureNumber(source,'area'),rateKgHa:captureNumber(source,'(?:dose(?:\\s+planejada)?|taxa)'),bagKg,pricePerKg,efficiencyPercent:captureNumber(source,'eficiencia')??100,
  guarantees:npk?{N:Number(npk[1]),P2O5:Number(npk[2]),K2O:Number(npk[3]),S:captureNumber(source,'enxofre')??0}:{N:captureNumber(source,'garantia\\s+n'),P2O5:captureNumber(source,'garantia\\s+p(?:2o5)?'),K2O:captureNumber(source,'garantia\\s+k(?:2o)?'),S:captureNumber(source,'garantia\\s+s')},
 }
}

function parseNutrientRemoval(source){
 const yieldMatch=source.match(new RegExp(`(?:produtividade|producao)\\s*(?:de|=|:)?\\s*${numberPattern}\\s*(sc\/ha|kg\/ha|t\/ha)`,'i'))
 return {crop:cropFrom(source),yieldValue:localNumber(yieldMatch?.[1]),yieldUnit:yieldMatch?.[2],basis:/\bextracao\b/.test(source)?'extraction':'export',credits:{},soilAdjustments:{},efficiencies:{N:70,P2O5:85,K2O:90,S:80}}
}

function parseQuote(source){
 const quantity=captureNumber(source,'quantidade')??localNumber(source.match(new RegExp(`${numberPattern}\\s*(?:sacos?|unidades?|kg|l|t)\\b`,'i'))?.[1])
 const price=captureNumber(source,'(?:preco(?:\\s+de\\s+sistema)?|valor(?:\\s+unitario)?)')
 const discount=captureNumber(source,'desconto')??0
 const product=captureText(source,/\bproduto\s*(?:=|:)?\s*([a-z0-9 ._/-]{1,100}?)(?=\s*,|\s+(?:quantidade|preco|valor|desconto)\b|$)/i)||'Item informado'
 const unit=source.match(/\b(sacos?|unidades?|kg|l|t)\b/i)?.[1]||'un.'
 return {items:quantity&&price?[{product,quantity,unit,systemPrice:price,discountPercent:discount}]:[]}
}

export function parseAgronomicCalculatorRequest(message='',calculator=identifyAgronomicCalculator(message)){
 const source=normalize(message)
 if(calculator==='semeadora')return parsePlanter(source)
 if(calculator==='populacao')return parsePopulation(source)
 if(calculator==='sementes')return parseSeeds(source)
 if(calculator==='colheita')return parseHarvest(source)
 if(calculator==='zoneamento')return parseZarc(source)
 if(calculator==='pulverizacao')return parseSpraying(source)
 if(calculator==='fertilizante')return parseFertilizer(source)
 if(calculator==='reposicao')return parseNutrientRemoval(source)
 if(calculator==='cotacao')return parseQuote(source)
 return {}
}

function legacyCostPerHectare(message=''){
 const source=String(message).replace(/\./g,'').replace(/,(?=\d{1,2}\b)/g,'.')
 const costMatch=source.match(/(?:custo(?:\s+total)?|total)\s*(?:de|=|:)?\s*(?:r\$\s*)?(\d+(?:\.\d+)?)/i)||source.match(/r\$\s*(\d+(?:\.\d+)?)/i)
 const areaMatch=source.match(/(?:area|em)\s*(?:de|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:ha|hectares?)/i)||source.match(/(\d+(?:\.\d+)?)\s*(?:ha|hectares?)/i)
 const total=Number(costMatch?.[1]);const area=Number(areaMatch?.[1])
 return total>0&&area>0?{total_cost:total,area_ha:area,cost_per_ha:Number((total/area).toFixed(2)),currency:'BRL',formula:'total_cost / area_ha'}:null
}

const summaryFor=(key,output)=>{
 if(key==='semeadora')return `Regulagem calculada: ${output.seedsMeter.toLocaleString('pt-BR',{maximumFractionDigits:2})} sementes/m e ${Math.round(output.seedsHa).toLocaleString('pt-BR')} sementes/ha.`
 if(key==='populacao')return `População calculada: alvo de ${output.finalTarget.toLocaleString('pt-BR')} plantas/ha e ${output.seedsPerMeter.toLocaleString('pt-BR',{maximumFractionDigits:2})} sementes/m.`
 if(key==='sementes')return `Demanda calculada: ${Math.round(output.seedsRequired).toLocaleString('pt-BR')} sementes, ${output.bagsRequired} embalagem(ns).`
 if(key==='colheita')return `Previsão calculada: ${output.central.toLocaleDateString('pt-BR')}, com janela de ${output.start.toLocaleDateString('pt-BR')} a ${output.end.toLocaleDateString('pt-BR')}.`
 if(key==='zoneamento')return `ZARC ${output.safra}: ${output.cropLabel} em ${output.municipality}/${output.uf}, fonte oficial MAPA consultada em ${output.updatedAt}.`
 if(key==='pulverizacao')return `Operação calculada: ${output.totalSprayL.toLocaleString('pt-BR')} L de calda em ${output.tankCount} tanque(s).`
 if(key==='fertilizante')return `Fertilizante calculado: ${output.pointsNpkHa.toLocaleString('pt-BR',{maximumFractionDigits:1})} pontos NPK/ha e ${output.totalKg.toLocaleString('pt-BR')} kg no total.`
 if(key==='reposicao')return `Extração/exportação calculada para ${output.crop}: ${output.yieldTon.toLocaleString('pt-BR',{maximumFractionDigits:2})} t/ha, com coeficientes e fonte técnica preservados.`
 return `Cotação calculada: total de ${output.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}, desconto de ${output.discount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`
}

export async function executeCopilotCalculator(message='',options={}){
 const calculator=identifyAgronomicCalculator(message)
 if(!calculator){
  const legacy=legacyCostPerHectare(message)
  if(legacy)return {adapter_version:copilotCalculatorAdapterVersion,contract_version:'val.legacy_cost_per_ha.v1',calculator:'cost_per_ha',status:'EXECUTED',input:{total_cost_brl:legacy.total_cost,area_ha:legacy.area_ha},output:legacy,summary:`Custo calculado: R$ ${legacy.cost_per_ha.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}/ha, usando custo total e área informados.`,source_ref:'calculator:cost_per_ha'}
  const costPerArea=/custo\s*(?:\/\s*ha|por\s+hectare)/i.test(message)
  return {adapter_version:copilotCalculatorAdapterVersion,contract_version:agronomicCalculatorContractVersion,calculator:null,status:/\b(?:calcule|calcular|quanto|resultado)\b/i.test(message)||costPerArea?'INPUT_REQUIRED':'READY',required_inputs:costPerArea?['total_cost_brl','area_ha']:[],catalog:AGRONOMIC_CALCULATORS,summary:'Escolha uma das nove calculadoras canônicas ou informe o cálculo e suas entradas.'}
 }
 const input=parseAgronomicCalculatorRequest(message,calculator)
 try{
  const execution=await executeAgronomicCalculator(calculator,input,{zarcProvider:payload=>consultZarc(payload,options.zarcOptions)})
  return {...execution,adapter_version:copilotCalculatorAdapterVersion,summary:execution.status==='EXECUTED'?summaryFor(calculator,execution.output):`Faltam entradas materiais para ${AGRONOMIC_CALCULATORS.find(item=>item.key===calculator)?.title||calculator}: ${(execution.required_inputs||[]).join(', ')}.`}
 }catch(error){
  return {adapter_version:copilotCalculatorAdapterVersion,contract_version:agronomicCalculatorContractVersion,calculator,status:error?.code==='zarc_not_found'?'NO_DATA':'SOURCE_UNAVAILABLE',required_inputs:[],error:clean(error?.message||'Falha ao executar a calculadora.',500),summary:clean(error?.message||'A fonte necessária não respondeu.',500)}
 }
}
