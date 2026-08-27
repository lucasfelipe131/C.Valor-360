import {estimateRegionalHarvest,recommendPlantPopulation} from './agronomic-planning.js'

export const agronomicCalculatorContractVersion='AgronomicCalculatorAdapter.v1'

export const AGRONOMIC_CALCULATORS=Object.freeze([
 Object.freeze({key:'semeadora',title:'Regulagem de semeadora',group:'Plantabilidade',implementation:'calculatePlanter',mode:'DETERMINISTIC'}),
 Object.freeze({key:'populacao',title:'População ideal',group:'Plantabilidade',implementation:'recommendPlantPopulation',mode:'DETERMINISTIC'}),
 Object.freeze({key:'sementes',title:'Demanda de sementes',group:'Plantabilidade',implementation:'calculateSeedDemand',mode:'DETERMINISTIC'}),
 Object.freeze({key:'colheita',title:'Previsão de colheita',group:'Plantabilidade',implementation:'estimateRegionalHarvest',mode:'DETERMINISTIC'}),
 Object.freeze({key:'zoneamento',title:'Zoneamento ZARC',group:'Plantabilidade',implementation:'zarcProvider',mode:'CURRENT_SOURCE'}),
 Object.freeze({key:'pulverizacao',title:'Pulverização',group:'Pulverização',implementation:'calculateSpraying',mode:'DETERMINISTIC'}),
 Object.freeze({key:'fertilizante',title:'Fertilizantes',group:'Fertilizantes',implementation:'calculateFertilizer',mode:'DETERMINISTIC'}),
 Object.freeze({key:'reposicao',title:'Extração e exportação',group:'Fertilizantes',implementation:'calculateNutrientRemoval',mode:'DETERMINISTIC'}),
 Object.freeze({key:'cotacao',title:'Cotação de insumos',group:'Custos',implementation:'calculateQuote',mode:'DETERMINISTIC'}),
])

const calculatorKeys=new Set(AGRONOMIC_CALCULATORS.map(item=>item.key))
const nutrients=Object.freeze(['N','P2O5','K2O','S'])
const number=value=>{
 if(typeof value==='string')value=value.trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.')
 const parsed=Number(value)
 return Number.isFinite(parsed)?parsed:0
}
const clamp=(value,min,max)=>Math.min(max,Math.max(min,number(value)))
const round=(value,digits=6)=>Number(number(value).toFixed(digits))
const positive=value=>number(value)>0
const text=value=>String(value??'').trim()
const nutrientRecord=(value={},fallback=0)=>Object.fromEntries(nutrients.map(key=>[key,number(value?.[key]??fallback)]))

export function calculatePlanter(input={}){
 const rowSpacing=Math.max(number(input.spacingCm),.1)/100
 const targetPlantsMeter=number(input.populationPlantsHa)*rowSpacing/10000
 const establishment=Math.max(number(input.germinationPercent)/100*number(input.fieldSurvivalPercent)/100,.01)
 const rawSeedsMeter=targetPlantsMeter/establishment
 const seedsMeter=rawSeedsMeter*(1+number(input.slippagePercent)/100)
 const seedsHa=seedsMeter*10000/rowSpacing
 const bagSeeds=number(input.bagSeeds)
 const testDistance=number(input.testDistanceM)
 const testRows=number(input.testRows)
 const wheelCircumference=number(input.wheelCircumferenceM)
 return Object.freeze({
  targetPlantsMeter:round(targetPlantsMeter),seedsMeter:round(seedsMeter),seedsHa:round(seedsHa),
  distance:seedsMeter>0?round(100/seedsMeter):0,bagsHa:bagSeeds>0?round(seedsHa/bagSeeds):0,
  expectedTest:round(seedsMeter*testDistance*testRows),wheelTurns:wheelCircumference>0?round(testDistance/wheelCircumference):0,
  establishmentPercent:round(establishment*100),
 })
}

