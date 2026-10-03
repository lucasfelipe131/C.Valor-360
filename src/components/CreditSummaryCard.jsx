import React,{useEffect} from 'react'
import {Building2,CheckCircle2,FileCheck2,FileSearch,History,Landmark,MapPinned,Scale,ShieldCheck,UserCheck} from 'lucide-react'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'

// Leitura do VAL Cred na ficha do produtor (contrato val-cred-integration.v1, parte C).
// Consome GET /api/clients/:id/credit. Só mostra o que o VAL Cred registrou: sem score,
// sem aprovação automática, sem CPF/CNPJ e sem documentos. A decisão de crédito é humana.

const REQUEST_STATUS={rascunho:'Rascunho',dados_incompletos:'Dados incompletos',analisada:'Analisada',parecer_registrado:'Parecer registrado',complementacao:'Complementação',favoravel:'Favorável',desfavoravel:'Desfavorável'}
const DECISION={favoravel:'favorável',desfavoravel:'desfavorável',complementacao:'pede complementação'}
const EVENT_LABEL={'credit.request.updated':'Solicitação atualizada','credit.analysis.completed':'Análise concluída','credit.decision.recorded':'Parecer humano registrado','credit.property.updated':'Propriedade atualizada','cooperative.unit.upserted':'Unidade atualizada'}
const ERROR='Não foi possível consultar o crédito no VAL Cred.'

const known=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))
const count=value=>Number(value).toLocaleString('pt-BR')
const money=value=>known(value)?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):null
const date=value=>{if(!value)return null;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed.toLocaleDateString('pt-BR')}
const coverage=value=>known(value)?`${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2})}×`:'não calculada'
const covers=value=>value===true?'cobre as parcelas':value===false?'não cobre as parcelas':'sem conclusão'
const statusLabel=value=>REQUEST_STATUS[value]||(value?String(value).replace(/_/g,' '):'Situação não informada')
const freshness=value=>value===true?'atual':value===false?'desatualizada — a solicitação mudou depois dela':'atualidade não informada'
const heading={margin:0,padding:'16px 20px 0',color:'#4f8d72',fontSize:'8px',fontWeight:850,letterSpacing:'.09em'}
const note={margin:0,padding:'8px 20px 16px',color:'#5d7487',fontSize:'10px',lineHeight:1.5}

function eventDetail(event){
 if(event.request)return `${event.request.title||'Solicitação'} — ${statusLabel(event.request.status)}`
 if(event.analysis)return `Cobertura ${coverage(event.analysis.coverage)} • base: ${covers(event.analysis.coversPayments)} • adverso: ${covers(event.analysis.stressCoversPayments)}`
 if(event.decision)return `Parecer ${DECISION[event.decision.decision]||'registrado'} — decisão humana no VAL Cred`
 if(event.property)return `${event.property.name||'Propriedade'}${event.property.municipality?` (${event.property.municipality})`:''} — ${event.property.mapped?'mapeada':'sem mapa'}, matrícula ${event.property.registryConfirmed?'conferida':'não conferida'}${known(event.property.activeLiens)?`, ${count(event.property.activeLiens)} ônus vigente(s)`:''}`
 if(event.unit)return [event.unit.code,event.unit.name].filter(Boolean).join(' — ')||'Unidade da cooperativa'
 return 'Evento registrado pela integração.'
}

function RequestItem({request}){
 const analysis=request.analysis
 return <div>
  <small>{statusLabel(request.status).toUpperCase()}{date(request.updatedAt)?` • ATUALIZADA EM ${date(request.updatedAt)}`:''}</small>
  <b>{request.title||'Solicitação sem título'}</b>
  <span>{[money(request.principal),known(request.termMonths)?`${count(request.termMonths)} meses`:null].filter(Boolean).join(' • ')||'Valor e prazo não informados'}</span>
  {analysis?<>
   <span>Última análise{date(analysis.at)?` em ${date(analysis.at)}`:''}: {freshness(analysis.fresh)}</span>
   <span>Cobertura {coverage(analysis.coverage)} • cenário base: {covers(analysis.coversPayments)} • cenário adverso: {covers(analysis.stressCoversPayments)}</span>
  </>:<span>Sem análise registrada.</span>}
 </div>
}

function PropertyItem({property}){
 return <div>
  <small>{[property.municipality,property.tenure].filter(Boolean).join(' • ').toUpperCase()||'PROPRIEDADE'}</small>
  <b>{property.name||'Propriedade sem nome'}</b>
  <span>{known(property.areaHa)?`${Number(property.areaHa).toLocaleString('pt-BR',{maximumFractionDigits:2})} ha`:'Área não informada'}</span>
  <span>Mapa: {property.mapped?'mapeada':'sem mapa'} • Matrícula: {property.registryConfirmed?'conferida':'não conferida'} • Ônus vigentes: {known(property.activeLiens)?count(property.activeLiens):'não informado'}</span>
 </div>
}

function Metrics({summary}){
 const requests=summary.requests||[],properties=summary.properties||[],unit=summary.producer?.unit
 const liens=properties.filter(item=>known(item.activeLiens))
 return <div className="manual-sync-metrics">
  <div><Building2/><span><b>{unit?.code||'—'}</b><small>{unit?.name?`unidade • ${unit.name}`:'unidade não informada'}</small></span></div>
  <div><FileSearch/><span><b>{count(requests.length)}</b><small>solicitações</small></span></div>
  <div><CheckCircle2/><span><b>{count(requests.filter(item=>item.analysis?.fresh===true).length)}</b><small>análises atuais</small></span></div>
  <div><MapPinned/><span><b>{count(properties.length)}</b><small>propriedades</small></span></div>
  <div><FileCheck2/><span><b>{properties.length?`${count(properties.filter(item=>item.registryConfirmed).length)}/${count(properties.length)}`:'—'}</b><small>matrículas conferidas</small></span></div>
  <div><Scale/><span><b>{liens.length?count(liens.reduce((sum,item)=>sum+Number(item.activeLiens),0)):'—'}</b><small>ônus vigentes</small></span></div>
 </div>
}

