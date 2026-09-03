import React,{useEffect,useState} from 'react'
import {BrainCircuit,ChevronsLeft,ChevronsRight,LayoutDashboard} from 'lucide-react'
import Logo from './Logo'
import {WORKSPACES,workspaceModules,moduleLabel} from '../lib/val-workspaces'

const COLLAPSE_KEY='valor360-sidebar-collapsed'
const readCollapsed=()=>{try{return localStorage.getItem(COLLAPSE_KEY)==='1'}catch{return false}}

export default function Sidebar({page,setPage,currentUser,onOpenVal,workspace,onWorkspaceChange}){
 const [collapsed,setCollapsed]=useState(readCollapsed)
 useEffect(()=>{try{localStorage.setItem(COLLAPSE_KEY,collapsed?'1':'0')}catch{}},[collapsed])
 const account=currentUser?.email||'Ambiente demonstrativo'
 const initials=currentUser?.email?currentUser.email.split('@')[0].split(/[._-]/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'VA'
 const role=currentUser?.role
 const modules=workspace?workspaceModules(workspace,role):[]
 const activeSpace=WORKSPACES.find(item=>item.id===workspace)

 return <aside className={`sidebar val-workspace-sidebar${collapsed?' is-collapsed':''}`}>
  <div className="sidebar-brand">
   <Logo compact={collapsed}/>
   <button type="button" className="sidebar-collapse" aria-label={collapsed?'Expandir navegação':'Recolher navegação'} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>
    {collapsed?<ChevronsRight size={15}/>:<ChevronsLeft size={15}/>}
   </button>
  </div>

  <nav aria-label="Início">
   <button type="button" className={page==='dashboard'?'active':''} aria-current={page==='dashboard'?'page':undefined} title={collapsed?'Hoje':undefined} onClick={()=>setPage('dashboard')}>
    <span className="nav-icon"><LayoutDashboard size={17}/></span><span>Hoje</span>
   </button>
  </nav>

  <p className="sidebar-rail-title">Workspaces</p>
  <nav aria-label="Workspaces" className="workspace-rail">
   {WORKSPACES.map(({id,label,icon:Icon,hint})=>
    <button type="button" key={id} className={workspace===id?'active':''} aria-current={workspace===id?'true':undefined} title={collapsed?label:hint} onClick={()=>onWorkspaceChange?.(id)}>
     <span className="nav-icon"><Icon size={17}/></span><span>{label}</span>
    </button>
   )}
  </nav>

  {activeSpace&&modules.length>0&&<>
   <p className="sidebar-rail-title is-context">{activeSpace.label}</p>
   <nav aria-label={`Módulos de ${activeSpace.label}`} className="workspace-modules">
    {modules.map(({id,label,icon:Icon})=>
     <button type="button" key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined} title={collapsed?label:undefined} onClick={()=>setPage(id)}>
      <span className="nav-icon"><Icon size={16}/></span><span>{label}</span>
     </button>
    )}
   </nav>
  </>}

  <button type="button" className={`sidebar-copilot${page==='copilot'?' active':''}`} title={collapsed?moduleLabel('copilot'):undefined} onClick={()=>onOpenVal?.()}>
   <span className="nav-icon"><BrainCircuit size={17}/></span>
   <span><b>Copiloto VAL</b><small>Pergunte, explore, decida</small></span>
  </button>

  <div className="user-card"><div className="user-avatar">{initials}</div><div><strong>{account}</strong><small>{currentUser?.demo?'Modo demonstrativo':'Acesso protegido do piloto'}</small></div></div>
 </aside>
}
