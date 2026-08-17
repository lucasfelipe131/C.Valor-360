import React,{useCallback,useEffect,useMemo,useState} from 'react'
import {
 AlertCircle,ArrowRight,BarChart3,Building2,CalendarDays,CheckCircle2,ChevronRight,
 ClipboardCheck,Clock3,Database,ExternalLink,Handshake,Info,LineChart,LoaderCircle,
 MapPin,Plus,RefreshCw,Route,ShieldCheck,Target,UserRound,Warehouse,X
} from 'lucide-react'
import {requestJsonResource,useAsyncResource} from '../hooks/useAsyncResource'

const emptyWorkspace={producers:[],profiles:[],intentions:[],marketSnapshots:[],opportunities:[],summary:{},catalog:{commodities:[],volumeUnits:[],priceUnits:[],marketKinds:[]},governance:{}}
const commodityFallback=[{value:'soja',label:'Soja'},{value:'milho',label:'Milho'},{value:'trigo',label:'Trigo'},{value:'sorgo',label:'Sorgo'},{value:'feijao',label:'Feijão'},{value:'arroz',label:'Arroz'},{value:'cevada',label:'Cevada'}]
const priceUnitLabel={'BRL/sc_60kg':'R$/sc 60 kg','BRL/t':'R$/t'}
const volumeUnitLabel={sc_60kg:'sc 60 kg',t:'t',kg:'kg'}
const intentStatus={draft:['A validar','draft'],monitoring:['Monitorando','monitoring'],confirmed:['Confirmada','confirmed'],negotiating:['Em negociação','negotiating'],closed:['Concluída','closed'],cancelled:['Cancelada','cancelled']}
const sourceLabel={producer_confirmation:'Produtor',consultant_interview:'Consultor',crm_import:'Importação CRM',integration:'Integração',market_feed:'Feed de mercado',broker:'Corretora',cooperative:'Cooperativa',manual_quote:'Cotação informada'}
const numberFormat=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2})
const moneyFormat=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2})
const dateFormat=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'})
const dateTimeFormat=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
const formatDate=value=>{if(!value)return 'Não informada';const parsed=new Date(value.length===10?`${value}T12:00:00`:value);return Number.isNaN(parsed.getTime())?'Não informada':dateFormat.format(parsed)}
const formatDateTime=value=>{const parsed=new Date(value);return !value||Number.isNaN(parsed.getTime())?'Não informada':dateTimeFormat.format(parsed)}
const localDateTime=()=>{const now=new Date(Date.now()-new Date().getTimezoneOffset()*60_000);return now.toISOString().slice(0,16)}
const today=()=>new Date().toISOString().slice(0,10)
const freshness=value=>{const hours=Math.max(0,(Date.now()-new Date(value).getTime())/3_600_000);return hours<=24?{label:'Atual',state:'fresh'}:hours<=72?{label:'Atenção',state:'attention'}:hours<=168?{label:'No limite',state:'limit'}:{label:'Vencida',state:'expired'}}

async function api(path,options={}){
 const {timeoutMs=15_000,...requestOptions}=options
 return requestJsonResource(path,{...requestOptions,headers:{...(requestOptions.body?{'Content-Type':'application/json'}:{}),...requestOptions.headers},timeoutMs,timeoutMessage:'A operação na SOG demorou além do limite.',fallbackMessage:'Não foi possível concluir a operação na SOG.'})
}

function SogMetric({icon:Icon,label,value,detail,tone=''}){
 return <article className={`sog-metric ${tone}`}><span><Icon/></span><div><small>{label}</small><b>{value}</b><p>{detail}</p></div></article>
}

function SogEmpty({icon:Icon,title,description,action,onAction}){
 return <div className="sog-empty"><span><Icon/></span><h4>{title}</h4><p>{description}</p>{action&&<button type="button" onClick={onAction}><Plus/>{action}</button>}</div>
}

function Field({label,hint,required,children,className=''}){
 return <label className={`sog-field ${className}`}><span>{label}{required&&<em>*</em>}</span>{children}{hint&&<small>{hint}</small>}</label>
}

