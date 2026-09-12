const text=value=>String(value??'').trim()
const day=(value,timeZone)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
const closed=value=>/^(DONE|COMPLETED|CANCELLED|CONCLU[IÍ]DO|CANCELADO|RESOLVIDO)$/i.test(text(value))
const normalized=value=>text(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

export function narrativeFollowups(record){
 return text(record.summary).split(/(?<=[.!?])\s+/).flatMap((description,index)=>{
  if(!/combinamos|ficou pendente|pr[oó]xima visita|compromisso|retornar|retomar/i.test(description))return []
  const resolved=/conclu[ií]d|resolvid|cancelad|n[aã]o precisa retornar/i.test(description)
  const literal=description.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/)
  const iso=description.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
  const due=iso||(literal?`${literal[3]}-${literal[2]}-${literal[1]}`:null)
  return [{...record,sourceId:`${record.sourceId}:sentence:${index}`,description,status:resolved?'DONE':'PROPOSED',dueAt:due?`${due}T12:00:00-03:00`:null}]
 })
}

// Pure ranking over authorized records. Suggestions never create visits.
export function dailyVisitSuggestions({records=[],now=new Date(),timeZone='America/Sao_Paulo'}={}){
 const today=day(now,timeZone),latest=new Map()
 for(const record of records){
  if(!record.clientId||!record.sourceId||!text(record.description))continue
  const key=`${record.clientId}:${normalized(record.description)}`
  const previous=latest.get(key)
  if(!previous||new Date(record.updatedAt||0)>=new Date(previous.updatedAt||0))latest.set(key,record)
 }
 const candidates=[]
 for(const record of latest.values()){
  if(closed(record.status))continue
  const due=record.dueAt?day(record.dueAt,timeZone):''
  if(due&&due>today)continue
  // Undated notes remain optional opportunities, never today's obligations.
  const classification=due===today?'DUE_TODAY':due?'OVERDUE':'SUGGESTED'
  candidates.push({...record,id:`suggestion:${record.sourceId}`,classification,confirmed:false,
   label:classification==='DUE_TODAY'?'Prazo hoje':classification==='OVERDUE'?'Prazo vencido — confirmar situação':'Sugestão sem data',
   reason:record.description,focus:classification==='OVERDUE'?`Confirmar se foi resolvido: ${record.description}`:`Retomar: ${record.description}`})
 }
 const rank={DUE_TODAY:0,OVERDUE:1,SUGGESTED:2}
 candidates.sort((a,b)=>rank[a.classification]-rank[b.classification]||text(b.updatedAt).localeCompare(text(a.updatedAt))||text(a.clientName).localeCompare(text(b.clientName)))
 const seen=new Set()
 return candidates.filter(item=>{if(seen.has(item.clientId))return false;seen.add(item.clientId);return true}).slice(0,8)
}
