import React,{useState} from 'react'
import {AlertCircle,ArrowDown,BookOpenCheck,Clock3,Database,History,ShieldCheck} from 'lucide-react'

const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()
const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'Sem data registrada'
const confidence={moderate:'Amostra moderada',low:'Amostra pequena',insufficient:'Caso isolado'}

export default function ObjectionEvidencePanel({data}){
 const objections=Array.isArray(data?.objections)?data.objections:[]
 const [openId,setOpenId]=useState(objections[0]?.id||'')
 if(!objections.length)return <section className="objection-panel is-empty"><History/><div><b>Objeções reais ainda não registradas</b><p>{text(data?.emptyReason,'Quando um negócio for perdido com motivo estruturado, ele aparecerá aqui.')}</p></div></section>
 return <section className="objection-panel" aria-labelledby="objection-panel-title">
  <header><div><span><History/>BIBLIOTECA DE OBJEÇÕES REAIS</span><h4 id="objection-panel-title">O que já travou negócios parecidos</h4><p>Somente motivos estruturados de perdas dos últimos 12 meses. Cada precedente traz a evidência usada e nunca vira script automático.</p></div><b>{data.lossEventsConsidered} perdas analisadas</b></header>
  <div className="objection-list">{objections.map(item=>{
   const open=openId===item.id
   return <article className={open?'is-open':''} key={item.id}>
    <button type="button" onClick={()=>setOpenId(open?'':item.id)} aria-expanded={open}>
     <span><AlertCircle/><div><b>{item.label}</b><small>{item.count} {item.count===1?'ocorrência':'ocorrências'} • {confidence[item.sampleConfidence]||'Amostra em formação'} • última em {date(item.lastSeen)}</small></div></span><ArrowDown/>
    </button>
    {open&&<div className="objection-detail">
     <div className="objection-context"><span><Database/>Categorias</span><p>{item.categories?.join(', ')||'Não registradas'}</p><span><BookOpenCheck/>Produtos</span><p>{item.products?.join(', ')||'Não registrados'}</p></div>
     <div className="objection-precedent"><small>{item.observedMove?'PRECEDENTE OBSERVADO':'SEM PRECEDENTE SUFICIENTE'}</small><h5>{item.observedMove?.label||'Ainda não existe uma resposta ligada a avanço real'}</h5><p>{item.observedMove?.action||item.guidance}</p>{item.observedMove?.outcomeAt&&<span><Clock3/>Fechamento posterior registrado em {date(item.observedMove.outcomeAt)}</span>}</div>
     <div className="objection-evidence"><ShieldCheck/><div><b>Evidências rastreáveis</b><p>{[...(item.evidenceIds||[]),...(item.observedMove?.evidenceIds||[])].filter((value,index,items)=>items.indexOf(value)===index).join(' • ')}</p><small>{item.guardrail}</small></div></div>
    </div>}
   </article>
  })}</div>
 </section>
}