function SogModal({title,eyebrow,onClose,children}){
 useEffect(()=>{const close=event=>{if(event.key==='Escape')onClose()};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[onClose])
 return <div className="sog-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="sog-modal" role="dialog" aria-modal="true" aria-labelledby="sog-modal-title"><header><div><small>{eyebrow}</small><h3 id="sog-modal-title">{title}</h3></div><button type="button" onClick={onClose} aria-label="Fechar"><X/></button></header>{children}</section></div>
}

function OpportunityCard({opportunity,onProducer}){
 const market=opportunity.marketReference
 return <article className={`sog-opportunity is-${opportunity.priority.level}`}>
  <header><div className="sog-opportunity-identity"><span>{opportunity.score}</span><div><small>{opportunity.priority.label} • {opportunity.commodityLabel}</small><h4>{opportunity.clientName}</h4><p>{opportunity.direction==='sell'?'Intenção de venda do produtor':'Intenção de compra do produtor'}{opportunity.season?` • Safra ${opportunity.season}`:''}</p></div></div><em>{opportunity.dataCompleteness}% dos dados</em></header>
  <div className="sog-opportunity-metrics">
   <div><small>VOLUME</small><b>{numberFormat.format(opportunity.volume)} {volumeUnitLabel[opportunity.volumeUnit]||opportunity.volumeUnit}</b></div>
   <div><small>PREÇO-ALVO</small><b>{opportunity.targetPrice?`${moneyFormat.format(opportunity.targetPrice)} / ${priceUnitLabel[opportunity.priceUnit]?.replace('R$/','')||opportunity.priceUnit}`:'A completar'}</b></div>
   <div><small>MERCADO</small><b>{market?`${moneyFormat.format(market.price)} / ${priceUnitLabel[market.priceUnit]?.replace('R$/','')||market.priceUnit}`:'Sem referência'}</b></div>
   <div><small>ENTREGA</small><b>{opportunity.deliveryStart?formatDate(opportunity.deliveryStart):opportunity.deliveryEnd?`Até ${formatDate(opportunity.deliveryEnd)}`:'A completar'}</b></div>
  </div>
  <div className="sog-opportunity-reading"><div><span><Target/></span><p><small>DIRECIONAMENTO SOG</small><b>{opportunity.nextAction}</b></p></div><ul>{opportunity.reasons.slice(0,3).map(reason=><li key={reason}><CheckCircle2/>{reason}</li>)}</ul>{opportunity.warnings?.[0]&&<p className="sog-warning"><AlertCircle/>{opportunity.warnings[0]}</p>}</div>
  <footer><span><ShieldCheck/>Regra {opportunity.reasonsVersion} • sem execução automática</span>{onProducer&&<button type="button" onClick={onProducer}>Abrir Cliente 360<ChevronRight/></button>}</footer>
 </article>
}

function ProfileForm({producers,catalog,initial,onSaved,onClose}){
 const [form,setForm]=useState(()=>({clientId:initial?.clientId||producers[0]?.id||'',commodities:initial?.commodities||[],storageCapacityT:initial?.storageCapacityT??'',storageStructure:initial?.storageStructure||'',logisticsMode:initial?.logisticsMode||'',usualDeliveryLocations:initial?.usualDeliveryLocations||'',marketingNotes:initial?.marketingNotes||'',source:initial?.source||'consultant_interview',sourceDetails:initial?.sourceDetails||'',observedAt:(initial?.observedAt||today()).slice(0,10),confirmed:Boolean(initial?.confirmedAt)}))
 const [saving,setSaving]=useState(false);const [error,setError]=useState('')
 const commodities=catalog.commodities?.length?catalog.commodities:commodityFallback
 const change=event=>setForm(current=>({...current,[event.target.name]:event.target.type==='checkbox'?event.target.checked:event.target.value}))
 const toggleCommodity=value=>setForm(current=>({...current,commodities:current.commodities.includes(value)?current.commodities.filter(item=>item!==value):[...current.commodities,value]}))
 const submit=async event=>{event.preventDefault();setSaving(true);setError('');try{await api('/api/grains/profiles',{method:'PUT',body:JSON.stringify(form)});await onSaved('Perfil de grãos atualizado com fonte e data de observação.');onClose()}catch(exception){setError(exception.message)}finally{setSaving(false)}}
 return <form className="sog-form" onSubmit={submit}>
  <div className="sog-form-grid">
   <Field label="Produtor" required className="is-wide"><select name="clientId" value={form.clientId} onChange={change} required disabled={Boolean(initial)}><option value="">Selecione</option>{producers.map(producer=><option key={producer.id} value={producer.id}>{producer.name}{producer.municipality?` • ${producer.municipality}`:''}</option>)}</select></Field>
   <Field label="Grãos trabalhados" hint="Marque somente culturas confirmadas." className="is-wide"><div className="sog-check-grid">{commodities.map(item=><button type="button" key={item.value} className={form.commodities.includes(item.value)?'is-selected':''} onClick={()=>toggleCommodity(item.value)} aria-pressed={form.commodities.includes(item.value)}>{form.commodities.includes(item.value)&&<CheckCircle2/>}{item.label}</button>)}</div></Field>
   <Field label="Armazenagem própria (t)" hint="Opcional"><input name="storageCapacityT" value={form.storageCapacityT} onChange={change} type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="Ex.: 1200"/></Field>
   <Field label="Estrutura de armazenagem"><input name="storageStructure" value={form.storageStructure} onChange={change} placeholder="Silo próprio, armazém terceirizado…"/></Field>
   <Field label="Modelo logístico"><input name="logisticsMode" value={form.logisticsMode} onChange={change} placeholder="FOB, CIF, frota própria…"/></Field>
   <Field label="Praças usuais de entrega"><input name="usualDeliveryLocations" value={form.usualDeliveryLocations} onChange={change} placeholder="Municípios, armazéns ou unidades"/></Field>
   <Field label="Origem da informação" required><select name="source" value={form.source} onChange={change}><option value="consultant_interview">Entrevista do consultor</option><option value="producer_confirmation">Confirmação do produtor</option><option value="crm_import">Importação CRM</option><option value="integration">Integração autorizada</option></select></Field>
   <Field label="Data da informação" required><input name="observedAt" value={form.observedAt} onChange={change} type="date" required/></Field>
   <Field label="Evidência / contexto" className="is-wide"><input name="sourceDetails" value={form.sourceDetails} onChange={change} placeholder="Ex.: visita de planejamento, conversa por telefone…"/></Field>
   <Field label="Notas comerciais de grãos" className="is-wide"><textarea name="marketingNotes" value={form.marketingNotes} onChange={change} rows="3" placeholder="Preferências de comercialização, restrições ou observações verificáveis"/></Field>
  </div>
  <label className="sog-confirm"><input name="confirmed" checked={form.confirmed} onChange={change} type="checkbox"/><span><b>Dados confirmados diretamente com o produtor</b><small>Marque apenas quando houver confirmação explícita. Caso contrário, a SOG mantém a informação como entrada do consultor.</small></span></label>
  {error&&<p className="sog-form-error" role="alert"><AlertCircle/>{error}</p>}
  <footer><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<CheckCircle2/>}Salvar perfil</button></footer>
 </form>
}

