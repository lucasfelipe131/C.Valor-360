import React from 'react'
import {
  ArrowUpRight,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  DatabaseZap,
  FileText,
  MapPin,
  Percent,
  Route,
  Sparkles,
  Target,
  Users
} from 'lucide-react'
import KpiCard from '../components/KpiCard'
import ValPanel from '../components/ValPanel'

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

export default function Dashboard({clients,visits,setPage,onClient,onPrepare}){
 const totalPotential=clients.reduce((sum,client)=>sum+Number(client.commercial?.potential||0),0)
 const irt=(clients.reduce((sum,client)=>sum+Number(client.irt||0),0)/Math.max(clients.length,1)).toFixed(1)
 const priorities=[...clients].sort((a,b)=>(b.commercial?.potential||0)-(a.commercial?.potential||0)).slice(0,3)
 const nextVisit=[...(visits||[])].sort((a,b)=>`${a.date||''}${a.time||''}`.localeCompare(`${b.date||''}${b.time||''}`))[0]
 const nextClient=clients.find(client=>client.id===nextVisit?.clientId)||clients[0]
 const quickActions=[
  {page:'visits',label:'Planejar visita',detail:'Agenda e roteiro',icon:CalendarDays},
  {page:'questionnaire',label:'Produtor 360',detail:'Convite ou importação',icon:ClipboardList},
  {page:'datahub',label:'Importar carteira',detail:'Clientes e negócios',icon:DatabaseZap},
  {page:'val',label:'Perguntar à Val',detail:'Próxima melhor ação',icon:BrainCircuit}
 ]

 return <div className="page-stack home-page">
  <section className="home-command">
   <div className="home-command-copy">
    <span className="home-live"><i/> CLIENTE 360 CVALE • CENTRAL ATIVA</span>
    <h2>{greeting()}, Lucas.</h2>
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

  <section className="priority-strip"><div className="priority-copy"><span className="eyebrow">PRIORIDADE DA VAL</span><h3>Quem merece sua atenção agora</h3><p>Potencial, tempo sem contato e oportunidade combinados.</p></div>{priorities.map((client,index)=><button key={client.id} onClick={()=>onClient(client)}><span>{String(index+1).padStart(2,'0')}</span><div><b>{client.name}</b><small>{client.commercial?.opportunity}</small></div><strong>R$ {Math.round((client.commercial?.potential||0)/1000)}k</strong><ArrowUpRight/></button>)}</section>

  <section className="dashboard-grid home-analysis">
   <article className="panel chart-panel">
    <div className="panel-head"><div><span className="eyebrow">DESEMPENHO</span><h3>Evolução das visitas</h3></div><button onClick={()=>setPage('visits')}>Ver agenda</button></div>
    <div className="mini-chart"><svg viewBox="0 0 520 210" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#2B83F6" stopOpacity=".28"/><stop offset="1" stopColor="#2B83F6" stopOpacity="0"/></linearGradient></defs><path d="M10 165 C55 145,85 120,120 132 S190 140,220 90 S290 50,330 88 S410 130,510 30 L510 205 L10 205 Z" fill="url(#area)"/><path d="M10 165 C55 145,85 120,120 132 S190 140,220 90 S290 50,330 88 S410 130,510 30" fill="none" stroke="#1768D6" strokeWidth="4" strokeLinecap="round"/><g fill="#1768D6"><circle cx="120" cy="132" r="5"/><circle cx="220" cy="90" r="5"/><circle cx="330" cy="88" r="5"/><circle cx="510" cy="30" r="5"/></g></svg><div className="months"><span>Jan</span><span>Fev</span><span>Mar</span><span>Abr</span><span>Mai</span></div></div>
   </article>
   <article className="panel funnel-panel">
    <div className="panel-head"><div><span className="eyebrow">PIPELINE</span><h3>Funil de oportunidades</h3></div></div>
    <div className="funnel">
      <div className="f-step f1"><span>Prospectados</span><b>53</b></div>
      <div className="f-step f2"><span>Qualificados</span><b>31</b></div>
      <div className="f-step f3"><span>Propostas</span><b>18</b></div>
      <div className="f-step f4"><span>Negócios</span><b>7</b></div>
    </div>
   </article>
  </section>

  <section className="dashboard-grid lower home-analysis">
   <article className="panel segment-panel">
    <div className="panel-head"><div><span className="eyebrow">CARTEIRA</span><h3>Perfis dos produtores</h3></div></div>
    <div className="donut-wrap"><div className="donut"><div><b>{clients.length}</b><small>Produtores</small></div></div>
    <div className="legend">{['Analítico','Relacional','Conservador','Digital'].map((profile,index)=><span key={profile}><i className={`dot d${index}`}/>{profile}</span>)}</div></div>
   </article>
   <article className="panel recent-panel">
    <div className="panel-head"><div><span className="eyebrow">ATIVIDADES</span><h3>Atividades recentes</h3></div><button onClick={()=>setPage('visits')}>Ver todas</button></div>
    <div className="activity"><CheckCircle2 className="success"/><div><b>Visita realizada com sucesso</b><span>Genor Brum Filho • Hoje</span></div></div>
    <div className="activity"><FileText className="blue"/><div><b>Proposta enviada</b><span>Comparativo técnico • Ontem</span></div></div>
    <div className="activity"><Target className="green"/><div><b>Nova oportunidade criada</b><span>Henrique Gambin • 06/08</span></div></div>
    <div className="activity"><CalendarDays className="purple"/><div><b>Reunião agendada</b><span>Matheus Jaeger • 05/08</span></div></div>
   </article>
  </section>

  <ValPanel clients={clients} selectedClient={nextClient} onSelect={onClient}/>
 </div>
}
