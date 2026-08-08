import React,{useMemo,useState} from 'react'
import {ArrowRight,BarChart3,Calculator,CheckCircle2,ChevronRight,FileText,Handshake,Search,Sparkles,Target,TrendingUp} from 'lucide-react'

const stageConfig=[
 {name:'Diagnóstico',label:'Entender',hint:'Dor e impacto',probability:35,icon:Search},
 {name:'Proposta',label:'Construir',hint:'Solução e valor',probability:55,icon:FileText},
 {name:'Negociação',label:'Converter',hint:'Decisão e acordo',probability:75,icon:Handshake},
 {name:'Fechado',label:'Realizar',hint:'Resultado entregue',probability:100,icon:CheckCircle2}
]
const stages=stageConfig.map(stage=>stage.name)
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const initials=name=>String(name||'Produtor').split(' ').filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()

export default function Opportunities({clients,onClient,onSaved}){
 const fallback=clients.map((client,index)=>({
  id:`o-${client.id}`,
  clientId:client.id,
  title:client.commercial?.opportunity||'Oportunidade a qualificar',
  value:client.commercial?.potential||0,
  stage:stages[Math.min(index,2)],
  probability:stageConfig[Math.min(index,2)].probability
 }))
 const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem('valor360-opportunities'))||fallback}catch{return fallback}})
 const [activeStage,setActiveStage]=useState(stages[0])
 const [roi,setRoi]=useState({area:100,investment:180,returnPerHa:420})
 const metrics=useMemo(()=>{
  const total=items.reduce((sum,item)=>sum+Number(item.value||0),0)
  const weighted=items.reduce((sum,item)=>sum+(Number(item.value||0)*Number(item.probability||0)/100),0)
  const open=items.filter(item=>item.stage!=='Fechado').length
  const closed=items.filter(item=>item.stage==='Fechado')
  return {total,weighted,open,closedValue:closed.reduce((sum,item)=>sum+Number(item.value||0),0)}
 },[items])
 const stageTotals=useMemo(()=>Object.fromEntries(stages.map(stage=>{
  const stageItems=items.filter(item=>item.stage===stage)
  return [stage,{items:stageItems,value:stageItems.reduce((sum,item)=>sum+Number(item.value||0),0)}]
 })),[items])
 const focus=useMemo(()=>items.filter(item=>item.stage!=='Fechado').sort((a,b)=>(Number(b.value)*Number(b.probability))-(Number(a.value)*Number(a.probability)))[0],[items])
 const result=Math.max(0,(Number(roi.returnPerHa)-Number(roi.investment))*Number(roi.area))
 const ratio=Number(roi.investment)>0?(Number(roi.returnPerHa)/Number(roi.investment)).toFixed(1):'0.0'
 const clientOf=id=>clients.find(client=>client.id===id)
 const advance=item=>{
  const current=stages.indexOf(item.stage)
  const nextConfig=stageConfig[Math.min(current+1,stageConfig.length-1)]
  const updated=items.map(opportunity=>opportunity.id===item.id?{...opportunity,stage:nextConfig.name,probability:nextConfig.probability}:opportunity)
  setItems(updated)
  setActiveStage(nextConfig.name)
  localStorage.setItem('valor360-opportunities',JSON.stringify(updated))
  onSaved?.(`${item.title}: etapa atualizada para ${nextConfig.name}.`)
 }

 return <div className="page-stack pipeline-page">
  <section className="pipeline-hero">
   <div className="pipeline-hero-copy">
    <span className="pipeline-live"><i></i> PIPELINE INTELIGENTE</span>
    <h2>Transforme potencial<br/>em valor realizado.</h2>
    <p>Acompanhe cada oportunidade com clareza, priorize o próximo movimento e conduza a carteira até o fechamento.</p>
    <div className="pipeline-hero-metrics">
     <div><small>POTENCIAL MAPEADO</small><b>{money(metrics.total)}</b></div>
     <div><small>PREVISÃO PONDERADA</small><b>{money(metrics.weighted)}</b></div>
     <div><small>EM MOVIMENTO</small><b>{metrics.open} <span>negócios</span></b></div>
    </div>
   </div>
   <div className="pipeline-focus-card">
    <div className="pipeline-focus-head"><span><Sparkles/> PRÓXIMO MELHOR MOVIMENTO</span><b>{focus?.probability||0}%</b></div>
    {focus?<>
     <div className="pipeline-focus-client"><span>{initials(clientOf(focus.clientId)?.name)}</span><div><small>{focus.stage}</small><h3>{clientOf(focus.clientId)?.name||'Produtor'}</h3></div></div>
     <p>{focus.title}</p>
     <div className="pipeline-focus-value"><span>Potencial da oportunidade</span><b>{money(focus.value)}</b></div>
     <button onClick={()=>{const client=clientOf(focus.clientId);if(client)onClient(client)}}>Abrir visão 360 <ChevronRight/></button>
    </>:<div className="pipeline-focus-empty"><CheckCircle2/><b>Carteira em dia</b><span>Não há oportunidades abertas.</span></div>}
   </div>
  </section>

  <section className="pipeline-journey" aria-label="Etapas do pipeline">
   {stageConfig.map((stage,index)=>{
    const Icon=stage.icon
    return <button key={stage.name} className={activeStage===stage.name?'active':''} onClick={()=>setActiveStage(stage.name)}>
     <span className={`pipeline-stage-icon stage-${index}`}><Icon/></span>
     <span><small>0{index+1} · {stage.label}</small><b>{stage.name}</b><em>{stage.hint}</em></span>
     <strong>{stageTotals[stage.name].items.length}</strong>
    </button>
   })}
  </section>

  <section className="pipeline-workspace">
   <header className="pipeline-board-head">
    <div><span className="eyebrow">VISÃO DA CARTEIRA</span><h2>Fluxo de oportunidades</h2><p>Avance cada negociação conforme o compromisso assumido com o produtor.</p></div>
    <div><BarChart3/><span><small>VALOR JÁ CONVERTIDO</small><b>{money(metrics.closedValue)}</b></span></div>
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
          <button onClick={()=>client&&onClient(client)}>{client?.name||'Produtor'}<ChevronRight/></button>
         </div>
         <h3>{item.title}</h3>
         <div className="pipeline-card-value"><span><small>POTENCIAL</small><b>{money(item.value)}</b></span><strong>{item.probability}%</strong></div>
         <div className="pipeline-probability"><i style={{width:`${item.probability}%`}}></i></div>
         {stage.name!=='Fechado'?<button className="pipeline-advance" onClick={()=>advance(item)}>Avançar para {stageConfig[index+1].name}<ArrowRight/></button>:<div className="pipeline-won"><CheckCircle2/> Valor convertido</div>}
        </article>
       })}
       {!column.items.length&&<div className="pipeline-empty"><Target/><b>Nenhuma oportunidade</b><span>Os próximos negócios aparecerão aqui.</span></div>}
      </div>
     </section>
    })}
   </div>
  </section>

  <article className="pipeline-roi">
   <div className="pipeline-roi-copy"><span className="pipeline-roi-icon"><Calculator/></span><div><span className="eyebrow">VENDA DE VALOR</span><h2>Simulador rápido de ROI</h2><p>Transforme o ganho técnico estimado em um argumento financeiro transparente para o produtor.</p></div></div>
   <div className="pipeline-roi-inputs">
    <label><span>Área</span><div><input aria-label="Área em hectares" type="number" value={roi.area} onChange={event=>setRoi({...roi,area:event.target.value})}/><b>ha</b></div></label>
    <label><span>Investimento por hectare</span><div><b>R$</b><input aria-label="Investimento por hectare" type="number" value={roi.investment} onChange={event=>setRoi({...roi,investment:event.target.value})}/></div></label>
    <label><span>Retorno por hectare</span><div><b>R$</b><input aria-label="Retorno por hectare" type="number" value={roi.returnPerHa} onChange={event=>setRoi({...roi,returnPerHa:event.target.value})}/></div></label>
   </div>
   <div className="pipeline-roi-result"><TrendingUp/><small>VALOR LÍQUIDO ESTIMADO</small><b>{money(result)}</b><span>Retorno de <strong>{ratio}x</strong> sobre o investimento</span></div>
  </article>
 </div>
}
