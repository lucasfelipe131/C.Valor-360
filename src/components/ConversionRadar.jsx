import React,{useEffect,useMemo} from 'react'
import {AlertTriangle,ArrowUpRight,CalendarClock,Database,RefreshCw,Route,ShieldCheck,Sparkles,Target} from 'lucide-react'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'
import '../conversion-radar.css'

const priorityLabels={agora:'Agir agora',esta_semana:'Esta semana',acompanhar:'Acompanhar'}
const priorityClass={agora:'is-now',esta_semana:'is-week',acompanhar:'is-watch'}
const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()
const amount=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'Valor não registrado'

export default function ConversionRadar({clients=[],onClient,onPrepare}){
 const {data,loading,error,run}=useAsyncResource({
  initialData:null,initialLoading:true,timeoutMs:30_000,
  timeoutMessage:'O radar demorou além do esperado. Atualize novamente.',
  fallbackMessage:'Não foi possível atualizar o radar agora.'
 })

 const load=()=>run(({signal})=>fetchJsonResource('/api/intelligence',{signal,fallbackMessage:'Não foi possível atualizar o radar agora.'}),{keepData:true})
 useEffect(()=>{load()},[])
 const radar=data?.radar||null
 const items=Array.isArray(radar?.items)?radar.items:[]
 const clientsById=useMemo(()=>new Map(clients.map(client=>[String(client.id),client])),[clients])
 const generatedAt=radar?.generatedAt?new Date(radar.generatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''

 const openClient=item=>{
  const client=clientsById.get(String(item.clientId))
  if(client)onClient?.(client)
 }
 const prepare=item=>{
  const client=clientsById.get(String(item.clientId))
  if(client)onPrepare?.(client)
 }

 return <section className="conversion-radar" aria-labelledby="conversion-radar-title">
  <header className="conversion-radar-head">
   <div>
    <span className="conversion-radar-kicker"><Sparkles/>RADAR DE CONVERSÃO DE HOJE</span>
    <h3 id="conversion-radar-title">Onde vale agir — e por quê</h3>
    <p>A VAL percorre a carteira, cruza prazos, visitas, oportunidades e sinais registrados e mostra no máximo cinco contas. Nada aqui dispara contato automático.</p>
   </div>
   <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading?'is-spinning':''}/>{loading?'Atualizando':'Atualizar radar'}</button>
  </header>

  {error&&<div className="conversion-radar-error"><AlertTriangle/><span>{error}</span></div>}

  {loading&&!radar&&<div className="conversion-radar-loading" role="status">
   <span><RefreshCw/></span><div><b>Cruzando a carteira inteira…</b><small>Ordenando sinais reais, prazos e próximos compromissos.</small></div>
  </div>}

  {!loading&&radar&&!items.length&&<div className="conversion-radar-empty">
   <ShieldCheck/><div><b>Nenhuma urgência foi fabricada</b><p>{text(radar.emptyReason,'Não há sinal registrado suficiente para recomendar contato hoje.')}</p></div>
  </div>}

  {items.length>0&&<div className="conversion-radar-list">
   {items.map((item,index)=><article className={`conversion-radar-card ${priorityClass[item.priority]||'is-watch'}`} key={item.id||item.clientId}>
    <div className="conversion-radar-rank"><span>{String(index+1).padStart(2,'0')}</span><i style={{'--radar-score':`${Math.max(0,Math.min(100,Number(item.score)||0))}%`}}/></div>
    <div className="conversion-radar-main">
     <div className="conversion-radar-title-row">
      <div><small>{priorityLabels[item.priority]||'Acompanhar'} • score {Math.round(Number(item.score)||0)}/100</small><h4>{text(item.clientName,'Produtor')}</h4><span>{[item.property,item.municipality].filter(Boolean).join(' • ')||'Localização ainda não informada'}</span></div>
      <b>{amount(item.amount)}</b>
     </div>
     <div className="conversion-radar-signal"><Target/><div><small>{text(item.headline,'Próxima decisão')}</small><p>{text(item.reason)}</p></div></div>
     <div className="conversion-radar-action"><Route/><div><small>PRÓXIMA AÇÃO</small><p>{text(item.nextAction)}</p></div></div>
     <div className="conversion-radar-meta">
      <span><CalendarClock/>{text(item.deadline,'Sem prazo registrado')}</span>
      <span><Database/>{Number(item.evidenceCount)||0} evidências • qualidade {Math.round(Number(item.dataQuality)||0)}/100</span>
     </div>
    </div>
    <div className="conversion-radar-buttons">
     <button type="button" onClick={()=>openClient(item)}>Abrir conta<ArrowUpRight/></button>
     <button type="button" className="is-primary" onClick={()=>prepare(item)}>Preparar conversa<Sparkles/></button>
    </div>
   </article>)}
  </div>}

  {radar&&<footer className="conversion-radar-foot">
   <span><ShieldCheck/>Somente sinais já registrados • sem contato ou gravação automática</span>
   <small>{Number(radar.considered)||0} contas consideradas • {Number(radar.enriched)||0} dossiês aprofundados{generatedAt?` • atualizado às ${generatedAt}`:''}</small>
  </footer>}
 </section>
}
