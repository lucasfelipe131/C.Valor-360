import React,{useEffect,useState} from 'react'
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ClipboardList,
  DatabaseZap,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  Sprout,
  Target,
  Users,
  X
} from 'lucide-react'

const primary=[
 ['clients','Clientes',Users],
 ['visits','Visitas',CalendarDays]
]

const secondary=[
 ['opportunities','Oportunidades',Target],
 ['val','Análise avançada',Search],
 ['datahub','Base Inteligente',DatabaseZap],
 ['questionnaire','Coletar preferências',ClipboardList],
 ['agro','Ferramentas agronômicas',Sprout],
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
  <section className="mobile-more-sheet open" aria-label="Ações e módulos">
   <header><div><small>VAL</small><h2>Ações e módulos</h2></div><button type="button" aria-label="Fechar menu" onClick={()=>setOpen(false)}><X/></button></header>
   <div>{visibleSecondary.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><span><Icon/></span><b>{label}</b></button>)}</div>
  </section></>}
  <nav className="mobile-nav" aria-label="Navegação principal">
   {primary.map(([id,label,Icon])=><button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon/><span>{label}</span></button>)}
   <button type="button" className={`mobile-val-button ${page==='dashboard'?'active':''}`} onClick={()=>navigate('dashboard')} aria-label="Abrir a VAL" aria-current={page==='dashboard'?'page':undefined}><span><BrainCircuit/></span><b>VAL</b></button>
   <button type="button" className={secondaryActive||open?'active':''} onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-label="Abrir ações e módulos"><MoreHorizontal/><span>Mais</span></button>
  </nav>
 </>
}