function IntentForm({producers,catalog,onSaved,onClose}){
 const [form,setForm]=useState({clientId:producers[0]?.id||'',direction:'sell',commodity:'soja',season:'',volume:'',volumeUnit:'sc_60kg',targetPrice:'',priceUnit:'BRL/sc_60kg',deliveryStart:'',deliveryEnd:'',deliveryLocation:'',qualitySpecs:'',evidence:'',sourceDetails:'',notes:'',observedAt:localDateTime()})
 const [saving,setSaving]=useState(false);const [error,setError]=useState('')
 const commodities=catalog.commodities?.length?catalog.commodities:commodityFallback
 const change=event=>setForm(current=>({...current,[event.target.name]:event.target.value}))
 const submit=async event=>{event.preventDefault();setError('');const evidence={producer_confirmation:{status:'confirmed',confidence:90,source:'producer_confirmation'},consultant_report:{status:'monitoring',confidence:65,source:'consultant_interview'},unvalidated:{status:'draft',confidence:35,source:'consultant_interview'}}[form.evidence];if(!evidence){setError('Informe como esta intenção foi obtida.');return}setSaving(true);try{await api('/api/grains/intents',{method:'POST',body:JSON.stringify({...form,...evidence})});await onSaved('Intenção registrada. A SOG recalculou o direcionamento com as referências disponíveis.');onClose()}catch(exception){setError(exception.message)}finally{setSaving(false)}}
 return <form className="sog-form" onSubmit={submit}>
  <div className="sog-form-grid">
   <Field label="Produtor" required className="is-wide"><select name="clientId" value={form.clientId} onChange={change} required><option value="">Selecione</option>{producers.map(producer=><option key={producer.id} value={producer.id}>{producer.name}{producer.municipality?` • ${producer.municipality}`:''}</option>)}</select></Field>
   <Field label="Movimento" required><select name="direction" value={form.direction} onChange={change}><option value="sell">Produtor pretende vender</option><option value="buy">Produtor pretende comprar</option></select></Field>
   <Field label="Grão" required><select name="commodity" value={form.commodity} onChange={change}>{commodities.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
   <Field label="Safra / ciclo"><input name="season" value={form.season} onChange={change} placeholder="Ex.: 2026/27"/></Field>
   <Field label="Volume" required><div className="sog-inline-input"><input name="volume" value={form.volume} onChange={change} type="number" min="0.001" step="0.001" inputMode="decimal" required placeholder="0"/><select name="volumeUnit" value={form.volumeUnit} onChange={change}>{(catalog.volumeUnits||[]).map(item=><option key={item.value} value={item.value}>{item.label}</option>)}{!catalog.volumeUnits?.length&&<><option value="sc_60kg">sc 60 kg</option><option value="t">t</option></>}</select></div></Field>
   <Field label="Preço-alvo" hint="Opcional, mas melhora a leitura"><div className="sog-inline-input"><input name="targetPrice" value={form.targetPrice} onChange={change} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="R$ 0,00"/><select name="priceUnit" value={form.priceUnit} onChange={change}><option value="BRL/sc_60kg">R$/sc</option><option value="BRL/t">R$/t</option></select></div></Field>
   <Field label="Início da entrega"><input name="deliveryStart" value={form.deliveryStart} onChange={change} type="date"/></Field>
   <Field label="Fim da entrega"><input name="deliveryEnd" value={form.deliveryEnd} onChange={change} type="date"/></Field>
   <Field label="Local de entrega"><input name="deliveryLocation" value={form.deliveryLocation} onChange={change} placeholder="Praça, armazém ou município"/></Field>
   <Field label="Como esta intenção foi obtida?" required><select name="evidence" value={form.evidence} onChange={change} required><option value="">Selecione a evidência</option><option value="producer_confirmation">Confirmada pelo produtor</option><option value="consultant_report">Relatada ao consultor — acompanhar</option><option value="unvalidated">Sinal preliminar — não confirmado</option></select></Field>
   <Field label="Contexto da evidência" className="is-wide"><input name="sourceDetails" value={form.sourceDetails} onChange={change} placeholder="Ex.: ligação de 15/08, visita de pré-colheita…"/></Field>
   <Field label="Padrão / qualidade"><input name="qualitySpecs" value={form.qualitySpecs} onChange={change} placeholder="Umidade, classificação ou condição relevante"/></Field>
   <Field label="Quando foi informada?" required><input name="observedAt" value={form.observedAt} onChange={change} type="datetime-local" required/></Field>
   <Field label="Observações" className="is-wide"><textarea name="notes" value={form.notes} onChange={change} rows="3" placeholder="Registre somente fatos úteis à negociação"/></Field>
  </div>
  <p className="sog-form-note"><ShieldCheck/>A intenção só é tratada como confirmada quando você selecionar “Confirmada pelo produtor”.</p>
  {error&&<p className="sog-form-error" role="alert"><AlertCircle/>{error}</p>}
  <footer><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<Handshake/>}Registrar intenção</button></footer>
 </form>
}

