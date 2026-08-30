export const zarcProviderVersion='val.zarc_provider.v1'
export const zarcSourcePage='https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico'
export const zarcSources=Object.freeze([
 Object.freeze({safra:'2026/2027',url:'https://dados.agricultura.gov.br/dataset/6d3d141c-885e-41a4-ab7f-dc8ff323b96f/resource/139e5a60-1f43-4cc8-aeab-a35dbbf816c0/download/dados-abertos-tabua-de-risco-safra-2026-2027.csv'}),
 Object.freeze({safra:'2025/2026',url:'https://dados.agricultura.gov.br/dataset/6d3d141c-885e-41a4-ab7f-dc8ff323b96f/resource/f9d597f9-0fee-47eb-9344-8642274ca9da/download/dados-abertos-tabua-de-risco-safra-2025-2026.csv'}),
])
export const zarcCacheTtlMs=6*60*60*1000

const processCache=globalThis.__valZarcProviderCache instanceof Map?globalThis.__valZarcProviderCache:new Map()
globalThis.__valZarcProviderCache=processCache

export function normalizeZarcText(value){
 return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ªº]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
}
const headerKey=value=>normalizeZarcText(value).replace(/ /g,'')
const numeric=value=>{const match=String(value??'').replace(',','.').match(/\d+(?:\.\d+)?/);return match?Number(match[0]):0}

export function* parseZarcCsv(text,delimiter){
 let row=[];let field='';let quoted=false
 for(let index=0;index<text.length;index+=1){
  const char=text[index]
  if(char==='"'){
   if(quoted&&text[index+1]==='"'){field+='"';index+=1}else quoted=!quoted
  }else if(char===delimiter&&!quoted){row.push(field);field=''}
  else if((char==='\n'||char==='\r')&&!quoted){
   if(char==='\r'&&text[index+1]==='\n')index+=1
   row.push(field);field=''
   if(row.some(item=>item.length>0))yield row
   row=[]
  }else field+=char
 }
 if(field.length||row.length){row.push(field);yield row}
}

const relevantCrop=name=>{const value=normalizeZarcText(name);return value.includes('soja')||value.includes('trigo')||value.includes('milho')}

function cancellationReason(signal){
 if(signal?.reason instanceof Error)return signal.reason
 return Object.assign(new Error('Consulta ZARC cancelada.'),{name:'AbortError',code:'val_request_cancelled'})
}

function waitForSource(entry,{cacheStore,signal,url}){
 signal?.throwIfAborted?.()
 entry.waiters+=1
 return new Promise((resolve,reject)=>{
  let finished=false
  const release=({cancelled=false}={})=>{
   entry.waiters=Math.max(0,entry.waiters-1)
   if(cancelled&&entry.waiters===0&&!entry.settled){
    if(cacheStore?.get(url)===entry)cacheStore.delete(url)
    entry.controller.abort(cancellationReason(signal))
   }
  }
  const finish=(callback,value,options)=>{
   if(finished)return
   finished=true
   signal?.removeEventListener?.('abort',onAbort)
   release(options)
   callback(value)
  }
  const onAbort=()=>finish(reject,cancellationReason(signal),{cancelled:true})
  signal?.addEventListener?.('abort',onAbort,{once:true})
  entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error))
 })
}

