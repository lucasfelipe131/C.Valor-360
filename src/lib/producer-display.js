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
