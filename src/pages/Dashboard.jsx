import React,{useEffect,useMemo,useState} from 'react'
import {
 ArrowUpRight,
 BrainCircuit,
 CalendarCheck2,
 CalendarDays,
 ChevronRight,
 Clock3,
 Percent,
 Send,
 Sparkles,
 Target,
 Users
} from 'lucide-react'
import KpiCard from '../components/KpiCard'
import ConversionRadar from '../components/ConversionRadar'
import ConversionOpportunityStudio from '../components/ConversionOpportunityStudio'
import VoiceCapture from '../components/voice/VoiceCapture'
import {compactBRL,commercialMetrics,relationshipSummary} from '../lib/commercial-metrics'
import {buildHomeCopilotAnswer,buildLocalHomePriorities,canonicalVoiceChange} from '../lib/copilot-view-model'
import {opportunityCacheKey,parseOpportunityCache,reconcilePipeline,resolveOpportunityCandidate} from '../lib/opportunity-pipeline'

const greeting=()=>{
 const hour=new Date().getHours()
 if(hour<12)return 'Bom dia'
 if(hour<18)return 'Boa tarde'
 return 'Boa noite'
}

const scheduledAtOf=visit=>{
 if(!visit)return null
 const date=visit.scheduledAt?new Date(visit.scheduledAt):new Date(`${visit.date||''}T${visit.time||'12:00'}:00`)
 return Number.isNaN(date.getTime())?null:date
}
const compactDate=visit=>{
 const date=scheduledAtOf(visit)
 if(!date)return 'Data a confirmar'
 return date.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).replace('.','')
}
const compactMoney=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',notation:'compact',maximumFractionDigits:1})
const pipelineStages=[
 {name:'Diagnóstico',detail:'Dor e impacto registrados'},
 {name:'Proposta',detail:'Solução e valor apresentados'},
 {name:'Negociação',detail:'Decisão e acordo em curso'},
 {name:'Fechado',detail:'Negócio marcado como concluído'}
]

