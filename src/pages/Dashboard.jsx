import React from 'react'
import {
  ArrowUpRight,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock3,
  DatabaseZap,
  MapPin,
  Percent,
  Route,
  Sparkles,
  Target,
  Users
} from 'lucide-react'
import KpiCard from '../components/KpiCard'
import ValPanel from '../components/ValPanel'
import {opportunityCacheKey,parseOpportunityCache,reconcilePipeline,resolveOpportunityCandidate} from '../lib/opportunity-pipeline'

const greeting=()=>{
 const hour=new Date().getHours()
 if(hour<12)return 'Bom dia'
 if(hour<18)return 'Boa tarde'
 return 'Boa noite'
}

const compactDate=value=>{
 if(!value)return 'Próximo compromisso'
 const date=new Date(`${value}T12:00:00`)
 return date.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).replace('.','')
}

const pipelineStages=[
 {name:'Diagnóstico',detail:'Dor e impacto registrados'},
 {name:'Proposta',detail:'Solução e valor apresentados'},
 {name:'Negociação',detail:'Decisão e acordo em curso'},
 {name:'Fechado',detail:'Negócio marcado como concluído'}
]
const compactMoney=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',notation:'compact',maximumFractionDigits:1})

export default function Dashboard({clients,visits,currentUser,setPage,onClient,onPrepare}){
 const firstName=String(currentUser?.name||currentUser?.email?.split('@')[0]||'Equipe').trim().split(/\s+/)[0]
 const totalPotential=clients.reduce((sum,client)=>sum+(client.commercial?.potentialValidated===false?0:Number(client.commercial?.potential||0)),0)
 const irt=(clients.reduce((sum,client)=>sum+Number(client.irt||0),0)/Math.max(clients.length,1)).toFixed(1)
 const priorities=clients.map(client=>({client,candidate:resolveOpportunityCandidate(client)})).filter(item=>item.candidate).sort((a,b)=>(b.client.commercial?.potential||0)-(a.client.commercial?.potential||0)).slice(0,3)
 const nextVisit=[...(visits||[])].sort((a,b)=>`${a.date||''}${a.time||''}`.localeCompare(`${b.date||''}${b.time||''}`))[0]
 const nextClient=clients.find(client=>client.id===nextVisit?.clientId)||clients[0]
 const quickActions=[
  {page:'visits',label:'Planejar visita',detail:'Agenda e roteiro',icon:CalendarDays},
  {page:'questionnaire',label:'Produtor 360',detail:'Convite ou importação',icon:ClipboardList},
  {page:'datahub',label:'Importar carteira',detail:'Clientes e negócios',icon:DatabaseZap},
  {page:'val',label:'Perguntar à Val',detail:'Próxima melhor ação',icon:BrainCircuit}
 ]
 const cacheKey=opportunityCacheKey(currentUser?.storageScope)
 const pipelineItems=reconcilePipeline(clients,cacheKey?parseOpportunityCache(localStorage.getItem(cacheKey)):[])
 const pipelineSummary=pipelineStages.map(stage=>{
  const stageItems=pipelineItems.filter(item=>item.stage===stage.name)
  return {...stage,count:stageItems.length,value:stageItems.reduce((sum,item)=>sum+Number(item.value||0),0)}
 })
 const largestStage=Math.max(...pipelineSummary.map(stage=>stage.count),1)
 const visitSeries=Array.from({length:5},(_,index)=>{
  const date=new Date();date.setDate(1);date.setMonth(date.getMonth()-(4-index))
  const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  return {key,label:date.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),count:(visits||[]).filter(visit=>String(visit.date||'').startsWith(key)).length}
 })
 const maxMonthlyVisits=Math.max(...visitSeries.map(month=>month.count),1)
 const recentVisits=[...(visits||[])].sort((a,b)=>`${b.date||''}${b.time||''}`.localeCompare(`${a.date||''}${a.time||''}`)).slice(0,4)

 return <div className="page-stack home-page">
  <section className="home-command">
   <div className="home-command-copy">
    <span className="home-live"><i/> VALOR 360 • CENTRAL ATIVA</span>
    <h2>{greeting()}, {firstName}.</h2>
    <p>Seu dia já está priorizado. Comece pela ação com maior impacto no relacionamento e no resultado.</p>
    <div className="home-command-actions">
     <button className="home-primary" onClick={()=>nextClient&&onPrepare(nextClient)} disabled={!nextClient}><Sparkles/>Preparar com a Val</button>
     <button className="home-secondary" onClick={()=>setPage('visits')}>Ver minha agenda <ChevronRight/></button>
    </div>
   </div>
   <article className="next-action-card">
    <div className="next-action-top"><span>PRÓXIMA AÇÃO</span><b><Clock3/>{nextVisit?.time||'14:00'}</b></div>
    <div className="next-action-person"><span>{nextClient?.name?.split(' ').map(part=>part[0]).slice(0,2).join('')||'P'}</span><div><small>{compactDate(nextVisit?.date)}</small><h3>{nextClient?.name||'Selecione um produtor'}</h3><p><MapPin/>{nextClient?.commercial?.property||nextClient?.municipality||'São Luiz Gonzaga • RS'}</p></div></div>
    <div className="next-action-objective"><Route/><div><small>OBJETIVO</small><p>{nextVisit?.objective||nextClient?.commercial?.opportunity||'Revisar prioridades e combinar o próximo avanço.'}</p></div></div>
    <button onClick={()=>nextClient&&onPrepare(nextClient)} disabled={!nextClient}>Abrir roteiro inteligente <ArrowUpRight/></button>
   </article>
  </section>

  <section className="home-quick-actions" aria-label="Ações rápidas">
   <div><span className="eyebrow">ACESSO RÁPIDO</span><h3>O que você quer fazer?</h3></div>
   <div className="home-quick-grid">{quickActions.map(({page,label,detail,icon:Icon})=><button key={page} onClick={()=>setPage(page)}><span><Icon/></span><div><b>{label}</b><small>{detail}</small></div><ChevronRight/></button>)}</div>
  </section>

  <section className="kpi-grid home-kpis">
   <KpiCard icon={Users} label="Clientes ativos" value={clients.length} delta="Carteira consolidada"/>
   <KpiCard icon={CalendarCheck2} label="Visitas na agenda" value={visits?.length||0} delta="Planejamento atual"/>
   <KpiCard icon={Target} label="Potencial mapeado" value={`R$ ${(totalPotential/1000).toFixed(0)} mil`} delta={`${priorities.length} prioridades agora`} tone="cyan"/>
   <KpiCard icon={Percent} label="IRT médio" value={irt} delta="Relacionamento estratégico" tone="green"/>
  </section>

  <section className="priority-strip"><div className="priority-copy"><span className="eyebrow">PRIORIDADE DA VAL</span><h3>Quem merece sua atenção agora</h3><p>Somente oportunidades com uma necessidade ou evidência comercial registrada.</p></div>{priorities.map(({client,candidate},index)=><button key={client.id} onClick={()=>onClient(client)}><span>{String(index+1).padStart(2,'0')}</span><div><b>{client.name}</b><small>{candidate.title}</small></div><strong>{client.commercial?.potentialValidated===false?`Índice ${client.commercial?.score||0}`:`R$ ${Math.round((client.commercial?.potential||0)/1000)}k`}</strong><ArrowUpRight/></button>)}{!priorities.length&&<div className="priority-empty"><Target/><div><b>Nenhuma oportunidade confirmada</b><small>Use a descoberta consultiva antes de abrir um negócio no pipeline.</small></div></div>}</section>

  <section className="dashboard-grid home-analysis">
   <article className="panel chart-panel">
    <div className="panel-head"><div><span className="eyebrow">ATIVIDADE</span><h3>Visitas registradas por mês</h3></div><button type="button" onClick={()=>setPage('visits')}>Ver agenda</button></div>
    <div className="mini-chart visit-chart" role="img" aria-label={visitSeries.map(month=>`${month.label}: ${month.count} visitas`).join(', ')}>
     <div className="visit-chart-grid">{visitSeries.map(month=><span className={`visit-bar ${month.count?'':'empty'}`} key={month.key}><b>{month.count}</b><i style={{'--visit-level':`${(month.count/maxMonthlyVisits)*100}%`}}><span/></i><small>{month.label}</small></span>)}</div>
     <p>Contagem baseada nas datas disponíveis na agenda atual.</p>
    </div>
   </article>
   <article className="panel funnel-panel">
    <div className="panel-head"><div><span className="eyebrow">PIPELINE</span><h3>Oportunidades por etapa</h3></div><button type="button" onClick={()=>setPage('opportunities')}>Abrir pipeline</button></div>
    <ol className="funnel" aria-label="Distribuição das oportunidades por etapa">
     {pipelineSummary.map((stage,index)=><li className={`f-step f${index+1}`} key={stage.name} style={{'--stage-share':`${(stage.count/largestStage)*100}%`}}>
      <span className="f-step-index">{String(index+1).padStart(2,'0')}</span>
      <span className="f-step-copy"><b>{stage.name}</b><small>{stage.detail}</small></span>
      <span className="f-step-metric"><b>{stage.count}</b><small>{compactMoney(stage.value)}</small></span>
      <span className="f-step-track" aria-hidden="true"><i/></span>
     </li>)}
    </ol>
    <p className="funnel-note">Contagem e valores registrados na carteira. Etapa não representa probabilidade de fechamento.</p>
   </article>
  </section>

  <section className="dashboard-grid lower home-analysis">
   <article className="panel segment-panel">
    <div className="panel-head"><div><span className="eyebrow">CARTEIRA</span><h3>Tags autodeclaradas</h3></div></div>
    <div className="donut-wrap"><div className="donut"><div><b>{clients.length}</b><small>Produtores</small></div></div>
    <div className="legend">{['Analítico','Relacional','Conservador','Digital'].map((profile,index)=><span key={profile}><i className={`dot d${index}`}/>{profile}</span>)}</div></div>
   </article>
   <article className="panel recent-panel">
    <div className="panel-head"><div><span className="eyebrow">ATIVIDADES</span><h3>Atividades recentes</h3></div><button onClick={()=>setPage('visits')}>Ver todas</button></div>
    {recentVisits.length?recentVisits.map(visit=>{const client=clients.find(item=>item.id===visit.clientId);return <div className="activity" key={visit.id}><CalendarDays className="purple"/><div><b>{visit.status==='Realizada'?'Visita realizada':'Visita agendada'}</b><span>{client?.name||'Produtor'} • {compactDate(visit.date)}</span></div></div>}):<div className="activity"><CalendarDays className="purple"/><div><b>Nenhuma atividade registrada</b><span>As visitas salvas aparecerão aqui.</span></div></div>}
   </article>
  </section>

  <ValPanel clients={clients} selectedClient={nextClient} onSelect={onClient}/>
 </div>
}
