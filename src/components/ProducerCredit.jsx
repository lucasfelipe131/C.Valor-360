import React,{useEffect,useState} from 'react'

const money=value=>value===null?'Não informado':Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Não informada'
const analysis={CURRENT_REVISION:'Análise da revisão atual',OUTDATED_REVISION:'Revisão alterada — requer nova análise',NOT_ANALYZED:'Sem análise registrada'}
export default function ProducerCredit({client}){
 const [resource,setResource]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false)
 const [producerId,setProducerId]=useState(''),[document,setDocument]=useState('')
 const endpoint=`/api/clients/${encodeURIComponent(client.id)}/credit`
 useEffect(()=>{
  const controller=new AbortController();setResource(null);setError('');setProducerId('');setDocument('')
  fetch(endpoint,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'A consulta de crédito não pôde ser concluída.');return data}).then(data=>{if(!controller.signal.aborted)setResource(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
  return()=>controller.abort()
 },[endpoint,revision])
 async function mutate(operation){
  setBusy(true);setError('')
  try{const response=await fetch(`${endpoint}/${operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({producerId,document})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível atualizar o vínculo.');setRevision(v=>v+1)}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="p360-card val-credit-panel"><header><div><small>VAL CRED</small><h3>Crédito rural</h3></div><button type="button" onClick={()=>setRevision(v=>v+1)} disabled={busy}>Atualizar</button></header>
  {error&&<p role="alert">{error}</p>}
  {!resource&&!error&&<p role="status">Consultando o cadastro de crédito…</p>}
  {resource?.applicationUrl&&<a href={resource.applicationUrl} target="_blank" rel="noreferrer">Abrir VAL CRED ↗</a>}
  {resource?.status==='NOT_CONFIGURED'&&<p>A conexão com a VAL CRED ainda não foi configurada.</p>}
  {resource?.status==='NOT_LINKED'&&<><p>Vincule o cadastro de {client.name} para consultar suas solicitações.</p>{resource.canLink?<form onSubmit={e=>{e.preventDefault();mutate('link')}} className="val-credit-link"><label>ID do produtor na VAL CRED<input value={producerId} onChange={e=>setProducerId(e.target.value)} required maxLength={180}/></label><label>CPF/CNPJ do mesmo cadastro<input value={document} onChange={e=>setDocument(e.target.value)} required inputMode="numeric" autoComplete="off" maxLength={18}/></label><button disabled={busy}>{busy?'Verificando…':'Verificar e vincular'}</button><small>Confira o nome e o documento do produtor nos dois cadastros. O vínculo libera a consulta para esta carteira.</small></form>:<p>Peça ao administrador para verificar o vínculo entre os cadastros.</p>}</>}
  {resource?.status==='LINKED'&&<><p>Cadastro vinculado: <strong>{resource.producer?.name}</strong></p><small>Consultado em {date(resource.fetchedAt)}</small>{!resource.requests.length&&<p>Nenhuma solicitação registrada neste cadastro.</p>}<div className="val-credit-requests">{resource.requests.map(r=><article key={r.id}><header><strong>{r.title}</strong><span>{r.status}</span></header><b>{money(r.principal)}</b><small>Valor solicitado · revisão {r.revision}</small><p>{analysis[r.analysisStatus]||'Análise a confirmar'}</p>{r.decision&&<p>Decisão registrada: {r.decision.value} · {date(r.decision.observedAt)}</p>}<small>Registro atualizado em {date(r.observedAt)}</small></article>)}</div><p className="val-credit-note">Solicitações e decisões registradas não comprovam liberação de recursos. Revise a operação na VAL CRED.</p>{resource.canLink&&<button disabled={busy} onClick={()=>{if(window.confirm('Remover o vínculo de crédito deste produtor nesta carteira?'))mutate('unlink')}}>Remover vínculo</button>}</>}
 </section>
}
