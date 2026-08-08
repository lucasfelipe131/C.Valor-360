import React from 'react'
import { LayoutDashboard, Users, DatabaseZap, BrainCircuit, ClipboardList } from 'lucide-react'
export default function MobileNav({page,setPage}){
 const items=[['dashboard','Hoje',LayoutDashboard],['clients','Clientes',Users],['datahub','Dados',DatabaseZap],['val','VAL',BrainCircuit],['questionnaire','Produtor',ClipboardList]]
 return <nav className="mobile-nav">{items.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
}