export default function Dashboard({clients,visits,opportunities=[],currentUser,setPage,onClient,onPrepare,onRefreshPortfolio,onOpenCopilot}){
 const firstName=String(currentUser?.name||currentUser?.email?.split('@')[0]||'Equipe').trim().split(/\s+/)[0]
 const [insights,setInsights]=useState(null)
 const [insightsError,setInsightsError]=useState('')
 const [voiceClientId,setVoiceClientId]=useState(clients[0]?.id||'')
 const [voiceNotice,setVoiceNotice]=useState('')
 const [voiceAnswer,setVoiceAnswer]=useState(null)
 const [voiceAnswerState,setVoiceAnswerState]=useState({loading:false,error:''})
 const [homeQuestion,setHomeQuestion]=useState('')
 const [insightsRevision,setInsightsRevision]=useState(0)
 const portfolioMetrics=clients.map(client=>({client,metrics:commercialMetrics(client)}))
 const totalPotential=portfolioMetrics.reduce((sum,item)=>sum+(item.metrics.potentialKnown?item.metrics.potentialTotal:0),0)
 const potentialKnown=portfolioMetrics.some(item=>item.metrics.potentialKnown)
 const relationships=relationshipSummary(clients)
 const irt=relationships.irtKnown?relationships.irtAverage.toFixed(1):'A medir'
 const portfolioPriorities=portfolioMetrics.map(({client,metrics})=>({client,metrics,candidate:resolveOpportunityCandidate(client)})).filter(item=>item.candidate).sort((a,b)=>b.metrics.openPotential-a.metrics.openPotential).slice(0,3)
 const now=Date.now()
 const upcomingVisits=[...(visits||[])].filter(visit=>{const scheduled=scheduledAtOf(visit);return scheduled?.getTime()>=now&&!/^(realizada|cancelada)$/i.test(String(visit.status||''))}).sort((a,b)=>scheduledAtOf(a)-scheduledAtOf(b))
 const cacheKey=opportunityCacheKey(currentUser?.storageScope)
 const cachedItems=cacheKey?parseOpportunityCache(localStorage.getItem(cacheKey)):[]
 const pipelineItems=reconcilePipeline(clients,[...cachedItems,...opportunities])
 const priorities=useMemo(()=>insights??buildLocalHomePriorities({upcomingVisits,opportunities,clients}),[insights,upcomingVisits,opportunities,clients])
 const selectedVoiceClient=clients.find(client=>client.id===voiceClientId)||null

 useEffect(()=>{
  if(!clients.some(client=>client.id===voiceClientId))setVoiceClientId(clients[0]?.id||'')
 },[clients,voiceClientId])
 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/v1/insights',{signal:controller.signal}).then(async response=>{
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}
   const payload=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(payload.error||'As prioridades não puderam ser atualizadas agora.')
   return Array.isArray(payload.items)?payload.items.slice(0,3):[]
  }).then(items=>{if(items)setInsights(items)}).catch(error=>{if(error.name!=='AbortError')setInsightsError(error.message)})
  return()=>controller.abort()
 },[insightsRevision])

 const answerAfterVoice=async payload=>{
  const confirmed=canonicalVoiceChange(payload)
  setVoiceAnswer(null)
  setVoiceAnswerState({loading:false,error:''})
  if(!confirmed){setVoiceNotice('Revisão concluída sem nova informação consolidada.');return}
  setVoiceNotice('Informação confirmada. A VAL está relacionando este contexto à carteira.')
  setVoiceAnswerState({loading:true,error:''})
  let portfolioRefreshFailed=false
  try{await onRefreshPortfolio?.()}catch{portfolioRefreshFailed=true}
  try{
   const response=await fetch('/api/val/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:selectedVoiceClient.id,client:selectedVoiceClient,message:confirmed.summary,mode:'daily'}),signal:AbortSignal.timeout(120000)})
   const result=await response.json().catch(()=>({}))
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!response.ok)throw new Error(result.error||'A informação foi salva, mas a orientação não pôde ser calculada agora.')
   const answer=buildHomeCopilotAnswer(result)
   if(!answer)throw new Error('A informação foi salva, mas a orientação chegou incompleta.')
   setVoiceAnswer(answer)
   setVoiceNotice(portfolioRefreshFailed?'Contexto confirmado e orientação pronta. A carteira será recarregada na próxima atualização.':'Contexto confirmado e relacionado pela VAL.')
   setInsightsRevision(value=>value+1)
  }catch(error){setVoiceAnswerState({loading:false,error:error.name==='TimeoutError'?'A informação foi salva, mas a análise ultrapassou o tempo. Tente novamente.':error.message});return}
  setVoiceAnswerState({loading:false,error:''})
 }

 const openPriority=priority=>{
  const client=clients.find(item=>String(item.id)===String(priority.subject_id))
  if(!client)return
  if(priority.category==='PREPARE')onPrepare(client)
  else onClient(client)
 }
 const pipelineSummary=pipelineStages.map(stage=>{
  const stageItems=pipelineItems.filter(item=>item.stage===stage.name)
  return {...stage,count:stageItems.length,value:stageItems.reduce((sum,item)=>sum+Number(item.value||0),0)}
 })
 const recentVisits=[...(visits||[])].sort((a,b)=>(scheduledAtOf(b)?.getTime()||0)-(scheduledAtOf(a)?.getTime()||0)).slice(0,4)

 return <div className="page-stack val-copilot-home">
  <section className="copilot-welcome">
   <div><span className="eyebrow">VAL • SEU COPILOTO</span><h2>{greeting()}, {firstName}.</h2><p>Estas são as decisões que merecem sua atenção agora.</p></div>
   <button type="button" onClick={()=>setPage('visits')}><CalendarDays/>Abrir agenda</button>
  </section>

  <section className="copilot-priorities" aria-labelledby="copilot-priorities-title">
   <header><div><span className="eyebrow">AGORA</span><h3 id="copilot-priorities-title">Até 3 prioridades para agir</h3></div><small>Somente sinais registrados na sua carteira.</small></header>
   {priorities.length?<div className="copilot-priority-grid">{priorities.slice(0,3).map((priority,index)=>{
    const client=clients.find(item=>String(item.id)===String(priority.subject_id))
    return <article key={`${priority.insight_id||priority.subject_id||'priority'}-${index}`}>
     <span>{String(index+1).padStart(2,'0')}</span>
     <div><small>{priority.category==='PREPARE'?'PREPARAR':priority.category==='ACT_NOW'?'AGIR AGORA':'ACOMPANHAR'}</small><h4>{priority.title}</h4><p>{priority.summary}</p>{priority.why_now&&<em><Clock3/>{priority.why_now}</em>}<b>{priority.recommended_action}</b></div>
     <button type="button" disabled={!client} onClick={()=>openPriority(priority)}>{priority.category==='PREPARE'?'Preparar visita':'Abrir produtor'}<ChevronRight/></button>
    </article>
   })}</div>:<div className="copilot-empty"><Sparkles/><div><h4>Nenhuma prioridade comprovada agora.</h4><p>A VAL não cria urgência sem um sinal registrado. Use a voz para adicionar contexto ou abra a agenda.</p></div></div>}
   {insightsError&&<p className="copilot-data-note" role="status">Prioridades locais exibidas. {insightsError}</p>}
  </section>

  <section className="copilot-talk" aria-label="Perguntar ou falar com a VAL">
   <div><BrainCircuit/><div><span className="eyebrow">PERGUNTE OU FALE</span><h3>Converse com a VAL</h3><p>Escolha o produtor e pergunte sem abrir uma visita. Registrar informação continua exigindo sua confirmação.</p></div></div>
   <div className="copilot-talk-controls"><label>Produtor<select value={voiceClientId} onChange={event=>{setVoiceClientId(event.target.value);setVoiceNotice('');setVoiceAnswer(null);setVoiceAnswerState({loading:false,error:''})}} disabled={!clients.length}><option value="">Selecione um produtor</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label><form className="copilot-home-question" onSubmit={event=>{event.preventDefault();if(selectedVoiceClient)onOpenCopilot?.({client:selectedVoiceClient,prompt:homeQuestion});setHomeQuestion('')}}><input value={homeQuestion} onChange={event=>setHomeQuestion(event.target.value)} placeholder="O que você precisa decidir?" disabled={!selectedVoiceClient}/><button type="submit" disabled={!selectedVoiceClient}><Send/>Perguntar</button></form><button className="copilot-open-voice" type="button" disabled={!selectedVoiceClient} onClick={()=>onOpenCopilot?.({client:selectedVoiceClient})}><BrainCircuit/>Abrir voz, foto ou arquivo</button><VoiceCapture clientId={selectedVoiceClient?.id||''} interactionType="GENERAL_CONTEXT" label="Registrar informação" description="Revisar antes de salvar" sourceContext={{page:'VAL_HOME'}} onConfirmed={answerAfterVoice}/></div>
   {voiceNotice&&<p className="copilot-confirmed" role="status">{voiceNotice}</p>}
   {voiceAnswerState.loading&&<p className="copilot-answer-loading" role="status">Relacionando memória, contexto, decisão e próximo passo…</p>}
   {voiceAnswerState.error&&<p className="copilot-answer-error" role="alert">{voiceAnswerState.error}</p>}
   {voiceAnswer&&<article className="copilot-answer" aria-live="polite"><small>O QUE IMPORTA AGORA</small><h4>{voiceAnswer.headline}</h4>{voiceAnswer.reason&&<p>{voiceAnswer.reason}</p>}{voiceAnswer.action&&<b>{voiceAnswer.action}</b>}{voiceAnswer.question&&<blockquote>{voiceAnswer.question}</blockquote>}<button type="button" onClick={()=>{onClient(selectedVoiceClient);setVoiceAnswer(null)}}>Abrir memória do produtor<ChevronRight/></button></article>}
  </section>

  <details className="copilot-advanced">
   <summary><span><small>QUERO APROFUNDAR</small><b>Ver carteira, radar e números</b></span><ChevronRight/></summary>
   <div className="copilot-advanced-content">
    <div className="copilot-advanced-shortcuts"><button type="button" onClick={()=>setPage('val')}><BrainCircuit/>Análise avançada da VAL<ArrowUpRight/></button><button type="button" onClick={()=>setPage('opportunities')}><Target/>Pipeline<ArrowUpRight/></button></div>
    <section className="kpi-grid home-kpis"><KpiCard icon={Users} label="Clientes ativos" value={clients.length} delta="Carteira consolidada"/><KpiCard icon={CalendarCheck2} label="Visitas na agenda" value={upcomingVisits.length} delta="Compromissos futuros"/><KpiCard icon={Target} label="Potencial mapeado" value={compactBRL(totalPotential,{known:potentialKnown})} delta={`${portfolioPriorities.length} ${portfolioPriorities.length===1?'prioridade registrada':'prioridades registradas'}`} tone="cyan"/><KpiCard icon={Percent} label="IRT médio" value={irt} delta={`${relationships.irtKnown} de ${relationships.total} perfis medidos`} tone="green"/></section>
    <ConversionRadar clients={clients} onClient={onClient} onPrepare={onPrepare}/>
    <ConversionOpportunityStudio clients={clients} onClient={onClient} onPrepare={onPrepare}/>
    <section className="dashboard-grid home-analysis">
     <article className="panel funnel-panel"><div className="panel-head"><div><span className="eyebrow">PIPELINE</span><h3>Oportunidades por etapa</h3></div><button type="button" onClick={()=>setPage('opportunities')}>Abrir pipeline</button></div><ol className="funnel">{pipelineSummary.map((stage,index)=><li className={`f-step f${index+1}`} key={stage.name}><span>{stage.name}</span><b>{stage.count} • {compactMoney(stage.value)}</b></li>)}</ol></article>
     <article className="panel recent-panel"><div className="panel-head"><div><span className="eyebrow">ATIVIDADES</span><h3>Atividades recentes</h3></div><button onClick={()=>setPage('visits')}>Ver todas</button></div>{recentVisits.length?recentVisits.map(visit=>{const client=clients.find(item=>item.id===visit.clientId);return <div className="activity" key={visit.id}><CalendarDays className="purple"/><div><b>{visit.status==='Realizada'?'Visita realizada':'Visita agendada'}</b><span>{client?.name||'Produtor'} • {compactDate(visit)}</span></div></div>}):<div className="activity"><CalendarDays className="purple"/><div><b>Nenhuma atividade registrada</b><span>As visitas salvas aparecerão aqui.</span></div></div>}</article>
    </section>
   </div>
  </details>
 </div>
}
