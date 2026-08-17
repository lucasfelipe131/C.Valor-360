import React,{useMemo} from 'react'
import {AlertTriangle,ArrowUpRight,CalendarClock,CheckCircle2,CircleGauge,RefreshCw,ShieldCheck,Sparkles,Target} from 'lucide-react'
import {buildPortfolioRadar} from '../lib/portfolio-radar.js'

const priorityLabel={imediata:'Agir agora',esta_semana:'Fazer nesta semana',acompanhar:'Acompanhar'}
const priorityIcon={imediata:AlertTriangle,esta_semana:CalendarClock,acompanhar:CircleGauge}
const compactMoney=value=>value===null||value===undefined?'Valor não registrado':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const generatedLabel=value=>new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})

export default function ValDailyRadar({clients=[],visits=[],opportunities=[],onClient,onPrepare}){
 const radar=useMemo(()=>buildPortfolioRadar({clients,visits,opportunities}),[clients,visits,opportunities])
 return <section className="val-daily-radar" aria-labelledby="val-daily-radar-title">
  <header className="val-daily-radar-head">
   <div>
    <span className="val-daily-radar-kicker"><Sparkles/> RADAR DE CONVERSÃO • HOJE</span>
    <h3 id="val-daily-radar-title">Cinco conversas que merecem atenção</h3>
    <p>A VAL ordenou a carteira com dados registrados. Nenhum motivo foi inventado e nenhum contato será feito automaticamente.</p>
   </div>
   <div className="val-daily-radar-status">
    <span><ShieldCheck/> Sem IA generativa</span>
    <small><RefreshCw/> Atualizado às {generatedLabel(radar.generatedAt)}</small>
   </div>
  </header>

  {radar.items.length?<div className="val-daily-radar-grid">
   {radar.items.map((item,index)=>{
    const Icon=priorityIcon[item.priority]||CircleGauge
    return <article className={`val-radar-card is-${item.priority}`} key={item.clientId}>
     <div className="val-radar-card-top">
      <span className="val-radar-rank">{String(index+1).padStart(2,'0')}</span>
      <span className="val-radar-priority"><Icon/>{priorityLabel[item.priority]||'Acompanhar'}</span>
      <strong>{item.score}<small>/100</small></strong>
     </div>
     <div className="val-radar-person">
      <span>{item.clientName.split(/\s+/).map(part=>part[0]).slice(0,2).join('')}</span>
      <div><h4>{item.clientName}</h4><small>{item.municipality||'Município não registrado'}</small></div>
     </div>
     <p className="val-radar-reason">{item.reason}</p>
     {item.opportunity&&<div className="val-radar-opportunity"><Target/><div><small>{item.opportunity.stage}</small><b>{item.opportunity.title}</b><span>{compactMoney(item.opportunity.value)}</span></div></div>}
     <div className="val-radar-action"><CheckCircle2/><div><small>PRÓXIMA AÇÃO</small><p>{item.action}</p></div></div>
     <div className="val-radar-proof"><b>{item.evidence.length}</b><span>{item.evidence.length===1?'evidência rastreável':'evidências rastreáveis'}</span>{item.missing.length>0&&<small>Falta: {item.missing.join(', ')}</small>}</div>
     <div className="val-radar-buttons">
      <button type="button" onClick={()=>onClient?.(clients.find(client=>String(client.id)===String(item.clientId)))}><span>Abrir conta</span><ArrowUpRight/></button>
      <button type="button" className="secondary" onClick={()=>onPrepare?.(clients.find(client=>String(client.id)===String(item.clientId)))}>Preparar conversa</button>
     </div>
    </article>
   })}
  </div>:<div className="val-radar-empty"><Target/><div><b>Nenhum sinal suficiente para o radar de hoje</b><p>Registre uma oportunidade, uma próxima ação, uma visita ou um potencial em aberto. A VAL não criará motivo apenas para preencher a lista.</p></div></div>}

  <footer className="val-daily-radar-foot">
   <span><ShieldCheck/> Visível somente dentro da carteira autenticada.</span>
   <span>O score ordena trabalho; não é probabilidade de fechamento.</span>
  </footer>
 </section>
}
