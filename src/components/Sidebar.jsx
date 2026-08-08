import React from 'react'
import { LayoutDashboard, Users, CalendarDays, Target, BrainCircuit, Sprout, FileBarChart, Settings, ClipboardList, DatabaseZap } from 'lucide-react'
import Logo from './Logo'
const items=[
 ['dashboard','Dashboard',LayoutDashboard],['clients','Clientes',Users],['datahub','Base Inteligente',DatabaseZap],['visits','Visitas',CalendarDays],
 ['opportunities','Oportunidades',Target],['val','Inteligência (VAL)',BrainCircuit],
 ['agro','Inteligência Agronômica',Sprout],['questionnaire','Produtor 360',ClipboardList],
 ['reports','Relatórios',FileBarChart],['settings','Configurações',Settings]
]
export default function Sidebar({page,setPage}){
 return <aside className="sidebar">
  <Logo/>
  <nav>{items.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
  <div className="user-card"><div className="user-avatar">LF</div><div><strong>Lucas Felipe</strong><small>Eng. Agrônomo • RT</small></div></div>
 </aside>
}
