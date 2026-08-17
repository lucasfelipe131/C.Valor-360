import React,{useEffect,useState} from 'react'
import {AlertCircle,ArrowDown,BookOpenCheck,Clock3,Database,History,ShieldCheck,Target} from 'lucide-react'

const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()
const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'Sem data registrada'
const confidence={moderate:'Amostra moderada',low:'Amostra pequena',insufficient:'Caso isolado'}

export default function ObjectionEvidencePanel({data}){
 const objections=Array.isArray(data?.objections)?data.objections:[]
 const [openId,setOpenId]=useState(objections[0]?.id||'')
 useEffect(()=>{setOpenId(objections[0]?.id||'')},[data?.generatedAt])
 if(!objections.length)return <section className="objection-panel is-empty"><History/><div><b>Objeções semelhantes ainda não registradas</b><p>{text(data?.emptyReason,'Quando um negócio for perdido com motivo estruturado, ele aparecerá aqui.')}</p>{data?.loadError&&<small>{data.loadError}</small>}</div></section>
 const focus=[data?.focus?.title,data?.focus?.category,data?.focus?.product].map(value=>text(value)).filter(Boolean).join(' • ')
 return <section className="objection-panel" aria-labelledby="objection-panel-title">
  <header><div><span><History/>BIBLIOTECA DE OBJEÇÕES REAIS</span><h4 id="objection-panel-title">O que já travou negócios parecidos nesta carteira</h4><p>Somente motivos estruturados de perdas dos últimos 12 meses. Cada precedente traz a evidência usada e nunca vira script automático.</p>{focus&&<em><Target/>Comparando com: {focus}</em>}</div><b>{data.lossEventsConsidered} perdas semelhantes</b></header>
  {data?.loadError&&<div className="objection-load-warning">A leitura da carteira completa falhou; esta visão usa apenas o histórico disponível desta conta. {data.loadError}</div>}
  <div className="objection-list">{objections.map(item=>{
   const open=openId===item.id
   return <article className={open?'is-open':''} key={item.id}>
    <button type="button" onClick={()=>setOpenId(open?'':item.id)} aria-expanded={open}>
     <span><AlertCircle/><div><b>{item.label}</b><small>{item.count} {item.count===1?'ocorrência':'ocorrências'} • {confidence[item.sampleConfidence]||'Amostra em formação'} • última em {date(item.lastSeen)}</small></div></span><ArrowDown/>
    </button>
    {open&&<div className="objection-detail">
     <div className="objection-context"><span><Database/>Categorias</span><p>{item.categories?.join(', ')||'Não registradas'}</p><span><BookOpenCheck/>Produtos</span><p>{item.products?.join(', ')||'Não registrados'}</p>{item.similarityReasons?.length>0&&<><span><Target/>Por que é parecido</span><p>{item.similarityReasons.join(' • ')}</p></>}</div>
     <div className="objection-precedent"><small>{item.observedMove?'PRECEDENTE OBSERVADO':'SEM PRECEDENTE SUFICIENTE'}</small><h5>{item.observedMove?.label||'Ainda não existe uma resposta ligada a avanço real'}</h5><p>{item.observedMove?.action||item.guidance}</p>{item.observedMove?.outcomeAt&&<span><Clock3/>Fechamento posterior registrado em {date(item.observedMove.outcomeAt)}</span>}</div>
     <div className="objection-evidence"><ShieldCheck/><div><b>Evidências rastreáveis</b><p>{[...(item.evidenceIds||[]),...(item.observedMove?.evidenceIds||[])].filter((value,index,items)=>items.indexOf(value)===index).join(' • ')}</p><small>{item.guardrail}</small></div></div>
    </div>}
   </article>
  })}</div>
 </section>
}
