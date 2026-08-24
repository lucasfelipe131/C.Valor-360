import React,{useEffect,useMemo,useState} from 'react'
import {ArrowLeft,BarChart3,CheckCircle2,ChevronRight,Clock3,Lightbulb,LoaderCircle,Mic,Target} from 'lucide-react'
import VoiceCapture from '../voice/VoiceCapture'
import {readConsultantExperiencePreference,writeConsultantExperiencePreference} from '../../lib/consultant-experience-preference.js'
import {buildPrepareVisitPresentation} from '../../lib/prepare-visit-presentation.js'
import '../../prepare-visit-simple.css'

const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const preferenceLabel={SIMPLE:'Simples',BALANCED:'Equilibrado',ANALYTICAL:'Analítico'}

function QuickSummary({model,mode,onClose}){
 const leaving=mode==='leaving'
 return <section className="prepare-quick" role="dialog" aria-modal="true" aria-label={leaving?'Antes de entrar':'Resumo em 60 segundos'}>
  <header><div><small>{leaving?'ANTES DE ENTRAR':'RESUMO EM 60 SEGUNDOS'}</small><h2>{model.producer}</h2></div><button type="button" onClick={onClose} aria-label="Fechar resumo">×</button></header>
  <article><small>{leaving?'OBJETIVO':'SITUAÇÃO'}</small><p>{leaving?model.essential.objective:model.quick.situation}</p></article>
  {!leaving&&<article><small>OPORTUNIDADE</small><p>{model.quick.opportunity}</p></article>}
  <article><small>{leaving?'LEMBRE':'PRINCIPAL RISCO'}</small><p>{model.quick.risk}</p></article>
  <article><small>PERGUNTE</small><ol>{model.quick.questions.map((question,index)=><li key={`${index}-${question}`}>{question}</li>)}</ol></article>
  {leaving&&<article><small>EVITE</small><p>{model.quick.avoid}</p></article>}
  <article className="prepare-quick-target"><small>{leaving?'SAIA COM':'COMPROMISSO'}</small><p>{model.quick.commitment}</p></article>
  <button className="primary-btn" type="button" onClick={onClose}>Entendi</button>
 </section>
}

