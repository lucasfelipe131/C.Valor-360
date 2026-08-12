import React from 'react'
import {Download,FileBarChart,HeartHandshake,Percent,Printer,Target,Users} from 'lucide-react'
import KpiCard from '../components/KpiCard'
import {compactBRL,commercialMetrics} from '../lib/commercial-metrics'

export default function Reports({clients,visits}){
 const irt=(clients.reduce((sum,c)=>sum+Number(c.irt||0),0)/Math.max(clients.length,1)).toFixed(1)
 const promoters=clients.filter(c=>Number(c.nps)>=9).length
 const clientMetrics=clients.map(commercialMetrics)
 const potential=clientMetrics.reduce((sum,metrics)=>sum+(metrics.potentialKnown?metrics.potentialTotal:0),0)
 const potentialKnown=clientMetrics.some(metrics=>metrics.potentialKnown)
 const profiles=['Analítico','Relacional','Conservador','Inovador','Digital']
 const counts=profiles.map(profile=>clients.filter(c=>c.primaryProfile===profile).length)
 const max=Math.max(...counts,1)
 return <div className="page-stack report-page">
  <section className="report-header"><div><span className="eyebrow">PAINEL DO PILOTO</span><h2>Resultados que cabem na banca — e na rotina.</h2><p>Indicadores da carteira atual, prontos para apoiar a apresentação de quatro minutos.</p></div><div className="report-actions"><button className="soft-btn" onClick={()=>window.print()}><Printer size={17}/>Imprimir</button><button className="primary-btn" onClick={()=>window.print()}><Download size={17}/>Exportar PDF</button></div></section>
  <section className="kpi-grid"><KpiCard icon={Users} label="Produtores mapeados" value={clients.length} delta="Base piloto"/><KpiCard icon={HeartHandshake} label="IRT médio" value={irt} delta="Relacionamento medido" tone="cyan"/><KpiCard icon={Percent} label="Promotores NPS" value={promoters} delta={`${Math.round(promoters/Math.max(clients.length,1)*100)}% da carteira`} tone="green"/><KpiCard icon={Target} label="Potencial validado" value={compactBRL(potential,{known:potentialKnown})} delta="Não inclui índices heurísticos"/></section>
  <section className="report-grid"><article className="panel"><div className="panel-head"><div><span className="eyebrow">TAGS DA CARTEIRA</span><h3>Preferências autodeclaradas dos produtores</h3></div><FileBarChart/></div><div className="profile-bars">{profiles.map((profile,i)=><div key={profile}><span>{profile}</span><div><i style={{width:`${counts[i]/max*100}%`}}></i></div><b>{counts[i]}</b></div>)}</div></article><article className="panel pilot-score"><span className="eyebrow">PRONTIDÃO DO MVP</span><div className="score-ring"><div><b>72%</b><span>piloto</span></div></div><ul><li><i></i>Cliente 360 e preferências ativas</li><li><i></i>VAL demonstrável</li><li><i></i>Agenda e oportunidades navegáveis</li><li className="pending"><i></i>Identidade corporativa e RLS</li></ul></article></section>
  <section className="panel impact-table"><div className="panel-head"><div><span className="eyebrow">INDICADORES DO PILOTO</span><h3>O que medir até novembro</h3></div></div><div className="table-row table-head"><span>Indicador</span><span>Base atual</span><span>Meta piloto</span><span>Status</span></div>{[['Visitas com objetivo definido',visits.length,'90%','Em medição'],['Clientes com perfil completo',clients.length,'30','Em evolução'],['Tempo de preparação','3 min','≤ 2 min','Validar'],['Próximo compromisso registrado','67%','85%','Em evolução']].map(row=><div className="table-row" key={row[0]}>{row.map((cell,i)=><span key={i}>{cell}</span>)}</div>)}</section>
 </div>
}
