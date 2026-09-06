import React,{useEffect,useMemo,useState} from 'react'
import {BrainCircuit,CalendarClock,ChevronRight,Clock3,Compass,PanelRightClose,PanelRightOpen,Sparkles} from 'lucide-react'
import {TIMELINE_KIND_LABEL,buildProducerTimeline} from '../lib/producer-timeline'

// Split View contextual: a decisão fica no centro, e o que sustenta a decisão
// — histórico, contexto e a VAL — fica ao lado, sem trocar de página.
//
// As três abas usam SOMENTE o que a sessão já carregou. Nenhuma delas dispara
// chamada de IA ao abrir: recomendação é ação explícita do usuário e vai pelo
// mesmo caminho governado do Copiloto, para não criar uma segunda superfície
// de decisão que possa divergir da resposta oficial.

const PANEL_KEY='valor360-context-panel'
const readState=()=>{
 try{return JSON.parse(localStorage.getItem(PANEL_KEY))||{}}catch{return {}}
}

const TABS=[
 ['timeline','Timeline',Clock3],
 ['contexto','Contexto',Compass],
 ['copiloto','Copiloto',BrainCircuit]
]

const dayLabel=date=>date.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).replace('.','')

export default function ContextPanel({client,visits,opportunities,commitments,contextMeta,voiceChange,profile,onAsk}){
 const stored=readState()
 const [open,setOpen]=useState(stored.open!==false)
 const [tab,setTab]=useState(TABS.some(([id])=>id===stored.tab)?stored.tab:'timeline')
 useEffect(()=>{try{localStorage.setItem(PANEL_KEY,JSON.stringify({open,tab}))}catch{}},[open,tab])

 const timeline=useMemo(()=>buildProducerTimeline({client,visits,opportunities,commitments,contextMeta,voiceChange}),
  [client,visits,opportunities,commitments,contextMeta,voiceChange])
 // "Em aberto" exclui o que já fechou — a lista serve para decidir, não para
 // registrar histórico; o histórico é a aba ao lado.
 const openOpportunities=useMemo(()=>(opportunities||[]).filter(item=>!/fechad|ganho|perdid|cancelad|closed|won|lost/i.test(String(item?.stage||''))),[opportunities])

 if(!open)return <aside className="context-panel is-collapsed" aria-label="Painel contextual">
  <button type="button" className="context-panel-toggle" aria-label="Abrir painel contextual" aria-expanded="false" onClick={()=>setOpen(true)}>
   <PanelRightOpen size={17}/>
  </button>
 </aside>

 return <aside className="context-panel" aria-label={`Painel contextual de ${client?.name||'produtor'}`}>
  <header className="context-panel-head">
   <div role="tablist" aria-label="Contexto do produtor">
    {TABS.map(([id,label,Icon])=>
     <button type="button" key={id} role="tab" id={`context-tab-${id}`} aria-selected={tab===id} aria-controls={`context-pane-${id}`} className={tab===id?'active':''} onClick={()=>setTab(id)}>
      <Icon size={15}/><span>{label}</span>
     </button>
    )}
   </div>
   <button type="button" className="context-panel-toggle" aria-label="Recolher painel contextual" aria-expanded="true" onClick={()=>setOpen(false)}>
    <PanelRightClose size={17}/>
   </button>
  </header>

  {tab==='timeline'&&<div className="context-pane" id="context-pane-timeline" role="tabpanel" aria-labelledby="context-tab-timeline">
   {timeline.isEmpty
    ?<p className="context-empty">Nada registrado ainda para {client?.name||'este produtor'}. A linha do tempo mostra visitas, oportunidades, compromissos e atualizações de contexto conforme forem confirmados.</p>
    :<>
     <p className="context-note">{timeline.items.length} evento{timeline.items.length>1?'s':''} registrado{timeline.items.length>1?'s':''}{timeline.upcoming?` • ${timeline.upcoming} ainda por acontecer`:''}.</p>
     <ol className="context-timeline">
      {timeline.items.map(entry=>
       <li key={entry.id} className={`is-${entry.kind}`}>
        <time dateTime={entry.at.toISOString()}>{dayLabel(entry.at)}</time>
        <div>
         <small>{TIMELINE_KIND_LABEL[entry.kind]||'Evento'}</small>
         <b>{entry.title}</b>
         <p>{entry.detail}</p>
         <em>{entry.source}</em>
        </div>
       </li>
      )}
     </ol>
     {timeline.undated>0&&<p className="context-note is-warning">{timeline.undated} registro{timeline.undated>1?'s':''} sem data verificável ficaram fora da linha — a VAL não estima datas.</p>}
    </>}
  </div>}

  {tab==='contexto'&&<div className="context-pane" id="context-pane-contexto" role="tabpanel" aria-labelledby="context-tab-contexto">
   <section className="context-block">
    <small>COMO ESTE PRODUTOR DECIDE</small>
    {profile?.measured
     ?<>
      <b>{profile.primary}</b>
      <p>{profile.guidance}</p>
     </>
     :<p className="context-empty">Perfil ainda não medido. Colete as preferências para a VAL adaptar a abordagem em vez de supor.</p>}
   </section>
   <section className="context-block">
    <small>PRÓXIMO COMPROMISSO</small>
    {commitments?.length
     ?<ul className="context-list">{commitments.slice(0,3).map((item,index)=>
       <li key={item.id||index}><CalendarClock size={14}/><span>{item.description||item.statement||'Compromisso sem descrição.'}</span></li>
      )}</ul>
     :<p className="context-empty">Nenhum compromisso confirmado. Um próximo passo combinado é o que transforma conversa em avanço.</p>}
   </section>
   <section className="context-block">
    <small>OPORTUNIDADES EM ABERTO</small>
    {openOpportunities.length
     ?<ul className="context-list">{openOpportunities.slice(0,4).map((item,index)=>
       <li key={item.candidateKey||item.id||index}><ChevronRight size={14}/><span>{item.title||item.hypothesis||'Oportunidade'} <em>{item.stage||''}</em></span></li>
      )}</ul>
     :<p className="context-empty">Nenhuma oportunidade aberta neste produtor.</p>}
   </section>
  </div>}

  {tab==='copiloto'&&<div className="context-pane" id="context-pane-copiloto" role="tabpanel" aria-labelledby="context-tab-copiloto">
   <p className="context-note">A VAL já sabe que a conversa é sobre <b>{client?.name||'este produtor'}</b>. Não é preciso repetir o contexto.</p>
   <div className="context-prompts">
    <button type="button" onClick={()=>onAsk?.({client,prompt:'O que mudou neste produtor desde a última visita e o que isso exige de mim agora?'})}>
     <Sparkles size={15}/><b>O que mudou</b><small>Resumo do que está registrado desde a última conversa</small>
    </button>
    <button type="button" onClick={()=>onAsk?.({client,prompt:'Qual é a decisão mais relevante em aberto neste produtor e quais evidências eu já tenho para sustentá-la?'})}>
     <Sparkles size={15}/><b>Decisão em aberto</b><small>Diagnóstico antes de recomendação</small>
    </button>
    <button type="button" onClick={()=>onAsk?.({client,prompt:'Quais recomendações eu consigo sustentar para este produtor com as evidências já registradas, e qual é o custo de não agir?'})}>
     <Sparkles size={15}/><b>Recomendações sustentadas</b><small>Só o que a evidência registrada aguenta</small>
    </button>
    <button type="button" onClick={()=>onAsk?.({client,prompt:'Quais objeções eu devo esperar deste produtor e como respondo com dado, não com desconto?'})}>
     <Sparkles size={15}/><b>Objeções prováveis</b><small>Preparar a resposta antes da conversa</small>
    </button>
   </div>
   <button type="button" className="context-open-copilot" onClick={()=>onAsk?.({client})}>
    <BrainCircuit size={16}/>Abrir o Copiloto neste produtor
   </button>
  </div>}
 </aside>
}
