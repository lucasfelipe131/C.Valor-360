import React,{useEffect,useMemo} from 'react'
import {AlertTriangle,ArrowUpRight,CalendarClock,Database,RefreshCw,Route,ShieldCheck,Sparkles,Target} from 'lucide-react'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'
import '../conversion-radar.css'

const priorityLabels={agora:'Agir agora',esta_semana:'Esta semana',acompanhar:'Acompanhar'}
const priorityClass={agora:'is-now',esta_semana:'is-week',acompanhar:'is-watch'}
const categoryLabels={ACT_NOW:'Agir agora',PREPARE:'Preparar',FOLLOW_UP:'Acompanhar',LEARN:'Aprender'}
const categoryClass={ACT_NOW:'is-now',PREPARE:'is-week',FOLLOW_UP:'is-watch',LEARN:'is-watch'}
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
 const insights=data?.insights||null
 const usingInsights=Boolean(insights)
 const source=insights||radar
 const items=Array.isArray(source?.items)?source.items:[]
 const clientsById=useMemo(()=>new Map(clients.map(client=>[String(client.id),client])),[clients])
 const generatedAt=source?.generated_at||source?.generatedAt?new Date(source.generated_at||source.generatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''

 const openClient=item=>{
  const client=clientsById.get(String(item.subject_id||item.clientId))
  if(client)onClient?.(client)
 }
 const prepare=item=>{
  const client=clientsById.get(String(item.subject_id||item.clientId))
  if(client)onPrepare?.(client)
 }

 return <section className="conversion-radar" aria-labelledby="conversion-radar-title">
  <header className="conversion-radar-head">
   <div>
    <span className="conversion-radar-kicker"><Sparkles/>RADAR DE CONVERSÃO DE HOJE</span>
    <h3 id="conversion-radar-title">O que merece minha atenção agora?</h3>
    <p>Onde vale agir — e por quê. A VAL cruza compromissos, visitas, oportunidades e sinais registrados e mostra no máximo cinco contas ou ações prioritárias. Nada aqui dispara contato automático.</p>
   </div>
   <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading?'is-spinning':''}/>{loading?'Atualizando':'Atualizar radar'}</button>
  </header>

  {error&&<div className="conversion-radar-error"><AlertTriangle/><span>{error}</span></div>}

  {loading&&!radar&&<div className="conversion-radar-loading" role="status">
   <span><RefreshCw/></span><div><b>Cruzando a carteira inteira…</b><small>Ordenando sinais reais, prazos e próximos compromissos.</small></div>
  </div>}

  {!loading&&source&&!items.length&&<div className="conversion-radar-empty">
   <ShieldCheck/><div><b>Nenhuma urgência foi fabricada</b><p>{text(source.empty_reason||source.emptyReason,'Não há sinal registrado suficiente para recomendar contato hoje.')}</p></div>
  </div>}

  {items.length>0&&<div className="conversion-radar-list">
   {items.map((item,index)=>{const insight=Boolean(item.contract_version==='val.insight_card.v1');const client=clientsById.get(String(item.subject_id||item.clientId));return <article className={`conversion-radar-card ${insight?(categoryClass[item.category]||'is-watch'):(priorityClass[item.priority]||'is-watch')}`} key={item.insight_id||item.id||item.subject_id||item.clientId}>
    <div className="conversion-radar-rank"><span>{String(index+1).padStart(2,'0')}</span>{!insight&&<i style={{'--radar-score':`${Math.max(0,Math.min(100,Number(item.score)||0))}%`}}/>}</div>
    <div className="conversion-radar-main">
     <div className="conversion-radar-title-row">
      <div><small>{insight?(categoryLabels[item.category]||'Acompanhar'):`${priorityLabels[item.priority]||'Acompanhar'} • score ${Math.round(Number(item.score)||0)}/100`}</small><h4>{text(client?.name||item.clientName,'Produtor')}</h4><span>{insight?text(item.title,'Atenção necessária'):[item.property,item.municipality].filter(Boolean).join(' • ')||'Localização ainda não informada'}</span></div>
      <b>{insight?(item.epistemic_status==='HYPOTHESIS'?'Hipótese':'Com evidência'):amount(item.amount)}</b>
     </div>
     <div className="conversion-radar-signal"><Target/><div><small>{text(insight?item.summary:item.headline,'Próxima decisão')}</small><p>{text(insight?item.why_now:item.reason)}</p></div></div>
     <div className="conversion-radar-action"><Route/><div><small>PRÓXIMA AÇÃO</small><p>{text(insight?item.recommended_action:item.nextAction)}</p></div></div>
     <div className="conversion-radar-meta">
      <span><CalendarClock/>{insight?`Válido até ${new Date(item.expires_at).toLocaleDateString('pt-BR')}`:text(item.deadline,'Sem prazo registrado')}</span>
      <span><Database/>{insight?(Array.isArray(item.evidence_refs)?item.evidence_refs.length:0):Number(item.evidenceCount)||0} evidências{insight?'':` • qualidade ${Math.round(Number(item.dataQuality)||0)}/100`}</span>
     </div>
    </div>
    <div className="conversion-radar-buttons">
     <button type="button" onClick={()=>openClient(item)}>Abrir conta<ArrowUpRight/></button>
     <button type="button" className="is-primary" onClick={()=>prepare(item)}>Preparar conversa<Sparkles/></button>
    </div>
   </article>})}
  </div>}

  {source&&<footer className="conversion-radar-foot">
   <span><ShieldCheck/>Somente sinais já registrados • sem contato ou gravação automática</span>
   <small>{Number(source.considered)||0} sinais considerados{!usingInsights?` • ${Number(radar.enriched)||0} dossiês aprofundados`:''}{generatedAt?` • atualizado às ${generatedAt}`:''}</small>
  </footer>}
 </section>
}