export default function PrepareVisitSimple({visit,client,prepared,storageScope,onBack,onVoiceConfirmed,onAcceptCommitment,committingId='',error='',notice=''}){
 const [preference,setPreference]=useState(()=>readConsultantExperiencePreference(storageScope))
 const [quickMode,setQuickMode]=useState('')
 const [analysisOpen,setAnalysisOpen]=useState(preference!=='SIMPLE')
 const [numbersOpen,setNumbersOpen]=useState(preference==='ANALYTICAL')
 const model=useMemo(()=>buildPrepareVisitPresentation({prepared,client,visit,preference}),[prepared,client,visit,preference])
 useEffect(()=>{setAnalysisOpen(preference!=='SIMPLE');setNumbersOpen(preference==='ANALYTICAL')},[preference])
 const choosePreference=value=>{const normalized=writeConsultantExperiencePreference(storageScope,value);setPreference(normalized)}
 const canVoice=['PLANNED','PREPARED'].includes(String(visit.lifecycleStatus||visit.lifecycle_status||'PLANNED').toUpperCase())
 const preparation=prepared.preparation||{}
 return <div className="prepare-simple-page">
  {quickMode&&<QuickSummary model={model} mode={quickMode} onClose={()=>setQuickMode('')}/>} 
  <header className="prepare-simple-header">
   <button type="button" className="prepare-back" onClick={onBack}><ArrowLeft size={18}/>Agenda</button>
   <div><span>PREPARAÇÃO DA VISITA</span><h1>{model.producer}</h1><p>{client?.commercial?.property||client?.municipality||'Conversa orientada por contexto confirmado'}</p></div>
   <label>Como prefere ver<select aria-label="Preferência de experiência do consultor" value={preference} onChange={event=>choosePreference(event.target.value)}>{Object.entries(preferenceLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  </header>

  <main className="prepare-essential" aria-label="Essencial para a visita">
   <article className="prepare-objective"><span><Target size={18}/>OBJETIVO</span><p>{model.essential.objective}</p></article>
   {model.essential.whyNow&&<article className="prepare-why-now"><span>POR QUE AGORA</span><p>{model.essential.whyNow}</p></article>}
   {model.essential.attention.length>0&&<article className="prepare-attention"><span>LEMBRE</span>{model.essential.attention.map(item=><p key={item}>{item}</p>)}</article>}
   <article className="prepare-questions"><span>PERGUNTE</span>{model.essential.questions.length?<ol>{model.essential.questions.map((question,index)=><li key={`${index}-${question}`}><b>{index+1}</b><p>{question}</p></li>)}</ol>:<p>Tenho pouco histórico deste produtor. Descubra qual é a principal prioridade dele para esta safra.</p>}</article>
   <article className="prepare-strategy"><span><Lightbulb size={17}/>ESTRATÉGIA</span><p>{model.essential.strategy}</p></article>
   <article className="prepare-avoid"><span>EVITE</span><p>{model.essential.avoid}</p></article>
   {model.essential.proofs.length>0&&<article className="prepare-proofs"><span>PROVA QUE VALE LEVAR</span><ul>{model.essential.proofs.map(item=><li key={item}>{item}</li>)}</ul></article>}
   <article className="prepare-target"><span>SAIA COM</span><p>{model.essential.commitment}</p></article>
  </main>

  <section className="prepare-simple-actions" aria-label="Atalhos da preparação">
   {canVoice&&<VoiceCapture clientId={visit.clientId} visitId={visit.id} interactionType="PRE_VISIT" label="Falar com a VAL" description="Pergunte ou adicione contexto por áudio" sourceContext={{page:'PREPARE_VISIT_SIMPLE',moment:'PRE_VISIT',preparation_id:preparation.preparation_id,lifecycle:visit.lifecycleStatus||'PLANNED'}} onConfirmed={onVoiceConfirmed}/>} 
   <button type="button" onClick={()=>setQuickMode('leaving')}><ChevronRight size={18}/><span><b>Estou saindo agora</b><small>Versão para ler antes de entrar</small></span></button>
   <button type="button" onClick={()=>setQuickMode('sixty')}><Clock3 size={18}/><span><b>Resumo em 60 segundos</b><small>Situação, risco, perguntas e compromisso</small></span></button>
  </section>

  {notice&&<div className="prepare-notice" role="status"><CheckCircle2 size={17}/>{notice}</div>}
  {error&&<div className="form-error" role="alert">{error}</div>}

  <details className="prepare-layer" open={analysisOpen} onToggle={event=>setAnalysisOpen(event.currentTarget.open)}>
   <summary><span><Lightbulb size={18}/><b>Ver análise</b><small>Oportunidade, objeções, provas e próximos passos</small></span><ChevronRight size={18}/></summary>
   <div className="prepare-analysis-grid">
    {model.analysis.opportunity&&<article><small>OPORTUNIDADE PRINCIPAL</small><p>{model.analysis.opportunity}</p></article>}
    {model.analysis.objection&&<article><small>OBJEÇÃO PROVÁVEL</small><p>{model.analysis.objection}</p>{model.analysis.objectionGuidance&&<em>{model.analysis.objectionGuidance}</em>}</article>}
    {model.analysis.proofs.length>0&&<article><small>PROVAS RECOMENDADAS</small><ul>{model.analysis.proofs.map(item=><li key={item}>{item}</li>)}</ul></article>}
    {model.analysis.missing.length>0&&<article><small>INFORMAÇÕES FALTANTES</small><ul>{model.analysis.missing.map(item=><li key={item}>{item}</li>)}</ul></article>}
    {model.analysis.secondary.length>0&&<article className="prepare-secondary"><small>{model.analysis.secondary.length} OPORTUNIDADE{model.analysis.secondary.length>1?'S':''} SECUNDÁRIA{model.analysis.secondary.length>1?'S':''}</small><ul>{model.analysis.secondary.map(item=><li key={item}>{item}</li>)}</ul></article>}
   </div>
   {model.analysis.priorities.length>0&&<section className="prepare-priorities"><small>ATÉ 3 PRIORIDADES</small>{model.analysis.priorities.map(action=>{const ready=Boolean(action.owner?.id&&action.due_at&&action.success_criteria);return <article key={action.action_id}><div><b>{action.title}</b><p>{action.description}</p></div>{onAcceptCommitment&&<button type="button" onClick={()=>onAcceptCommitment(action)} disabled={!ready||Boolean(prepared.accepted_commitment)||committingId===action.action_id}>{committingId===action.action_id?<LoaderCircle className="is-spinning" size={15}/>:prepared.accepted_commitment?<CheckCircle2 size={15}/>:null}{prepared.accepted_commitment?'Compromisso registrado':ready?'Assumir compromisso':'Manter como sugestão'}</button>}</article>})}</section>}
  </details>

  <details className="prepare-layer prepare-numbers" open={numbersOpen} onToggle={event=>setNumbersOpen(event.currentTarget.open)}>
   <summary><span><BarChart3 size={18}/><b>Ver números e evidências</b><small>Histórico, comparativos, agronomia e fontes disponíveis</small></span><ChevronRight size={18}/></summary>
   <div className="prepare-evidence-grid">
    {model.analytical.numbers.length>0&&<article><small>NÚMEROS COMERCIAIS</small><dl>{model.analytical.numbers.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{money(item.value)}</dd></div>)}</dl></article>}
    {model.analytical.thesis&&<article><small>TESE E EVIDÊNCIAS</small><p>{model.analytical.thesis}</p>{model.analytical.rationale.length>0&&<ul>{model.analytical.rationale.map(item=><li key={item}>{item}</li>)}</ul>}</article>}
    {model.analytical.economicCase&&<article><small>CASO ECONÔMICO</small><p>{model.analytical.economicCase}</p></article>}
    {model.analytical.agronomy.length>0&&<article><small>DADOS AGRONÔMICOS</small><ul>{model.analytical.agronomy.map(item=><li key={item}>{item}</li>)}</ul></article>}
    {model.analytical.risks.length>0&&<article><small>RISCOS</small><ul>{model.analytical.risks.map(item=><li key={item}>{item}</li>)}</ul></article>}
    {!model.analytical.numbers.length&&!model.analytical.thesis&&!model.analytical.agronomy.length&&<p className="prepare-empty">Ainda não há números ou evidências suficientes. A VAL não inventou dados para preencher esta camada.</p>}
   </div>
  </details>
 </div>
}
