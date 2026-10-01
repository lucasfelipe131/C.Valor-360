// Arithmetic over explicit supplied quantities only. No agronomic rate or live price is inferred.
const number=String.raw`(\d+(?:\.\d{3})*(?:[.,]\d+)?)`
const value=raw=>Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/\.(?=\d{3}(?:\D|$))/g,''))
const read=(s,pattern)=>{const m=s.match(new RegExp(pattern,'i'));return m?value(m[1]):null}
const finite=n=>n!==null&&Number.isFinite(n)
const fmt=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:2})
export function suppliedDimensionalArithmetic(message=''){
 const s=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/[-−]\s*(?:r\$\s*)?\d/.test(s))return null
 const arithmeticOnly=s.replace(/\b(?:sem|nao)\s+(?:recomendar|prescrever|indicar)\s+(?:uma\s+)?dose(?:\s+(?:agronomica|tecnica))?\b/g,'')
 if(/\b(?:recomende|prescreva|dose|aplique)\b/.test(arithmeticOnly))return null
 if(/\b(?:hoje|agora|cotacao atual|previsao|bula|registro vigente|aprova\w*|libera\w*)\b/.test(s))return null
 const scenario=suppliedScenarioArithmetic(arithmeticOnly)
 if(scenario)return scenario
 if(/\b(?:aumenta|cai|diferenca|incremental)\b/.test(s))return null
 const area=read(s,String.raw`${number}\s*(?:ha|hectares?)\b`)
 const yieldSc=read(s,String.raw`${number}\s*(?:sc|sacas?)\s*(?:\/|por\s+)\s*(?:ha|hectares?)\b`)
 const money=[...s.matchAll(/r\$/g)].length
 const cost=read(s,String.raw`r\$\s*${number}\s*(?:\/|por\s+)\s*(?:ha|hectares?)\b`)
 const price=read(s,String.raw`r\$\s*${number}\s*(?:\/|por\s+)\s*(?:sc|sacas?)\b`)
 let input,output,formula,summary,key
 if(/\bproducao\s+estimada\b/.test(s)&&money===0&&finite(area)&&area>0&&finite(yieldSc)&&yieldSc>=0){
  key='estimated_production';input={area_ha:area,yield_sc_ha:yieldSc};output={production_sc:area*yieldSc};formula='area_ha * yield_sc_ha';summary=`Produção estimada no cenário: ${fmt(output.production_sc)} sacas = ${fmt(area)} ha × ${fmt(yieldSc)} sc/ha. Não é colheita confirmada.`
 }else if(/\bpreco\s+de\s+equilibrio\b/.test(s)&&money===1&&finite(cost)&&cost>=0&&finite(yieldSc)&&yieldSc>0){
  key='break_even_price';input={cost_brl_ha:cost,yield_sc_ha:yieldSc};output={price_brl_sc:cost/yieldSc};formula='cost_brl_ha / yield_sc_ha';summary=`Preço de equilíbrio: R$ ${fmt(output.price_brl_sc)}/sc = R$ ${fmt(cost)}/ha ÷ ${fmt(yieldSc)} sc/ha, com a produtividade estimada informada.`
 }else if(/\bprodutividade\s+de\s+equilibrio\b/.test(s)&&money===2&&finite(cost)&&cost>=0&&finite(price)&&price>0){
  key='break_even_yield';input={cost_brl_ha:cost,price_brl_sc:price};output={yield_sc_ha:cost/price};formula='cost_brl_ha / price_brl_sc';summary=`Produtividade de equilíbrio: ${fmt(output.yield_sc_ha)} sacas/ha = R$ ${fmt(cost)}/ha ÷ R$ ${fmt(price)}/saca, com o preço informado.`
 }else if(/\bpreco\s+de\s+equilibrio\b/.test(s)&&money===1&&finite(cost)&&cost>=0&&!finite(yieldSc)){
  return {contract_version:'val.supplied_dimensional_arithmetic.v1',calculator:'break_even_price',status:'INPUT_REQUIRED',input:{cost_brl_ha:cost},required_inputs:['yield_sc_ha'],summary:'Qual é a produtividade estimada em sacas por hectare para calcular o preço de equilíbrio com o custo informado?'}
 }else if(/^converta\b/.test(s)&&money===0){
  const tonnes=read(s,String.raw`${number}\s*toneladas?\b`),bagKg=read(s,String.raw`sacas?\s+de\s+${number}\s*kg\b`)
  if(!finite(tonnes)||tonnes<0||!finite(bagKg)||bagKg<=0)return null
  key='mass_to_bags';input={tonnes,bag_kg:bagKg};output={bags:tonnes*1000/bagKg};formula='tonnes * 1000 / bag_kg';summary=`Conversão: ${fmt(tonnes)} t × 1.000 kg/t ÷ ${fmt(bagKg)} kg/saca = ${fmt(output.bags)} sacas de ${fmt(bagKg)} kg.`
 }else return null
 return {contract_version:'val.supplied_dimensional_arithmetic.v1',calculator:key,status:'EXECUTED',input,output:{...output,formula},summary,source_ref:`calculator:${key}`}
}

