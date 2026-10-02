import React,{useCallback,useEffect,useRef,useState} from 'react'
import {Activity,ArrowLeft,ArrowRight,CheckCircle2,Link2,RefreshCw,ShieldCheck} from 'lucide-react'
import './IntegrationHub.css'

const labels={PROCESSED:'Processado',OLDER:'Versão anterior',DUPLICATE:'Reenvio sem alteração',CONFLICT:'Conflito',REVIEW_REQUIRED:'Revisão necessária',REJECTED:'Rejeitado',FAILED:'Falha',RECEIVED:'Recebido',RETRY_REQUESTED:'Nova tentativa solicitada',IDENTITY_RECHECK:'Vínculo reavaliado',NEWER:'Versão mais recente',HEALTHY:'Saudável',ATTENTION:'Requer atenção',DEGRADED:'Com falhas',NO_EVENTS:'Aguardando eventos'}
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Ainda não registrada'
const messages={hub_identity_ambiguous:'Há mais de um produtor compatível. Confira as chaves no Manual antes de reenviar.',hub_identity_unresolved:'O produtor não foi identificado nesta carteira. Confira a chave de origem.',hub_identity_name_collision:'Já existe um produtor com este nome. Informe a chave do cadastro existente.',hub_canonical_data_conflict:'O conteúdo diverge de uma informação mantida na VAL. Revise na origem antes de reenviar.',hub_version_conflict:'A mesma versão contém informações diferentes. Revise na origem.',hub_external_id_content_conflict:'O identificador foi reenviado com outro conteúdo. O original foi preservado.',hub_approved_data_conflict:'Um dado validado não pode ser substituído por conteúdo sem aprovação.',hub_producer_archived:'O produtor está arquivado. Nenhum dado foi alterado.',hub_retry_backoff:'Aguarde o horário da próxima tentativa.',hub_retry_not_eligible:'Este evento não permite nova tentativa.'}
async function request(path,options){
 const response=await fetch(`/api/integration-hub/${path}`,{credentials:'same-origin',...options})
 const payload=await response.json()
 if(!response.ok)throw new Error(messages[payload.code]||payload.error||'Não foi possível consultar o Hub.')
 return payload
}
export default function IntegrationHub(){
 const [data,setData]=useState(null),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const detailSequence=useRef(0)
 const load=useCallback(async signal=>{
  setBusy(true);setError('')
  try{setData(await request(`overview?status=${encodeURIComponent(status)}&offset=${offset}`,{signal}))}
  catch(exception){if(exception.name!=='AbortError')setError(exception.message)}
  finally{if(!signal?.aborted)setBusy(false)}
 },[status,offset])
 useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort()},[load])
 async function inspect(id){
  const sequence=++detailSequence.current;setError('');setDetail(null)
  try{const result=await request(`events/${id}`);if(sequence===detailSequence.current)setDetail(result)}catch(exception){setError(exception.message)}
 }
 async function retry(id){
  setBusy(true);setError('');setNotice('')
  try{const result=await request(`events/${id}/retry`,{method:'POST'});setNotice(`Nova tentativa: ${labels[result.status]||result.status}.`);await load();await inspect(id)}
  catch(exception){setError(exception.message)}finally{setBusy(false)}
 }
 const metrics=data?.connectors?.reduce((sum,item)=>({processed:sum.processed+item.metrics.processed,review:sum.review+item.metrics.review+item.metrics.conflicts,rejected:sum.rejected+item.metrics.rejected,failures:sum.failures+item.metrics.failures}),{processed:0,review:0,rejected:0,failures:0})
 return <div className="page-stack integration-hub">
  <section className="panel hub-intro"><div><span className="eyebrow">VAL • HUB DE DADOS</span><h2>Integrações com origem e histórico.</h2><p>Acompanhe os dados que chegam à sua carteira e os eventos que precisam de atenção.</p><span className="hub-scope"><ShieldCheck size={16}/>Somente dados do seu acesso</span></div><button className="ghost-btn" disabled={busy} onClick={()=>load()}><RefreshCw size={17}/>{busy?'Atualizando…':'Atualizar'}</button></section>
  {error&&<div role="alert" className="form-error">{error}</div>}
  {notice&&<p role="status">{notice}</p>}
  {!data&&busy&&<p role="status">Consultando integrações…</p>}
  {metrics&&<div className="hub-metrics">{[['Processados',metrics.processed],['Em revisão',metrics.review],['Rejeitados',metrics.rejected],['Falhas',metrics.failures]].map(([label,value])=><article className="panel" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>}
  <section aria-label="Conectores" className="hub-connectors">{data?.connectors.map(connector=><article key={connector.id} className="panel hub-connector"><div className="panel-head"><div><span className="eyebrow">CONECTOR OFICIAL</span><h3><Link2 size={20}/>{connector.name}</h3></div><span className={`hub-status hub-${connector.health.toLowerCase()}`}><Activity size={14}/>{labels[connector.health]}</span></div><p>Produtores, registros e resultados agronômicos vinculados aos módulos existentes da VAL.</p><dl><div><dt>Última sincronização concluída</dt><dd>{date(connector.metrics.last_sync)}</dd></div><div><dt>Último evento recebido</dt><dd>{date(connector.metrics.last_received)}</dd></div><div><dt>Tempo médio de processamento</dt><dd>{connector.metrics.latency_ms===null?'Sem medição':`${connector.metrics.latency_ms} ms`}</dd></div><div><dt>Novas tentativas</dt><dd>{connector.metrics.retries}</dd></div></dl><details><summary>Eventos suportados</summary><ul>{connector.events.map(event=><li key={event}>{event}</li>)}</ul></details></article>)}</section>
  {data&&<section className="panel hub-events"><div className="panel-head"><div><span className="eyebrow">RASTREABILIDADE</span><h3>Eventos recebidos</h3></div><label>Filtrar por estado<select value={status} onChange={event=>{setOffset(0);setStatus(event.target.value);setDetail(null)}}><option value="">Todos</option>{['PROCESSED','REVIEW_REQUIRED','REJECTED','FAILED','OLDER','DUPLICATE'].map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label></div>
   {!data.events.length?<div className="hub-empty"><CheckCircle2/><h4>Nenhum evento nesta consulta.</h4><p>As sincronizações recebidas do Manual aparecerão aqui, com origem, vínculo e histórico.</p></div>:<div className="table-scroll"><table><thead><tr><th>Recebido em</th><th>Evento / origem</th><th>Produtor vinculado</th><th>Estado</th><th>Detalhes</th></tr></thead><tbody>{data.events.map(event=><tr key={event.id}><td>{date(event.receivedAt)}</td><td><strong>{event.eventType}</strong><small>{event.source}</small></td><td>{event.clientName||'Sem vínculo canônico'}</td><td><span className={`hub-status hub-${event.status.toLowerCase()}`}>{labels[event.status]||event.status}</span>{event.reviewRequired&&<small>Reenvio em conflito</small>}</td><td><button className="ghost-btn" onClick={()=>inspect(event.id)} aria-label={`Ver histórico do evento ${event.externalId}`}>Ver histórico</button></td></tr>)}</tbody></table></div>}
   <div className="hub-pagination"><button className="ghost-btn" disabled={!offset||busy} onClick={()=>setOffset(Math.max(0,offset-50))}><ArrowLeft size={16}/>Anterior</button><span>Página {Math.floor(offset/50)+1}</span><button className="ghost-btn" disabled={!data.pagination.hasMore||busy} onClick={()=>setOffset(offset+50)}>Próxima<ArrowRight size={16}/></button></div>
  </section>}
  {detail&&<section className="panel hub-detail" aria-label="Histórico do evento"><div className="panel-head"><h3>Origem e histórico</h3><button className="ghost-btn" onClick={()=>{++detailSequence.current;setDetail(null)}}>Fechar histórico</button></div><dl>{[['Origem',detail.provenance.source],['Evento de origem',detail.provenance.sourceEvent],['Entidade externa',detail.event.externalEntityId||detail.provenance.clientExternalKey],['Produtor VAL',detail.event.clientName||'Sem vínculo'],['Observado em',date(detail.provenance.observedAt)],['Recebido em',date(detail.provenance.receivedAt)],['Versão de origem',detail.event.sourceVersion??'Não informada'],['Tentativas',detail.event.attempts],['Tempo de processamento',detail.event.latencyMs===null?'Sem medição':`${detail.event.latencyMs} ms`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Não informado'}</dd></div>)}</dl>
   {detail.event.errorCode&&<p role="status">{messages[detail.event.errorCode]||'A sincronização encontrou um erro. Confira o registro na origem.'} <small>Código: {detail.event.errorCode}</small></p>}
   {detail.event.retryEligible&&<div className="hub-retry"><p>Nova tentativa disponível a partir de {date(detail.event.nextRetryAt)}.</p><button className="primary-btn" disabled={busy||new Date(detail.event.nextRetryAt)>new Date()} onClick={()=>retry(detail.event.id)}>Tentar novamente</button></div>}
   <ol className="hub-audit">{detail.audit.map(entry=><li key={entry.id}><strong>{labels[entry.action]||entry.action}</strong><span>{date(entry.created_at)} • tentativa {entry.attempt}</span>{entry.error_code&&<small>{messages[entry.error_code]||entry.error_code}</small>}</li>)}</ol>
   {!detail.audit.length&&<p>Evento anterior à implantação do Hub. O registro original foi preservado.</p>}
  </section>}
 </div>
}