function Governance({generatedAt}){
 return <div className="business-decision-grid">
  <article><UserCheck/><span><small>DECISÃO HUMANA</small><b>O parecer de crédito é sempre de uma pessoa</b><em>Nada aqui aprova ou recusa crédito automaticamente.</em></span></article>
  <article><Scale/><span><small>SEM SCORE</small><b>Não existe nota de crédito</b><em>Cobertura e cenários são leitura da análise registrada no VAL Cred.</em></span></article>
  <article><ShieldCheck/><span><small>PRIVACIDADE</small><b>Documentos não são compartilhados</b><em>Sem CPF/CNPJ e sem documentos nesta leitura.</em></span></article>
  <article><History/><span><small>ORIGEM</small><b>VAL Cred</b><em>{date(generatedAt)?`Resumo gerado em ${date(generatedAt)}.`:'Data do resumo não informada.'}</em></span></article>
 </div>
}

/** Visão pura do JSON de GET /api/clients/:id/credit (sem busca), usada pelo cartão e pelos testes. */
export function CreditSummaryView({data,loading=false,error=''}){
 if(!loading&&!error&&(!data||data.status==='not_configured'))return null
 const status=data?.status
 const summary=status==='ok'?data.summary:null
 const events=Array.isArray(data?.events)?data.events:[]
 const requests=Array.isArray(summary?.requests)?summary.requests:[],properties=Array.isArray(summary?.properties)?summary.properties:[]
 const chip=loading&&!data?'Consultando o VAL Cred…':error?'Leitura indisponível':status==='ok'?(date(summary?.generatedAt)?`Lido em ${date(summary.generatedAt)}`:'Leitura atual'):status==='not_linked'?'Produtor não vinculado':status==='unavailable'?'VAL Cred indisponível agora':'Consultando o VAL Cred…'
 return <section className="credit-summary-card" aria-labelledby="credit-summary-title" style={{display:'grid',gap:'12px'}}>
  <article className="manual-business-sync">
   <header><div><span><Landmark/></span><div><small>VAL CRED • CRÉDITO RURAL</small><h4 id="credit-summary-title">Crédito no VAL Cred</h4><p>Leitura do que o VAL Cred registrou para este produtor. A decisão de crédito é humana; não há score nem aprovação automática.</p></div></div><em role="status">{chip}</em></header>
   {error&&<div className="form-error" role="alert" style={{margin:'14px 20px'}}>{error}</div>}
   {!error&&status==='not_linked'&&<p style={{...note,paddingTop:'16px'}}>Este produtor ainda não está vinculado no VAL Cred. O vínculo é feito pela chave do cliente quando o crédito é aberto lá.</p>}
   {!error&&status==='unavailable'&&<div className="form-error" role="alert" style={{margin:'14px 20px'}}>{data?.error||'O VAL Cred não respondeu agora.'}{events.length?' Os eventos já recebidos continuam abaixo.':''}</div>}
   {summary&&<>
    <Metrics summary={{...summary,requests,properties}}/>
    <h5 style={heading}>SOLICITAÇÕES</h5>
    {requests.length?<div className="manual-producer-summary">{requests.map((request,index)=><RequestItem key={request.id||index} request={request}/>)}</div>:<p style={{...note,paddingBottom:0}}>Nenhuma solicitação registrada.</p>}
    <h5 style={heading}>PROPRIEDADES</h5>
    {properties.length?<div className="manual-producer-summary">{properties.map((property,index)=><PropertyItem key={`${property.name}-${index}`} property={property}/>)}</div>:<p style={{...note,paddingBottom:0}}>Nenhuma propriedade registrada.</p>}
   </>}
   {data&&<>
    <h5 style={heading}>ÚLTIMOS EVENTOS RECEBIDOS DO VAL CRED</h5>
    {data.eventsAvailable===false?<p style={note}>Os eventos recebidos não puderam ser lidos agora.</p>
     :events.length?<div className="manual-producer-summary">{events.map((event,index)=><div key={event.id||index}><small>{date(event.occurredAt)||'DATA NÃO INFORMADA'}</small><b>{EVENT_LABEL[event.type]||'Evento do VAL Cred'}</b><span>{eventDetail(event)}</span></div>)}</div>
     :<p style={note}>Nenhum evento do VAL Cred recebido para este produtor.</p>}
   </>}
  </article>
  {summary&&<Governance generatedAt={summary.generatedAt}/>}
 </section>
}

export default function CreditSummaryCard({client,refreshToken=0}){
 const {state,run}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:12_000,timeoutMessage:'O VAL Cred demorou além do limite.',fallbackMessage:ERROR})
 useEffect(()=>{
  const clientId=client.id
  // O dado guarda de qual produtor veio: trocar de ficha nunca mostra o crédito do anterior.
  run(async({signal})=>({clientId,payload:await fetchJsonResource(`/api/clients/${encodeURIComponent(clientId)}/credit`,{signal,fallbackMessage:ERROR})}),{keepData:true})
 },[client.id,refreshToken,run])
 const data=state.data?.clientId===client.id?state.data.payload:null
 return <CreditSummaryView data={data} loading={state.loading} error={state.error}/>
}
