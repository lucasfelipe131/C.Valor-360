import React from 'react'
import {Bell,BrainCircuit,CalendarDays,Search} from 'lucide-react'

export default function Topbar({title,subtitle,onNavigate}){
 const today=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','')
 return <header className="topbar">
  <div className="topbar-title"><span className="topbar-mobile-mark">C</span><div><h1>{title}</h1><p>{subtitle}</p></div></div>
  <div className="top-actions">
   <button className="val-shortcut" aria-label="Abrir a Val" onClick={()=>onNavigate?.('val')}><BrainCircuit/><span>Val ativa</span></button>
   <button className="icon-btn" aria-label="Buscar clientes" onClick={()=>onNavigate?.('clients')}><Search size={19}/></button>
   <button className="icon-btn" aria-label="Abrir relatórios e alertas" onClick={()=>onNavigate?.('reports')}><Bell size={19}/><span className="badge">3</span></button>
   <div className="date-pill"><CalendarDays size={16}/> Hoje, {today}</div>
  </div>
 </header>
}
