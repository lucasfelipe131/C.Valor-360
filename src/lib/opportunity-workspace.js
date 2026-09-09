import {reconcilePipeline} from './opportunity-pipeline.js'
import {commercialMetrics} from './commercial-metrics.js'

export const OPPORTUNITY_STAGES=['Diagnóstico','Proposta','Negociação','Fechado']
export const BUSINESS_TYPES=['Insumos','Grãos','Barter']
export const WORKSPACE_METADATA='opportunity_workspace_v1'
export const WORKSPACE_EVENT='opportunity_workspace_event'
export const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
export const knownNumber=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))
export const opportunityValue=item=>item?.valueKnown===false||!knownNumber(item?.value)?null:Number(item.value)
export const normalizeSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export const metadataOf=item=>item?.workspaceDetails||(Array.isArray(item?.evidence)?item.evidence:[]).find(e=>e?.type===WORKSPACE_METADATA)||{}
export const historyOf=item=>(Array.isArray(item?.evidence)?item.evidence:[]).filter(e=>e?.type===WORKSPACE_EVENT).slice().reverse()

// This input is the authenticated API response, never a browser cache.
export function buildOpportunityWorkspace(clients=[],persisted=[]){
 const byClient=new Map(clients.map(c=>[String(c.id),c]))
 const canonical=new Map()
 for(const item of persisted){
  if(!byClient.has(String(item.clientId)))continue
  const key=String(item.databaseId||item.candidateKey||item.id||'')
  if(!key)continue
  const details=metadataOf(item)
  const status=details.status||item.status||(item.stage==='Fechado'?'closed':'open')
  canonical.set(String(item.clientId)+':'+key,{...item,...details,
   id:String(item.databaseId?'db:'+item.databaseId:item.clientId+':'+key),
   client:byClient.get(String(item.clientId)),status,
   stage:OPPORTUNITY_STAGES.includes(item.stage)?item.stage:'Diagnóstico',
   value:opportunityValue(item),valueKnown:opportunityValue(item)!==null,
   crop:details.crop||item.crop||'',season:details.season||item.season||'',
   // O vazio gravado e uma escolha do consultor, nao ausencia de informacao: cair no fallback de
   // category fazia o cartao, o chip de filtro e o CSV continuarem mostrando o tipo apagado.
   businessType:details.businessType??item.businessType??(BUSINESS_TYPES.includes(item.category)?item.category:''),
   nextAction:item.nextAction||'',nextActionAt:item.nextActionAt||null,
   history:historyOf(item),workspaceDetails:details
  })
 }
 const saved=[...canonical.values()]
 const projected=reconcilePipeline(clients,[]).filter(item=>{
  const client=byClient.get(String(item.clientId))
  if(client?.commercial?.synthetic&&saved.some(x=>x.clientId===item.clientId))return false
  return !saved.some(x=>String(x.clientId)===String(item.clientId)&&x.candidateKey===item.candidateKey)
 }).map(item=>{
  const client=byClient.get(String(item.clientId));const metrics=commercialMetrics(client)
  // O candidato projetado do cadastro vale a carteira em aberto INTEIRA do produtor. Quando o
  // consultor ja registrou uma oportunidade para esse produtor, somar os dois conta o mesmo
  // dinheiro duas vezes em "Valor em aberto". O cartao da necessidade continua na tela; o que
  // some e a soma duplicada.
  const alreadyRegistered=saved.some(entry=>String(entry.clientId)===String(item.clientId))
  const projectedValue=alreadyRegistered||!metrics.openPotentialKnown?null:item.value
  return {...item,client,status:'open',value:projectedValue,valueKnown:projectedValue!==null,crop:'',season:'',businessType:'',nextAction:'',nextActionAt:null,history:[],workspaceDetails:{}}
 })
 return [...projected,...saved]
}
export function dayKey(value,timeZone='America/Sao_Paulo'){
 if(!value)return ''
 if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return String(value)
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return ''
 return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
}
export function dueInfo(item,now=new Date(),timeZone='America/Sao_Paulo'){
 if(!item.nextAction)return {label:'Sem prazo',state:'none'}
 if(item.nextActionDone)return {label:'Concluída',state:'done'}
 const day=dayKey(item.nextActionAt,timeZone),today=dayKey(now,timeZone)
 if(!day)return {label:'Sem prazo',state:'none'}
 const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1)
 const time=/T/.test(String(item.nextActionAt))?new Intl.DateTimeFormat('pt-BR',{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(item.nextActionAt)).replace(':00','h'):''
 if(day===today)return {label:'Hoje'+(time?' • '+time:''),state:'today'}
 if(day===tomorrow.toISOString().slice(0,10))return {label:'Amanhã',state:'future'}
 return {label:(day<today?'Atrasada • ':'')+day.slice(8,10)+'/'+day.slice(5,7),state:day<today?'overdue':'future'}
}
export function filterOpportunities(items,filters={}){
 const q=normalizeSearch(filters.search)
 return items.filter(item=>
  (!q||normalizeSearch(item.client?.name+' '+item.title).includes(q))&&
  (!filters.crop||item.crop===filters.crop)&&(!filters.season||item.season===filters.season)&&
  (!filters.type||item.businessType===filters.type)&&
  (filters.archived?['lost','archived'].includes(item.status):!['lost','archived'].includes(item.status)))
}
export function opportunityMetrics(items,now=new Date(),timeZone='America/Sao_Paulo'){
 const open=items.filter(x=>x.stage!=='Fechado'&&x.status==='open')
 const known=open.filter(x=>opportunityValue(x)!==null)
 const month=dayKey(now,timeZone).slice(0,7)
 const won=items.filter(x=>x.status==='won'&&dayKey(x.closedAt,timeZone).startsWith(month))
 return {open:open.length,openValue:known.reduce((s,x)=>s+x.value,0),unknown:open.length-known.length,
  wonValue:won.reduce((s,x)=>s+(opportunityValue(x)??0),0),wonUnknown:won.filter(x=>opportunityValue(x)===null).length,
  due:items.filter(x=>!['lost','archived'].includes(x.status)&&dueInfo(x,now,timeZone).state==='today').length,month}
}
export function scenarioResult({area,investment,returnPerHa}){
 if(![area,investment,returnPerHa].every(knownNumber))return null
 const a=Number(area),i=Number(investment),r=Number(returnPerHa)
 if(a<=0||i<0||r<0)return null
 return {net:(r-i)*a,investment:a*i,ratio:i>0?r/i:null}
}
export function opportunityCsv(items,timeZone='America/Sao_Paulo'){
 // Spreadsheet formula prefixes must never execute when an export is opened.
 const cell=value=>{let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
 const rows=[['Produtor','Oportunidade','Cultura','Safra','Tipo','Etapa','Resultado','Valor (BRL)','Volume','Unidade','Próxima ação','Prazo','Responsável'],
 ...items.map(x=>[x.client?.name,x.title,x.crop,x.season,x.businessType,x.stage,statusLabel(x),opportunityValue(x)??'Não informado',x.volume??'',x.volumeUnit||'',x.nextAction,dayKey(x.nextActionAt,timeZone),x.ownerName||''])]
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')
}
export function statusLabel(item){
 return ({won:'Ganho',lost:'Perdido',archived:'Arquivado',closed:'Fechado'})[item.status]||(item.waitingProducer?'Aguardando produtor':'')
}
