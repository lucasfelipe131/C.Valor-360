import React,{useCallback,useEffect,useMemo,useState} from 'react'
import {AlertCircle,ArrowRight,BarChart3,CalendarDays,CheckCircle2,Clock3,ExternalLink,Info,LineChart,LoaderCircle,MapPin,RefreshCw,ShieldCheck,Sparkles,Target,Truck,Warehouse} from 'lucide-react'
import {requestJsonResource,useAsyncResource} from '../hooks/useAsyncResource'

const commodityFallback=[{value:'soja',label:'Soja'},{value:'milho',label:'Milho'},{value:'trigo',label:'Trigo'},{value:'sorgo',label:'Sorgo'},{value:'feijao',label:'Feijão'},{value:'arroz',label:'Arroz'},{value:'cevada',label:'Cevada'}]
const objectiveOptions=[['equilibrio','Equilíbrio entre preço e prazo'],['caixa','Fazer caixa primeiro'],['margem','Buscar o melhor preço médio'],['risco','Reduzir risco e travar cedo']]
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2})
const moneyCompact=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const integer=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0})
const dateFormat=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'})
const formatDate=value=>{if(!value)return 'Não informada';const parsed=new Date(value.length===10?`${value}T12:00:00`:value);return Number.isNaN(parsed.getTime())?'Não informada':dateFormat.format(parsed)}
const priceUnitLabel={'BRL/sc_60kg':'R$/sc','BRL/t':'R$/t','USD/bu':'US$/bu','BRL/USD':'R$/US$'}
const formatReference=item=>item.priceUnit==='USD/bu'?`US$ ${item.price.toFixed(2).replace('.',',')}/bu`:item.priceUnit==='BRL/USD'?`R$ ${item.price.toFixed(4).replace('.',',')}`:`${money.format(item.price)} / ${priceUnitLabel[item.priceUnit]?.replace('R$/','')||item.priceUnit}`

async function api(path,options={}){
 const {timeoutMs=20_000,...requestOptions}=options
 return requestJsonResource(path,{...requestOptions,headers:{...(requestOptions.body?{'Content-Type':'application/json'}:{}),...requestOptions.headers},timeoutMs,timeoutMessage:'A análise demorou além do limite.',fallbackMessage:'Não foi possível concluir a análise na SOG.'})
}

function Field({label,hint,required,children,className=''}){
 return <label className={`sog-field ${className}`}><span>{label}{required&&<em>*</em>}</span>{children}{hint&&<small>{hint}</small>}</label>
}

