import React from 'react'
import { LayoutDashboard, Users, CalendarDays, BrainCircuit, Menu } from 'lucide-react'
export default function MobileNav({page,setPage}){
 const items=[['dashboard','Hoje',LayoutDashboard],['clients','Clientes',Users],['visits','Visitas',CalendarDays],['val','VAL',BrainCircuit],['more','Mais',Menu]]
 return <nav className="mobile-nav">{items.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id==='more'?'agro':id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
}