// Explicit financial and geometric arithmetic. Operations require unambiguous
// supplied operands; this never reads a client record or invents a market value.
function suppliedScenarioArithmetic(s){
 const amounts=[...s.matchAll(new RegExp(String.raw`r\$\s*${number}\s*((?:\/|por\s+)\s*(?:ha|hectares?|sc|sacas?|t|toneladas?))?`,'g'))].map(m=>({value:value(m[1]),unit:m[2]||'',index:m.index}))
 const areas=[...s.matchAll(new RegExp(String.raw`${number}\s*(?:ha|hectares?)\b`,'g'))].filter(m=>!/[\w/]/.test(s[m.index-1]||'')).map(m=>value(m[1]))
 const rates=[...s.matchAll(new RegExp(String.raw`${number}\s*(?:sc|sacas?)\s*(?:\/|por\s+)\s*(?:ha|hectares?)\b`,'g'))].map(m=>value(m[1]))
 if([...amounts.map(m=>m.value),...areas,...rates].some(n=>!Number.isFinite(n)))return null
 const bag=read(s,String.raw`sacas?\s+de\s+${number}\s*kg\b`)
 const qty=read(s,String.raw`${number}\s*(?:sc|sacas?)\b(?!\s*(?:\/|por\b))`)
 const allTotal=amounts.every(m=>!m.unit)
 const label=(m,pattern)=>pattern.test(s.slice(Math.max(0,m.index-65),m.index).split(/[,;.]/).at(-1))
 const revenue=amounts.filter(m=>label(m,/\breceita\s*(?:de|e|:)?\s*$/))
 const costs=amounts.filter(m=>label(m,/\bcustos?\s*(?:(?:total|fixo|variavel)\s*)?(?:de|e|:)?\s*$/))
 const done=(key,input,output,formula,summary)=>({contract_version:'val.supplied_dimensional_arithmetic.v1',calculator:key,status:'EXECUTED',input,output:{...output,formula},summary,source_ref:`calculator:${key}`})
 if(/\b(?:receita|faturamento)\b/.test(s)&&finite(qty)&&qty>=0&&amounts.length===1&&/sc|saca/.test(amounts[0].unit)&&!areas.length&&!rates.length){
  const price=amounts[0].value,result=qty*price
  return done('quantity_revenue',{quantity_sc:qty,price_brl_sc:price},{revenue_brl:result},'quantity_sc * price_brl_sc',`Receita estimada no cenário: ${fmt(qty)} sacas × R$ ${fmt(price)}/saca = R$ ${fmt(result)}. Não confirma venda ou recebimento.`)
 }
 if(/\breceita\b/.test(s)&&areas.length===1&&rates.length===1&&amounts.length>=1&&amounts.length<=2&&amounts.every(m=>/sc|saca/.test(m.unit))&&!/\b(?:diferenca|incremental|custo)\b/.test(s)){
  const production=areas[0]*rates[0],revenues=amounts.map(m=>production*m.value)
  return done('scenario_revenue',{area_ha:areas[0],yield_sc_ha:rates[0],prices_brl_sc:amounts.map(m=>m.value)},{production_sc:production,revenue_brl:revenues},'area_ha * yield_sc_ha * price_brl_sc',`Receita simulada para ${fmt(areas[0])} ha × ${fmt(rates[0])} sacas/ha = ${fmt(production)} sacas: ${amounts.map((m,i)=>`a R$ ${fmt(m.value)}/saca, R$ ${fmt(revenues[i])}`).join('; ')}. A produtividade é uma premissa, não colheita confirmada.`)
 }
 if(allTotal&&amounts.length===2&&revenue.length===1&&costs.length===1&&/\b(?:resultado|margem|lucro)\b/.test(s)){
  const r=revenue[0].value,c=costs[0].value,result=r-c,margin=r>0?result/r*100:null
  return done('revenue_less_cost',{revenue_brl:r,cost_brl:c},{result_brl:result,margin_percent:margin},'(revenue_brl - cost_brl); result_brl / revenue_brl * 100',`Resultado: R$ ${fmt(r)} de receita − R$ ${fmt(c)} de custo = R$ ${fmt(result)}. ${margin===null?'Margem percentual indefinida porque a receita é zero.':`Margem sobre a receita: ${fmt(margin)}%.`}`)
 }
 if(allTotal&&amounts.length===3&&revenue.length===1&&costs.length===2&&/\bmargem de contribuicao\b/.test(s)){
  const variable=costs.find(m=>label(m,/\bcusto variavel\s*(?:de|e|:)?\s*$/)),fixed=costs.find(m=>label(m,/\bcusto fixo\s*(?:de|e|:)?\s*$/))
  if(variable&&fixed){const contribution=revenue[0].value-variable.value,result=contribution-fixed.value
   return done('contribution_margin',{revenue_brl:revenue[0].value,variable_cost_brl:variable.value,fixed_cost_brl:fixed.value},{contribution_brl:contribution,result_brl:result},'revenue_brl - variable_cost_brl; contribution_brl - fixed_cost_brl',`Margem de contribuição: R$ ${fmt(revenue[0].value)} − R$ ${fmt(variable.value)} = R$ ${fmt(contribution)}. Resultado após o custo fixo: R$ ${fmt(contribution)} − R$ ${fmt(fixed.value)} = R$ ${fmt(result)}.`)
  }
 }
 if(allTotal&&amounts.length===2&&/\b(?:retorno|roi)\b/.test(s)){
  const investment=amounts.find(m=>label(m,/\binvestimento\s*(?:de|e|:)?\s*$/)),benefit=amounts.find(m=>label(m,/\bbeneficio(?: incremental)?\s*(?:de|e|:)?\s*$/))
  if(investment?.value>0&&benefit){const net=benefit.value-investment.value,roi=net/investment.value*100
   return done('net_return',{investment_brl:investment.value,benefit_brl:benefit.value},{net_brl:net,roi_percent:roi},'(benefit_brl - investment_brl) / investment_brl * 100',`Benefício líquido: R$ ${fmt(benefit.value)} − R$ ${fmt(investment.value)} = R$ ${fmt(net)}. Retorno líquido sobre o investimento: ${fmt(roi)}%. É uma simulação, não garantia de retorno.`)
  }
 }
 if(allTotal&&amounts.length===2&&/\bvariacao percentual\b/.test(s)&&/\b(?:passa|passou|vai|foi) de\b/.test(s)&&amounts[0].value>0){
  const result=(amounts[1].value/amounts[0].value-1)*100
  return done('percent_change',{initial_brl:amounts[0].value,final_brl:amounts[1].value},{change_percent:result},'(final_brl / initial_brl - 1) * 100',`Variação percentual: (R$ ${fmt(amounts[1].value)} ÷ R$ ${fmt(amounts[0].value)} − 1) × 100 = ${fmt(result)}%, usando o valor inicial como base.`)
 }
 if(/\b(?:resultado|retorno) incremental\b/.test(s)&&amounts.length===2&&rates.length===1&&!areas.length){
  const cost=amounts.find(m=>/ha|hectare/.test(m.unit)),price=amounts.find(m=>/sc|saca/.test(m.unit))
  if(cost&&price){const revenue=rates[0]*price.value,result=revenue-cost.value
   return done('incremental_result_per_area',{incremental_yield_sc_ha:rates[0],price_brl_sc:price.value,cost_brl_ha:cost.value},{incremental_revenue_brl_ha:revenue,result_brl_ha:result},'incremental_yield_sc_ha * price_brl_sc - cost_brl_ha',`Resultado incremental simulado por hectare: ${fmt(rates[0])} sacas/ha × R$ ${fmt(price.value)}/saca − R$ ${fmt(cost.value)}/ha = R$ ${fmt(result)}/ha. O ganho é hipotético, não produtividade confirmada.`)
  }
 }
 if(/\bequilibrio\b/.test(s)&&amounts.length===1&&/ha|hectare/.test(amounts[0].unit)){
  const change=s.match(new RegExp(String.raw`custo\s+(aumenta|sobe|cai|diminui)\s+${number}\s*%`))
  const yields=s.match(new RegExp(String.raw`(?:rendimento|produtividade)\s+(?:cai|sobe|passa|muda)\s+de\s+${number}\s*(?:sc/ha\s*)?para\s+${number}\s*sc/ha`))
  if(change&&yields){const initialYield=value(yields[1]),finalYield=value(yields[2]),percent=value(change[2]),direction=/aumenta|sobe/.test(change[1])?1:-1,newCost=amounts[0].value*(1+direction*percent/100)
   if(finalYield>0&&initialYield>0&&newCost>=0)return done('adjusted_break_even_price',{initial_cost_brl_ha:amounts[0].value,cost_change_percent:direction*percent,initial_yield_sc_ha:initialYield,final_yield_sc_ha:finalYield},{new_cost_brl_ha:newCost,break_even_brl_sc:newCost/finalYield},'initial_cost_brl_ha * (1 + cost_change_percent / 100) / final_yield_sc_ha',`Custo ajustado: R$ ${fmt(amounts[0].value)}/ha × (1 ${direction>0?'+':'−'} ${fmt(percent)}/100) = R$ ${fmt(newCost)}/ha. Novo preço de equilíbrio: R$ ${fmt(newCost)}/ha ÷ ${fmt(finalYield)} sacas/ha = R$ ${fmt(newCost/finalYield)}/saca. Premissas simuladas, não colheita ou preço confirmado.`)
  }
 }
 if(/^converta\b/.test(s)&&amounts.length===1&&/tonelada|\bt\b/.test(amounts[0].unit)&&finite(bag)&&bag>0){
  const result=amounts[0].value*bag/1000
  return done('tonne_price_to_bag',{price_brl_t:amounts[0].value,bag_kg:bag},{price_brl_bag:result},'price_brl_t * bag_kg / 1000',`Conversão da referência informada: R$ ${fmt(amounts[0].value)}/tonelada × ${fmt(bag)} kg/saca ÷ 1.000 kg/tonelada = R$ ${fmt(result)}/saca. Não é cotação atual verificada.`)
 }
 if(/\b(?:area retangular|retangulo)\b/.test(s)&&!amounts.length){
  const dimensions=[...s.matchAll(new RegExp(String.raw`${number}\s*(?:metros?|m)\b`,'g'))].map(m=>value(m[1]))
  if(dimensions.length===2&&dimensions.every(n=>n>0)){const square=dimensions[0]*dimensions[1]
   return done('rectangle_area',{length_m:dimensions[0],width_m:dimensions[1]},{area_m2:square,area_ha:square/10000},'length_m * width_m / 10000',`Área retangular calculada: ${fmt(dimensions[0])} m × ${fmt(dimensions[1])} m = ${fmt(square)} m² = ${fmt(square/10000)} hectares, usando 10.000 m² por hectare.`)
  }
 }
 if(!amounts.length&&areas.length===1&&areas[0]>0&&/\bquantidade por hectare\b/.test(s)){
  const mass=read(s,String.raw`${number}\s*kg\b(?!\s*(?:\/|por\b))`)
  if(finite(mass)&&mass>=0)return done('supplied_mass_per_area',{mass_kg:mass,area_ha:areas[0]},{quantity_kg_ha:mass/areas[0]},'mass_kg / area_ha',`Quantidade aritmética: ${fmt(mass)} kg ÷ ${fmt(areas[0])} hectares = ${fmt(mass/areas[0])} kg/ha. Esta divisão não determina adequação, necessidade ou recomendação agronômica.`)
 }
 return null
}
