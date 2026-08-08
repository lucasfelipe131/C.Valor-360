import React from 'react'
import { Users, CalendarCheck2, Target, Percent, ArrowUpRight, BrainCircuit, CheckCircle2, FileText, CalendarDays } from 'lucide-react'
import KpiCard from '../components/KpiCard'
import ValPanel from '../components/ValPanel'
export default function Dashboard({clients,visits,setPage,onClient,onPrepare}){
 const totalPotential=clients.reduce((s,c)=>s+(c.commercial?.potential||0),0)
 const irt=(clients.reduce((s,c)=>s+Number(c.irt||0),0)/Math.max(clients.length,1)).toFixed(1)
 const priorities=[...clients].sort((a,b)=>(b.commercial?.potential||0)-(a.commercial?.potential||0)).slice(0,3)
 const nextVisit=visits?.[0]
 const nextClient=clients.find(c=>c.id===nextVisit?.clientId)||clients[0]
 return <div className="page-stack">
  <section className="mobile-welcome"><div><span>Olá, Lucas!</span><h2>Vamos transformar relacionamentos em resultados hoje?</h2></div><div className="mobile-next"><small>PRÓXIMA VISITA</small><b>{nextClient?.name}</b><span>{nextVisit?.time||'14:00'} • {nextClient?.commercial?.property||nextClient?.municipality}</span><button onClick={()=>onPrepare(nextClient)}>Abrir roteiro</button></div></section>
  <section className="kpi-grid">
   <KpiCard icon={Users} label="Clientes ativos" value={clients.length} delta="Base piloto atual"/>
   <KpiCard icon={CalendarCheck2} label="Visitas realizadas" value="32" delta="+8 no mês"/>
   <KpiCard icon={Target} label="Oportunidades" value="18" delta={`R$ ${(totalPotential/1000).toFixed(0)} mil mapeados`} tone="cyan"/>
   <KpiCard icon={Percent} label="IRT médio" value={irt} delta="Relacionamento estratégico" tone="green"/>
  </section>

  <section className="priority-strip"><div className="priority-copy"><span className="eyebrow">PRIORIDADE DA VAL</span><h3>Quem merece sua atenção agora</h3><p>Potencial, tempo sem contato e oportunidade combinados.</p></div>{priorities.map((client,index)=><button key={client.id} onClick={()=>onClient(client)}><span>{String(index+1).padStart(2,'0')}</span><div><b>{client.name}</b><small>{client.commercial?.opportunity}</small></div><strong>R$ {Math.round((client.commercial?.potential||0)/1000)}k</strong><ArrowUpRight size={17}/></button>)}</section>

  <section className="dashboard-grid">
   <article className="panel chart-panel">
    <div className="panel-head"><div><span className="eyebrow">DESEMPENHO</span><h3>Evolução das visitas</h3></div><button>Visitas</button></div>
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

  <section className="dashboard-grid lower">
   <article className="panel segment-panel">
    <div className="panel-head"><div><span className="eyebrow">CARTEIRA</span><h3>Perfis dos produtores</h3></div></div>
    <div className="donut-wrap"><div className="donut"><div><b>{clients.length}</b><small>Produtores</small></div></div>
    <div className="legend">{['Analítico','Relacional','Conservador','Digital'].map((p,i)=><span key={p}><i className={'dot d'+i}></i>{p}</span>)}</div></div>
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
