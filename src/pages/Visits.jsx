import React,{useMemo,useState} from 'react'
import {BrainCircuit,CalendarPlus,Clock3,MapPin,Route,Save,Sparkles} from 'lucide-react'

const today=()=>{
 const date=new Date();const offset=date.getTimezoneOffset()*60_000
 return new Date(date.getTime()-offset).toISOString().slice(0,10)
}
const visitDate=visit=>visit.scheduledAt?new Date(visit.scheduledAt):new Date(`${visit.date}T${visit.time||'12:00'}:00`)
const pretty=visit=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(visitDate(visit))
const time=visit=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(visitDate(visit))

export default function Visits({clients,visits,onSave,onPrepare}){
 const [showForm,setShowForm]=useState(false)
 const [form,setForm]=useState({clientId:clients[0]?.id||'',date:today(),time:'14:00',objective:''})
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const {ordered,upcoming}=useMemo(()=>{
  const scheduled=[...visits].sort((a,b)=>visitDate(a)-visitDate(b))
  const future=scheduled.filter(visit=>visitDate(visit).getTime()>=Date.now()&&!/^(realizada|cancelada)$/i.test(String(visit.status||'')))
  const history=scheduled.filter(visit=>!future.includes(visit)).reverse()
  return {ordered:[...future,...history],upcoming:future}
 },[visits])
 const formValid=Boolean(form.clientId&&form.date&&form.time&&form.objective.trim())
 const save=async e=>{
  e.preventDefault()
  if(!formValid){setError('Preencha produtor, data, horário e objetivo antes de salvar.');return}
  setSaving(true);setError('')
  try{await onSave?.({clientId:form.clientId,scheduledAt:new Date(`${form.date}T${form.time}:00`).toISOString(),objective:form.objective.trim()});setShowForm(false);setForm({...form,objective:''})}catch(exception){setError(exception.message||'Não foi possível salvar a visita.')}finally{setSaving(false)}
 }
 const clientOf=id=>clients.find(c=>c.id===id)
 return <div className="page-stack">
  <section className="module-hero visits-hero"><div><span className="eyebrow">ROTEIRO COMERCIAL</span><h2>Visitas com intenção e próximo compromisso.</h2><p>Organize a agenda, prepare a abordagem com a VAL e registre o resultado de cada conversa.</p></div><button className="primary-btn" onClick={()=>setShowForm(v=>!v)}><CalendarPlus size={17}/>{showForm?'Fechar':'Nova visita'}</button></section>
  {showForm&&<form className="panel visit-form" onSubmit={save}><div className="panel-head"><div><span className="eyebrow">NOVO COMPROMISSO</span><h3>Agendar visita</h3></div></div><div className="form-grid"><label>Produtor<select required disabled={!clients.length} value={form.clientId} onChange={e=>{setError('');setForm({...form,clientId:e.target.value})}}><option value="">Selecione um produtor</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Data<input required min={today()} type="date" value={form.date} onChange={e=>{setError('');setForm({...form,date:e.target.value})}}/></label><label>Horário<input required type="time" value={form.time} onChange={e=>{setError('');setForm({...form,time:e.target.value})}}/></label><label>Objetivo da visita<input required value={form.objective} onChange={e=>{setError('');setForm({...form,objective:e.target.value})}} placeholder="Ex.: quantificar a perda e combinar área teste"/></label></div>{error&&<div className="form-error" role="alert">{error}</div>}<button className="primary-btn" type="submit" disabled={saving||!formValid}><Save size={16}/>{saving?'Salvando no sistema…':'Salvar na agenda'}</button></form>}
  <section className="visits-layout">
   <article className="panel route-card"><div className="panel-head"><div><span className="eyebrow">PRÓXIMA ROTA</span><h3>Agenda priorizada</h3></div><Route size={22}/></div><div className="route-visual"><span className="route-road"></span>{upcoming.slice(0,3).map((visit,index)=><div className={`route-stop rs${index+1}`} key={visit.id}><b>{index+1}</b><span>{clientOf(visit.clientId)?.municipality||'Região'}</span></div>)}</div><div className="route-summary"><Sparkles size={17}/><span>{upcoming.length?'A VAL sugere começar pelo maior potencial e terminar próximo à unidade.':'Nenhum compromisso futuro registrado. Agende uma visita para montar a próxima rota.'}</span></div></article>
   <div className="visit-list">{ordered.map((visit,index)=>{const client=clientOf(visit.clientId);return <article className="panel visit-card" key={visit.id}><div className="visit-date"><b>{pretty(visit)}</b><span>{time(visit)}</span></div><div className="visit-body"><div className="visit-card-head"><div><span className="status-pill">{visit.status}</span><h3>{client?.name||'Produtor'}</h3></div><span className="visit-order">#{String(index+1).padStart(2,'0')}</span></div><p><MapPin size={14}/>{client?.commercial?.property||client?.municipality}</p><div className="visit-objective"><small>OBJETIVO</small><b>{visit.objective}</b></div><button className="soft-btn" onClick={()=>onPrepare(client)}><BrainCircuit size={16}/>Preparar com a VAL</button></div></article>})}</div>
  </section>
 </div>
}
