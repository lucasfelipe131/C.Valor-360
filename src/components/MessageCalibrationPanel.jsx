import React,{useEffect,useState} from 'react'
import {Activity,BarChart3,CheckCircle2,ChevronDown,Database,Edit3,Eye,FlaskConical,ShieldCheck,ThumbsDown,ThumbsUp} from 'lucide-react'
import '../message-calibration.css'

const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()||fallback
const percent=value=>Number.isFinite(Number(value))?`${Math.round(Number(value)*100)}%`:'Em formação'
const stageLabel={preparar:'Preparar',alinhar:'Alinhar',descobrir:'Descobrir',dimensionar:'Dimensionar',construir_valor:'Construir valor',propor:'Propor',comprometer:'Comprometer',unknown:'Etapa não registrada'}

export default function MessageCalibrationPanel({data}){
 const messages=Array.isArray(data?.messages)?data.messages:[]
 const segments=Array.isArray(data?.segments)?data.segments:[]
 const summary=data?.summary||{}
 const [expanded,setExpanded]=useState('')
 useEffect(()=>{setExpanded(messages[0]?.id||'')},[data?.generatedAt])
 if(!data)return null
 return <section className="message-calibration" aria-labelledby="message-calibration-title">
  <header>
   <div><span><FlaskConical/>PLACAR DE MENSAGENS • SHADOW MODE</span><h4 id="message-calibration-title">O que coincidiu com avanço na conversa seguinte</h4><p>O placar observa linhas sugeridas, abordagem, feedback e a etapa registrada na recomendação seguinte. Ele não modifica o motor nem afirma que uma frase causou o resultado.</p></div>
   <b className={data.sampleStatus==='partially_ready'?'is-ready':''}>{data.readySegments||0} de 7 segmentos com amostra mínima</b>
  </header>

  <div className="message-calibration-summary">
   <article><Eye/><span><small>RECOMENDAÇÕES</small><b>{summary.observations||0}</b></span></article>
   <article><Activity/><span><small>LINHAS AVALIADAS</small><b>{summary.linesEvaluated||0}</b></span></article>
   <article><CheckCircle2/><span><small>AVANÇOS DE ETAPA</small><b>{summary.advanced||0}</b></span></article>
   <article><ThumbsUp/><span><small>ACEITAS OU EDITADAS</small><b>{(summary.accepted||0)+(summary.edited||0)}</b></span></article>
   <article><ThumbsDown/><span><small>REJEITADAS</small><b>{summary.rejected||0}</b></span></article>
  </div>

  <div className="message-segments" aria-label="Amostra por etapa">{segments.map(item=><div className={item.status==='benchmark_ready'?'is-ready':''} key={item.stage}>
   <span><b>{stageLabel[item.stage]||item.stage}</b><small>{item.sample}/{data.minSample} casos</small></span>
   <i><em style={{'--sample-fill':`${Math.min(100,item.sample/data.minSample*100)}%`}}/></i>
   <strong>{item.status==='benchmark_ready'?percent(item.advanceRate):`${item.remaining} para calibrar`}</strong>
  </div>)}</div>

  {!messages.length?<div className="message-calibration-empty"><BarChart3/><div><b>Placar ainda sem mensagens comparáveis</b><p>{text(data.emptyReason)}</p></div></div>:<div className="message-score-list">{messages.map(item=>{
   const open=expanded===item.id
   return <article className={open?'is-open':''} key={item.id}>
    <button type="button" onClick={()=>setExpanded(open?'':item.id)} aria-expanded={open}>
     <div><span>{stageLabel[item.stage]||item.stage}</span><blockquote>“{text(item.line||item.approach,'Mensagem sem texto disponível')}”</blockquote></div>
     <div className="message-score-metrics"><span><b>{item.uses}</b><small>usos</small></span><span><b>{item.nextObserved}</b><small>seguintes</small></span><span><b>{item.confidence==='benchmark_ready'?percent(item.advanceRate):'—'}</b><small>avanço</small></span><ChevronDown/></div>
    </button>
    {open&&<div className="message-score-detail">
     <div><small>ABORDAGEM REGISTRADA</small><p>{text(item.approach,'Não registrada separadamente.')}</p></div>
     <dl><div><dt>Avançou</dt><dd>{item.advanced}</dd></div><div><dt>Aceita</dt><dd>{item.accepted}</dd></div><div><dt>Editada</dt><dd>{item.edited}</dd></div><div><dt>Executada</dt><dd>{item.executed}</dd></div><div><dt>Ganhou</dt><dd>{item.won}</dd></div><div><dt>Perdeu</dt><dd>{item.lost}</dd></div></dl>
     <span><Database/>{item.evidenceIds.join(' • ')}</span>
    </div>}
   </article>
  })}</div>}

  <footer><ShieldCheck/><div><b>Nenhuma autoalteração</b><p>{text(data.guardrail)}</p><small>{text(data.interpretation)}</small></div><span><Edit3/>Notas livres excluídas • retenção {data.lookbackDays} dias</span></footer>
 </section>
}
