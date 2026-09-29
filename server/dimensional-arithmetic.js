// Arithmetic over explicit supplied quantities only. No agronomic rate or live price is inferred.
const number=String.raw`(\d+(?:\.\d{3})*(?:[.,]\d+)?)`
const value=raw=>Number(raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/\.(?=\d{3}(?:\D|$))/g,''))
const read=(s,pattern)=>{const m=s.match(new RegExp(pattern,'i'));return m?value(m[1]):null}
const finite=n=>n!==null&&Number.isFinite(n)
const fmt=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:2})
export function suppliedDimensionalArithmetic(message=''){
 const s=String(message).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/\b(?:recomende|prescreva|dose|aplique|aumenta|cai|diferenca|incremental)\b/.test(s))return null
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
  key='break_even_yield';input={cost_brl_ha:cost,price_brl_sc:price};output={yield_sc_ha:cost/price};formula='cost_brl_ha / price_brl_sc';summary=`Produtividade de equilíbrio: ${fmt(output.yield_sc_ha)} sc/ha = R$ ${fmt(cost)}/ha ÷ R$ ${fmt(price)}/sc, com o preço informado.`
 }else if(/^converta\b/.test(s)&&money===0){
  const tonnes=read(s,String.raw`${number}\s*toneladas?\b`),bagKg=read(s,String.raw`sacas?\s+de\s+${number}\s*kg\b`)
  if(!finite(tonnes)||tonnes<0||!finite(bagKg)||bagKg<=0)return null
  key='mass_to_bags';input={tonnes,bag_kg:bagKg};output={bags:tonnes*1000/bagKg};formula='tonnes * 1000 / bag_kg';summary=`Conversão: ${fmt(tonnes)} t × 1.000 kg/t ÷ ${fmt(bagKg)} kg/saca = ${fmt(output.bags)} sacas de ${fmt(bagKg)} kg.`
 }else return null
 return {contract_version:'val.supplied_dimensional_arithmetic.v1',calculator:key,status:'EXECUTED',input,output:{...output,formula},summary,source_ref:`calculator:${key}`}
}
