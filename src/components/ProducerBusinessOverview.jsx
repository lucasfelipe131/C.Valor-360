import React,{useEffect,useMemo,useState} from 'react'
import {
 BadgeDollarSign,BarChart3,CalendarClock,Cloud,DatabaseZap,FileBarChart,
 Layers3,MapPinned,ShoppingCart,Target,TrendingUp,WalletCards
} from 'lucide-react'

const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2})
const percent=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'Não calculado':`${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`
const date=value=>{if(!value)return 'Não informado';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Não informado':parsed.toLocaleDateString('pt-BR')}
const shown=value=>value===null||value===undefined||value===''?'Não informado':String(value)
const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0

function TrendChart({items=[]}){
 const values=items.map(item=>finite(item.wonValue));const maximum=Math.max(...values,1)
 const points=values.map((value,index)=>`${20+(index*Math.max(0,300/Math.max(values.length-1,1)))},${132-value/maximum*94}`).join(' ')
 if(!items.length)return <div className="business-chart-empty"><BarChart3/><span>O gráfico aparecerá quando houver negócios com data e valor.</span></div>
 return <div className="business-trend-chart">
  <svg viewBox="0 0 340 160" role="img" aria-label="Evolução mensal de compras registradas">
   <line x1="20" y1="132" x2="320" y2="132"/><line x1="20" y1="38" x2="20" y2="132"/>
   <polyline points={points}/>
   {values.map((value,index)=><circle key={`${items[index].month}-${index}`} cx={20+(index*Math.max(0,300/Math.max(values.length-1,1)))} cy={132-value/maximum*94} r="4"><title>{items[index].month}: {money(value)}</title></circle>)}
  </svg>
  <div>{items.map(item=><span key={item.month}><b>{String(item.month).slice(5)}</b><small>{money(item.wonValue)}</small></span>)}</div>
 </div>
}

function RankedBars({items=[],valueKey='value',empty='Sem dados suficientes para comparar.'}){
 const maximum=Math.max(...items.map(item=>finite(item[valueKey])),1)
 if(!items.length)return <div className="business-chart-empty"><BarChart3/><span>{empty}</span></div>
 return <div className="business-ranked-bars">{items.map((item,index)=><div key={`${item.label||item.stage}-${index}`}>
  <span><b>{item.label||item.stage}</b><small>{money(item[valueKey])} • {item.count||0} registros</small></span>
  <i><em style={{width:`${Math.max(3,finite(item[valueKey])/maximum*100)}%`}}/></i>
 </div>)}</div>
}

function Metric({icon:Icon,label,value,detail,tone=''}){
 return <article className={`business-metric ${tone}`}><span><Icon/></span><div><small>{label}</small><b>{value}</b><em>{detail}</em></div></article>
}

export default function ProducerBusinessOverview({client,refreshToken=0}){
 const [state,setState]=useState({loading:true,data:null,error:''})
 useEffect(()=>{
  const controller=new AbortController();setState(current=>({...current,loading:true,error:''}))
  fetch(`/api/clients/${encodeURIComponent(client.id)}/overview`,{signal:typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]):controller.signal})
   .then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível consolidar as métricas.');return payload})
   .then(data=>setState({loading:false,data,error:''}))
   .catch(error=>{if(error.name!=='AbortError')setState(current=>({...current,loading:false,error:error.name==='TimeoutError'?'A consolidação demorou além do limite.':error.message}))})
  return()=>controller.abort()
 },[client.id,refreshToken])
 const fallback=useMemo(()=>{
  const current=finite(client.commercial?.purchaseCurrentSeason);const potential=finite(client.commercial?.potentialTotal);const open=Math.max(0,potential-current);const grossMargin=client.commercial?.grossMarginPercent
  return {currentPurchases:current,previousPurchases:finite(client.commercial?.purchasePreviousSeason),potentialTotal:potential,openPotential:open,openPipeline:finite(client.commercial?.openPipeline),weightedPipeline:0,forecast:current,averageTicket:finite(client.commercial?.purchaseTotal)/Math.max(finite(client.commercial?.purchaseCount),1),conversionRate:client.commercial?.conversion??null,potentialCoveragePercent:potential?current/potential*100:null,pipelineCoveragePercent:open?finite(client.commercial?.openPipeline)/open*100:null,creditLimit:finite(client.commercial?.creditLimit),creditUsed:finite(client.commercial?.creditUsed),creditAvailable:Math.max(0,finite(client.commercial?.creditLimit)-finite(client.commercial?.creditUsed)),purchaseGrowthPercent:client.commercial?.purchaseGrowthPercent??null,walletShare:client.commercial?.walletShare??null,targetShare:client.commercial?.targetShare??null,grossMarginPercent:grossMargin??null,estimatedMargin:grossMargin===null||grossMargin===undefined||grossMargin===''?null:current*finite(grossMargin)/100,marginTotal:finite(client.commercial?.marginTotal),wins:finite(client.commercial?.wins),losses:finite(client.commercial?.losses),knownOutcomes:finite(client.commercial?.knownOutcomes),paymentTerms:client.commercial?.paymentTerms||'',decisionWindow:client.commercial?.decisionWindow||'',commercialRisk:client.commercial?.commercialRisk||'',lastPurchaseAt:client.commercial?.lastPurchaseAt||null}
 },[client])
 const business=state.data?.business||fallback
 const coverage=Math.max(0,Math.min(100,Number(business.potentialCoveragePercent||0)))
 const pipeline=state.data?.pipeline||[]
 const overdue=pipeline.reduce((sum,item)=>sum+finite(item.overdue),0)
 const targetGap=business.targetShare!==null&&business.targetShare!==undefined&&business.walletShare!==null&&business.walletShare!==undefined?Number(business.targetShare)-Number(business.walletShare):null
 const technical=state.data?.technical||{}
 return <section className="producer-business-overview" aria-labelledby="business-overview-title">
  <header className="business-overview-head"><div><span className="eyebrow">NEGÓCIOS E MÉTRICAS</span><h3 id="business-overview-title">Visão global do produtor</h3><p>Compras, potencial, pipeline e dados técnicos consolidados para este login.</p></div><span className={`cloud-scope-chip ${state.data?.cloud?.ownerScoped?'is-ready':''}`}><Cloud/>{state.loading?'Consolidando dados':state.data?.cloud?.ownerScoped?'PostgreSQL por login':'Dados disponíveis'}</span></header>
  {state.error&&<div className="form-error" role="alert">{state.error} Os valores já carregados no cadastro continuam visíveis.</div>}
  <div className="business-metric-grid">
   <Metric icon={ShoppingCart} label="Compras da safra atual" value={money(business.currentPurchases)} detail={`Safra anterior: ${money(business.previousPurchases)}`}/>
   <Metric icon={WalletCards} label="Potencial total" value={money(business.potentialTotal)} detail={`Cobertura: ${percent(business.potentialCoveragePercent)}`}/>
   <Metric icon={Target} label="Potencial em aberto" value={money(business.openPotential)} detail="Calculado automaticamente" tone="is-attention"/>
   <Metric icon={TrendingUp} label="Previsão com pipeline" value={money(business.forecast)} detail={`Pipeline ponderado: ${money(business.weightedPipeline)}`}/>
   <Metric icon={BadgeDollarSign} label="Pipeline aberto" value={money(business.openPipeline)} detail={`Cobertura do gap: ${percent(business.pipelineCoveragePercent)}`}/>
   <Metric icon={BarChart3} label="Ticket médio global" value={money(business.averageTicket)} detail={`Conversão: ${percent(business.conversionRate)}`}/>
   <Metric icon={WalletCards} label="Crédito disponível" value={money(business.creditAvailable)} detail={`${money(business.creditUsed)} utilizados`}/>
   <Metric icon={CalendarClock} label="Última compra" value={date(business.lastPurchaseAt)} detail={`Variação entre safras: ${percent(business.purchaseGrowthPercent)}`}/>
   <Metric icon={BadgeDollarSign} label="Margem estimada da safra" value={business.estimatedMargin===null||business.estimatedMargin===undefined?'Não calculada':money(business.estimatedMargin)} detail={business.grossMarginPercent===null||business.grossMarginPercent===undefined?'Informe a margem bruta no cadastro.':`${percent(business.grossMarginPercent)} sobre a compra atual`}/>
   <Metric icon={TrendingUp} label="Margem registrada" value={money(business.marginTotal)} detail="Somada apenas quando o histórico contém margem"/>
   <Metric icon={BarChart3} label="Ganhos / perdas" value={`${finite(business.wins)} / ${finite(business.losses)}`} detail={`${finite(business.knownOutcomes)} resultado(s) classificado(s)`}/>
   <Metric icon={CalendarClock} label="Ações vencidas" value={finite(overdue).toLocaleString('pt-BR')} detail={overdue?'Requer revisão do próximo compromisso.':'Pipeline sem ação vencida registrada.'} tone={overdue?'is-attention':''}/>
  </div>
  <div className="business-chart-grid">
   <article className="business-chart-card coverage-card"><header><div><small>COBERTURA DO POTENCIAL</small><h4>Realizado x oportunidade aberta</h4></div><span>{percent(business.potentialCoveragePercent)}</span></header><div className="coverage-visual"><div className="coverage-ring" style={{'--coverage':`${coverage*3.6}deg`}}><span><b>{percent(business.potentialCoveragePercent)}</b><small>realizado</small></span></div><dl><div><dt>Realizado</dt><dd>{money(business.currentPurchases)}</dd></div><div><dt>Em aberto</dt><dd>{money(business.openPotential)}</dd></div><div><dt>Pipeline</dt><dd>{money(business.openPipeline)}</dd></div></dl></div></article>
   <article className="business-chart-card"><header><div><small>ACOMPANHAMENTO MENSAL</small><h4>Compras reconhecidas no histórico</h4></div></header><TrendChart items={state.data?.monthly||[]}/></article>
   <article className="business-chart-card"><header><div><small>FUNIL POR ETAPA</small><h4>Valor e volume das oportunidades</h4></div></header><RankedBars items={pipeline.map(item=>({...item,label:item.stage}))}/></article>
   <article className="business-chart-card"><header><div><small>MIX DE NEGÓCIOS</small><h4>Categorias com maior valor registrado</h4></div></header><RankedBars items={state.data?.categories||[]} empty="Importe ou registre negócios categorizados para formar o mix."/></article>
  </div>
  <div className="business-decision-grid">
   <article><TrendingUp/><span><small>SHARE E META</small><b>{business.walletShare===null||business.walletShare===undefined?'Share não informado':`${percent(business.walletShare)} atual`}</b><em>{targetGap===null?'Cadastre a meta de share para medir o avanço.':targetGap<=0?'Meta de share atingida.':`Faltam ${percent(targetGap)} para a meta.`}</em></span></article>
   <article><CalendarClock/><span><small>JANELA DE DECISÃO</small><b>{shown(business.decisionWindow)}</b><em>{overdue?`${overdue} próxima(s) ação(ões) vencida(s) no funil.`:'Nenhuma próxima ação vencida registrada.'}</em></span></article>
   <article><WalletCards/><span><small>CONDIÇÃO COMERCIAL</small><b>{shown(business.paymentTerms)}</b><em>{business.creditLimit?`${percent(business.creditUsed/business.creditLimit*100)} do limite de crédito utilizado.`:'Limite de crédito ainda não informado.'}</em></span></article>
   <article><Target/><span><small>RISCO / TRAVA</small><b>{shown(business.commercialRisk)}</b><em>Use como pauta de validação; não como fato sem confirmação.</em></span></article>
  </div>
  <article className="manual-business-sync"><header><div><span><DatabaseZap/></span><div><small>MANUAL DO AGRÔNOMO • MESMO LOGIN</small><h4>Contexto técnico sincronizado</h4><p>O preenchimento técnico amplia o dossiê da VAL sem misturar carteiras de outros usuários.</p></div></div><em>{technical.lastSyncAt?`Última sincronização: ${date(technical.lastSyncAt)}`:'Aguardando primeiro registro vinculado ao produtor'}</em></header>
   <div className="manual-sync-metrics"><div><MapPinned/><span><b>{finite(technical.properties)}</b><small>propriedades</small></span></div><div><Layers3/><span><b>{finite(technical.fields)}</b><small>talhões</small></span></div><div><FileBarChart/><span><b>{finite(technical.cropSeasons)}</b><small>safras</small></span></div><div><DatabaseZap/><span><b>{finite(technical.soilAnalyses)}</b><small>análises de solo</small></span></div><div><FileBarChart/><span><b>{finite(technical.fieldReports)}</b><small>relatórios</small></span></div><div><BarChart3/><span><b>{finite(technical.ndvi)}</b><small>leituras NDVI</small></span></div></div>
   {technical.producer&&<div className="manual-producer-summary"><div><small>PRODUTOR NO NÚCLEO TÉCNICO</small><b>{technical.producer.name}</b><span>{[technical.producer.city,technical.producer.area?`${technical.producer.area} ha`:'',technical.producer.cultures?.join(' • ')].filter(Boolean).join(' • ')||'Cadastro técnico localizado'}</span></div><div><small>MAPEAMENTO</small><b>{technical.producer.fieldCount||technical.fields||0} talhões</b><span>{technical.producer.mappingStatus||'Status ainda não informado'}</span></div></div>}
   {technical.recentRecords?.length>0&&<ul className="manual-recent-records">{technical.recentRecords.map(item=><li key={item.id}><DatabaseZap/><span><b>{item.title}</b><small>{item.type.replace(/_/g,' ')} • {date(item.updatedAt)}</small></span></li>)}</ul>}
  </article>
 </section>
}
