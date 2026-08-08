import React,{useState} from 'react'
import { Search, ChevronRight, MapPin, Sprout, Star, MessageCircle } from 'lucide-react'
export default function Clients({clients,onClient,onNew}){
 const [q,setQ]=useState('')
 const list=clients.filter(c=>(c.name+c.municipality+c.cultures).toLowerCase().includes(q.toLowerCase()))
 return <div className="page-stack">
  <div className="search-row"><div className="search-box"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar produtor, município ou cultura..."/></div><button className="primary-btn" onClick={onNew}>+ Novo cliente</button></div>
  <div className="list-summary"><span><b>{list.length}</b> produtores encontrados</span><span>Carteira piloto • São Luiz Gonzaga/RS</span></div>
  <section className="client-grid">{list.map(c=><article className="client-card" key={c.id} onClick={()=>onClient(c)}>
   <div className="client-top"><div className="initials">{c.name.split(' ').slice(0,2).map(x=>x[0]).join('')}</div><div className="client-pills"><span className="profile-pill">{c.primaryProfile}</span>{c.commercial?.score!==undefined&&<span className="ai-score-pill">VAL {c.commercial.score}</span>}</div></div>
   <h3>{c.name}</h3><p><MapPin size={14}/>{c.municipality}</p><p><Sprout size={14}/>{c.cultures}</p>
   <div className="client-stats"><span><b>{c.irt}</b><small>IRT</small></span><span><b>{c.nps}</b><small>NPS</small></span><span><b>{c.commercial?.potentialValidated===false?c.commercial?.score||0:`R$ ${Math.round((c.commercial?.potential||0)/1000)}k`}</b><small>{c.commercial?.potentialValidated===false?'Índice':'Potencial'}</small></span></div>
   <div className="client-footer"><span><MessageCircle size={14}/>{c.commercial?.score!==undefined?c.commercial.opportunity:(c.servicePreference||'Preferência a registrar')}</span><ChevronRight size={18}/></div>
  </article>)}</section>
 </div>
}
