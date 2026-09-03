// Home como centro operacional: responde "o que precisa da minha atenção agora?"
//
// Tudo aqui é contado a partir do que a sessão já carregou — agenda, funil e
// carteira. Nenhuma chamada nova, nenhum número estimado. Se um contador não
// tem base registrada, ele vale zero e a interface diz o que isso significa,
// em vez de inventar urgência.

const text=value=>String(value??'').trim()

export const visitLifecycle=visit=>{
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

export const visitMoment=visit=>{
 const raw=visit?.scheduledAt||visit?.occurredAt||visit?.completedAt||(visit?.date?`${visit.date}T${text(visit.time)||'00:00'}`:'')
 if(!raw)return null
 const parsed=new Date(raw)
 return Number.isNaN(parsed.getTime())?null:parsed
}

const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
const isOpenStage=stage=>!/fechad|ganho|perdid|cancelad|closed|won|lost/i.test(text(stage))

export function buildDayBriefing({visits=[],opportunities=[],clients=[],now=new Date()}={}){
 const live=visits.filter(visit=>visitLifecycle(visit)!=='CANCELLED')
 const dated=live.map(visit=>({visit,at:visitMoment(visit),lifecycle:visitLifecycle(visit)}))

 const today=dated.filter(entry=>entry.at&&sameDay(entry.at,now))
 const concluded=today.filter(entry=>entry.lifecycle==='COMPLETED').length

 const prepared=dated.filter(entry=>entry.lifecycle==='PREPARED').length
 // "Pendência" é estado real do ciclo de vida, não alerta inventado: visita em
 // andamento ou aguardando revisão continua exigindo uma ação do consultor.
 const pending=dated.filter(entry=>['IN_PROGRESS','COMPLETED_PENDING_REVIEW'].includes(entry.lifecycle))

 const openOpportunities=opportunities.filter(item=>isOpenStage(item?.stage))

 const upcoming=dated
  .filter(entry=>entry.at&&entry.at.getTime()>=now.getTime()&&!['COMPLETED','COMPLETED_PENDING_REVIEW'].includes(entry.lifecycle))
  .sort((a,b)=>a.at-b.at)
  .slice(0,4)
  .map(({visit,at,lifecycle})=>{
   const client=clients.find(item=>String(item.id)===String(visit.clientId??visit.client_id))||null
   return {
    id:text(visit.id)||at.toISOString(),
    at,
    lifecycle,
    clientId:text(visit.clientId??visit.client_id),
    clientName:client?.name||'Produtor não vinculado',
    place:text(client?.commercial?.property)||text(client?.municipality),
    objective:text(visit.objective)||'Objetivo ainda não registrado.'
   }
  })

 return {
  cards:[
   {id:'today',label:'Visitas de hoje',value:today.length,hint:today.length?`${concluded} concluída${concluded===1?'':'s'}`:'Nenhuma na agenda de hoje',page:'visits'},
   {id:'prepared',label:'Preparadas',value:prepared,hint:prepared?'Prontas para a conversa':'Nenhuma preparada ainda',page:'visits'},
   {id:'opportunities',label:'Oportunidades',value:openOpportunities.length,hint:openOpportunities.length?'Em acompanhamento':'Nenhuma em aberto',page:'opportunities'},
   {id:'pending',label:'Pendências',value:pending.length,hint:pending.length?'Aguardam seu registro':'Nada aguardando registro',page:'visits'}
  ],
  upcoming,
  undatedVisits:live.length-dated.filter(entry=>entry.at).length
 }
}
