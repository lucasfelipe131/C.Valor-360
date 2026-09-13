const text=value=>String(value??'').trim()
const day=(value,timeZone)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
const closed=value=>/^(DONE|COMPLETED|CANCELLED|CONCLU[IÍ]DO|CANCELADO|RESOLVIDO)$/i.test(text(value))
const LIMIT=8
const normalized=value=>text(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

// "O produtor nao pretende retomar o plantio" casava com 'retomar' e virava pendencia PROPOSED:
// a frase que diz que NAO ha o que fazer chegava a tela do dia como tarefa a cumprir.
const negatedCommitment=/\bn[aã]o\s+(?:\w+\s+){0,3}?(?:combinamos|pretende[m]?|vai|v[aã]o|quer|querem|deseja[m]?|precisa[m]?|ir[aá]|ir[aã]o|havia|houve|tem|t[eê]m|fic(?:ou|aram))\b|\bsem\s+(?:compromisso|pend[eê]ncia|retorno)\b|\bnada\s+(?:ficou\s+)?pendente\b|\bnenhum\s+compromisso\b/i
export function narrativeFollowups(record){
 return text(record.summary).split(/(?<=[.!?])\s+/).flatMap((description,index)=>{
  if(!/combinamos|ficou pendente|pr[oó]xima visita|compromisso|retornar|retomar/i.test(description))return []
  if(negatedCommitment.test(description))return []
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
  // Só compromisso confirmado pelo consultor é pendência registrada. O que veio da leitura do relato
  // ("Realizar o retorno combinado.") é hipótese do extrator e precisa chegar à tela dizendo isso —
  // o consultor chegou a relatar que NÃO havia retorno a fazer e mesmo assim via a frase como fato.
  const attested=record.origin==='COMMITMENT'
  const label=attested
   ?classification==='DUE_TODAY'?'Prazo hoje':classification==='OVERDUE'?'Prazo vencido — confirmar situação':'Sugestão sem data'
   :classification==='DUE_TODAY'?'Prazo hoje — leitura do relato, não confirmada':classification==='OVERDUE'?'Prazo vencido — leitura do relato, não confirmada':'Sugestão do relato — não confirmada'
  candidates.push({...record,id:`suggestion:${record.sourceId}`,classification,confirmed:false,attested,label,
   reason:record.description,focus:attested?classification==='OVERDUE'?`Confirmar se foi resolvido: ${record.description}`:`Retomar: ${record.description}`:`Confirmar com o produtor se isto procede: ${record.description}`})
 }
 const rank={DUE_TODAY:0,OVERDUE:1,SUGGESTED:2}
 // O driver do Postgres devolve updated_at como Date. text(Date) vira "Sat Sep 13 2026 ..." e o
 // localeCompare ordenava a lista do dia pelo NOME DO DIA DA SEMANA em ingles (Fri, Mon, Sat, Sun,
 // Thu, Tue, Wed) — e o corte em 8 produtores caia em cima dessa ordem sem sentido.
 const at=value=>{const time=new Date(value??0).getTime();return Number.isFinite(time)?time:0}
 candidates.sort((a,b)=>rank[a.classification]-rank[b.classification]||at(b.updatedAt)-at(a.updatedAt)||text(a.clientName).localeCompare(text(b.clientName)))
 const seen=new Set()
 const eligible=candidates.filter(item=>{if(seen.has(item.clientId))return false;seen.add(item.clientId);return true})
 // O corte existe (a lista do dia e curta de proposito), mas nao pode ser silencioso.
 return Object.assign(eligible.slice(0,LIMIT),{total:eligible.length,omitted:Math.max(0,eligible.length-LIMIT),limit:LIMIT})
}
