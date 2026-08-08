import {normalizeText,slug} from './profile'

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
 const number=Number(raw.replace(/[^0-9.-]/g,''));return Number.isFinite(number)?number:0
}

function parseDate(value){
 if(value instanceof Date)return value
 if(typeof value==='number'&&value>20000)return new Date(Math.round((value-25569)*86400*1000))
 const raw=String(value||'').trim();if(!raw)return null
 const br=raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/)
 const date=br?new Date(Number(br[3].length===2?`20${br[3]}`:br[3]),Number(br[2])-1,Number(br[1])):new Date(raw)
 return Number.isNaN(date.getTime())?null:date
}

function recencyDays(date){return date?Math.max(0,Math.round((Date.now()-date.getTime())/86400000)):365}
const won=status=>/ganh|fech|conclu|fatur|vend|aprov/i.test(String(status||''))
const lost=status=>/perd|cancel|recus|desist/i.test(String(status||''))

export function buildCommercialIntelligence(rows,mapping){
 if(!mapping.client)throw new Error('Não encontrei uma coluna de cliente ou produtor.')
 const groups=new Map()
 rows.forEach(row=>{
  const name=String(row[mapping.client]||'').trim();if(!name)return
  const key=normalizeText(name);const current=groups.get(key)||{name,rows:[],revenue:0,wins:0,losses:0,products:new Set(),lastDate:null,municipality:'A definir',culture:'A definir',area:'A definir'}
  const value=parseMoney(row[mapping.value]);const date=parseDate(row[mapping.date]);const product=String(row[mapping.product]||'').trim();const status=row[mapping.status]
  current.rows.push(row);current.revenue+=value;if(won(status)||!mapping.status)current.wins++;if(lost(status))current.losses++;if(product)current.products.add(product)
  if(date&&(!current.lastDate||date>current.lastDate))current.lastDate=date
  if(row[mapping.municipality])current.municipality=String(row[mapping.municipality]);if(row[mapping.culture])current.culture=String(row[mapping.culture]);if(row[mapping.area])current.area=String(row[mapping.area])
  groups.set(key,current)
 })
 const list=[...groups.values()];const maxRevenue=Math.max(...list.map(group=>group.revenue),1);const maxFrequency=Math.max(...list.map(group=>group.rows.length),1);const maxDiversity=Math.max(...list.map(group=>group.products.size),1)
 return list.map(group=>{
  const days=recencyDays(group.lastDate);const conversion=group.wins/Math.max(group.wins+group.losses,1);const avgTicket=group.revenue/Math.max(group.rows.length,1)
  const score=Math.round((Math.max(0,1-days/365)*25)+(group.revenue/maxRevenue*30)+(group.rows.length/maxFrequency*20)+(conversion*15)+(group.products.size/maxDiversity*10))
  let opportunity='Aprofundar diagnóstico técnico e comercial'
  if(days>120)opportunity='Reativar relacionamento com abordagem personalizada'
  else if(group.products.size<=1)opportunity='Ampliar categorias com venda cruzada de valor'
  else if(conversion<.5)opportunity='Revisar objeções e proposta de valor'
  else if(score>=75)opportunity='Antecipar planejamento e proteger participação na carteira'
  const potential=Math.round(Math.max(avgTicket*1.8,(maxRevenue-group.revenue)*.18+avgTicket))
  return {id:`${slug(group.name)}-importado`,name:group.name,municipality:group.municipality,area:group.area,cultures:group.culture,relationshipTime:'Histórico importado',primaryProfile:'A classificar',secondaryProfile:'Aguardando Produtor 360',scores:{},irt:0,irtBand:'Aguardando Produtor 360',nps:0,npsClass:'A medir',servicePreference:'A reconhecer',contactFrequency:'Definida pela Val conforme recência',contentPreference:'Recomendação orientada pelo histórico',postSalePreference:'A reconhecer',commercial:{potential,lastContactDays:days,priority:score>=75?'Alta':score>=50?'Média':'Nutrir',opportunity,property:group.municipality,score,revenue:group.revenue,frequency:group.rows.length,averageTicket:avgTicket,conversion:Math.round(conversion*100),categories:[...group.products],lastBusinessAt:group.lastDate?.toISOString()||null,learningConfidence:Math.min(98,45+group.rows.length*7)},source:'Base Inteligente'}
 })
}

export function summarizeLearning(clients,rowCount,fileName){
 const totalRevenue=clients.reduce((sum,client)=>sum+Number(client.commercial?.revenue||0),0)
 return {id:`import-${Date.now()}`,fileName,rowCount,clientCount:clients.length,totalRevenue,averageTicket:clients.reduce((sum,client)=>sum+Number(client.commercial?.averageTicket||0),0)/Math.max(clients.length,1),highPotential:clients.filter(client=>client.commercial?.priority==='Alta').length,createdAt:new Date().toISOString()}
}
