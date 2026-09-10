import React,{useEffect,useState} from 'react'
import {Download,FileText,RefreshCw,Wheat} from 'lucide-react'
import {attachmentContentUrl,attachmentMatchesBrowserScope} from '../lib/attachment-browser-scope'
import {formatNumber,isDemoRecord,scopedRecords} from '../lib/producer-display'
function useResource(url){
 const [attempt,retry]=useState(0),[state,setState]=useState({status:'loading',data:null,error:''})
 useEffect(()=>{
  const controller=new AbortController();setState({status:'loading',data:null,error:''})
  const timeout=setTimeout(()=>controller.abort('timeout'),15000)
  fetch(url,{signal:controller.signal}).then(async response=>{if(response.status===401)window.dispatchEvent(new Event('valor360:unauthorized'));const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível carregar os registros.');return data}).then(data=>{if(!controller.signal.aborted)setState({status:'ready',data,error:''})}).catch(error=>{if(!controller.signal.aborted||controller.signal.reason==='timeout')setState({status:'error',data:null,error:controller.signal.reason==='timeout'?'A consulta demorou demais. Tente novamente.':error.message})}).finally(()=>clearTimeout(timeout))
  return()=>{clearTimeout(timeout);controller.abort()}
 },[url,attempt])
 return {...state,retry:()=>retry(value=>value+1)}
}
function ResourceState({state,empty,children}){
 if(state.status==='loading')return <div className="p360-resource-loading" role="status" aria-label="Carregando registros"><span className="p360-skeleton"/><span className="p360-skeleton"/><span className="p360-skeleton"/></div>
 if(state.status==='error')return <div className="p360-empty" role="alert"><p>{state.error}</p><button onClick={state.retry}><RefreshCw size={16}/>Tentar novamente</button></div>
 return empty?<div className="p360-empty"><p>{empty}</p></div>:children
}
const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'Não informado'
export function ProducerDocuments({client,onAsk}){
 const state=useResource(`/api/val/attachments?clientId=${encodeURIComponent(client.id)}&limit=200`)
 const items=(state.data?.attachments||[]).filter(item=>attachmentMatchesBrowserScope(item,{clientId:client.id})&&(isDemoRecord(client)||!isDemoRecord(item))&&item.status!=='rejected')
 const [query,setQuery]=useState('')
 const visible=items.filter(item=>String(item.originalName||'').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
 // A rota devolve o acervo inteiro em `total`. Sem dizer isso, a lista mostrava os 200 mais recentes
 // como se fossem todos os documentos do produtor.
 const total=Number(state.data?.total)||items.length
 const hidden=Math.max(0,total-items.length)
 return <section className="p360-card"><header><h3>Documentos do produtor</h3><button onClick={()=>onAsk?.({capture:'file'})}>Anexar documento</button></header>{hidden>0&&<p className="p360-source-note" role="status">Mostrando os {items.length} documentos mais recentes de {total}. Os {hidden} mais antigos ficam na galeria de fotos do produtor ou podem ser buscados pelo nome.</p>}<label className="p360-filter">Buscar documento<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nome do arquivo"/></label><ResourceState state={state} empty={!visible.length?(query?'Nenhum documento encontrado':'Nenhum documento cadastrado'):''}><ul className="p360-document-list">{visible.map(item=>{let url;try{url=attachmentContentUrl(item,{clientId:client.id})}catch{return null}return <li key={item.id}><FileText size={22}/><div><b>{item.originalName}</b><small>{date(item.createdAt)} • {item.status==='confirmed'?'Evidência confirmada':'Documento recebido'}{isDemoRecord(client)?' • Demonstrativo':''}</small></div><a href={url} target="_blank" rel="noreferrer" aria-label={`Abrir ${item.originalName}`}><Download size={17}/>Abrir</a></li>})}</ul></ResourceState></section>
}
export function ProducerGrains({client,onAsk}){
 const state=useResource('/api/grains/bootstrap')
 const intentions=scopedRecords(state.data?.intentions,client)
 const profiles=scopedRecords(state.data?.profiles,client)
 return <section className="p360-card"><header><h3>Grãos • registros do produtor</h3><button onClick={()=>onAsk?.({prompt:'Quais oportunidades de grãos deste produtor possuem evidências atuais?'})}>Consultar a VAL</button></header><ResourceState state={state} empty={!intentions.length&&!profiles.length?'Nenhuma intenção de venda ou perfil de grãos registrado':''}>
 {profiles.map(profile=><div className="p360-grain-profile" key={profile.id}><Wheat/><div><b>{(profile.commodities||[]).join(', ')||'Culturas não informadas'}</b><p>{profile.marketingNotes||'Estratégia de comercialização não informada'}</p><small>Origem: {profile.sourceDetails||profile.source||'Não informada'} • {date(profile.observedAt)}</small></div></div>)}
 <div className="p360-table-scroll"><table className="p360-table"><thead><tr><th>Cultura / safra</th><th>Intenção</th><th>Volume</th><th>Preço-alvo</th><th>Situação</th></tr></thead><tbody>{intentions.map(item=><tr key={item.id}><td>{item.commodity}<small>{item.season||'Safra não informada'}</small></td><td>{item.direction==='sell'?'Venda':item.direction==='buy'?'Compra':item.direction}</td><td>{formatNumber(item.volume)} {item.volumeUnit}</td><td>{formatNumber(item.targetPrice)} {item.priceUnit}</td><td>{{draft:'Rascunho',monitoring:'Em acompanhamento',confirmed:'Confirmada',negotiating:'Em negociação',closed:'Encerrada',cancelled:'Cancelada'}[item.status]||item.status}<small>{date(item.observedAt)}</small></td></tr>)}</tbody></table></div>
 <p className="p360-source-note">Intenções registradas não comprovam venda ou entrega. O saldo disponível depende de produção e movimentações conciliadas.</p>
 </ResourceState></section>
}
