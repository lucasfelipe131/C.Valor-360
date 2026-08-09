import React,{useEffect,useMemo,useState} from 'react'
import {ArrowRight,BarChart3,Calculator,CheckCircle2,ChevronRight,FileText,Handshake,Search,Sparkles,Target,TrendingUp} from 'lucide-react'
import {advancePipelineItem,opportunityCacheKey,parseOpportunityCache,reconcilePipeline} from '../lib/opportunity-pipeline'

const stageConfig=[
 {name:'Diagnóstico',label:'Entender',hint:'Dor e impacto',progress:25,icon:Search},
 {name:'Proposta',label:'Construir',hint:'Solução e valor',progress:50,icon:FileText},
 {name:'Negociação',label:'Converter',hint:'Decisão e acordo',progress:75,icon:Handshake},
 {name:'Fechado',label:'Realizar',hint:'Resultado entregue',progress:100,icon:CheckCircle2}
]
const stages=stageConfig.map(stage=>stage.name)
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const initials=name=>String(name||'Produtor').split(' ').filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()

export default function Opportunities({clients,storageScope,persistedItems=[],onPersist,onClient,onSaved}){
 const cacheKey=opportunityCacheKey(storageScope)
 const [items,setItems]=useState(()=>reconcilePipeline(clients,[...(cacheKey?parseOpportunityCache(localStorage.getItem(cacheKey)):[]),...persistedItems]))
 const [activeStage,setActiveStage]=useState(stages[0])
 const [roi,setRoi]=useState({area:100,investment:180,returnPerHa:420})
 const [savingId,setSavingId]=useState('')
 const [error,setError]=useState('')
 useEffect(()=>{setItems(current=>reconcilePipeline(clients,[...current,...persistedItems]))},[clients,persistedItems])
 useEffect(()=>{if(cacheKey)localStorage.setItem(cacheKey,JSON.stringify(items))},[cacheKey,items])
 const metrics=useMemo(()=>{
  const total=items.reduce((sum,item)=>sum+Number(item.value||0),0)
  const openItems=items.filter(item=>item.stage!=='Fechado')
  const closed=items.filter(item=>item.stage==='Fechado')
  return {total,open:openItems.length,openValue:openItems.reduce((sum,item)=>sum+Number(item.value||0),0),closedValue:closed.reduce((sum,item)=>sum+Number(item.value||0),0)}
 },[items])
 const stageTotals=useMemo(()=>Object.fromEntries(stages.map(stage=>{
  const stageItems=items.filter(item=>item.stage===stage)
  return [stage,{items:stageItems,value:stageItems.reduce((sum,item)=>sum+Number(item.value||0),0)}]
 })),[items])
 const focus=useMemo(()=>items.filter(item=>item.stage!=='Fechado').sort((a,b)=>Number(b.value)-Number(a.value))[0],[items])
 const result=Math.max(0,(Number(roi.returnPerHa)-Number(roi.investment))*Number(roi.area))
 const ratio=Number(roi.investment)>0?(Number(roi.returnPerHa)/Number(roi.investment)).toFixed(1):'0.0'
 const clientOf=id=>clients.find(client=>client.id===id)
 const advance=async item=>{
  const updated=advancePipelineItem(items,item.id)
  const next=updated.find(opportunity=>opportunity.id===item.id);if(!next)return
  setSavingId(item.id);setError('')
  try{await onPersist?.(next);setItems(updated);setActiveStage(next.stage);onSaved?.(`${item.title}: etapa atualizada para ${next.stage} e incorporada ao contexto da VAL.`)}catch(exception){setError(exception.message||'Não foi possível atualizar a oportunidade.')}finally{setSavingId('')}
 }

 return <div className="page-stack pipeline-page">
  <section className="pipeline-hero">
   <div className="pipeline-hero-copy">
    <span className="pipeline-live"><i></i> GESTÃO DO PIPELINE</span>
    <h2>Negócios em movimento,<br/>sem ruído.</h2>
    <p>Veja o que está em cada etapa, qual valor foi informado e qual compromisso precisa avançar com o produtor.</p>
    <div className="pipeline-hero-metrics">
     <div><small>VALOR TOTAL INFORMADO</small><b>{money(metrics.total)}</b></div>
     <div><small>VALOR EM ABERTO</small><b>{money(metrics.openValue)}</b></div>
     <div><small>OPORTUNIDADES ABERTAS</small><b>{metrics.open} <span>negócios</span></b></div>
    </div>
   </div>
   <div className="pipeline-focus-card">
    <div className="pipeline-focus-head"><span><Sparkles/> MAIOR VALOR EM ABERTO</span><b>{focus?`Etapa ${stages.indexOf(focus.stage)+1} de 4`:'—'}</b></div>
    {focus?<>
     <div className="pipeline-focus-client"><span>{initials(clientOf(focus.clientId)?.name)}</span><div><small>{focus.stage}</small><h3>{clientOf(focus.clientId)?.name||'Produtor'}</h3></div></div>
     <p>{focus.title}</p>
     <div className="pipeline-focus-value"><span>Potencial da oportunidade</span><b>{money(focus.value)}</b></div>
     <button type="button" onClick={()=>{const client=clientOf(focus.clientId);if(client)onClient(client)}}>Abrir visão 360 <ChevronRight/></button>
    </>:<div className="pipeline-focus-empty"><CheckCircle2/><b>Carteira em dia</b><span>Não há oportunidades abertas.</span></div>}
   </div>
  </section>

  <section className="pipeline-journey" aria-label="Etapas do pipeline">
   {stageConfig.map((stage,index)=>{
    const Icon=stage.icon
    return <button type="button" key={stage.name} className={activeStage===stage.name?'active':''} aria-pressed={activeStage===stage.name} onClick={()=>setActiveStage(stage.name)}>
     <span className={`pipeline-stage-icon stage-${index}`}><Icon/></span>
     <span><small>0{index+1} · {stage.label}</small><b>{stage.name}</b><em>{stage.hint}</em></span>
     <strong>{stageTotals[stage.name].items.length}</strong>
    </button>
   })}
  </section>

  {error&&<div className="form-error" role="alert">{error}</div>}
  <section className="pipeline-workspace">
   <header className="pipeline-board-head">
    <div><span className="eyebrow">VISÃO DA CARTEIRA</span><h2>Fluxo de oportunidades</h2><p>Avance cada negociação conforme o compromisso assumido com o produtor.</p></div>
    <div><BarChart3/><span><small>VALOR MARCADO COMO FECHADO</small><b>{money(metrics.closedValue)}</b></span></div>
   </header>
   <div className="pipeline-board">
    {stageConfig.map((stage,index)=>{
     const Icon=stage.icon
     const column=stageTotals[stage.name]
     return <section className={`pipeline-column ${activeStage===stage.name?'active':''}`} key={stage.name}>
      <header>
       <span className={`pipeline-stage-icon stage-${index}`}><Icon/></span>
       <div><small>{stage.label}</small><b>{stage.name}</b></div>
       <strong>{column.items.length}</strong>
       <em>{money(column.value)}</em>
      </header>
      <div className="pipeline-card-list">
       {column.items.map(item=>{
        const client=clientOf(item.clientId)
        return <article className="pipeline-card" key={item.id}>
         <div className="pipeline-card-client">
          <span>{initials(client?.name)}</span>
          <button type="button" onClick={()=>client&&onClient(client)}>{client?.name||'Produtor'}<ChevronRight/></button>
         </div>
         <h3>{item.title}</h3>
         <div className="pipeline-card-value"><span><small>VALOR INFORMADO</small><b>{money(item.value)}</b></span><strong>Etapa {index+1} de 4</strong></div>
         <div className="pipeline-stage-progress" aria-label={`Etapa ${index+1} de 4 no pipeline`}>{stageConfig.map((segment,segmentIndex)=><i className={segmentIndex<=index?'reached':''} key={segment.name}/>)}</div>
         {stage.name!=='Fechado'?<button type="button" className="pipeline-advance" disabled={savingId===item.id} onClick={()=>advance(item)}>{savingId===item.id?'Salvando…':`Avançar para ${stageConfig[index+1].name}`}<ArrowRight/></button>:<div className="pipeline-won"><CheckCircle2/> Marcado como fechado</div>}
        </article>
       })}
       {!column.items.length&&<div className="pipeline-empty"><Target/><b>Nenhuma oportunidade</b><span>Os próximos negócios aparecerão aqui.</span></div>}
      </div>
     </section>
    })}
   </div>
  </section>

  <article className="pipeline-roi">
   <div className="pipeline-roi-copy"><span className="pipeline-roi-icon"><Calculator/></span><div><span className="eyebrow">VENDA DE VALOR</span><h2>Simulador de cenário financeiro</h2><p>Compare investimento e retorno informados pelo consultor. O cálculo é uma hipótese comercial, não recomendação agronômica nem previsão garantida.</p></div></div>
   <div className="pipeline-roi-inputs">
    <label><span>Área</span><div><input aria-label="Área em hectares" type="number" value={roi.area} onChange={event=>setRoi({...roi,area:event.target.value})}/><b>ha</b></div></label>
    <label><span>Investimento por hectare</span><div><b>R$</b><input aria-label="Investimento por hectare" type="number" value={roi.investment} onChange={event=>setRoi({...roi,investment:event.target.value})}/></div></label>
    <label><span>Retorno por hectare</span><div><b>R$</b><input aria-label="Retorno por hectare" type="number" value={roi.returnPerHa} onChange={event=>setRoi({...roi,returnPerHa:event.target.value})}/></div></label>
   </div>
   <div className="pipeline-roi-result"><TrendingUp/><small>VALOR LÍQUIDO DO CENÁRIO</small><b>{money(result)}</b><span>Relação retorno bruto/investimento de <strong>{ratio}x</strong></span></div>
  </article>
 </div>
}