function MarketBrief({brief,commodityFilter}){
 if(!brief)return null
 const commodities=(brief.commodities||[]).filter(item=>!commodityFilter||item.commodity===commodityFilter)
 return <div className="sog-brief">
  <header className="sog-brief-head"><div><small>BRIEFING DA PRAÇA • {brief.praca?.label||'Praça não mapeada'}</small><b>Leitura de mercado observada em {formatDate(brief.brief?.observedAt)}</b><p>{brief.governance?.note}</p></div>{brief.warning?<em className="sog-brief-stale"><Clock3/>{brief.warning}</em>:<em className="sog-brief-fresh"><CheckCircle2/>Briefing dentro da validade</em>}</header>
  <div className="sog-brief-grid">{commodities.map(item=><article key={item.commodity}>
   <header><b>{item.label}</b>{item.stage&&<span className={`sog-stage is-${item.stage.key}`}><CalendarDays/>{item.stage.label}</span>}</header>
   <div className="sog-brief-reference">{item.registeredReference?<><small>COTAÇÃO REGISTRADA NA SOG</small><b>{money.format(item.registeredReference.price)} / {priceUnitLabel[item.registeredReference.priceUnit]?.replace('R$/','')||item.registeredReference.priceUnit}</b><span>{item.registeredReference.sourceName} • {item.registeredReference.region} • {item.registeredReference.freshness}</span></>:<><small>COTAÇÃO REGISTRADA NA SOG</small><b>Nenhuma</b><span>Registre uma cotação com fonte para comparar preço.</span></>}</div>
   <ul className="sog-brief-seeded">{item.seededReferences.map(reference=><li key={reference.label}><span><b>{reference.label}</b><small>{reference.source} • {formatDate(reference.observedAt)}{reference.note?` • ${reference.note}`:''}</small></span><em>{formatReference(reference)}</em></li>)}</ul>
   {item.reading?.length>0&&<ul className="sog-brief-reading">{item.reading.map(line=><li key={line}><Info/>{line}</li>)}</ul>}
   {item.stage&&<p className="sog-brief-stage-note"><CalendarDays/>{item.stage.note}</p>}
  </article>)}</div>
  {brief.brief?.risks?.length>0&&<div className="sog-brief-risks"><b><AlertCircle/>Riscos acompanhados</b><ul>{brief.brief.risks.map(risk=><li key={risk}>{risk}</li>)}</ul></div>}
  {brief.praca?.logistics?.freightToPortBRLPerSc&&<p className="sog-brief-logistics"><Truck/>Frete interior × {brief.praca.geography?.portReference}: {money.format(brief.praca.logistics.freightToPortBRLPerSc.low)} a {money.format(brief.praca.logistics.freightToPortBRLPerSc.high)} por saca ({brief.praca.logistics.freightToPortBRLPerSc.source}).</p>}
  {brief.brief?.sources?.length>0&&<footer className="sog-brief-sources">{brief.brief.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer"><ExternalLink/>{source.name}</a>)}</footer>}
 </div>
}

function AnalysisResult({analysis,commodityMap}){
 const reading=analysis.marketReading||{}
 return <div className="sog-analysis-result">
  <header className="sog-analysis-headline"><span><Sparkles/></span><div><small>LEITURA DA SOG • {analysis.rulesVersion}</small><h4>{analysis.headline}</h4><p>{analysis.producer?.name}{analysis.producer?.municipality?` • ${analysis.producer.municipality}`:''} • {commodityMap[analysis.request.commodity]||analysis.request.commodity} • {integer.format(analysis.request.volumeSc)} sc • objetivo: {analysis.request.objectiveLabel}</p></div></header>
  <div className="sog-analysis-metrics">
   <div><small>REFERÊNCIA USADA</small><b>{reading.reference?money.format(reading.reference.price):'Sem cotação'}</b><span>{reading.reference?`${reading.reference.sourceName} • ${reading.reference.freshness}`:'registre uma cotação com fonte'}</span></div>
   <div><small>PREÇO-ALVO</small><b>{analysis.request.targetPriceSc?money.format(analysis.request.targetPriceSc):'A completar'}</b><span>{reading.priceGapPercent==null?'sem comparação':`${reading.priceGapPercent>=0?'atingido':'faltam'} ${Math.abs(reading.priceGapPercent).toFixed(1).replace('.',',')}%`}</span></div>
   <div><small>MARGEM SOBRE CUSTO</small><b>{reading.marginPercent==null?'Sem custo':`${reading.marginPercent.toFixed(1).replace('.',',')}%`}</b><span>{analysis.request.costPriceSc?`custo ${money.format(analysis.request.costPriceSc)} / sc`:'informe o custo por saca'}</span></div>
   <div><small>BASE × PORTO</small><b>{reading.basisSc==null?'Sem porto':money.format(reading.basisSc)}</b><span>{reading.port?`${reading.port.region} • ${money.format(reading.port.price)}`:'registre uma cotação de porto'}</span></div>
  </div>
  {analysis.closingTargets?.length>0&&<section className="sog-targets"><header><div><small>TARGET DE FECHAMENTO</small><b>Três alvos escalonados • {analysis.ladder?.sharesNote}</b></div><em>Média da escada: {analysis.ladder?.averagePriceSc?money.format(analysis.ladder.averagePriceSc):'—'} / sc • {moneyCompact.format(analysis.ladder?.revenueBRL||0)}</em></header>
   <div className="sog-target-list">{analysis.closingTargets.map(target=><article key={target.key} className={`is-${target.key}`}><header><span>{target.share}%</span><div><small>{target.label}</small><b>{money.format(target.price)} / sc</b></div></header><dl><div><dt>VOLUME</dt><dd>{integer.format(target.volumeSc)} sc</dd></div><div><dt>RECEITA</dt><dd>{moneyCompact.format(target.revenueBRL)}</dd></div><div><dt>GATILHO</dt><dd>{target.trigger}</dd></div>{target.deadline&&<div><dt>ATÉ</dt><dd>{formatDate(target.deadline)}</dd></div>}</dl><p>{target.condition}</p></article>)}</div></section>}
  <div className="sog-analysis-columns">
   <section className="sog-tips"><header><Target/><b>Dicas para o fechamento</b></header><ul>{analysis.tips.map(tip=><li key={tip.text} className={`is-${tip.scope}`}><CheckCircle2/><span>{tip.text}<small>{tip.scope==='praca'?'praça':tip.scope==='pedido'?'pedido do produtor':'geral'}</small></span></li>)}</ul></section>
   <section className="sog-reasons"><header><LineChart/><b>Como a SOG leu o pedido</b></header><ul>{analysis.reasons.map(reason=><li key={reason}><ArrowRight/>{reason}</li>)}</ul>
    {analysis.scenarios?.length>0&&<div className="sog-scenarios">{analysis.scenarios.map(scenario=><div key={scenario.key}><small>{scenario.label.toUpperCase()}</small><b>{money.format(scenario.price)}</b><span>{moneyCompact.format(scenario.revenueBRL)}</span></div>)}</div>}
   </section>
  </div>
  {(analysis.alerts.length>0||analysis.dataGaps.length>0)&&<div className="sog-analysis-alerts">{analysis.alerts.map(alert=><p key={alert} className="sog-warning"><AlertCircle/>{alert}</p>)}{analysis.dataGaps.map(gap=><p key={gap} className="sog-gap"><Info/>{gap}</p>)}</div>}
  {analysis.assumptions.length>0&&<details className="sog-assumptions"><summary>Premissas e padrões considerados</summary><ul>{analysis.assumptions.map(item=><li key={item}>{item}</li>)}</ul></details>}
  <footer className="sog-analysis-footer"><ShieldCheck/>{analysis.disclaimer}</footer>
 </div>
}

export default function SogAnalysisPanel({producers=[],catalog={},profilesByClient,commodityMap={}}){
 const commodities=catalog.commodities?.length?catalog.commodities:commodityFallback
 const [form,setForm]=useState({clientId:producers[0]?.id||'',commodity:'soja',direction:'sell',volume:'',volumeUnit:'sc_60kg',targetPrice:'',costPrice:'',priceUnit:'BRL/sc_60kg',objective:'equilibrio',deliveryStart:'',deliveryEnd:'',deliveryLocation:'',hasStorage:'',cashNeedBRL:'',cashNeedDate:'',qualityNotes:'',request:''})
 const [analysis,setAnalysis]=useState(null);const [running,setRunning]=useState(false);const [error,setError]=useState('')
 const {data:brief,loading:briefLoading,error:briefError,run:loadBrief}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:20_000,timeoutMessage:'O briefing da praça demorou além do limite.',fallbackMessage:'Não foi possível carregar o briefing da praça.'})
 const load=useCallback(()=>loadBrief(({signal})=>api('/api/grains/market-brief',{signal,timeoutMs:0}),{keepData:true}),[loadBrief])
 useEffect(()=>{load()},[load])
 useEffect(()=>{if(!form.clientId&&producers[0]?.id)setForm(current=>({...current,clientId:producers[0].id}))},[producers,form.clientId])
 const selectedProducer=useMemo(()=>producers.find(item=>String(item.id)===String(form.clientId)),[producers,form.clientId])
 const profile=selectedProducer&&profilesByClient?profilesByClient.get(String(selectedProducer.id)):null
 const change=event=>setForm(current=>({...current,[event.target.name]:event.target.value}))
 const submit=async event=>{event.preventDefault();setRunning(true);setError('');try{const payload={...form,clientName:selectedProducer?.name||'',deliveryLocation:form.deliveryLocation||profile?.usualDeliveryLocations||selectedProducer?.municipality||''};const result=await api('/api/grains/analysis',{method:'POST',body:JSON.stringify(payload)});setAnalysis(result.analysis)}catch(exception){setError(exception.message)}finally{setRunning(false)}}
 return <section className="sog-panel sog-analysis" aria-labelledby="sog-analysis-title">
  <header className="sog-panel-head"><div><span className="eyebrow">ANÁLISE PERSONALIZADA</span><h3 id="sog-analysis-title">O que o produtor pediu, lido contra a praça</h3><p>Informe o pedido do produtor. A SOG compara com a cotação registrada, o calendário da praça e o custo, e devolve três alvos de fechamento com dicas explicáveis. Nada é executado.</p></div><button type="button" className="sog-refresh" onClick={load} disabled={briefLoading}><RefreshCw className={briefLoading?'spin':''}/>Atualizar briefing</button></header>
  <div className="sog-analysis-layout">
   <form className="sog-form sog-analysis-form" onSubmit={submit}>
    <div className="sog-form-grid">
     <Field label="Produtor" required className="is-wide"><select name="clientId" value={form.clientId} onChange={change} required><option value="">Selecione</option>{producers.map(producer=><option key={producer.id} value={producer.id}>{producer.name}{producer.municipality?` • ${producer.municipality}`:''}</option>)}</select></Field>
     <Field label="Grão" required><select name="commodity" value={form.commodity} onChange={change}>{commodities.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
     <Field label="Movimento" required><select name="direction" value={form.direction} onChange={change}><option value="sell">Produtor quer vender</option><option value="buy">Produtor quer comprar</option></select></Field>
     <Field label="Volume" required><div className="sog-inline-input"><input name="volume" value={form.volume} onChange={change} type="number" min="0.001" step="0.001" inputMode="decimal" required placeholder="0"/><select name="volumeUnit" value={form.volumeUnit} onChange={change}><option value="sc_60kg">sc 60 kg</option><option value="t">t</option><option value="kg">kg</option></select></div></Field>
     <Field label="Objetivo do produtor" required><select name="objective" value={form.objective} onChange={change}>{objectiveOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
     <Field label="Preço-alvo" hint="Quanto o produtor quer"><div className="sog-inline-input"><input name="targetPrice" value={form.targetPrice} onChange={change} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="R$ 0,00"/><select name="priceUnit" value={form.priceUnit} onChange={change}><option value="BRL/sc_60kg">R$/sc</option><option value="BRL/t">R$/t</option></select></div></Field>
     <Field label="Custo de produção" hint="Mesma unidade do preço-alvo"><input name="costPrice" value={form.costPrice} onChange={change} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="R$ 0,00"/></Field>
     <Field label="Início da entrega"><input name="deliveryStart" value={form.deliveryStart} onChange={change} type="date"/></Field>
     <Field label="Fim da entrega"><input name="deliveryEnd" value={form.deliveryEnd} onChange={change} type="date"/></Field>
     <Field label="Local de entrega" hint={profile?.usualDeliveryLocations?`Perfil: ${profile.usualDeliveryLocations}`:selectedProducer?.municipality?`Município do cadastro: ${selectedProducer.municipality}`:''}><input name="deliveryLocation" value={form.deliveryLocation} onChange={change} placeholder="Praça, armazém ou município"/></Field>
     <Field label="Armazenagem própria"><select name="hasStorage" value={form.hasStorage} onChange={change}><option value="">{profile?.storageCapacityT?`Perfil: ${profile.storageCapacityT} t`:'Não informado'}</option><option value="sim">Sim</option><option value="nao">Não</option></select></Field>
     <Field label="Necessidade de caixa (R$)"><input name="cashNeedBRL" value={form.cashNeedBRL} onChange={change} type="number" min="0" step="0.01" inputMode="decimal" placeholder="R$ 0,00"/></Field>
     <Field label="Caixa até"><input name="cashNeedDate" value={form.cashNeedDate} onChange={change} type="date"/></Field>
     <Field label="Qualidade do lote" className="is-wide"><input name="qualityNotes" value={form.qualityNotes} onChange={change} placeholder="Umidade, pH, impureza ou condição relevante"/></Field>
     <Field label="Pedido do produtor, nas palavras dele" className="is-wide"><textarea name="request" value={form.request} onChange={change} rows="3" placeholder="Ex.: quero vender 3 mil sacas até março, mas preciso de R$ 200 mil em outubro"/></Field>
    </div>
    <p className="sog-form-note"><ShieldCheck/>A análise compara apenas com cotações registradas com fonte e horário. Sem cotação, ela declara a lacuna em vez de estimar preço.</p>
    {error&&<p className="sog-form-error" role="alert"><AlertCircle/>{error}</p>}
    <footer><button type="submit" disabled={running||!producers.length}>{running?<LoaderCircle className="spin"/>:<BarChart3/>}Analisar pedido</button></footer>
   </form>
   <div className="sog-analysis-output">{analysis?<AnalysisResult analysis={analysis} commodityMap={commodityMap}/>:<div className="sog-empty"><span><Target/></span><h4>A análise nasce do pedido do produtor</h4><p>Escolha o produtor, informe volume, preço-alvo e objetivo. A SOG devolve leitura de mercado, três alvos de fechamento e dicas específicas para a praça.</p></div>}</div>
  </div>
  {briefError&&!brief&&<p className="sog-form-error" role="alert"><AlertCircle/>{briefError}</p>}
  {brief&&<MarketBrief brief={brief} commodityFilter={analysis?analysis.request.commodity:''}/>}
  {brief?.praca?.buyers?.length>0&&<div className="sog-buyers"><header><MapPin/><b>Compradores e referências da praça</b><small>confiança declarada por item; confirmar antes de negociar</small></header><ul>{brief.praca.buyers.map(buyer=><li key={buyer.name}><span><b>{buyer.name}</b><small>{buyer.municipality} • {buyer.note}</small></span><em>{buyer.confidence}%</em></li>)}</ul></div>}
  {profile?.storageCapacityT&&<p className="sog-brief-logistics"><Warehouse/>Perfil de grãos do produtor: {profile.storageCapacityT} t de armazenagem{profile.logisticsMode?` • ${profile.logisticsMode}`:''}.</p>}
 </section>
}
