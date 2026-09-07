// Timeline 360 — reúne, em uma linha só, o que já está registrado sobre o produtor.
//
// REGRA: não fabricar histórico. Cada entrada vem de uma fonte real e carrega
// a data que aquela fonte registrou. Um evento sem data verificável não entra
// na linha — ele é contado à parte, para que a interface possa dizer com
// honestidade que existe registro sem data em vez de inventar uma.
//
// Também não duplica: visita, transição de oportunidade, compromisso e
// atualização de contexto são eventos distintos com chaves distintas.

const text=value=>String(value??'').trim()
const parseDate=value=>{
 if(!value)return null
 const parsed=value instanceof Date?value:new Date(value)
 return Number.isNaN(parsed.getTime())?null:parsed
}
const sameClient=(a,b)=>text(a)!==''&&text(a)===text(b)

const visitLifecycle=visit=>{
 const explicit=text(visit?.lifecycleStatus||visit?.lifecycle_status).toUpperCase()
 if(['PLANNED','PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'].includes(explicit))return explicit
 const legacy=text(visit?.status).toLocaleLowerCase('pt-BR')
 if(/cancelad/.test(legacy))return 'CANCELLED'
 if(/realizad|conclu[ií]d/.test(legacy))return 'COMPLETED'
 if(/revis[aã]o/.test(legacy))return 'COMPLETED_PENDING_REVIEW'
 if(/andamento|iniciad/.test(legacy))return 'IN_PROGRESS'
 if(/preparad/.test(legacy))return 'PREPARED'
 return 'PLANNED'
}

const VISIT_LABEL={
 PLANNED:'Visita agendada',
 PREPARED:'Visita preparada',
 IN_PROGRESS:'Visita iniciada',
 COMPLETED_PENDING_REVIEW:'Visita aguardando revisão',
 COMPLETED:'Visita realizada',
 CANCELLED:'Visita cancelada'
}

export function buildProducerTimeline({client,visits=[],opportunities=[],commitments=[],contextMeta=null,voiceChange=null}={}){
 const clientId=text(client?.id)
 const entries=[]
 let undated=0

 for(const visit of visits){
  if(!sameClient(visit?.clientId??visit?.client_id,clientId))continue
  const at=parseDate(visit?.completedAt||visit?.occurredAt||visit?.scheduledAt||visit?.date)
  if(!at){undated+=1;continue}
  const lifecycle=visitLifecycle(visit)
  entries.push({
   id:`visit:${text(visit.id)||at.toISOString()}`,
   kind:'visit',
   at,
   title:VISIT_LABEL[lifecycle]||'Visita',
   detail:text(visit.summary)||text(visit.objective)||'Sem objetivo registrado.',
   status:lifecycle,
   source:'Agenda de visitas'
  })
 }

 for(const opportunity of opportunities){
  if(!sameClient(opportunity?.clientId??opportunity?.client_id,clientId))continue
  // Só a transição registrada com evidência tem data confiável.
  const at=parseDate(opportunity?.evidence?.at)
  if(!at){undated+=1;continue}
  const from=text(opportunity.evidence.from)
  const to=text(opportunity.evidence.to)||text(opportunity.stage)
  entries.push({
   id:`opportunity:${text(opportunity.candidateKey)||text(opportunity.id)}:${at.toISOString()}`,
   kind:'opportunity',
   at,
   title:from&&to&&from!==to?`Oportunidade avançou para ${to}`:`Oportunidade em ${to||'etapa não informada'}`,
   detail:text(opportunity.title)||text(opportunity.hypothesis)||'Oportunidade sem título.',
   status:to,
   source:'Funil de oportunidades'
  })
 }

 for(const commitment of commitments){
  // A rota /api/v1/commitments já vem filtrada por produtor e nem sempre ecoa
  // o clientId. Só descartamos quando o registro declara OUTRO produtor.
  const owner=text(commitment?.clientId??commitment?.client_id)
  if(owner&&clientId&&owner!==clientId)continue
  const at=parseDate(commitment?.due_at??commitment?.dueAt)
  if(!at){undated+=1;continue}
  entries.push({
   id:`commitment:${text(commitment.id)||at.toISOString()}`,
   kind:'commitment',
   at,
   title:({PROPOSED:'Compromisso proposto',ACCEPTED:'Compromisso combinado',IN_PROGRESS:'Compromisso em andamento',DONE:'Compromisso concluído',BLOCKED:'Compromisso bloqueado',CANCELLED:'Compromisso cancelado'})[text(commitment.status).toUpperCase()]||'Compromisso registrado',
   detail:text(commitment.description)||text(commitment.statement)||'Compromisso sem descrição.',
   status:text(commitment.status),
   source:'Compromissos'
  })
 }

 const contextAt=parseDate(contextMeta?.updatedAt)
 if(contextAt)entries.push({
  id:`context:${contextAt.toISOString()}`,
  kind:'context',
  at:contextAt,
  title:contextMeta?.status==='verified'?'Contexto técnico verificado':'Contexto técnico atualizado pelo consultor',
  detail:contextMeta?.status==='verified'?'Memória verificada e disponível para a VAL.':'Entrada do consultor aguardando verificação.',
  status:text(contextMeta?.status),
  source:'Complemento técnico'
 })

 const voiceAt=parseDate(voiceChange?.at||voiceChange?.confirmedAt)||(voiceChange?.summary?new Date():null)
 if(voiceAt&&voiceChange?.summary)entries.push({
  id:`voice:${voiceAt.toISOString()}`,
  kind:'note',
  at:voiceAt,
  title:'Registro confirmado por voz',
  detail:text(voiceChange.summary),
  status:'CONFIRMED',
  source:'Captura por voz'
 })

 const seen=new Set()
 const items=entries
  .filter(entry=>{if(seen.has(entry.id))return false;seen.add(entry.id);return true})
  .sort((a,b)=>b.at-a.at)

 const now=Date.now()
 return {
  items,
  undated,
  upcoming:items.filter(entry=>entry.at.getTime()>now).length,
  isEmpty:items.length===0
 }
}

export const TIMELINE_KIND_LABEL={
 visit:'Visita',
 opportunity:'Oportunidade',
 commitment:'Compromisso',
 context:'Contexto',
 note:'Registro'
}
