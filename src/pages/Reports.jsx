import React from 'react'
import {Download,FileBarChart,HeartHandshake,Percent,Printer,Target,Users} from 'lucide-react'
import KpiCard from '../components/KpiCard'
import {compactBRL,commercialMetrics,relationshipSummary} from '../lib/commercial-metrics'

export default function Reports({clients,visits}){
 const relationships=relationshipSummary(clients)
 const irt=relationships.irtKnown?relationships.irtAverage.toFixed(1):'A medir'
 const promoters=relationships.promoters
 const clientMetrics=clients.map(commercialMetrics)
 const potential=clientMetrics.reduce((sum,metrics)=>sum+(metrics.potentialKnown?metrics.potentialTotal:0),0)
 const potentialKnown=clientMetrics.some(metrics=>metrics.potentialKnown)
 const profiles=['Analítico','Relacional','Conservador','Inovador','Digital']
 const counts=profiles.map(profile=>clients.filter(c=>c.primaryProfile===profile).length)
 const max=Math.max(...counts,1)
 const now=Date.now()
 const futureClientIds=new Set(visits.filter(visit=>{const date=visit.scheduledAt?new Date(visit.scheduledAt):new Date(`${visit.date||''}T${visit.time||'12:00'}:00`);return !Number.isNaN(date.getTime())&&date.getTime()>=now&&!/^(realizada|cancelada)$/i.test(String(visit.status||''))}).map(visit=>visit.clientId))
 const visitsWithObjective=visits.filter(visit=>String(visit.objective||'').trim()).length
 const readinessItems=[clients.length>0,relationships.profileMeasured>0,potentialKnown,visits.length>0]
 const readiness=Math.round(readinessItems.filter(Boolean).length/readinessItems.length*100)
 return <div className="page-stack report-page">
  <section className="report-header"><div><span className="eyebrow">PAINEL DO PILOTO</span><h2>Resultados que cabem na banca — e na rotina.</h2><p>Indicadores da carteira atual, prontos para apoiar a apresentação de quatro minutos.</p></div><div className="report-actions"><button className="soft-btn" onClick={()=>window.print()}><Printer size={17}/>Imprimir</button><button className="primary-btn" onClick={()=>window.print()}><Download size={17}/>Exportar PDF</button></div></section>
  <section className="kpi-grid"><KpiCard icon={Users} label="Produtores mapeados" value={clients.length} delta={`${relationships.profileMeasured} com perfil medido`}/><KpiCard icon={HeartHandshake} label="IRT médio" value={irt} delta={`${relationships.irtKnown} medições válidas`} tone="cyan"/><KpiCard icon={Percent} label="Promotores NPS" value={promoters} delta={relationships.npsKnown?`${Math.round(relationships.promoterRate)}% de ${relationships.npsKnown} respondentes`:'NPS ainda não medido'} tone="green"/><KpiCard icon={Target} label="Potencial validado" value={compactBRL(potential,{known:potentialKnown})} delta="Não inclui índices heurísticos"/></section>
  <section className="report-grid"><article className="panel"><div className="panel-head"><div><span className="eyebrow">TAGS DA CARTEIRA</span><h3>Preferências autodeclaradas dos produtores</h3></div><FileBarChart/></div><div className="profile-bars">{profiles.map((profile,i)=><div key={profile}><span>{profile}</span><div><i style={{width:`${counts[i]/max*100}%`}}></i></div><b>{counts[i]}</b></div>)}</div></article><article className="panel pilot-score"><span className="eyebrow">COBERTURA OPERACIONAL</span><div className="score-ring"><div><b>{readiness}%</b><span>carteira</span></div></div><ul><li className={clients.length?'':'pending'}><i></i>Carteira disponível</li><li className={relationships.profileMeasured?'':'pending'}><i></i>Perfis de relacionamento medidos</li><li className={potentialKnown?'':'pending'}><i></i>Potencial comercial informado</li><li className={visits.length?'':'pending'}><i></i>Agenda com compromissos registrados</li></ul></article></section>
  <section className="panel impact-table"><div className="panel-head"><div><span className="eyebrow">INDICADORES DO PILOTO</span><h3>O que medir até novembro</h3></div></div><div className="table-row table-head"><span>Indicador</span><span>Base atual</span><span>Meta piloto</span><span>Status</span></div>{[['Visitas com objetivo definido',`${visitsWithObjective} de ${visits.length}`,'90%',visits.length?'Em medição':'Sem visitas'],['Clientes com perfil completo',`${relationships.profileMeasured} de ${clients.length}`,'30','Em evolução'],['Tempo de preparação','A medir','≤ 2 min','Instrumentar'],['Próximo compromisso registrado',`${futureClientIds.size} de ${clients.length}`,'85%','Em evolução']].map(row=><div className="table-row" key={row[0]}>{row.map((cell,i)=><span key={i}>{cell}</span>)}</div>)}</section>
 </div>
}
