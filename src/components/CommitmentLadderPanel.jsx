import React,{useEffect,useState} from 'react'
import {ArrowRight,Check,ChevronDown,CircleDashed,FileCheck2,Flag,ShieldCheck,Sparkles} from 'lucide-react'

const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()
const money=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'Valor não registrado'
const statusLabel={confirmed:'Confirmado',indicated:'Indicado pela etapa',next:'Próximo compromisso',later:'Depois'}

export default function CommitmentLadderPanel({data,client,onPrepare}){
 const ladders=Array.isArray(data?.ladders)?data.ladders:[]
 const [selectedId,setSelectedId]=useState(data?.selectedId||ladders[0]?.id||'')
 useEffect(()=>setSelectedId(data?.selectedId||ladders[0]?.id||''),[data?.selectedId,client?.id])
 const ladder=ladders.find(item=>item.id===selectedId)||ladders[0]||null
 if(!ladder)return <div className="commitment-ladder-empty"><CircleDashed/><div><b>Escada ainda não disponível</b><p>{text(data?.emptyReason,'Registre uma oportunidade para organizar o próximo compromisso.')}</p></div></div>
 const next=ladder.nextMinimumCommitment||{}
 return <div className="commitment-ladder">
  <div className="commitment-ladder-toolbar">
   <div><small>OPORTUNIDADE</small><h4>{ladder.title}</h4><span>{ladder.stage} • {money(ladder.amount)}</span></div>
   {ladders.length>1&&<label><span>Trocar oportunidade</span><div><select value={ladder.id} onChange={event=>setSelectedId(event.target.value)}>{ladders.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown/></div></label>}
  </div>
  <div className="commitment-ladder-grid">
   <ol className="commitment-ladder-steps">{ladder.steps.map(step=><li className={`is-${step.status}`} key={step.id}><span className="commitment-step-marker">{step.status==='confirmed'?<Check/>:step.order}</span><div><div className="commitment-step-title"><b>{step.label}</b><small>{statusLabel[step.status]||step.status}</small></div><p>{step.minimumYes}</p>{step.requiresConfirmation&&<em><ShieldCheck/>{step.stageBasis}</em>}{step.evidenceIds?.length>0&&<span><FileCheck2/>{step.evidenceIds.length} evidência(s) registrada(s)</span>}</div></li>)}</ol>
   <aside className="commitment-next-card"><span className="commitment-next-kicker"><Flag/>PRÓXIMO COMPROMISSO</span><h4>{text(next.label,'Confirmar o próximo compromisso')}</h4><p>{text(next.action)}</p><blockquote>“{text(next.question)}”</blockquote><dl><div><dt>O que comprova avanço</dt><dd>{text(next.evidenceNeeded)}</dd></div><div><dt>Confirmação</dt><dd>{next.consentRequired?'Consentimento explícito obrigatório antes do teste.':'A resposta precisa ser explícita e registrada.'}</dd></div></dl><button type="button" onClick={onPrepare}><Sparkles/>Preparar esta conversa<ArrowRight/></button></aside>
  </div>
 </div>
}