export function calculateSeedDemand(input={}){
 const areaHa=Math.max(0,number(input.areaHa))
 const populationSeedsHa=Math.max(0,number(input.populationSeedsHa))
 const marginPercent=number(input.marginPercent)
 const bagSeeds=Math.max(1,number(input.bagSeeds))
 const seedsRequired=areaHa*populationSeedsHa*(1+marginPercent/100)
 return Object.freeze({areaHa,populationSeedsHa,marginPercent,seedsRequired:round(seedsRequired),bagsRequired:Math.ceil(seedsRequired/bagSeeds),bagSeeds})
}

function sprayTotal(dose,unit,areaHa){
 const raw=number(dose)*areaHa
 if(unit==='mL/ha')return raw>=1000?{value:round(raw/1000),unit:'L'}:{value:round(raw),unit:'mL'}
 if(unit==='g/ha')return raw>=1000?{value:round(raw/1000),unit:'kg'}:{value:round(raw),unit:'g'}
 return {value:round(raw),unit:unit==='kg/ha'?'kg':'L'}
}

export function calculateSpraying(input={}){
 const areaHa=Math.max(0,number(input.areaHa))
 const sprayVolumeLHa=Math.max(0,number(input.sprayVolumeLHa))
 const tankVolumeL=Math.max(1,number(input.tankVolumeL))
 const totalSprayL=areaHa*sprayVolumeLHa
 const items=(Array.isArray(input.items)?input.items:[]).map(item=>Object.freeze({
  product:text(item?.product),dose:number(item?.dose),unit:['L/ha','mL/ha','kg/ha','g/ha'].includes(item?.unit)?item.unit:'L/ha',
  total:Object.freeze(sprayTotal(item?.dose,item?.unit,areaHa)),
 }))
 return Object.freeze({areaHa,sprayVolumeLHa,tankVolumeL,totalSprayL:round(totalSprayL),tankCount:Math.ceil(totalSprayL/tankVolumeL),areaPerTankHa:sprayVolumeLHa>0?round(tankVolumeL/sprayVolumeLHa):0,items:Object.freeze(items)})
}

export function calculateFertilizer(input={}){
 const areaHa=Math.max(0,number(input.areaHa))
 const rateKgHa=Math.max(0,number(input.rateKgHa))
 const bagKg=Math.max(1,number(input.bagKg))
 const pricePerKg=Math.max(0,number(input.pricePerKg))
 const efficiencyPercent=number(input.efficiencyPercent)
 const guarantees=Object.fromEntries(Object.entries(input.guarantees&&typeof input.guarantees==='object'?input.guarantees:{}).map(([key,value])=>[key,number(value)]))
 const suppliedKgHa=Object.fromEntries(Object.entries(guarantees).map(([key,value])=>[key,round(value*rateKgHa/100)]))
 const pointsNpk=number(suppliedKgHa.N)+number(suppliedKgHa.P2O5)+number(suppliedKgHa.K2O)
 return Object.freeze({
  areaHa,rateKgHa,bagKg,pricePerKg,efficiencyPercent,guarantees:Object.freeze(guarantees),suppliedKgHa:Object.freeze(suppliedKgHa),
  pointsNpkHa:round(pointsNpk),effectivePointsNpkHa:round(pointsNpk*efficiencyPercent/100),costPerHa:round(pricePerKg*rateKgHa,2),
  totalKg:round(areaHa*rateKgHa),bagsRequired:Math.ceil(areaHa*rateKgHa/bagKg),
 })
}

