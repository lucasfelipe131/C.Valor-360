import {normalizeText,slug} from './profile.js'

const fieldAliases={
 client:['cliente','produtor','nome cliente','nome produtor','razao social','customer'],
 value:['valor','valor total','valor negocio','faturamento','receita','total venda','venda','amount'],
 date:['data','data venda','emissao','fechamento','date'],
 product:['produto','categoria','item','solucao','insumo','product'],
 status:['status','situacao','etapa','resultado','stage'],
 municipality:['municipio','cidade','localidade','city'],
 culture:['cultura','cultivo','culture'],
 area:['area','hectares','ha']
}

export const normalizeHeader=value=>normalizeText(value)

export function detectColumns(headers){
 const mapping={};const confidence={}
 Object.entries(fieldAliases).forEach(([field,aliases])=>{
  const ranked=headers.map(header=>{const normalized=normalizeHeader(header);const score=aliases.reduce((best,alias)=>Math.max(best,normalized===alias?1:(normalized.includes(alias)||alias.includes(normalized) ? .8 : 0)),0);return {header,score}}).sort((a,b)=>b.score-a.score)
  if(ranked[0]?.score){mapping[field]=ranked[0].header;confidence[field]=Math.round(ranked[0].score*100)}
 })
 return {mapping,confidence}
}

export function parseMoney(value){
 if(typeof value==='number')return value
 let raw=String(value||'').replace(/R\$|\s/g,'')
 if(raw.includes(',')&&raw.includes('.'))raw=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'')
 else if(raw.includes(','))raw=raw.replace(',','.')
 else if(/^-?\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'')
 const normalized=raw.replace(/[^0-9.-]/g,'');if(!normalized||!/\d/.test(normalized))return 0
 const number=Number(normalized);return Number.isFinite(number)?number:0
}

function parseDate(value){
 if(value instanceof Date)return value
 if(typeof value==='number'&&value>20000)return new Date(Math.round((value-25569)*86400*1000))
 const raw=String(value||'').trim();if(!raw)return null
 const br=raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/)
 const date=br?new Date(Date.UTC(Number(br[3].length===2?`20${br[3]}`:br[3]),Number(br[2])-1,Number(br[1]))):new Date(raw)
 return Number.isNaN(date.getTime())?null:date
}

function recencyDays(date){return date?Math.max(0,Math.round((Date.now()-date.getTime())/86400000)):null}
const won=status=>/ganh|fech|conclu|fatur|vend|aprov/i.test(String(status||''))
const lost=status=>/perd|cancel|recus|desist/i.test(String(status||''))

export function buildCommercialIntelligence(rows,mapping){
 if(!mapping.client)throw new Error('Não encontrei uma coluna de cliente ou produtor.')
 const groups=new Map()
 rows.forEach(row=>{
  const name=String(row[mapping.client]||'').trim();if(!name)return
  const key=normalizeText(name);const current=groups.get(key)||{name,rows:[],revenue:0,valueRows:0,wins:0,losses:0,knownOutcomes:0,products:new Set(),lastDate:null,observed:{value:0,date:0,product:0,status:0},municipality:'A definir',culture:'A definir',area:'A definir'}
  const rawValue=mapping.value?row[mapping.value]:null;const hasValue=rawValue!==null&&rawValue!==undefined&&String(rawValue).trim()!=='';const value=hasValue?parseMoney(rawValue):0
  const date=parseDate(mapping.date?row[mapping.date]:null);const product=String(mapping.product?row[mapping.product]||'':'').trim();const status=mapping.status?row[mapping.status]:null;const isWon=won(status);const isLost=lost(status)
  current.rows.push(row);if(hasValue){current.revenue+=value;current.valueRows++;current.observed.value++}if(isWon||isLost){current.knownOutcomes++;current.observed.status++;if(isWon)current.wins++;if(isLost)current.losses++}if(product){current.products.add(product);current.observed.product++}if(date)current.observed.date++
  if(date&&(!current.lastDate||date>current.lastDate))current.lastDate=date
  if(row[mapping.municipality])current.municipality=String(row[mapping.municipality]);if(row[mapping.culture])current.culture=String(row[mapping.culture]);if(row[mapping.area])current.area=String(row[mapping.area])
  groups.set(key,current)
 })
 const list=[...groups.values()];const maxRevenue=Math.max(...list.map(group=>group.revenue),1);const maxFrequency=Math.max(...list.map(group=>group.rows.length),1);const maxDiversity=Math.max(...list.map(group=>group.products.size),1)
 return list.map(group=>{
  const days=recencyDays(group.lastDate);const conversion=group.knownOutcomes?group.wins/group.knownOutcomes:null;const avgTicket=group.valueRows?group.revenue/group.valueRows:null
  const score=Math.round(((days===null?0:Math.max(0,1-days/365))*25)+(group.valueRows?group.revenue/maxRevenue*30:0)+(group.rows.length/maxFrequency*20)+(conversion===null?0:conversion*15)+(group.products.size?group.products.size/maxDiversity*10:0))
  const evidenceCoverage=Math.round((1+Object.values(group.observed).reduce((sum,count)=>sum+(count/Math.max(group.rows.length,1)),0))/5*100)
  let opportunity='Hipótese: aprofundar o contexto técnico e comercial'
  if(days!==null&&days>120)opportunity='Hipótese: entender a mudança de recência antes de reativar'
  else if(mapping.product&&group.products.size===1)opportunity='Hipótese: verificar se existe necessidade em outras categorias'
  else if(conversion!==null&&conversion<.5)opportunity='Hipótese: revisar motivos registrados e proposta de valor'
  else if(score>=75)opportunity='Hipótese: confirmar janela e planejamento da próxima decisão'
  return {id:slug(group.name),name:group.name,municipality:group.municipality,area:group.area,cultures:group.culture,relationshipTime:'Histórico importado',primaryProfile:'A classificar',secondaryProfile:'Aguardando Produtor 360',scores:{},irt:0,irtBand:'Aguardando Produtor 360',nps:0,npsClass:'A medir',servicePreference:'A reconhecer',contactFrequency:days===null?'A confirmar; nenhuma data válida importada':'A confirmar; recência histórica disponível',contentPreference:'A confirmar com o produtor',postSalePreference:'A reconhecer',commercial:{potential:0,potentialValidated:false,lastContactDays:days,priority:score>=75?'Alta':score>=50?'Média':'Nutrir',opportunity,property:'',score,revenue:group.revenue,frequency:group.rows.length,averageTicket:avgTicket,conversion:conversion===null?null:Math.round(conversion*100),knownOutcomes:group.knownOutcomes,categories:[...group.products],lastBusinessAt:group.lastDate?.toISOString()||null,evidenceCoverage},source:'Base Inteligente'}
 })
}

export function summarizeLearning(clients,rowCount,fileName){
 const totalRevenue=clients.reduce((sum,client)=>sum+Number(client.commercial?.revenue||0),0)
 return {id:`import-${Date.now()}`,fileName,rowCount,clientCount:clients.length,totalRevenue,averageTicket:clients.reduce((sum,client)=>sum+Number(client.commercial?.averageTicket||0),0)/Math.max(clients.length,1),highIndex:clients.filter(client=>client.commercial?.priority==='Alta').length,createdAt:new Date().toISOString()}
}
