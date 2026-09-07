// Presentation only. Never send this projection to persistence or AI context.
export const DATA_KINDS=Object.freeze(['REAL DATA','DERIVED DATA','ESTIMATE','DEMO','MISSING'])
export const isDemoRecord=value=>value?.isDemo===true||value?.demo?.synthetic===true||value?.synthetic===true||value?.source==='val-demo-synthetic-v1'||value?.profileSource==='val-demo-synthetic-v1'
export const hasValue=value=>value!==null&&value!==undefined&&value!==''&&!(typeof value==='number'&&!Number.isFinite(value))
export function displayDatum(value,{kind='REAL DATA',record=null,demo=false}={}){
 if(!hasValue(value)||!DATA_KINDS.includes(kind))return {value:null,kind:'MISSING'}
 if(isDemoRecord(record)&&!demo)return {value:null,kind:'MISSING'}
 return {value,kind:demo?'DEMO':kind}
}
export function scopedRecords(records,client){
 return (Array.isArray(records)?records:[]).filter(record=>String(record.clientId??record.client_id)===String(client.id)&&(isDemoRecord(client)||!isDemoRecord(record)))
}
export const formatNumber=value=>hasValue(value)&&Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2}):'—'
export const cropColor=crop=>/soja/i.test(crop)?'#26b34a':/milho/i.test(crop)?'#f3b62f':/trigo/i.test(crop)?'#42baf3':'#8a999f'

// Calculations stay within one crop and season; sacks from different crops are never combined.
export function seasonDisplay(seasons=[],{season='',complete=true,demo=false}={}){
 const selected=seasons.filter(row=>row.season===season&&(demo||!isDemoRecord(row)))
 const crops=[...new Set(selected.map(row=>row.crop).filter(Boolean))]
 return crops.map(crop=>{
  const rows=selected.filter(row=>row.crop===crop)
  const duplicated=new Set(rows.map(row=>row.fieldId)).size!==rows.length
  const valid=complete&&!duplicated&&rows.every(row=>hasValue(row.areaHa)&&Number(row.areaHa)>=0)
  const areaHa=valid?rows.reduce((sum,row)=>sum+Number(row.areaHa),0):null
  const units=[...new Set(rows.map(row=>row.unit))]
  const estimable=valid&&units.length===1&&units[0]==='sc/ha'&&rows.every(row=>hasValue(row.productivityTarget)&&Number(row.productivityTarget)>=0)
  const estimatedProductionSc=estimable?rows.reduce((sum,row)=>sum+Number(row.areaHa)*Number(row.productivityTarget),0):null
  return {crop,areaHa,estimatedProductionSc,productivityTarget:estimable&&areaHa>0?estimatedProductionSc/areaHa:null,reason:duplicated?'Registros duplicados: revisar a safra':!complete?'Cobertura parcial':'Registros da safra selecionada'}
 })
}
export function nextPlanAction(plan,{now=Date.now()}={}){
 if(!plan||!['PROPOSED','ACCEPTED','IN_PROGRESS'].includes(plan.status))return null
 const action=(Array.isArray(plan.priorities)?plan.priorities:[]).find(item=>['PROPOSED','ACCEPTED','IN_PROGRESS'].includes(item.status)&&item.source_refs?.length&&(!item.due_at||new Date(item.due_at).getTime()>=now))
 return action?{...action,planStatus:plan.status,planId:plan.id||plan.action_plan_id}:null
}