export const NUTRIENT_PROFILES=Object.freeze({
 Soja:Object.freeze({bagKg:60,extraction:Object.freeze({N:83,P2O5:15.4,K2O:38,S:15}),export:Object.freeze({N:56,P2O5:11,K2O:18,S:5.4}),source:'Embrapa Soja · Indicações Técnicas para a Região Sul (2025)',note:'Na soja, a demanda de N é atendida predominantemente pela fixação biológica quando a inoculação e a nodulação são adequadas.'}),
 Milho:Object.freeze({bagKg:60,extraction:Object.freeze({N:24.3,P2O5:10,K2O:23.9,S:3}),export:Object.freeze({N:16.1,P2O5:7.5,K2O:5.6,S:1.2}),source:'Embrapa Milho e Sorgo · Circular Técnica 181',note:'A reposição apenas da exportação pode reduzir estoques de N e K em sistemas de alta produtividade; confira solo, palhada e histórico.'}),
 Trigo:Object.freeze({bagKg:60,extraction:Object.freeze({N:30,P2O5:15,K2O:20,S:4}),export:Object.freeze({N:23,P2O5:10,K2O:6,S:2.5}),source:'Embrapa Trigo · Informações Técnicas Trigo e Triticale',note:'P₂O₅ e K₂O seguem a referência regional de 15/20 kg/t absorvidos e 10/6 kg/t exportados; N e S devem ser ajustados à análise e ao sistema.'}),
 Canola:Object.freeze({bagKg:60,extraction:Object.freeze({N:47.6,P2O5:18,K2O:58.6,S:17.2}),export:Object.freeze({N:33.6,P2O5:13.4,K2O:7,S:3.8}),source:'Canola Council of Canada · Uptake and removal guidelines (2023)',note:'Valores convertidos de lb/bu considerando 50 lb por bushel. Ajuste à análise de solo e às indicações regionais brasileiras.'}),
})

export function calculateNutrientRemoval(input={}){
 const crop=text(input.crop)
 const profile=NUTRIENT_PROFILES[crop]
 if(!profile)throw Object.assign(new Error('Cultura não suportada pela calculadora de extração e exportação.'),{code:'calculator_invalid_crop'})
 const yieldValue=Math.max(0,number(input.yieldValue))
 const yieldUnit=input.yieldUnit==='t/ha'||input.yieldUnit==='kg/ha'?input.yieldUnit:'sc/ha'
 const yieldTon=yieldUnit==='t/ha'?yieldValue:yieldUnit==='kg/ha'?yieldValue/1000:yieldValue*profile.bagKg/1000
 const basis=input.basis==='extraction'?'extraction':'export'
 const credits=nutrientRecord(input.credits)
 const soilAdjustments=nutrientRecord(input.soilAdjustments)
 const defaultEfficiencies={N:70,P2O5:85,K2O:90,S:80}
 const efficiencies=Object.fromEntries(nutrients.map(key=>[key,number(input.efficiencies?.[key]??defaultEfficiencies[key])]))
 const demand=Object.fromEntries(nutrients.map(key=>[key,round(profile[basis][key]*yieldTon)]))
 const fertilizerTargets=Object.fromEntries(nutrients.map(key=>[key,round(Math.max(0,demand[key]+soilAdjustments[key]-credits[key])/Math.max(.01,efficiencies[key]/100))]))
 return Object.freeze({crop,yieldValue,yieldUnit,yieldTon:round(yieldTon),basis,profile,demand:Object.freeze(demand),credits:Object.freeze(credits),soilAdjustments:Object.freeze(soilAdjustments),efficiencies:Object.freeze(efficiencies),fertilizerTargets:Object.freeze(fertilizerTargets)})
}

export function calculateQuote(input={}){
 const items=(Array.isArray(input.items)?input.items:[]).map(item=>{
  const quantity=Math.max(0,number(item?.quantity))
  const systemPrice=Math.max(0,number(item?.systemPrice))
  const discountPercent=clamp(item?.discountPercent??item?.discount,0,100)
  const finalUnitPrice=systemPrice*(1-discountPercent/100)
  return Object.freeze({product:text(item?.product),quantity,unit:text(item?.unit)||'un.',systemPrice,discountPercent,finalUnitPrice:round(finalUnitPrice,2),finalTotal:round(quantity*finalUnitPrice,2)})
 })
 const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.systemPrice,0)
 const total=items.reduce((sum,item)=>sum+item.finalTotal,0)
 return Object.freeze({currency:'BRL',items:Object.freeze(items),subtotal:round(subtotal,2),discount:round(subtotal-total,2),total:round(total,2)})
}

