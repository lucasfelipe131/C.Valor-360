import React,{useMemo,useState} from 'react'
import {ArrowRight,Calculator,ChevronRight,Target,TrendingUp} from 'lucide-react'

const stages=['Diagnóstico','Proposta','Negociação','Fechado']
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})

export default function Opportunities({clients,onClient,onSaved}){
 const fallback=clients.map((c,i)=>({id:`o-${c.id}`,clientId:c.id,title:c.commercial?.opportunity||'Oportunidade a qualificar',value:c.commercial?.potential||0,stage:stages[Math.min(i,2)],probability:[35,55,75,100][Math.min(i,3)]}))
 const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem('valor360-opportunities'))||fallback}catch{return fallback}})
 const [roi,setRoi]=useState({area:100,investment:180,returnPerHa:420})
 const total=items.reduce((sum,item)=>sum+Number(item.value||0),0)
 const result=Math.max(0,(Number(roi.returnPerHa)-Number(roi.investment))*Number(roi.area))
 const ratio=Number(roi.investment)>0?(Number(roi.returnPerHa)/Number(roi.investment)).toFixed(1):'0.0'
 const advance=item=>{
  const current=stages.indexOf(item.stage);const next=stages[Math.min(current+1,stages.length-1)]
  const updated=items.map(o=>o.id===item.id?{...o,stage:next,probability:[35,55,75,100][stages.indexOf(next)]}:o)
  setItems(updated);localStorage.setItem('valor360-opportunities',JSON.stringify(updated));onSaved?.(`${item.title}: etapa atualizada para ${next}.`)
 }
 const clientOf=id=>clients.find(c=>c.id===id)
 return <div className="page-stack">
  <section className="opportunity-summary"><div><span className="eyebrow">PIPELINE DE VALOR</span><h2>{money(total)}</h2><p>Potencial mapeado na carteira piloto</p></div><div className="summary-divider"></div><div><b>{items.filter(i=>i.stage==='Proposta'||i.stage==='Negociação').length}</b><span>oportunidades em avanço</span></div><div><b>23%</b><span>conversão estimada</span></div><Target size={58}/></section>
  <section className="kanban-board">{stages.map(stage=><div className="kanban-column" key={stage}><div className="kanban-title"><span>{stage}</span><b>{items.filter(i=>i.stage===stage).length}</b></div>{items.filter(i=>i.stage===stage).map(item=>{const client=clientOf(item.clientId);return <article className="opportunity-card" key={item.id}><span className="probability">{item.probability}%</span><h3>{item.title}</h3><button className="client-link" onClick={()=>onClient(client)}>{client?.name}<ChevronRight size={14}/></button><div className="opportunity-value"><small>POTENCIAL</small><b>{money(item.value)}</b></div>{stage!=='Fechado'&&<button className="advance-btn" onClick={()=>advance(item)}>Avançar etapa <ArrowRight size={15}/></button>}</article>})}</div>)}</section>
  <article className="panel roi-card"><div className="roi-copy"><div className="roi-icon"><Calculator/></div><span className="eyebrow">VENDA DE VALOR</span><h2>Simulador rápido de ROI</h2><p>Converta o ganho técnico estimado em argumento financeiro, deixando as premissas visíveis para o produtor.</p></div><div className="roi-inputs"><label>Área (ha)<input type="number" value={roi.area} onChange={e=>setRoi({...roi,area:e.target.value})}/></label><label>Investimento/ha (R$)<input type="number" value={roi.investment} onChange={e=>setRoi({...roi,investment:e.target.value})}/></label><label>Retorno estimado/ha (R$)<input type="number" value={roi.returnPerHa} onChange={e=>setRoi({...roi,returnPerHa:e.target.value})}/></label></div><div className="roi-result"><TrendingUp/><small>VALOR LÍQUIDO ESTIMADO</small><b>{money(result)}</b><span>Retorno de {ratio}x sobre o investimento</span></div></article>
 </div>
}
