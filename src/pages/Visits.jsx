import React,{useMemo,useState} from 'react'
import {BrainCircuit,CalendarPlus,Clock3,MapPin,Route,Save,Sparkles} from 'lucide-react'

const today='2026-08-08'
const pretty=date=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(`${date}T12:00:00`))

export default function Visits({clients,visits,setVisits,onPrepare,onSaved}){
 const [showForm,setShowForm]=useState(false)
 const [form,setForm]=useState({clientId:clients[0]?.id||'',date:today,time:'14:00',objective:''})
 const ordered=useMemo(()=>[...visits].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),[visits])
 const save=e=>{
  e.preventDefault();if(!form.clientId||!form.date||!form.objective)return
  setVisits([...visits,{...form,id:`v-${Date.now()}`,status:'Agendada'}]);setShowForm(false);setForm({...form,objective:''});onSaved?.()
 }
 const clientOf=id=>clients.find(c=>c.id===id)
 return <div className="page-stack">
  <section className="module-hero visits-hero"><div><span className="eyebrow">ROTEIRO COMERCIAL</span><h2>Visitas com intenção e próximo compromisso.</h2><p>Organize a agenda, prepare a abordagem com a VAL e registre o resultado de cada conversa.</p></div><button className="primary-btn" onClick={()=>setShowForm(v=>!v)}><CalendarPlus size={17}/>{showForm?'Fechar':'Nova visita'}</button></section>
  {showForm&&<form className="panel visit-form" onSubmit={save}><div className="panel-head"><div><span className="eyebrow">NOVO COMPROMISSO</span><h3>Agendar visita</h3></div></div><div className="form-grid"><label>Produtor<select value={form.clientId} onChange={e=>setForm({...form,clientId:e.target.value})}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Data<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>Horário<input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></label><label>Objetivo da visita<input value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})} placeholder="Ex.: quantificar a perda e combinar área teste"/></label></div><button className="primary-btn" type="submit"><Save size={16}/>Salvar na agenda</button></form>}
  <section className="visits-layout">
   <article className="panel route-card"><div className="panel-head"><div><span className="eyebrow">PRÓXIMA ROTA</span><h3>Agenda priorizada</h3></div><Route size={22}/></div><div className="route-visual"><span className="route-road"></span>{ordered.slice(0,3).map((visit,index)=><div className={`route-stop rs${index+1}`} key={visit.id}><b>{index+1}</b><span>{clientOf(visit.clientId)?.municipality||'Região'}</span></div>)}</div><div className="route-summary"><Sparkles size={17}/><span>A VAL sugere começar pelo maior potencial e terminar próximo à unidade.</span></div></article>
   <div className="visit-list">{ordered.map((visit,index)=>{const client=clientOf(visit.clientId);return <article className="panel visit-card" key={visit.id}><div className="visit-date"><b>{pretty(visit.date)}</b><span>{visit.time}</span></div><div className="visit-body"><div className="visit-card-head"><div><span className="status-pill">{visit.status}</span><h3>{client?.name||'Produtor'}</h3></div><span className="visit-order">#{String(index+1).padStart(2,'0')}</span></div><p><MapPin size={14}/>{client?.commercial?.property||client?.municipality}</p><div className="visit-objective"><small>OBJETIVO</small><b>{visit.objective}</b></div><button className="soft-btn" onClick={()=>onPrepare(client)}><BrainCircuit size={16}/>Preparar com a VAL</button></div></article>})}</div>
  </section>
 </div>
}