const requiredByCalculator=Object.freeze({
 semeadora:[['populationPlantsHa',positive],['spacingCm',positive],['germinationPercent',positive],['fieldSurvivalPercent',positive],['bagSeeds',positive],['testDistanceM',positive],['testRows',positive],['wheelCircumferenceM',positive]],
 populacao:[['crop',text],['cultivar',value=>value&&text(value.name)&&positive(value.cycleDays)&&Array.isArray(value.cycleRangeDays)],['plantingDate',text],['municipality',text],['uf',text],['environment',text],['germinationPercent',positive],['emergencePercent',positive],['spacingCm',positive]],
 sementes:[['areaHa',positive],['populationSeedsHa',positive],['bagSeeds',positive]],
 colheita:[['crop',text],['cultivar',value=>value&&text(value.name)&&positive(value.cycleDays)&&Array.isArray(value.cycleRangeDays)],['plantingDate',text],['municipality',text],['uf',text]],
 zoneamento:[['uf',text],['municipality',text],['crop',text],['soil',text],['cycle',text]],
 pulverizacao:[['areaHa',positive],['sprayVolumeLHa',positive],['tankVolumeL',positive]],
 fertilizante:[['areaHa',positive],['rateKgHa',positive],['bagKg',positive],['guarantees',value=>value&&typeof value==='object'&&Object.values(value).some(positive)]],
 reposicao:[['crop',text],['yieldValue',positive],['yieldUnit',text],['basis',text]],
 cotacao:[['items',value=>Array.isArray(value)&&value.length>0&&value.every(item=>positive(item?.quantity)&&positive(item?.systemPrice))]],
})

export function requiredCalculatorInputs(key,input={}){
 const rules=requiredByCalculator[key]||[]
 return rules.filter(([name,validate])=>!validate(input?.[name])).map(([name])=>name)
}

export async function executeAgronomicCalculator(key,input={},options={}){
 if(!calculatorKeys.has(key))return Object.freeze({contract_version:agronomicCalculatorContractVersion,calculator:key,status:'UNSUPPORTED',required_inputs:[],error:'Calculadora não reconhecida.'})
 const required=requiredCalculatorInputs(key,input)
 if(required.length)return Object.freeze({contract_version:agronomicCalculatorContractVersion,calculator:key,status:'INPUT_REQUIRED',required_inputs:Object.freeze(required),inputs:Object.freeze({...input})})
 let output
 if(key==='semeadora')output=calculatePlanter(input)
 else if(key==='populacao')output=recommendPlantPopulation(input)
 else if(key==='sementes')output=calculateSeedDemand(input)
 else if(key==='colheita')output=estimateRegionalHarvest(input)
 else if(key==='zoneamento'){
  if(typeof options.zarcProvider!=='function')return Object.freeze({contract_version:agronomicCalculatorContractVersion,calculator:key,status:'SOURCE_UNAVAILABLE',required_inputs:[],error:'Provider ZARC autorizado indisponível.'})
  output=await options.zarcProvider(input)
 }
 else if(key==='pulverizacao')output=calculateSpraying(input)
 else if(key==='fertilizante')output=calculateFertilizer(input)
 else if(key==='reposicao')output=calculateNutrientRemoval(input)
 else output=calculateQuote(input)
 return Object.freeze({contract_version:agronomicCalculatorContractVersion,calculator:key,status:'EXECUTED',inputs:Object.freeze({...input}),output,source_ref:key==='zoneamento'?output?.sourceUrl||null:`calculator:${key}:${agronomicCalculatorContractVersion}`})
}

export {estimateRegionalHarvest,recommendPlantPopulation}
