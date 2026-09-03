import React,{useEffect,useState} from 'react'
import {BrainCircuit,CalendarPlus,ClipboardList,Home,MoreHorizontal,Plus,Target,Users,X} from 'lucide-react'
import {WORKSPACES,isNavItemActive,settingsModules,workspaceModules} from '../lib/val-workspaces'

// Mobile não é desktop encolhido. A barra carrega o que o agrônomo faz em
// campo — hoje, produtor, registrar, copiloto — e o "Mais" abre o mesmo modelo
// de workspaces da sidebar, sem lista paralela.

const quickActions=[
 [{id:'visits',page:'visits'},'Agendar visita','Abre a agenda para criar o compromisso',CalendarPlus],
 [{id:'questionnaire',page:'questionnaire'},'Novo produtor','Coleta as preferências e compila o perfil',ClipboardList],
 [{id:'opportunities',page:'opportunities'},'Nova oportunidade','Registra a hipótese no funil',Target]
]

export default function MobileNav({page,tool,currentUser,workspace,onWorkspaceChange,onSelect,onOpenVal}){
 const [sheet,setSheet]=useState('')
 useEffect(()=>setSheet(''),[page])
 const role=currentUser?.role
 const go=entry=>{setSheet('');onSelect?.(entry)}
 const settings=settingsModules(role)
 const inWorkspaces=WORKSPACES.some(space=>workspaceModules(space.id,role).some(entry=>isNavItemActive(entry,{page,tool})))
 const close=()=>setSheet('')

 return <>
  {sheet&&<>
   <button type="button" className="mobile-more-backdrop" aria-label="Fechar menu" onClick={close}/>
   <section className={`mobile-more-sheet open${sheet==='create'?' is-create':''}`} aria-label={sheet==='create'?'Ações rápidas':'Workspaces e módulos'}>
    <header>
     <div><small>VAL</small><h2>{sheet==='create'?'O que você quer registrar?':'Workspaces'}</h2></div>
     <button type="button" aria-label="Fechar menu" onClick={close}><X/></button>
    </header>
    {sheet==='create'
     ?<div className="mobile-quick-actions">
       <button type="button" onClick={()=>{close();onOpenVal?.()}}><span><BrainCircuit/></span><b>Falar com a VAL</b><small>Voz, foto ou arquivo no mesmo gesto</small></button>
       {quickActions.map(([entry,label,hint,Icon])=><button type="button" key={entry.id} onClick={()=>go(entry)}><span><Icon/></span><b>{label}</b><small>{hint}</small></button>)}
      </div>
     :<div className="mobile-workspace-list">
       {WORKSPACES.map(({id,label,hint,icon:Icon})=>{
        const modules=workspaceModules(id,role)
        if(!modules.length)return null
        return <section key={id} className={workspace===id?'is-active':''}>
         <button type="button" className="mobile-workspace-head" onClick={()=>{setSheet('');onWorkspaceChange?.(id)}}><span><Icon/></span><b>{label}</b><small>{hint}</small></button>
         <div>{modules.map(entry=>{
          const ItemIcon=entry.icon
          const active=isNavItemActive(entry,{page,tool})
          return <button type="button" key={entry.id} className={active?'active':''} aria-current={active?'page':undefined} onClick={()=>go(entry)}><span><ItemIcon/></span><b>{entry.label}</b></button>
         })}</div>
        </section>
       })}
       {settings.length>0&&<section>
        <p className="mobile-workspace-settings-title">Configurações</p>
        <div>{settings.map(entry=>{
         const ItemIcon=entry.icon
         const active=isNavItemActive(entry,{page,tool})
         return <button type="button" key={entry.id} className={active?'active':''} aria-current={active?'page':undefined} onClick={()=>go(entry)}><span><ItemIcon/></span><b>{entry.label}</b></button>
        })}</div>
       </section>}
      </div>}
   </section>
  </>}

  <nav className="mobile-nav" aria-label="Navegação principal">
   <button type="button" className={page==='dashboard'?'active':''} aria-current={page==='dashboard'?'page':undefined} onClick={()=>go({id:'dashboard',page:'dashboard'})}><Home/><span>Início</span></button>
   <button type="button" className={page==='clients'||page==='client360'?'active':''} aria-current={page==='clients'?'page':undefined} onClick={()=>go({id:'producer360',action:'producer',page:'clients'})}><Users/><span>Produtores</span></button>
   <button type="button" className="mobile-create-button" aria-label="Registrar ou criar" aria-expanded={sheet==='create'} onClick={()=>setSheet(value=>value==='create'?'':'create')}><span><Plus/></span></button>
   <button type="button" className={page==='copilot'?'active':''} aria-label="Abrir o Copiloto VAL" onClick={onOpenVal}><BrainCircuit/><span>Copiloto</span></button>
   <button type="button" className={sheet==='more'||(inWorkspaces&&page!=='clients')?'active':''} aria-expanded={sheet==='more'} aria-label="Abrir workspaces e módulos" onClick={()=>setSheet(value=>value==='more'?'':'more')}><MoreHorizontal/><span>Mais</span></button>
  </nav>
 </>
}
