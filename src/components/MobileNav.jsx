import React,{useEffect,useState} from 'react'
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ClipboardList,
  DatabaseZap,
  LayoutDashboard,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Sprout,
  Target,
  Users,
  X
} from 'lucide-react'

const primary=[
 ['dashboard','Hoje',LayoutDashboard],
 ['clients','Clientes',Users],
 ['val','Val',BrainCircuit],
 ['visits','Agenda',CalendarDays]
]

const secondary=[
 ['datahub','Base Inteligente',DatabaseZap],
 ['opportunities','Oportunidades',Target],
 ['agro','Inteligência Agronômica',Sprout],
 ['questionnaire','Produtor 360',ClipboardList],
 ['reports','Relatórios',BarChart3],
 ['settings','Configurações',Settings]
]

export default function MobileNav({page,setPage,currentUser}){
 const [open,setOpen]=useState(false)
 useEffect(()=>setOpen(false),[page])
 const navigate=id=>{setPage(id);setOpen(false)}
 const visibleSecondary=currentUser?.role==='admin'?[...secondary,['admin','Administração',ShieldCheck]]:secondary
 const secondaryActive=visibleSecondary.some(([id])=>id===page)
 return <>
  {open&&<><button type="button" className="mobile-more-backdrop" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>
  <section className="mobile-more-sheet open" aria-label="Todos os módulos">
   <header><div><small>VALOR 360</small><h2>Todos os módulos</h2></div><button type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}><X/></button></header>
   <div>{visibleSecondary.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><span><Icon/></span><b>{label}</b></button>)}</div>
  </section></>}
  <nav className="mobile-nav" aria-label="Navegação principal">
   {primary.slice(0,2).map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon/><span>{label}</span></button>)}
   <button type="button" className={`mobile-val-button ${page==='val'?'active':''}`} onClick={()=>navigate('val')} aria-label="Abrir a Val" aria-current={page==='val'?'page':undefined}><span><BrainCircuit/></span><b>Val</b></button>
   {primary.slice(3).map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon/><span>{label}</span></button>)}
   <button type="button" className={secondaryActive||open?'active':''} onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label="Abrir todos os módulos"><MoreHorizontal/><span>Mais</span></button>
  </nav>
 </>
}