async function loadSource(url,{fetchImpl=globalThis.fetch,nowMs=Date.now(),cacheStore=processCache,signal}={}){
 signal?.throwIfAborted?.()
 const existing=cacheStore?.get(url)
 if(existing&&existing.expiresAt>nowMs)return waitForSource(existing,{cacheStore,signal,url})
 if(typeof fetchImpl!=='function')throw new Error('Cliente HTTP indisponível para consultar o MAPA.')
 const controller=new AbortController()
 const entry={controller,expiresAt:nowMs+zarcCacheTtlMs,promise:null,settled:false,waiters:0}
 entry.promise=(async()=>{
  const timeoutSignal=AbortSignal.timeout(55000)
  const effectiveSignal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,timeoutSignal]):controller.signal
  const response=await fetchImpl(url,{cache:'no-store',signal:effectiveSignal})
  if(!response.ok)throw new Error(`MAPA respondeu ${response.status}`)
  const sourceText=await response.text()
  const firstLine=sourceText.slice(0,sourceText.indexOf('\n')>0?sourceText.indexOf('\n'):1000)
  const delimiter=(firstLine.match(/;/g)??[]).length>=(firstLine.match(/,/g)??[]).length?';':','
  const iterator=parseZarcCsv(sourceText.replace(/^\uFEFF/,''),delimiter)
  const first=iterator.next()
  if(first.done)return []
  const headers=first.value.map(headerKey)
  const idx=(...names)=>names.map(headerKey).map(name=>headers.indexOf(name)).find(value=>value>=0)??-1
  const cropIndex=idx('Nome_cultura','cultura')
  const cycleIndex=idx('Cod_Ciclo','ciclo')
  const soilIndex=idx('Cod_Solo','solo')
  const ufIndex=idx('UF')
  const municipalityIndex=idx('municipio','município')
  const managementCodeIndex=idx('Cod_Outros_Manejos','cod_manejo')
  const managementIndex=idx('Nome_Outros_Manejos','manejo')
  const portariaIndex=idx('Portaria')
  const decIndexes=Array.from({length:36},(_,index)=>idx(`dec${index+1}`))
  if([cropIndex,cycleIndex,soilIndex,ufIndex,municipalityIndex].some(value=>value<0))throw new Error('Formato da Tábua de Risco não reconhecido.')
  const rows=[]
  for(const values of iterator){
   const crop=values[cropIndex]??''
   if(!relevantCrop(crop))continue
   rows.push({
    crop,cycle:values[cycleIndex]??'',soil:values[soilIndex]??'',uf:values[ufIndex]??'',municipality:values[municipalityIndex]??'',
    managementCode:managementCodeIndex>=0?values[managementCodeIndex]??'':'',management:managementIndex>=0?values[managementIndex]??'':'',
    portaria:portariaIndex>=0?values[portariaIndex]??'':'',risks:decIndexes.map(column=>column>=0?numeric(values[column]??''):0),
   })
  }
  return rows
 })()
 if(cacheStore){
  cacheStore.set(url,entry)
 }
 entry.promise.then(
  ()=>{entry.settled=true},
  ()=>{entry.settled=true;if(cacheStore?.get(url)===entry)cacheStore.delete(url)},
 )
 return waitForSource(entry,{cacheStore,signal,url})
}

function cropMatches(name,target){
 const value=normalizeZarcText(name)
 if(target==='soja')return value.includes('soja')
 if(target==='trigo')return value.includes('trigo')
 if(!value.includes('milho')||value.includes('consorci'))return false
 const isSecond=/\b2\s*a?\s*safra\b/.test(value)||value.includes('segunda safra')||value.includes('safrinha')
 if(target==='milho-safrinha')return isSecond
 return !isSecond&&(/\b1\s*a?\s*safra\b/.test(value)||value.includes('primeira safra')||value==='milho')
}