function MarketForm({catalog,onSaved,onClose}){
 const [form,setForm]=useState({commodity:'soja',marketKind:'spot',region:'',price:'',priceUnit:'BRL/sc_60kg',deliveryStart:'',deliveryEnd:'',sourceName:'',sourceType:'manual_quote',sourceUrl:'',confidence:'',notes:'',observedAt:localDateTime()})
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');const commodities=catalog.commodities?.length?catalog.commodities:commodityFallback
 const change=event=>setForm(current=>({...current,[event.target.name]:event.target.value}))
 const submit=async event=>{event.preventDefault();setSaving(true);setError('');try{await api('/api/grains/market',{method:'POST',body:JSON.stringify(form)});await onSaved('Referência de mercado salva com fonte, horário e confiança.');onClose()}catch(exception){setError(exception.message)}finally{setSaving(false)}}
 return <form className="sog-form" onSubmit={submit}>
  <div className="sog-form-grid">
   <Field label="Grão" required><select name="commodity" value={form.commodity} onChange={change}>{commodities.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
   <Field label="Mercado" required><select name="marketKind" value={form.marketKind} onChange={change}><option value="spot">Disponível</option><option value="forward">A termo</option><option value="futures">Futuro</option></select></Field>
   <Field label="Praça / região" required><input name="region" value={form.region} onChange={change} required placeholder="Ex.: Cascavel/PR"/></Field>
   <Field label="Cotação" required><div className="sog-inline-input"><input name="price" value={form.price} onChange={change} type="number" min="0.01" step="0.01" inputMode="decimal" required placeholder="R$ 0,00"/><select name="priceUnit" value={form.priceUnit} onChange={change}><option value="BRL/sc_60kg">R$/sc</option><option value="BRL/t">R$/t</option></select></div></Field>
   <Field label="Início da entrega"><input name="deliveryStart" value={form.deliveryStart} onChange={change} type="date"/></Field>
   <Field label="Fim da entrega"><input name="deliveryEnd" value={form.deliveryEnd} onChange={change} type="date"/></Field>
   <Field label="Fonte" required><input name="sourceName" value={form.sourceName} onChange={change} required placeholder="Nome da bolsa, corretora, cooperativa…"/></Field>
   <Field label="Tipo de fonte" required><select name="sourceType" value={form.sourceType} onChange={change}><option value="market_feed">Feed / boletim de mercado</option><option value="broker">Corretora</option><option value="cooperative">Cooperativa</option><option value="manual_quote">Cotação informada manualmente</option><option value="integration">Integração autorizada</option></select></Field>
   <Field label="Quando foi observada?" required><input name="observedAt" value={form.observedAt} onChange={change} type="datetime-local" required/></Field>
   <Field label="Confiança da fonte" required><select name="confidence" value={form.confidence} onChange={change} required><option value="">Selecione</option><option value="95">Fonte oficial / feed validado</option><option value="80">Fonte comercial identificada</option><option value="65">Registro manual a conferir</option></select></Field>
   <Field label="Link da fonte" hint="Opcional" className="is-wide"><input name="sourceUrl" value={form.sourceUrl} onChange={change} type="url" placeholder="https://…"/></Field>
   <Field label="Observações" className="is-wide"><textarea name="notes" value={form.notes} onChange={change} rows="3" placeholder="Condição, base, vencimento ou contexto da cotação"/></Field>
  </div>
  <p className="sog-form-note"><Info/>A SOG não busca nem inventa cotações. Esta referência será usada somente com a fonte e o horário registrados.</p>
  {error&&<p className="sog-form-error" role="alert"><AlertCircle/>{error}</p>}
  <footer><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<LineChart/>}Salvar referência</button></footer>
 </form>
}

