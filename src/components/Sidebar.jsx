import React from 'react'
import { LayoutDashboard, Users, CalendarDays, Target, Search, Sprout, FileBarChart, Settings, ClipboardList, DatabaseZap, ShieldCheck, Sparkles } from 'lucide-react'
import Logo from './Logo'
const primary=[
 ['dashboard','Hoje',LayoutDashboard],['clients','Clientes',Users],['visits','Visitas',CalendarDays],['opportunities','Oportunidades',Target],['copilot','VAL',Sparkles]
]
const secondary=[
 ['val','Análise avançada',Search],['datahub','Base Inteligente',DatabaseZap],['questionnaire','Coletar preferências',ClipboardList],
 ['agro','Ferramentas agronômicas',Sprout],['reports','Relatórios',FileBarChart],['settings','Configurações',Settings]
]
export default function Sidebar({page,setPage,currentUser,onOpenVal}){
 const account=currentUser?.email||'Ambiente demonstrativo'
 const initials=currentUser?.email?currentUser.email.split('@')[0].split(/[._-]/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'VA'
 const visibleSecondary=currentUser?.role==='admin'?[...secondary,['admin','Administração',ShieldCheck]]:secondary
 const secondaryActive=visibleSecondary.some(([id])=>id===page)
 return <aside className="sidebar">
  <Logo/>
  <nav aria-label="Jornada principal">{primary.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} aria-label={id==='copilot'?'Perguntar à VAL':undefined} onClick={()=>id==='copilot'?onOpenVal?.():setPage(id)}><span className="nav-icon"><Icon size={17}/></span><span>{label}</span></button>)}</nav>
  <details className="sidebar-support" open={secondaryActive||undefined}><summary><Search size={17}/><span>Mais recursos</span></summary><div>{visibleSecondary.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={17}/><span>{label}</span></button>)}</div></details>
  <div className="user-card"><div className="user-avatar">{initials}</div><div><strong>{account}</strong><small>{currentUser?.demo?'Modo demonstrativo':'Acesso protegido do piloto'}</small></div></div>
 </aside>
}
