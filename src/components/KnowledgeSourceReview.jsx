import React,{useCallback,useEffect,useState} from 'react'
import {BookCheck,CircleSlash,ExternalLink,LoaderCircle,RefreshCw,Search,ShieldCheck,Users} from 'lucide-react'
import {fetchJsonResource,requestJsonResource,useAsyncResource} from '../hooks/useAsyncResource'
import '../knowledge-source-review.css'

const queueApi='/api/v1/knowledge/source-requests'
const REVIEW_ROLES=['admin','technical_reviewer']
const statusLabels={DRAFT:'Na fila',UNDER_REVIEW:'Em revisão',APPROVED:'Aprovada',REJECTED:'Recusada',SUPERSEDED:'Substituída',EXPIRED:'Vencida'}
const reasonLabels={REGULATED_SOURCE_REQUIRED:'Exige fonte oficial',LIBRARY_NO_COVERAGE:'Sem cobertura no acervo'}
const emptySource={title:'',publisher:'',url:'',authority:'A',year:'',excerpt:'',accessed_at:'',valid_until:''}
const date=value=>{if(!value)return '—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleDateString('pt-BR')}
const regulated=request=>request?.reason==='REGULATED_SOURCE_REQUIRED'

export default function KnowledgeSourceReview({currentUser,onNotify}){
 const {data,loading,error,run,setError}=useAsyncResource({initialData:[],initialLoading:true,timeoutMs:10_000,timeoutMessage:'A consulta da fila demorou além do limite.',fallbackMessage:'Não foi possível carregar a fila de fontes.'})
 const [filter,setFilter]=useState('')
 const [openKey,setOpenKey]=useState('')
 const [source,setSource]=useState(emptySource)
 const [saving,setSaving]=useState(false)
 const [researchAvailable,setResearchAvailable]=useState(false)
 const [researchingKey,setResearchingKey]=useState('')
 const allowed=REVIEW_ROLES.includes(currentUser?.role)&&!currentUser?.demo
 const load=useCallback(()=>run(async({signal})=>{
  const payload=await fetchJsonResource(`${queueApi}${filter?`?status=${encodeURIComponent(filter)}`:''}`,{signal,fallbackMessage:'Não foi possível carregar a fila de fontes.'})
  setResearchAvailable(payload.research_available===true)
  return payload.requests||[]
 },{keepData:true}),[run,filter])
 useEffect(()=>{if(allowed)load()},[allowed,load])
 if(!allowed)return <section className="panel admin-denied"><ShieldCheck/><h2>Área restrita</h2><p>A revisão de fontes é da administração e da revisão técnica: aprovar uma fonte muda o que a VAL responde para a organização inteira.</p></section>
 const act=async(requestKey,payload,message)=>{
  setSaving(true);setError('')
  try{
   await requestJsonResource(`${queueApi}/${requestKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),timeoutMs:15_000,fallbackMessage:'Não foi possível atualizar o pedido.'})
   setOpenKey('');setSource(emptySource);await load();onNotify?.(message)
  }catch(exception){setError(exception.message)}finally{setSaving(false)}
 }
 const approve=(event,request)=>{
  event.preventDefault()
  const year=Number(source.year)
  act(request.request_key,{action:'approve',source:{...source,year:Number.isInteger(year)&&year>0?year:null,valid_until:source.valid_until||null}},'Fonte aprovada. A VAL passa a responder citando a origem.')
 }
 // A busca é paga e demora: fica visível qual pedido está pesquisando, e o botão não repete.
 const research=async request=>{
  setResearchingKey(request.request_key)
  try{await act(request.request_key,{action:'research'},request.candidates?.length?'Candidatas atualizadas.':'Pesquisa concluída. Abra a fonte e copie o trecho literal.')}
  finally{setResearchingKey('')}
 }
 const pickCandidate=(request,candidate)=>{
  setOpenKey(request.request_key)
  setSource({...emptySource,title:candidate.title,url:candidate.url,publisher:candidate.host,authority:'A',accessed_at:new Date().toISOString().slice(0,10)})
 }
 const reject=request=>{
  const reason=window.prompt('Por que esta dúvida não vira fonte aprovada?')
  if(reason?.trim())act(request.request_key,{action:'reject',reason:reason.trim()},'Pedido recusado com motivo registrado.')
 }
 const requests=data||[]
 return <section className="source-review" aria-labelledby="source-review-title">
  <div className="source-review-head">
   <div><span className="source-review-icon"><BookCheck/></span><div>
    <span className="eyebrow">CONHECIMENTO GOVERNADO</span>
    <h3 id="source-review-title">Dúvidas sem fonte aprovada</h3>
    <p>O que a VAL não respondeu chega aqui. Aprovar exige o endereço oficial e o trecho citado: a resposta entregue é o texto da fonte, e a responsabilidade técnica fica no seu nome.</p>
   </div></div>
   <div className="source-review-actions">
    <label className="source-review-filter">Situação<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="">Todas</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <button type="button" onClick={load} disabled={loading} aria-label="Atualizar fila">{loading?<LoaderCircle className="val-spinner"/>:<RefreshCw/>}Atualizar</button>
   </div>
  </div>
  {error&&<div className="form-error" role="alert">{error}</div>}
  {!loading&&!requests.length&&<div className="source-review-empty"><CircleSlash/><p>Nenhuma dúvida nesta situação. Quando a VAL não souber responder, a pergunta aparece aqui com o peso de quantos consultores perguntaram.</p></div>}
  <ul className="source-review-list">
   {requests.map(request=><li key={request.request_key} className={`source-review-card is-${request.status.toLowerCase()}`}>
    <header>
     <div><p className="source-review-question">{request.question}</p>
      <div className="source-review-tags">
       <span className={`source-review-reason ${regulated(request)?'is-regulated':''}`}>{reasonLabels[request.reason]||request.reason}</span>
       <span className="source-review-status">{statusLabels[request.status]||request.status}</span>
       <span className="source-review-weight" title="Quantas vezes foi perguntada e por quantos consultores"><Users size={14}/>{request.asked_count}× · {request.asked_by?.length||0} consultor(es)</span>
       <span className="source-review-domain">{request.domain}</span>
       <span className="source-review-date">Última vez em {date(request.last_asked_at)}</span>
      </div>
     </div>
    </header>
    {request.status==='APPROVED'&&request.source&&<div className="source-review-approved" role="status">
     <b>{request.source.title} — {request.source.publisher}</b>
     <a href={request.source.url} target="_blank" rel="noreferrer noopener">{request.source.url}</a>
     <blockquote>{request.source.excerpt}</blockquote>
     <small>Aprovada por {request.approved_by} em {date(request.approved_at)}{request.source.valid_until?` · vigente até ${date(request.source.valid_until)}`:''}</small>
    </div>}
    {request.status==='REJECTED'&&<p className="source-review-rejected" role="status">Recusada: {request.rejection_reason}</p>}
    {request.status!=='APPROVED'&&request.candidates?.length>0&&<div className="source-review-candidates">
     <small>Sugestões da pesquisa em {date(request.candidates_researched_at)} — abra a fonte, confira e copie o trecho literal. Nada daqui é mostrado ao consultor.</small>
     <ul>{request.candidates.map(candidate=><li key={candidate.url}>
      <a href={candidate.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={12}/>{candidate.title}<em>{candidate.host}</em></a>
      <button type="button" onClick={()=>pickCandidate(request,candidate)}>Usar esta fonte</button>
     </li>)}</ul>
    </div>}
    <footer>
     {request.status==='DRAFT'&&<button type="button" disabled={saving} onClick={()=>act(request.request_key,{action:'review'},'Pedido movido para revisão.')}>Assumir revisão</button>}
     {['UNDER_REVIEW','REJECTED','EXPIRED'].includes(request.status)&&<button type="button" className="primary-btn" disabled={saving} onClick={()=>{setOpenKey(openKey===request.request_key?'':request.request_key);setSource(emptySource)}}>{openKey===request.request_key?'Cancelar':'Anexar fonte oficial'}</button>}
     {researchAvailable&&request.status!=='APPROVED'&&request.status!=='SUPERSEDED'&&<button type="button" disabled={saving||Boolean(researchingKey)} onClick={()=>research(request)}>{researchingKey===request.request_key?<LoaderCircle className="val-spinner" size={13}/>:<Search size={13}/>}{request.candidates?.length?'Pesquisar de novo':'Pesquisar fontes oficiais'}</button>}
     {['DRAFT','UNDER_REVIEW'].includes(request.status)&&<button type="button" className="source-review-reject" disabled={saving} onClick={()=>reject(request)}>Recusar</button>}
    </footer>
    {openKey===request.request_key&&<form className="source-review-form" onSubmit={event=>approve(event,request)}>
     {regulated(request)&&<p className="source-review-hint">Assunto regulado: exige autoridade A, endereço oficial em https sob gov.br ou embrapa.br, o trecho citado e a data de consulta.</p>}
     <label>Título<input required value={source.title} onChange={event=>setSource(current=>({...current,title:event.target.value}))} placeholder="Ex.: Ficha do registro no AGROFIT"/></label>
     <label>Publicador<input required value={source.publisher} onChange={event=>setSource(current=>({...current,publisher:event.target.value}))} placeholder="Ex.: MAPA/AGROFIT"/></label>
     <label>Endereço<input required type="url" value={source.url} onChange={event=>setSource(current=>({...current,url:event.target.value}))} placeholder="https://…"/></label>
     <label>Autoridade<select value={source.authority} onChange={event=>setSource(current=>({...current,authority:event.target.value}))}><option value="A">A — oficial ou normativa</option><option value="B">B — institucional revisada</option><option value="C">C — técnica setorial</option><option value="D">D — apoio</option></select></label>
     <label>Ano<input type="number" min="1900" value={source.year} onChange={event=>setSource(current=>({...current,year:event.target.value}))}/></label>
     <label>Consultada em<input required={regulated(request)} type="date" value={source.accessed_at} onChange={event=>setSource(current=>({...current,accessed_at:event.target.value}))}/></label>
     <label>Vigente até<input type="date" value={source.valid_until} onChange={event=>setSource(current=>({...current,valid_until:event.target.value}))}/></label>
     <label className="source-review-excerpt">Trecho citado<textarea required={regulated(request)} rows={4} maxLength={2000} value={source.excerpt} onChange={event=>setSource(current=>({...current,excerpt:event.target.value}))} placeholder="Cole o trecho literal da fonte que responde a esta dúvida. É ele que a VAL vai entregar."/></label>
     <button className="primary-btn" disabled={saving}><ShieldCheck/>{saving?'Aprovando…':'Aprovar em meu nome'}</button>
    </form>}
   </li>)}
  </ul>
 </section>
}
