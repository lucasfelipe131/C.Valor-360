import {createHash} from 'node:crypto'

export const USDA_GRAIN_REPORT='https://www.ams.usda.gov/mnreports/ams_2850.pdf'
const FX_URL='https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados/ultimos/5?formato=json'
const CACHE_MS=15*60*1000
const failure=code=>Object.assign(new Error(code),{code})
const validDay=(year,month,day)=>{
 const iso=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
 const date=new Date(`${iso}T00:00:00Z`)
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null
}

// These are public USDA report references, retaining the US market and original unit.
// A daily report has no intraday timestamp: midnight is a conservative freshness bound.
export function parseUsdaGrainReport(text,{now=new Date()}={}){
 const normalized=String(text).replace(/\s+/g,' ')
 const match=normalized.match(/Grain Report for\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*Final/i)
 if(!match)throw failure('USDA_REPORT_DATE_MISSING')
 const observedDate=validDay(match[3],match[1],match[2])
 if(!observedDate||Date.parse(`${observedDate}T00:00:00Z`)>now.getTime())throw failure('USDA_REPORT_DATE_INVALID')
 const observedAt=`${observedDate}T00:00:00-05:00`
 const rows=[]
 const add=(commodity,price,marketKind,region,deliveryStart=null)=>{
  if(!Number.isFinite(price)||price<=0)return
  rows.push({id:`usda-${commodity}-${marketKind}-${observedDate}`,commodity,marketKind,region,price,priceUnit:'USD/bu',sourceName:'USDA AMS · Iowa Daily Cash Grain Bids',sourceType:'market_feed',sourceUrl:USDA_GRAIN_REPORT,confidence:85,observedAt,observedDate,timePrecision:'DAY',fetchedAt:now.toISOString(),deliveryStart,deliveryEnd:deliveryStart,notes:'Referência pública dos EUA em US$/bushel. Não representa preço no Brasil. Publicação diária, sem horário intradiário informado.',status:'active'})
 }
 const spot=normalized.match(/State Average Price:\s*Corn\s*--\s*\$([\d.]+)[\s\S]{0,100}?Soybeans\s*--\s*\$([\d.]+)/i)
 if(spot){add('milho',Number(spot[1]),'spot','Iowa, EUA');add('soja',Number(spot[2]),'spot','Iowa, EUA')}
 // Read only the first CBOT contract for each commodity, never an unrelated row.
 const futures=normalized.slice(normalized.indexOf('Futures Settlements'))
 for(const [name,commodity] of [['Corn','milho'],['Soybeans','soja'],['Wheat','trigo']]){
  const row=futures.match(new RegExp(`CBOT\\s*\\|?\\s*${name}\\s*\\|?\\s*([\\d.]+)\\s*\\(([A-Za-z]{3})\\s*(\\d{2})\\)`,'i'))
  if(!row)continue
  const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}
  const delivery=validDay(`20${row[3]}`,months[row[2]],1)
  if(delivery){add(commodity,Number(row[1])/100,'futures','CBOT, EUA',delivery);const quote=rows.at(-1);quote.contractMonth=delivery.slice(0,7);quote.deliveryEnd=new Date(Date.UTC(Number(`20${row[3]}`),months[row[2]],0)).toISOString().slice(0,10)}
 }
 if(!rows.length)throw failure('USDA_REPORT_QUOTES_MISSING')
 return rows
}

async function readLimited(response,maxBytes){
 if(!response.ok)throw failure(`SOURCE_HTTP_${response.status}`)
 if(Number(response.headers.get('content-length'))>maxBytes)throw failure('SOURCE_TOO_LARGE')
 const reader=response.body.getReader(),chunks=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw failure('SOURCE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 return Buffer.concat(chunks)
}
async function pdfText(bytes){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs')
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false})
 let document
 try{
  document=await task.promise
  if(document.numPages>8)throw failure('SOURCE_PAGE_LIMIT')
  const pages=[]
  for(let page=1;page<=document.numPages;page++){const content=await (await document.getPage(page)).getTextContent();pages.push(content.items.map(item=>item.str||'').join(' '))}
  return pages.join(' ')
 }finally{await task.destroy()}
}

export function createOpenMarketFeed({fetchImpl=fetch,extractPdf=pdfText,clock=()=>new Date()}={}){
 let cache=null,pending=null
 async function refresh(){
  const now=clock(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000)
  try{
   const results=await Promise.allSettled([
    (async()=>{const response=await fetchImpl(USDA_GRAIN_REPORT,{signal:controller.signal,redirect:'error'});const bytes=await readLimited(response,3_000_000);return parseUsdaGrainReport(await extractPdf(bytes),{now})})(),
    (async()=>{const response=await fetchImpl(FX_URL,{signal:controller.signal,redirect:'error'});const body=await readLimited(response,100_000);const rows=JSON.parse(body.toString('utf8'));if(!Array.isArray(rows))throw failure('BCB_DATA_INVALID');return rows.map(row=>{const m=String(row.data).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);const day=m&&validDay(m[3],m[2],m[1]);return {value:Number(row.valor),observedDate:day}}).filter(row=>row.observedDate&&Number.isFinite(row.value)&&row.value>0&&Date.parse(row.observedDate)<=now.getTime()).sort((a,b)=>b.observedDate.localeCompare(a.observedDate))[0]||null})()
   ])
   const quotes=results[0].status==='fulfilled'?results[0].value:[]
   const fx=results[1].status==='fulfilled'?results[1].value:null
   const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason?.code||'SOURCE_UNAVAILABLE')
   cache={marketSnapshots:quotes,indicators:fx?[{id:'usd-brl',label:'Dólar comercial · venda',unit:'BRL/USD',...fx,sourceName:'Banco Central do Brasil · SGS 10813',sourceUrl:FX_URL,timePrecision:'DAY'}]:[],fetchedAt:now.toISOString(),errors,status:quotes.length?'AVAILABLE':'UNAVAILABLE',cacheStatus:'FRESH'}
   return cache
  }finally{clearTimeout(timer)}
 }
 return {
  async read({tenantId,ownerId}={}){
   if(!tenantId||!ownerId)throw failure('MARKET_AUTHENTICATED_SCOPE_REQUIRED')
   const now=clock()
   if(!cache||now.getTime()-Date.parse(cache.lastAttemptAt||cache.fetchedAt)>=CACHE_MS){
    if(!pending)pending=refresh().finally(()=>{pending=null})
    const previous=cache
    await pending
    if(!cache.marketSnapshots.length&&previous?.marketSnapshots.length)cache={...previous,cacheStatus:'STALE_CACHE',errors:cache.errors,lastAttemptAt:cache.fetchedAt}
   }
   const namespace=createHash('sha256').update(`${tenantId}:${ownerId}`).digest('hex').slice(0,12)
   return {...cache,marketSnapshots:cache.marketSnapshots.map(row=>({...row,id:`${row.id}-${namespace}`,tenantId,contextOwnerId:ownerId,scope:'MARKET'}))}
  }
 }
}

export async function withOpenMarketReferences(workspace,feed,scope){
 const current=await feed.read(scope)
 const marketSnapshots=[...current.marketSnapshots,...(workspace.marketSnapshots||[])].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))
 return {...workspace,marketSnapshots,openMarket:current}
}
