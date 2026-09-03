import React from 'react'
import {Bell,BrainCircuit,CalendarDays,Search} from 'lucide-react'
import Logo from './Logo'

export default function Topbar({title,subtitle,onNavigate,onOpenVal}){
 const today=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','')
 return <header className="topbar">
  <div className="topbar-title"><div className="topbar-mobile-logo"><Logo compact/></div><div><h1 tabIndex="-1">{title}</h1><p>{subtitle}</p></div></div>
  <div className="top-actions">
   <button type="button" className="val-shortcut" aria-label="Abrir a VAL" onClick={onOpenVal}><BrainCircuit/><span>Abrir a VAL</span></button>
   <button type="button" className="icon-btn" aria-label="Buscar clientes" onClick={()=>onNavigate?.('clients')}><Search size={19}/></button>
   <button type="button" className="icon-btn" aria-label="Abrir relatórios e alertas" onClick={()=>onNavigate?.('reports')}><Bell size={19}/></button>
   <time className="date-pill"><CalendarDays size={16}/> Hoje, {today}</time>
  </div>
 </header>
}