const decDate=(dec,end=false)=>{
 const month=Math.floor((dec-1)/3)+1
 const part=(dec-1)%3
 const day=end?(part===0?10:part===1?20:new Date(2025,month,0).getDate()):(part===0?1:part===1?11:21)
 return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`
}

export function zarcRanges(decendios){
 if(!decendios.length)return []
 const groups=[]
 for(const dec of [...decendios].sort((a,b)=>a-b)){
  const current=groups.at(-1)
  if(current&&dec===current.at(-1)+1)current.push(dec)
  else groups.push([dec])
 }
 if(groups.length>1&&groups[0][0]===1&&groups.at(-1).at(-1)===36){const first=groups.shift();const last=groups.pop();groups.unshift([...last,...first])}
 return groups.map(group=>`${decDate(group[0])} a ${decDate(group.at(-1),true)}`)
}

export const zarcCropLabels=Object.freeze({soja:'Soja','milho-verao':'Milho verão · 1ª safra','milho-safrinha':'Milho safrinha · 2ª safra',trigo:'Trigo'})
export const zarcSoilLabels=Object.freeze({'1':'Arenoso · Tipo 1','2':'Textura média · Tipo 2','3':'Argiloso · Tipo 3','11':'AD1','12':'AD2','13':'AD3','14':'AD4','15':'AD5','16':'AD6'})
export const zarcCycleLabels=Object.freeze({'20':'Grupo I','21':'Grupo II','22':'Grupo III','24':'Grupo IV','25':'Grupo V','26':'Grupo VI'})

function providerError(message,statusCode,code,details={}){
 return Object.assign(new Error(message),{statusCode,code,details})
}

export async function consultZarc(input={},options={}){
 options.signal?.throwIfAborted?.()
 const uf=String(input.uf??'').toUpperCase()
 const municipality=String(input.municipality??'').trim()
 const crop=String(input.crop??'')
 const soil=String(input.soil??'')
 const cycle=String(input.cycle??'')
 if(!uf||!municipality||!zarcCropLabels[crop]||!zarcSoilLabels[soil]||!zarcCycleLabels[cycle])throw providerError('Informe cultura, UF, município, solo e grupo de ciclo.',400,'zarc_input_invalid')
 let matched=[];let usedSafra='';let usedSource=null
 const failures=[];const availableSoils=new Set();const availableCycles=new Set()
 const now=options.now instanceof Date?options.now:new Date(options.now??Date.now())
 const nowMs=now.getTime()
 for(const source of zarcSources){
  options.signal?.throwIfAborted?.()
  try{
   const rows=await loadSource(source.url,{fetchImpl:options.fetchImpl,nowMs,cacheStore:options.cacheStore===undefined?processCache:options.cacheStore,signal:options.signal})
   const baseRows=rows.filter(row=>row.uf.toUpperCase()===uf&&normalizeZarcText(row.municipality)===normalizeZarcText(municipality)&&cropMatches(row.crop,crop)&&(!row.managementCode||numeric(row.managementCode)===1||normalizeZarcText(row.management).includes('sequeiro')))
   baseRows.forEach(row=>{availableSoils.add(String(numeric(row.soil)));availableCycles.add(String(numeric(row.cycle)))})
   matched=baseRows.filter(row=>String(numeric(row.soil))===soil&&String(numeric(row.cycle))===cycle)
   if(matched.length){usedSafra=source.safra;usedSource=source;break}
  }catch(error){if(options.signal?.aborted)throw options.signal.reason instanceof Error?options.signal.reason:error;failures.push(error instanceof Error?error.message:'Falha na fonte oficial')}
 }
 if(!matched.length){
  const soilOptions=[...availableSoils].map(value=>zarcSoilLabels[value]||value).join(', ')
  const cycleOptions=[...availableCycles].map(value=>zarcCycleLabels[value]||value).join(', ')
  const guidance=availableSoils.size||availableCycles.size?` A portaria vigente para este município utiliza solo(s): ${soilOptions||'não informado'}; grupo(s): ${cycleOptions||'não informado'}.`:' Confira o grupo de ciclo e a classe de solo adotados na portaria vigente.'
  const detail=failures.length===zarcSources.length?' A fonte oficial está temporariamente indisponível.':guidance
  throw providerError(`Não há janela ZARC encontrada para ${zarcCropLabels[crop]} em ${municipality}/${uf}.${detail}`,404,failures.length===zarcSources.length?'zarc_source_unavailable':'zarc_not_found',{failures})
 }
 const windows=[20,30,40].map(risk=>{
  const allowed=new Set()
  for(const row of matched)row.risks.forEach((value,index)=>{if(value>0&&value<=risk)allowed.add(index+1)})
  const decendios=[...allowed].sort((a,b)=>a-b)
  return Object.freeze({risk,decendios:Object.freeze(decendios),ranges:Object.freeze(zarcRanges(decendios))})
 })
 const portarias=[...new Set(matched.map(row=>row.portaria.trim()).filter(Boolean))].slice(0,4)
 return Object.freeze({
  provider:zarcProviderVersion,cropLabel:zarcCropLabels[crop],municipality:matched[0].municipality,uf,safra:usedSafra,
  soilLabel:zarcSoilLabels[soil],cycleLabel:zarcCycleLabels[cycle],management:'Sequeiro',portarias:Object.freeze(portarias),
  windows:Object.freeze(windows),updatedAt:now.toISOString(),sourceUrl:zarcSourcePage,sourceDatasetUrl:usedSource?.url||null,cacheTtlSeconds:zarcCacheTtlMs/1000,
 })
}
