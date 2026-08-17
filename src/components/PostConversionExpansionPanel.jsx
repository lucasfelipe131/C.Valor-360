import React from 'react'
import {ArrowRight,CheckCircle2,Database,Leaf,RefreshCcw,ShieldCheck,Sparkles,Wheat} from 'lucide-react'
import '../post-conversion-expansion.css'

const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()||fallback
const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'Sem data registrada'
const money=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'Valor não registrado'

export default function PostConversionExpansionPanel({data,onPrepare}){
 if(!data)return null
 const candidates=Array.isArray(data.candidates)?data.candidates:[]
 const trigger=data.trigger
 return <section className="post-conversion-panel" aria-labelledby="post-conversion-title">
  <header><div><span><RefreshCcw/>CICLO PÓS-CONVERSÃO</span><h4 id="post-conversion-title">O fechamento vira o início da próxima descoberta</h4><p>A VAL só abre este ciclo depois de um resultado ganho registrado. Nenhuma sugestão cria oportunidade, contato ou ordem automaticamente.</p></div><b className={trigger?'is-triggered':''}>{trigger?'Fechamento confirmado':'Aguardando fechamento'}</b></header>

  {!trigger?<div className="post-conversion-empty"><CheckCircle2/><div><b>Ciclo ainda não acionado</b><p>{text(data.emptyReason)}</p></div></div>:<>
   <div className="post-conversion-trigger"><CheckCircle2/><div><small>NEGÓCIO QUE ACIONOU O CICLO</small><h5>{text(trigger.product||trigger.category,'Negócio fechado')}</h5><p>{date(trigger.closedAt)} • {money(trigger.value)}</p><span><Database/>{trigger.evidenceIds?.join(' • ')}</span></div></div>

   {candidates.length?<div className="post-conversion-grid">{candidates.map(item=>{
    const Icon=item.domain==='grains'?Wheat:Leaf
    return <article key={item.id} className={`is-${item.domain}`}>
     <div className="post-candidate-head"><span><Icon/></span><div><small>{item.domain==='grains'?'GRÃOS • SOG':'INSUMOS • CATÁLOGO OFICIAL'}</small><h5>{item.label}</h5><p>{item.subtitle}</p></div></div>
     <div className="post-candidate-reason"><b>Por que apareceu</b><p>{item.reason}</p></div>
     <div className="post-candidate-action"><b>Próxima descoberta</b><p>{item.nextAction}</p><blockquote>“{item.question}”</blockquote></div>
     <span className="post-candidate-evidence"><Database/>{item.evidenceIds?.join(' • ')}</span>
     <em><ShieldCheck/>{item.caveat}</em>
    </article>
   })}</div>:<div className="post-conversion-empty"><ShieldCheck/><div><b>Fechamento reconhecido, expansão ainda sem suporte</b><p>{text(data.emptyReason)}</p></div></div>}
  </>}

  <footer><ShieldCheck/><p>{text(data.guardrail)}</p>{trigger&&<button type="button" onClick={onPrepare}><Sparkles/>Preparar próxima descoberta<ArrowRight/></button>}</footer>
 </section>
}
