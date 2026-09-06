import React,{useEffect,useState} from 'react'
import {BrainCircuit,ChevronsLeft,ChevronsRight,LayoutDashboard} from 'lucide-react'
import Logo from './Logo'
import {WORKSPACES,isNavItemActive,settingsModules,workspaceModules} from '../lib/val-workspaces'

// Sidebar da Mescla 09: marca, workspaces, subnavegação do workspace ativo,
// configurações sempre à mão e o Copiloto como atalho permanente no rodapé.

const COLLAPSE_KEY='valor360-sidebar-collapsed'
const readCollapsed=()=>{try{return localStorage.getItem(COLLAPSE_KEY)==='1'}catch{return false}}

export default function Sidebar({page,tool,currentUser,workspace,onWorkspaceChange,onSelect,onOpenVal}){
 const [collapsed,setCollapsed]=useState(readCollapsed)
 useEffect(()=>{try{localStorage.setItem(COLLAPSE_KEY,collapsed?'1':'0')}catch{}},[collapsed])
 const role=currentUser?.role
 const account=currentUser?.email||'Ambiente demonstrativo'
 const initials=currentUser?.email?currentUser.email.split('@')[0].split(/[._-]/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'VA'
 const modules=workspace?workspaceModules(workspace,role):[]
 const activeSpace=WORKSPACES.find(item=>item.id===workspace)
 const settings=settingsModules(role)

 const item=entry=>{
  const Icon=entry.icon
  const active=isNavItemActive(entry,{page,tool})
  return <button type="button" key={entry.id} className={active?'active':''} aria-current={active?'page':undefined} title={collapsed?entry.label:undefined} onClick={()=>onSelect?.(entry)}>
   <span className="nav-icon"><Icon size={16}/></span><span>{entry.label}</span>
  </button>
 }

 return <aside className={`sidebar val-workspace-sidebar${collapsed?' is-collapsed':''}`}>
  <div className="sidebar-brand">
   <Logo variant={collapsed?'icon-only':'full'}/>
   <button type="button" className="sidebar-collapse" aria-label={collapsed?'Expandir navegação':'Recolher navegação'} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>
    {collapsed?<ChevronsRight size={15}/>:<ChevronsLeft size={15}/>}
   </button>
  </div>

  <nav aria-label="Início" className="workspace-home">
   <button type="button" className={page==='dashboard'?'active':''} aria-current={page==='dashboard'?'page':undefined} title={collapsed?'Início':undefined} onClick={()=>onSelect?.({id:'dashboard',page:'dashboard'})}>
    <span className="nav-icon"><LayoutDashboard size={16}/></span><span>Início</span>
   </button>
  </nav>

  <p className="sidebar-rail-title">Workspaces</p>
  <nav aria-label="Workspaces" className="workspace-rail">
   {WORKSPACES.map(({id,label,icon:Icon,hint})=>{
    // Só um destino fica cheio por vez: em Início, o workspace continua
    // carregado abaixo, mas quem está ativo é Início.
    const here=workspace===id&&page!=='dashboard'
    return <button type="button" key={id} className={here?'active':workspace===id?'is-loaded':''} aria-current={here?'true':undefined} title={collapsed?label:hint} onClick={()=>onWorkspaceChange?.(id)}>
     <span className="nav-icon"><Icon size={16}/></span><span>{label}</span>
    </button>
   })}
  </nav>

  {activeSpace&&modules.length>0&&<>
   <p className="sidebar-rail-title is-context">{activeSpace.label}</p>
   <nav aria-label={`Módulos de ${activeSpace.label}`} className="workspace-modules">
    {modules.map(item)}
   </nav>
  </>}

  {settings.length>0&&<>
   <p className="sidebar-rail-title">Configurações</p>
   <nav aria-label="Configurações" className="workspace-settings">
    {settings.map(item)}
   </nav>
  </>}

  <div className="sidebar-foot">
   <div className="user-card"><div className="user-avatar">{initials}</div><div><strong>{account}</strong><small>{currentUser?.demo?'Modo demonstrativo':'Acesso protegido do piloto'}</small></div></div>
   <button type="button" className={`sidebar-copilot${page==='copilot'?' active':''}`} title={collapsed?'Acessar Copiloto':undefined} onClick={()=>onOpenVal?.()}>
    <span className="nav-icon"><BrainCircuit size={17}/></span>
    <span><b>Acessar Copiloto</b><small>Atalho rápido</small></span>
   </button>
  </div>
 </aside>
}
