import React,{useEffect,useMemo,useState} from 'react'
import {
 AlertTriangle,
 ArrowUpRight,
 BarChart3,
 BrainCircuit,
 Calculator,
 CalendarCheck2,
 CalendarDays,
 CheckCircle2,
 ChevronRight,
 ClipboardList,
 DatabaseZap,
 LandPlot,
 Mic,
 Send,
 Sparkles,
 Sprout,
 Target
} from 'lucide-react'
import ConversionRadar from '../components/ConversionRadar'
import ConversionOpportunityStudio from '../components/ConversionOpportunityStudio'
import VoiceCapture from '../components/voice/VoiceCapture'
import Disclosure from '../components/Disclosure'
import {compactBRL,commercialMetrics,relationshipSummary} from '../lib/commercial-metrics'
import {buildHomeCopilotAnswer,buildLocalHomePriorities,canonicalVoiceChange} from '../lib/copilot-view-model'
import {buildDayBriefing,buildFocusProducers,buildPendencies,buildTopCultures,visitLifecycle} from '../lib/home-command-center'
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
 const upcomingVisits=[...(visits||[])].filter(visit=>{const scheduled=scheduledAtOf(visit);const lifecycle=String(visit.lifecycleStatus||visit.lifecycle_status||'').toUpperCase();const openLifecycle=['IN_PROGRESS','PLANNED','PREPARED'].includes(lifecycle);return (scheduled?.getTime()>=now||openLifecycle)&&!/^(realizada|cancelada)$/i.test(String(visit.status||''))}).sort((a,b)=>{const rank=visit=>String(visit.lifecycleStatus||visit.lifecycle_status||'').toUpperCase()==='IN_PROGRESS'?0:1;return rank(a)-rank(b)||scheduledAtOf(a)-scheduledAtOf(b)})
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
 // Centro operacional: o que precisa de atenção agora, contado a partir do que
 // já está na sessão. Nenhum número estimado, nenhum alerta inventado.
 // A faixa do dia, as pendencias e os produtores em foco contam pela MESMA fonte do funil
 // (reconcilePipeline): com o array cru a Home dizia "Oportunidades 00" e o funil da mesma tela
 // mostrava 1, e o card levava para uma pagina com outro numero.
 const briefing=useMemo(()=>buildDayBriefing({visits,opportunities:pipelineItems,clients}),[visits,pipelineItems,clients])
 const focus=useMemo(()=>buildFocusProducers({clients,visits,opportunities:pipelineItems}),[clients,visits,pipelineItems])
 const pendencies=useMemo(()=>buildPendencies({clients,visits,opportunities:pipelineItems}),[clients,visits,pipelineItems])
 const topCultures=useMemo(()=>buildTopCultures({clients,metricsOf:client=>commercialMetrics(client).openPotential}),[clients])
 const coverage={total:clients.length,measured:relationships.irtKnown,share:clients.length?Math.round(relationships.irtKnown/clients.length*100):0}
 // A linha clicada identifica UMA visita: sem levar o id, Visitas escolhia sozinha a primeira futura
 // do produtor e o consultor recebia o roteiro de outro compromisso.
 const openVisit=entry=>{const client=clients.find(item=>String(item.id)===String(entry.clientId));if(client)onPrepare(client,{visitId:entry.id});else setPage('visits')}
 const quickActions=[
  ['Preparar visita',CalendarCheck2,()=>selectedVoiceClient?onPrepare(selectedVoiceClient):setPage('visits')],
  ['Perguntar à VAL',BrainCircuit,()=>onOpenCopilot?.({})],
  ['Novo produtor',ClipboardList,()=>setPage('questionnaire')],
  ['Inteligência agronômica',Sprout,()=>setPage('agro')],
  ['Calculadoras',Calculator,()=>setPage({page:'agro',tool:'calculadoras',label:'Calculadoras',context:{tool:'calculadoras'}})],
  ['Mapas e talhões',LandPlot,()=>setPage({page:'agro',tool:'produtores',label:'Mapas e talhões',context:{tool:'produtores'}})],
  ['Relatórios',BarChart3,()=>setPage('reports')],
  ['Base Inteligente',DatabaseZap,()=>setPage('datahub')]
 ]


 // Dois níveis, sem exceção. Nível 1 responde "o que faço agora": o dia, quem
 // precisa de mim, o Copiloto e as ações. Nível 2 é o que interessa às vezes —
 // números, pergunta longa, radar — e fica a um toque, no desktop e no celular.
 return <div className="page-stack val-copilot-home">
  <div className="home-cockpit">
   <div className="home-cockpit-main">

    <section className="home-day-strip" aria-label="Resumo do dia">
     {briefing.cards.map(card=>{
      const Icon=({today:CalendarDays,prepared:CheckCircle2,opportunities:Target,pending:AlertTriangle})[card.id]||Sparkles
      return <button type="button" key={card.id} className={`home-day-card is-${card.id}`} onClick={()=>setPage(card.page)}>
       <span className="home-day-head"><Icon size={17}/><small>{card.label}</small></span>
       <strong>{String(card.value).padStart(2,'0')}</strong>
       <span className="home-day-hint">{card.hint}</span>
      </button>
     })}
    </section>

    <div className="home-operational">
     <section className="home-panel home-next-visits" aria-labelledby="home-next-visits-title">
      <header>
       <h3 id="home-next-visits-title">Próximas visitas</h3>
       <button type="button" onClick={()=>setPage('visits')}>Ver agenda<ChevronRight size={14}/></button>
      </header>
      {briefing.upcoming.length
       ?<ul>{briefing.upcoming.map(entry=>
         <li key={entry.id}>
          <time dateTime={entry.at.toISOString()}>{entry.at.toDateString()===new Date().toDateString()?entry.at.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):entry.at.toLocaleString('pt-BR',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).replace('.','')}</time>
          <div>
           <b>{entry.clientName}</b>
           <span>{entry.place||'Local não informado'}</span>
          </div>
          <button type="button" aria-label={`Preparar visita de ${entry.clientName}`} onClick={()=>openVisit(entry)}>{entry.lifecycle==='PREPARED'?'Abrir':'Preparar'}</button>
         </li>
        )}</ul>
       :<p className="home-panel-empty">Nenhum compromisso futuro na agenda. Agende uma visita para a VAL montar a próxima rota.</p>}
      {briefing.undatedVisits>0&&<p className="home-panel-note" role="status">{briefing.undatedVisits} visita{briefing.undatedVisits>1?'s':''} sem data registrada ficaram fora desta lista.</p>}
     </section>

     <section className="home-panel home-focus" aria-labelledby="home-focus-title">
      <header>
       <h3 id="home-focus-title">Produtores em foco</h3>
       <button type="button" onClick={()=>setPage('clients')}>Ver todos<ChevronRight size={14}/></button>
      </header>
      {focus.length
       ?<ul>{focus.map(entry=>
         <li key={entry.id}>
          <div>
           <b>{entry.name}</b>
           <span>{entry.place||'Localização não informada'}</span>
           <p>{entry.reason}</p>
          </div>
          <button type="button" className={`focus-tag is-${entry.tone}`} onClick={()=>onClient(entry.client)}>{entry.label}</button>
         </li>
        )}</ul>
       :<p className="home-panel-empty">Nenhum produtor com sinal registrado que peça atenção agora. A VAL não cria foco sem evidência.</p>}
     </section>

     <section className="home-panel home-insights" aria-labelledby="home-insights-title">
      <header>
       <h3 id="home-insights-title">Insights para você</h3>
      </header>
      {priorities.length
       ?<ul>{priorities.slice(0,3).map((priority,index)=>{
         const client=clients.find(item=>String(item.id)===String(priority.subject_id))
         return <li key={`${priority.insight_id||priority.subject_id||'priority'}-${index}`}>
          <span className="home-insight-mark"><Sparkles size={14}/></span>
          <div>
           <b>{priority.title}</b>
           <p>{priority.summary}</p>
          </div>
          <button type="button" disabled={!client} onClick={()=>openPriority(priority)} aria-label={priority.category==='PREPARE'?'Preparar visita':'Abrir produtor'}>
           <ChevronRight size={15}/>
          </button>
         </li>
        })}</ul>
       :<p className="home-panel-empty">Nenhuma prioridade comprovada agora. A VAL não cria urgência sem um sinal registrado.</p>}
      {insightsError&&<p className="home-panel-note" role="status">Prioridades locais exibidas. {insightsError}</p>}
     </section>
    </div>

    <section className="home-copilot-banner" aria-label="Copiloto VAL">
     <div>
      <span className="home-copilot-mark"><BrainCircuit size={20}/></span>
      <div><b>Copiloto VAL</b><p>Fale ou escreva. A VAL responde com o contexto da sua carteira.</p></div>
     </div>
     <div className="home-copilot-actions">
      <button type="button" className="is-voice" onClick={()=>onOpenCopilot?.({conversation:true})}><Mic size={18}/>Falar com a VAL</button>
      <button type="button" onClick={()=>onOpenCopilot?.({capture:'text'})}>Perguntar<ChevronRight size={16}/></button>
     </div>
    </section>

    <section className="home-quick-actions" aria-label="Ações rápidas">
     <h3>Ações rápidas</h3>
     <div>
      {quickActions.map(([label,Icon,run])=>
       <button type="button" key={label} onClick={run}><Icon size={16}/><span>{label}</span></button>
      )}
     </div>
    </section>

    <Disclosure id="home-numbers" title="Números da carteira" hint="Funil, culturas, cobertura e indicadores">
     <section className="home-analytics">
      <article className="home-panel">
       <header>
        <h3>Oportunidades por etapa</h3>
        <button type="button" onClick={()=>setPage('opportunities')}>Abrir pipeline<ChevronRight size={14}/></button>
       </header>
       <ol className="home-funnel">{pipelineSummary.map((stage,index)=>{
        const total=pipelineSummary.reduce((sum,item)=>sum+item.count,0)
        const share=total?Math.round(stage.count/total*100):0
        return <li key={stage.name} className={`is-stage-${index+1}`}>
         <div><b>{stage.name}</b><span>{stage.detail}</span></div>
         <i style={{width:`${share}%`}} aria-hidden="true"/>
         <em>{stage.count} <small>{compactMoney(stage.value)}</small></em>
        </li>
       })}</ol>
      </article>

      <article className="home-panel">
       <header><h3>Top culturas da carteira</h3></header>
       {topCultures.length
        ?<ol className="home-bars">{topCultures.map(entry=>{
          const maior=Math.max(...topCultures.map(item=>item.producers))
          return <li key={entry.culture}>
           <div><b>{entry.culture}</b><em>{entry.producers}</em></div>
           <i style={{width:`${Math.round(entry.producers/maior*100)}%`}} aria-hidden="true"/>
           <span>{entry.potential>0?`${compactBRL(entry.potential,{known:true})} em potencial`:'Potencial não informado'}</span>
          </li>
         })}</ol>
        :<p className="home-panel-empty">Nenhuma cultura declarada na carteira ainda.</p>}
      </article>

      <article className="home-panel">
       <header><h3>Cobertura da carteira</h3></header>
       {clients.length
        ?<div className="home-coverage">
          <div className="home-donut" style={{'--val-share':`${coverage.share}%`}} role="img" aria-label={`${coverage.measured} de ${coverage.total} produtores com perfil medido`}>
           <b>{coverage.share}%</b>
           <small>perfis</small>
          </div>
          <ul>
           <li><i className="is-measured" aria-hidden="true"/><span>{coverage.measured} com perfil medido</span></li>
           <li><i aria-hidden="true"/><span>{coverage.total-coverage.measured} ainda a medir</span></li>
          </ul>
         </div>
        :<p className="home-panel-empty">Carteira vazia. A cobertura aparece quando houver produtor registrado.</p>}
      </article>

      <article className="home-panel">
       <header><h3>Indicadores da carteira</h3></header>
       <div className="home-analytics-kpis">
        <div><small>Produtores</small><b>{clients.length}</b><span>Carteira consolidada</span></div>
        <div><small>Visitas na agenda</small><b>{upcomingVisits.length}</b><span>Compromissos futuros</span></div>
        <div><small>Potencial mapeado</small><b>{compactBRL(totalPotential,{known:potentialKnown})}</b><span>{portfolioPriorities.length} {portfolioPriorities.length===1?'prioridade registrada':'prioridades registradas'}</span></div>
        <div><small>IRT médio</small><b>{irt}</b><span>{relationships.irtKnown} de {relationships.total} perfis medidos</span></div>
       </div>
      </article>
     </section>
    </Disclosure>

    <Disclosure id="home-ask" title="Perguntar à VAL daqui" hint="Escolha o produtor e pergunte sem abrir uma visita">
     <section className="copilot-talk" aria-label="Perguntar ou falar com a VAL">
      <div className="copilot-talk-controls"><label>Produtor<select value={voiceClientId} onChange={event=>{setVoiceClientId(event.target.value);setVoiceNotice('');setVoiceAnswer(null);setVoiceAnswerState({loading:false,error:''})}} disabled={!clients.length}><option value="">Selecione um produtor</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label><form className="copilot-home-question" onSubmit={event=>{event.preventDefault();if(selectedVoiceClient)onOpenCopilot?.({client:selectedVoiceClient,prompt:homeQuestion});setHomeQuestion('')}}><input value={homeQuestion} onChange={event=>setHomeQuestion(event.target.value)} placeholder="O que você precisa decidir?" disabled={!selectedVoiceClient}/><button type="submit" disabled={!selectedVoiceClient}><Send/>Perguntar</button></form><button className="copilot-open-voice" type="button" disabled={!selectedVoiceClient} onClick={()=>onOpenCopilot?.({client:selectedVoiceClient})}><BrainCircuit/>Abrir voz, foto ou arquivo</button><VoiceCapture clientId={selectedVoiceClient?.id||''} interactionType="GENERAL_CONTEXT" label="Registrar informação" description="Revisar antes de salvar" sourceContext={{page:'VAL_HOME'}} onConfirmed={answerAfterVoice}/></div>
      <p className="copilot-talk-note">Registrar informação continua exigindo sua confirmação.</p>
      {voiceNotice&&<p className="copilot-confirmed" role="status">{voiceNotice}</p>}
      {voiceAnswerState.loading&&<p className="copilot-answer-loading" role="status">Relacionando memória, contexto, decisão e próximo passo…</p>}
      {voiceAnswerState.error&&<p className="copilot-answer-error" role="alert">{voiceAnswerState.error}</p>}
      {voiceAnswer&&<article className="copilot-answer" aria-live="polite"><small>O QUE IMPORTA AGORA</small><h4>{voiceAnswer.headline}</h4>{voiceAnswer.reason&&<p>{voiceAnswer.reason}</p>}{voiceAnswer.action&&<b>{voiceAnswer.action}</b>}{voiceAnswer.question&&<blockquote>{voiceAnswer.question}</blockquote>}<button type="button" onClick={()=>{onClient(selectedVoiceClient);setVoiceAnswer(null)}}>Abrir memória do produtor<ChevronRight/></button></article>}
     </section>
    </Disclosure>

    <Disclosure id="home-deep-dive" title="Carteira, radar e estúdio de oportunidades" hint="Análise avançada e conversão">
     <div className="copilot-advanced-content">
      <div className="copilot-advanced-shortcuts"><button type="button" onClick={()=>setPage('val')}><BrainCircuit/>Análise avançada da VAL<ArrowUpRight/></button><button type="button" onClick={()=>setPage('opportunities')}><Target/>Pipeline<ArrowUpRight/></button></div>
      <ConversionRadar clients={clients} onClient={onClient} onPrepare={onPrepare}/>
      <ConversionOpportunityStudio clients={clients} onClient={onClient} onPrepare={onPrepare}/>
     </div>
    </Disclosure>

   </div>

   <aside className="home-rail" aria-label="Pendências e atividades">
    <section className="home-rail-card home-pendencies">
     <h3>Pendências e alertas</h3>
     {pendencies.length
      ?<ul>{pendencies.map(entry=>
        <li key={entry.id}>
         <button type="button" onClick={()=>setPage(entry.page)}>
          <b>{String(entry.value).padStart(2,'0')}</b>
          <span>{entry.label}<small>{entry.detail}</small></span>
          <ChevronRight size={15}/>
         </button>
        </li>
       )}</ul>
      :<p className="home-panel-empty">Nada pendente com o que já está registrado na carteira.</p>}
    </section>

    <section className="home-rail-card">
     <h3>Atividades recentes</h3>
     {recentVisits.length
      ?<ul className="home-rail-activity">{recentVisits.map(visit=>{
        const client=clients.find(item=>String(item.id)===String(visit.clientId))
        return <li key={visit.id}>
         <b>{({COMPLETED:'Visita realizada',CANCELLED:'Visita cancelada',IN_PROGRESS:'Visita em andamento',COMPLETED_PENDING_REVIEW:'Visita aguardando confirmação'})[visitLifecycle(visit)]||'Visita agendada'}</b>
         <span>{client?.name||'Produtor'} • {compactDate(visit)}</span>
        </li>
       })}</ul>
      :<p className="home-panel-empty">Nenhuma atividade registrada ainda.</p>}
    </section>
   </aside>
  </div>
 </div>
}