export default function SogWorkspace({clients=[],onSelect}){
 const {data:workspaceData,loading,error,run:loadWorkspace}=useAsyncResource({initialData:emptyWorkspace,initialLoading:true,timeoutMs:15_000,timeoutMessage:'A SOG demorou além do limite para carregar a carteira.',fallbackMessage:'Não foi possível carregar a base da SOG.'})
 const workspace=workspaceData||emptyWorkspace
 const [notice,setNotice]=useState('');const [tab,setTab]=useState('opportunities');const [modal,setModal]=useState(null);const [profileTarget,setProfileTarget]=useState(null);const [search,setSearch]=useState('')
 const load=useCallback(()=>loadWorkspace(({signal})=>api('/api/grains/bootstrap',{signal,timeoutMs:0}),{keepData:true}),[loadWorkspace])
 useEffect(()=>{load()},[load])
 const producers=useMemo(()=>{const byId=new Map((workspace.producers||[]).map(item=>[String(item.id),item]));for(const client of clients)if(!byId.has(String(client.id)))byId.set(String(client.id),{id:String(client.id),name:client.name,municipality:client.municipality||'',cultures:client.cultures||'',area:client.area??null});return [...byId.values()].sort((left,right)=>String(left.name).localeCompare(String(right.name),'pt-BR'))},[workspace.producers,clients])
 const profilesByClient=useMemo(()=>new Map((workspace.profiles||[]).map(item=>[String(item.clientId),item])),[workspace.profiles])
 const commodityMap=useMemo(()=>Object.fromEntries((workspace.catalog?.commodities?.length?workspace.catalog.commodities:commodityFallback).map(item=>[item.value,item.label])),[workspace.catalog])
 const filteredProducers=producers.filter(item=>`${item.name} ${item.municipality}`.toLowerCase().includes(search.toLowerCase()))
 const saved=async message=>{await load();setNotice(message);window.clearTimeout(window.__sogNotice);window.__sogNotice=window.setTimeout(()=>setNotice(''),4200)}
 const openProfile=producer=>{const target=producer||producers.find(item=>!profilesByClient.has(String(item.id)))||producers[0];setProfileTarget(target?profilesByClient.get(String(target.id))||{clientId:target.id}:null);setModal('profile')}
 const openClient=clientId=>{const client=clients.find(item=>String(item.id)===String(clientId));if(client&&onSelect)onSelect(client)}
 const updateStatus=async(id,status)=>{try{await api(`/api/grains/intents/${id}`,{method:'PATCH',body:JSON.stringify({status})});await saved(status==='negotiating'?'Intenção movida para negociação.':'Intenção concluída no histórico SOG.')}catch(exception){setNotice(exception.message)}}
 const summary=workspace.summary||{}
 const tabs=[['opportunities','Oportunidades',workspace.opportunities?.length||0,Target],['intentions','Intenções',summary.activeIntentions||0,Handshake],['market','Mercado',workspace.marketSnapshots?.length||0,LineChart],['producers','Produtores',producers.length,UserRound],['ecosystem','Alimentação',null,Database]]
 if(loading&&!workspace.producers?.length)return <section className="sog-loading" role="status"><LoaderCircle className="spin"/><b>Conectando a SOG à carteira protegida…</b><span>Carregando produtores, intenções e referências de mercado.</span></section>
 if(error&&!workspace.producers?.length)return <section className="sog-load-error" role="alert"><AlertCircle/><div><b>A SOG não conseguiu carregar a base.</b><p>{error}</p><button type="button" onClick={load}><RefreshCw/>Tentar novamente</button></div></section>
 return <section className="sog-workspace" aria-labelledby="sog-title">
  {notice&&<div className="sog-notice" role="status"><CheckCircle2/>{notice}</div>}
  <header className="sog-hero">
   <div><span className="sog-kicker"><BarChart3/>SOG • SISTEMA DE OPERAÇÕES DE GRÃOS</span><h2 id="sog-title">Dados que viram direção comercial.</h2><p>A carteira do Cliente 360, as intenções confirmadas e o mercado com fonte convergem em uma fila explicável de oportunidades.</p><div className="sog-hero-actions"><button type="button" onClick={()=>setModal('intent')} disabled={!producers.length}><Plus/>Registrar intenção</button><button type="button" onClick={()=>setModal('market')}><LineChart/>Adicionar cotação</button></div></div>
   <aside><span><ShieldCheck/></span><div><small>GOVERNANÇA ATIVA</small><b>Nenhuma intenção é presumida</b><p>A SOG mostra evidência, confiança e atualização. O consultor confirma a ação; o sistema não fecha operações.</p></div></aside>
  </header>
  <div className="sog-metrics" aria-label="Resumo operacional SOG">
   <SogMetric icon={UserRound} label="CARTEIRA CONECTADA" value={summary.producerCount??producers.length} detail={`${summary.profiledProducers||0} com perfil de grãos`} />
   <SogMetric icon={Handshake} label="INTENÇÕES ATIVAS" value={summary.activeIntentions||0} detail={`${summary.confirmedIntentions||0} confirmadas ou negociando`} tone="is-blue"/>
   <SogMetric icon={Clock3} label="MERCADO ATUAL" value={summary.freshMarketReferences||0} detail="referências observadas em até 24h" tone="is-gold"/>
   <SogMetric icon={Target} label="AÇÃO PRIORITÁRIA" value={summary.highPriority||0} detail={`${summary.generatedOpportunities||0} leituras geradas`} tone="is-red"/>
  </div>
  <nav className="sog-tabs" aria-label="Módulos da SOG" role="tablist">{tabs.map(([id,label,count,Icon])=><button type="button" role="tab" aria-selected={tab===id} className={tab===id?'is-active':''} key={id} onClick={()=>setTab(id)}><Icon/><span>{label}</span>{count!==null&&<em>{count}</em>}</button>)}</nav>

  {tab==='opportunities'&&<section className="sog-panel" aria-labelledby="sog-opportunities-title"><header className="sog-panel-head"><div><span className="eyebrow">FILA EXPLICÁVEL</span><h3 id="sog-opportunities-title">Oportunidades e próximo movimento</h3><p>Priorização baseada em confirmação, proximidade do preço, atualidade da fonte e janela de entrega.</p></div><button type="button" className="sog-refresh" onClick={load} disabled={loading}><RefreshCw className={loading?'spin':''}/>Atualizar</button></header>{workspace.opportunities?.length?<div className="sog-opportunity-list">{workspace.opportunities.map(item=><OpportunityCard key={item.id} opportunity={item} onProducer={clients.length?()=>openClient(item.clientId):null}/>)}</div>:<SogEmpty icon={Target} title="A fila nasce de dados reais" description="Registre uma intenção e uma referência de mercado do mesmo grão. A SOG fará o cruzamento sem fabricar preços ou interesses." action={producers.length?'Registrar primeira intenção':null} onAction={()=>setModal('intent')}/>}</section>}

  {tab==='intentions'&&<section className="sog-panel" aria-labelledby="sog-intents-title"><header className="sog-panel-head"><div><span className="eyebrow">DEMANDA E ORIGINAÇÃO</span><h3 id="sog-intents-title">Intenções de negociação</h3><p>Cada registro mantém produtor, volume, janela, origem, confiança e evolução da conversa.</p></div><button type="button" className="sog-primary-action" onClick={()=>setModal('intent')} disabled={!producers.length}><Plus/>Nova intenção</button></header>{workspace.intentions?.length?<div className="sog-intent-list">{workspace.intentions.map(item=>{const [statusLabel,statusClass]=intentStatus[item.status]||[item.status,''];return <article key={item.id}><header><div><span className={`sog-status is-${statusClass}`}>{statusLabel}</span><h4>{item.clientName}</h4><p>{commodityMap[item.commodity]||item.commodity}{item.season?` • ${item.season}`:''}</p></div><em>{item.confidence}% confiança</em></header><dl><div><dt>Movimento</dt><dd>{item.direction==='sell'?'Venda do produtor':'Compra do produtor'}</dd></div><div><dt>Volume</dt><dd>{numberFormat.format(item.volume)} {volumeUnitLabel[item.volumeUnit]||item.volumeUnit}</dd></div><div><dt>Preço-alvo</dt><dd>{item.targetPrice?`${moneyFormat.format(item.targetPrice)} • ${priceUnitLabel[item.priceUnit]}`:'Não informado'}</dd></div><div><dt>Entrega</dt><dd>{item.deliveryStart?formatDate(item.deliveryStart):item.deliveryEnd?`Até ${formatDate(item.deliveryEnd)}`:'Não informada'}</dd></div></dl><footer><span><Database/>{sourceLabel[item.source]||item.source} • {formatDateTime(item.observedAt)}</span>{item.status==='monitoring'&&<em>Confirme com o produtor antes de negociar</em>}{item.status==='confirmed'&&<button type="button" onClick={()=>updateStatus(item.id,'negotiating')}>Iniciar negociação<ArrowRight/></button>}{item.status==='negotiating'&&<button type="button" onClick={()=>updateStatus(item.id,'closed')}>Concluir<CheckCircle2/></button>}</footer></article>})}</div>:<SogEmpty icon={Handshake} title="Nenhuma intenção registrada" description="Cadastre apenas o que foi informado ou observado, indicando se houve confirmação direta do produtor." action={producers.length?'Registrar intenção':null} onAction={()=>setModal('intent')}/>}</section>}

  {tab==='market'&&<section className="sog-panel" aria-labelledby="sog-market-title"><header className="sog-panel-head"><div><span className="eyebrow">INTELIGÊNCIA DE MERCADO</span><h3 id="sog-market-title">Referências com fonte e validade</h3><p>A SOG preserva o valor original, a praça, o horário e a confiança para evitar decisões sobre cotações sem origem.</p></div><button type="button" className="sog-primary-action" onClick={()=>setModal('market')}><Plus/>Adicionar cotação</button></header>{workspace.marketSnapshots?.length?<div className="sog-market-grid">{workspace.marketSnapshots.map(item=>{const fresh=freshness(item.observedAt);return <article key={item.id}><header><span className={`sog-freshness is-${fresh.state}`}><Clock3/>{fresh.label}</span><em>{item.confidence}% confiança</em></header><div className="sog-market-price"><small>{commodityMap[item.commodity]||item.commodity} • {item.marketKind==='spot'?'Disponível':item.marketKind==='forward'?'A termo':'Futuro'}</small><b>{moneyFormat.format(item.price)}</b><span>{priceUnitLabel[item.priceUnit]}</span></div><p><MapPin/>{item.region}</p><footer><div><small>FONTE</small><b>{item.sourceName}</b><span>{formatDateTime(item.observedAt)}</span></div>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Abrir fonte ${item.sourceName}`}><ExternalLink/></a>}</footer></article>})}</div>:<SogEmpty icon={LineChart} title="Mercado ainda sem referências" description="Inclua a primeira cotação identificando praça, fonte e horário. Valores sem procedência não entram no motor." action="Adicionar cotação" onAction={()=>setModal('market')}/>}</section>}

  {tab==='producers'&&<section className="sog-panel" aria-labelledby="sog-producers-title"><header className="sog-panel-head"><div><span className="eyebrow">CLIENTE 360 + CONTEXTO DE GRÃOS</span><h3 id="sog-producers-title">Produtores conectados à SOG</h3><p>O cadastro não é duplicado: a SOG acrescenta somente armazenagem, logística e preferências próprias da comercialização de grãos.</p></div><button type="button" className="sog-primary-action" onClick={()=>openProfile()} disabled={!producers.length}><Plus/>Completar perfil</button></header>{producers.length?<><label className="sog-search"><UserRound/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar produtor ou município"/></label><div className="sog-producer-list">{filteredProducers.map(producer=>{const profile=profilesByClient.get(String(producer.id));const active=(workspace.intentions||[]).filter(item=>String(item.clientId)===String(producer.id)&&!['closed','cancelled'].includes(item.status)).length;return <article key={producer.id}><div className="sog-producer-icon"><Building2/></div><div className="sog-producer-main"><span>{profile?<><CheckCircle2/>Perfil SOG alimentado</>:<><AlertCircle/>Perfil de grãos pendente</>}</span><h4>{producer.name}</h4><p>{producer.municipality||'Município não informado'}{producer.cultures?` • ${producer.cultures}`:''}</p>{profile&&<div>{profile.commodities.map(code=><em key={code}>{commodityMap[code]||code}</em>)}{profile.storageCapacityT&&<em><Warehouse/>{numberFormat.format(profile.storageCapacityT)} t</em>}{profile.logisticsMode&&<em><Route/>{profile.logisticsMode}</em>}</div>}</div><aside><b>{active}</b><small>intenções ativas</small><button type="button" onClick={()=>openProfile(producer)}>{profile?'Atualizar':'Completar'}<ChevronRight/></button></aside></article>})}</div></>:<SogEmpty icon={UserRound} title="A SOG usa a mesma carteira do Cliente 360" description="Cadastre ou importe produtores na Base Inteligente. Eles aparecerão aqui sem duplicação."/>}</section>}

  {tab==='ecosystem'&&<section className="sog-panel sog-ecosystem" aria-labelledby="sog-ecosystem-title"><header className="sog-panel-head"><div><span className="eyebrow">ECOSSISTEMA DE ALIMENTAÇÃO</span><h3 id="sog-ecosystem-title">Da evidência ao direcionamento</h3><p>Quatro camadas mantêm a origem do dado visível e separam entrada humana, mercado e inteligência calculada.</p></div><em className="sog-operational"><CheckCircle2/>Operacional</em></header><div className="sog-flow">
   <article><span>01</span><div><UserRound/><small>BASE CANÔNICA</small><h4>Cliente 360</h4><p>Produtor, município, culturas, perfil relacional e carteira permanecem no cadastro existente.</p><em><CheckCircle2/>{producers.length} produtores conectados</em></div></article><ArrowRight/>
   <article><span>02</span><div><ClipboardCheck/><small>COLETA COM EVIDÊNCIA</small><h4>Perfil + intenção</h4><p>Consultor registra volume, preço, janela e informa se o produtor confirmou ou se ainda é um sinal.</p><em><CheckCircle2/>{summary.activeIntentions||0} intenções ativas</em></div></article><ArrowRight/>
   <article><span>03</span><div><LineChart/><small>MERCADO RASTREÁVEL</small><h4>Cotação + fonte</h4><p>Praça, horário, tipo de mercado e confiança acompanham cada valor usado na comparação.</p><em><CheckCircle2/>{workspace.marketSnapshots?.length||0} referências registradas</em></div></article><ArrowRight/>
   <article><span>04</span><div><Target/><small>REGRA AUDITÁVEL</small><h4>Direção de negócio</h4><p>Score, motivos, alertas e próxima ação são recalculados; a decisão continua humana.</p><em><ShieldCheck/>sog-rules-v1</em></div></article>
  </div><div className="sog-source-board"><section><header><Database/><div><small>ENTRADAS DISPONÍVEIS AGORA</small><h4>Alimentação implementada</h4></div></header><ul><li><CheckCircle2/><span><b>Carteira e Cliente 360</b><small>Leitura automática, isolada pelo login.</small></span></li><li><CheckCircle2/><span><b>Formulários SOG</b><small>Perfil do produtor, intenção e evolução da negociação.</small></span></li><li><CheckCircle2/><span><b>Registro de mercado</b><small>Fonte, URL opcional, horário e confiança.</small></span></li><li><CheckCircle2/><span><b>API autenticada interna</b><small>Mesmas validações da interface para futuras integrações.</small></span></li></ul></section><section className="is-future"><header><Route/><div><small>PRÓXIMOS CONECTORES</small><h4>Preparados, ainda não conectados</h4></div></header><ul><li><Clock3/><span><b>ERP / CTRM</b><small>Contratos, fixações, saldos e entregas.</small></span></li><li><Clock3/><span><b>Feed externo de mercado</b><small>Cotações automáticas somente após homologação da fonte.</small></span></li><li><Clock3/><span><b>Importação estruturada</b><small>Planilha de intenções com validação e revisão humana.</small></span></li></ul></section></div><div className="sog-governance"><article><ShieldCheck/><div><small>ISOLAMENTO</small><b>Mesmo login e carteira</b><p>Consultores só acessam produtores e registros do próprio escopo.</p></div></article><article><Database/><div><small>PROVENIÊNCIA</small><b>Fonte e atualização obrigatórias</b><p>Preço e intenção não entram sem identificação de origem.</p></div></article><article><Handshake/><div><small>CONTROLE HUMANO</small><b>Sem operação automática</b><p>A SOG orienta; confirmação, proposta e fechamento ficam com a equipe.</p></div></article></div></section>}

  {modal==='profile'&&<SogModal title="Perfil comercial de grãos" eyebrow="PRODUTOR + SOG" onClose={()=>setModal(null)}><ProfileForm producers={producers} catalog={workspace.catalog||{}} initial={profileTarget} onSaved={saved} onClose={()=>setModal(null)}/></SogModal>}
  {modal==='intent'&&<SogModal title="Registrar intenção de negociação" eyebrow="EVIDÊNCIA COMERCIAL" onClose={()=>setModal(null)}><IntentForm producers={producers} catalog={workspace.catalog||{}} onSaved={saved} onClose={()=>setModal(null)}/></SogModal>}
  {modal==='market'&&<SogModal title="Adicionar referência de mercado" eyebrow="FONTE E VALIDADE" onClose={()=>setModal(null)}><MarketForm catalog={workspace.catalog||{}} onSaved={saved} onClose={()=>setModal(null)}/></SogModal>}
 </section>
}
