import React from 'react'
import { LayoutDashboard, Users, CalendarDays, Target, BrainCircuit, Sprout, FileBarChart, Settings, ClipboardList, DatabaseZap } from 'lucide-react'
import Logo from './Logo'
const items=[
 ['dashboard','Dashboard',LayoutDashboard],['clients','Clientes',Users],['datahub','Base Inteligente',DatabaseZap],['visits','Visitas',CalendarDays],
 ['opportunities','Oportunidades',Target],['val','Inteligência (VAL)',BrainCircuit],
 ['agro','Inteligência Agronômica',Sprout],['questionnaire','Produtor 360',ClipboardList],
 ['reports','Relatórios',FileBarChart],['settings','Configurações',Settings]
]
export default function Sidebar({page,setPage,currentUser}){
 const account=currentUser?.email||'Ambiente demonstrativo'
 const initials=currentUser?.email?currentUser.email.split('@')[0].split(/[._-]/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'VA'
 return <aside className="sidebar">
  <Logo/>
  <nav aria-label="Módulos">{items.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
  <div className="user-card"><div className="user-avatar">{initials}</div><div><strong>{account}</strong><small>{currentUser?.demo?'Modo demonstrativo':'Acesso protegido do piloto'}</small></div></div>
 </aside>
}
