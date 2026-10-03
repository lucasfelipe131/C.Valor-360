import {createHash} from 'node:crypto'

export const BRAZIL_GRAIN_REPORT='https://celepar7.pr.gov.br/sima/cotdiat.asp'
const CACHE_MS=15*60*1000
const failure=code=>Object.assign(new Error(code),{code})
const text=html=>String(html).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim()
const normalized=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const validDay=(year,month,day)=>{
 const iso=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
 const date=new Date(iso+'T00:00:00Z')
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null
}

// DERAL's daily wholesale buying average retains its publication day and state.
// Refreshing cannot turn this state benchmark into a local producer offer.
export function parseBrazilGrainReport(html,{now=new Date()}={}){
 const match=normalized(html).match(/cotacao de compra pelo mercado atacadista no dia\s*(\d{2})\/(\d{2})\/(\d{4})/)
 if(!match)throw failure('BRAZIL_REPORT_DATE_MISSING')
 const observedDate=validDay(match[3],match[2],match[1])
 if(!observedDate||Date.parse(observedDate+'T00:00:00-03:00')>now.getTime())throw failure('BRAZIL_REPORT_DATE_INVALID')
 const observedAt=observedDate+'T00:00:00-03:00'
 const rows=[...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell=>text(cell[1])))
 const header=rows.find(cells=>normalized(cells[0])==='produto/tipo')
 const meanIndex=header?.findIndex(cell=>normalized(cell)==='media dia')
 // Refuse a changed layout rather than silently using a regional/minimum price.
 if(header?.length!==24||meanIndex!==21)throw failure('BRAZIL_REPORT_LAYOUT_CHANGED')
 const quotes=[];let commodity=null
 for(const cells of rows){
  if(/^(milho amarelo tipo 1|soja industrial tipo 1|trigo pao ph 78) sc 60 kg$/.test(normalized(cells[0]))){commodity=normalized(cells[0]).split(' ')[0];continue}
  if(cells.length===25){commodity=null;continue}
  if(!commodity||normalized(cells[0])!=='m_c')continue
  if(cells.length!==24)throw failure('BRAZIL_REPORT_LAYOUT_CHANGED')
  const value=cells[meanIndex],price=/^\d+(?:[.,]\d{1,2})?$/.test(value)?Number(value.replace(',','.')):NaN
  if(!Number.isFinite(price)||price<=0)continue
  quotes.push({id:'deral-'+commodity+'-'+observedDate,commodity,marketKind:'spot',region:'Paraná, Brasil',price,priceUnit:'BRL/sc_60kg',sourceName:'DERAL/SEAB-PR · média estadual de compra no atacado',sourceType:'market_feed',sourceOrigin:'BRAZIL_PUBLIC',sourceUrl:BRAZIL_GRAIN_REPORT,confidence:85,observedAt,observedDate,timePrecision:'DAY',fetchedAt:now.toISOString(),notes:'Média estadual brasileira de compra pelo mercado atacadista. Não é oferta ao produtor nem cotação de outra praça. Boletim diário, sem horário intradiário.',status:'active'})
 }
 if(quotes.length!==3||new Set(quotes.map(row=>row.commodity)).size!==3)throw failure('BRAZIL_REPORT_QUOTES_MISSING')
 return quotes
}

async function readLimited(response,maxBytes){
 if(!response.ok)throw failure('SOURCE_HTTP_'+response.status)
 if(Number(response.headers.get('content-length'))>maxBytes)throw failure('SOURCE_TOO_LARGE')
 const reader=response.body.getReader(),chunks=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw failure('SOURCE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 return Buffer.concat(chunks)
}

export function createOpenMarketFeed({fetchImpl=fetch,clock=()=>new Date()}={}){
 let cache=null,pending=null
 async function refresh(){
  const now=clock(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000)
  try{
   const response=await fetchImpl(BRAZIL_GRAIN_REPORT,{signal:controller.signal,redirect:'error'})
   const bytes=await readLimited(response,1_000_000)
   const declared=(response.headers.get('content-type')||'')+' '+bytes.subarray(0,1500).toString('ascii')
   const charset=/iso-8859-1|windows-1252/i.test(declared)?'windows-1252':'utf-8'
   cache={marketSnapshots:parseBrazilGrainReport(new TextDecoder(charset).decode(bytes),{now}),fetchedAt:now.toISOString(),errors:[],status:'AVAILABLE',cacheStatus:'FRESH',primaryBase:'VAL_SOG',country:'BR'}
  }catch(error){
   const errors=[error?.code||'SOURCE_UNAVAILABLE']
   cache=cache?.marketSnapshots.length?{...cache,cacheStatus:'STALE_CACHE',errors,lastAttemptAt:now.toISOString()}:{marketSnapshots:[],fetchedAt:now.toISOString(),errors,status:'UNAVAILABLE',cacheStatus:'FRESH',primaryBase:'VAL_SOG',country:'BR'}
  }finally{clearTimeout(timer)}
 }
 return {
  async read({tenantId,ownerId}={}){
   if(!tenantId||!ownerId)throw failure('MARKET_AUTHENTICATED_SCOPE_REQUIRED')
   const now=clock()
   if(!cache||now.getTime()-Date.parse(cache.lastAttemptAt||cache.fetchedAt)>=CACHE_MS){
    if(!pending)pending=refresh().finally(()=>{pending=null})
    await pending
   }
   const namespace=createHash('sha256').update(tenantId+':'+ownerId).digest('hex').slice(0,12)
   return {...cache,marketSnapshots:cache.marketSnapshots.map(row=>({...row,id:row.id+'-'+namespace,tenantId,contextOwnerId:ownerId,scope:'MARKET'}))}
  }
 }
}

export async function withOpenMarketReferences(workspace,feed,scope){
 const current=await feed.read(scope)
 const sog=(workspace.marketSnapshots||[]).map(row=>{
  const isSynthetic=/sintetic|simulad|fictici/.test(normalized(row.sourceName+' '+row.notes))
  return {...row,sourceOrigin:'VAL_SOG',isSynthetic,status:isSynthetic?'inactive':row.status}
 })
 const marketSnapshots=[...sog,...current.marketSnapshots].sort((a,b)=>Number(b.sourceOrigin==='VAL_SOG')-Number(a.sourceOrigin==='VAL_SOG')||Date.parse(b.observedAt)-Date.parse(a.observedAt))
 return {...workspace,marketSnapshots,openMarket:current,marketBase:'VAL_SOG'}
}

