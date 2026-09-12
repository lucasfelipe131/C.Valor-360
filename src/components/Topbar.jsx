import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Bell,ChevronRight,Search,X} from 'lucide-react'
import Logo from './Logo'
import {MODULES,contextTrail} from '../lib/val-workspaces'
import {AGRO_TOOLS} from '../lib/agro-tools'

const normalize=value=>String(value??'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g,'')

// A busca global percorre o que a sessão já carregou — carteira, agenda, funil
// e os próprios módulos. Nenhuma rota nova é inventada: o que ela encontra é
// exatamente o que o usuário já pode abrir.
const buildIndex=({clients,visits,opportunities,role})=>{
 const index=[]
 for(const client of clients||[])index.push({
  id:`client:${client.id}`,kind:'Produtor',label:client.name,
  hint:[client.municipality,client.commercial?.property].filter(Boolean).join(' • '),
  action:{type:'client',client}
 })
 for(const visit of visits||[])index.push({
  id:`visit:${visit.id}`,kind:'Visita',label:visit.objective||'Visita sem objetivo',
  hint:(clients||[]).find(item=>String(item.id)===String(visit.clientId))?.name||'',
  action:{type:'page',page:'visits'}
 })
 for(const opportunity of opportunities||[])index.push({
  id:`opportunity:${opportunity.id||opportunity.candidateKey}`,kind:'Oportunidade',
  label:opportunity.title||opportunity.hypothesis||'Oportunidade',
  hint:opportunity.stage||'',action:{type:'page',page:'opportunities'}
 })
 for(const [page,module] of Object.entries(MODULES)){
  if(module.contextual||(module.role&&module.role!==role))continue
  index.push({id:`module:${page}`,kind:'Módulo',label:module.label,hint:'Abrir no workspace',action:{type:'page',page}})
 }
 for(const tool of AGRO_TOOLS)index.push({
  id:`tool:${tool.id}`,kind:'Ferramenta',label:tool.label,hint:tool.description,
  action:{type:'tool',tool}
 })
 return index
}

export default function Topbar({onBack,backLabel,title,subtitle,onNavigate,onOpenVal,workspace,page,client,clients,visits,opportunities,currentUser,onOpenClient}){
 const initials=String(currentUser?.name||currentUser?.email||'VA').replace(/@.*$/,'').split(/[\s._-]+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'VA'
 // O sino conta pendência real de ciclo de vida — não é contador decorativo.
 const alerts=(visits||[]).filter(visit=>{
  const state=String(visit?.lifecycleStatus||visit?.lifecycle_status||'').toUpperCase()
  if(['IN_PROGRESS','COMPLETED_PENDING_REVIEW'].includes(state))return true
  return /andamento|iniciad|revis[aã]o/i.test(String(visit?.status||''))
 }).length
 const [open,setOpen]=useState(false)
 const [query,setQuery]=useState('')
 const inputRef=useRef(null)
 const trail=contextTrail({page,workspace,client})
 const index=useMemo(()=>buildIndex({clients,visits,opportunities,role:currentUser?.role}),[clients,visits,opportunities,currentUser?.role])
 const results=useMemo(()=>{
  const term=normalize(query).trim()
  if(!term)return []
  return index.filter(item=>normalize(`${item.label} ${item.hint} ${item.kind}`).includes(term)).slice(0,8)
 },[index,query])

 // So rouba o foco quando o campo inline esta realmente visivel; no mobile
 // ele fica oculto e o foco pertence ao campo do painel.
 useEffect(()=>{if(open&&inputRef.current?.offsetParent)inputRef.current.focus()},[open])
 useEffect(()=>{
  if(!open)return
  const keydown=event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);setQuery('')}}
  window.addEventListener('keydown',keydown)
  return()=>window.removeEventListener('keydown',keydown)
 },[open])

 const run=item=>{
  setOpen(false);setQuery('')
  if(item.action.type==='client')onOpenClient?.(item.action.client)
  else if(item.action.type==='tool'){
   const {id,page:manualPage,label}=item.action.tool
   onNavigate?.({page:'agro',tool:id,manualPage,label,context:{tool:id,page:manualPage,label}})
  }
  else onNavigate?.(item.action.page)
 }

 return <header className="topbar val-global-header">
  <div className="topbar-title">
   {onBack&&<button type="button" className="soft-btn" onClick={onBack} aria-label={`Voltar para ${backLabel}`}>← Voltar{backLabel?` · ${backLabel}`:''}</button>}
   <div className="topbar-mobile-logo"><Logo compact/></div>
   <div>
    {trail.length>0&&<nav className="context-trail" aria-label="Contexto atual">
     {trail.map((step,position)=><React.Fragment key={step.id}>
      {position>0&&<ChevronRight size={12} aria-hidden="true"/>}
      <span className={`context-step is-${step.kind}`}>{step.label}</span>
     </React.Fragment>)}
    </nav>}
    <h1 tabIndex="-1">{title}</h1>
    <p>{subtitle}</p>
   </div>
  </div>
  <div className="top-actions">
   <div className="global-search-inline">
    <Search size={16} aria-hidden="true"/>
    <input
     ref={inputRef}
     value={query}
     onChange={event=>{setQuery(event.target.value);setOpen(true)}}
     onFocus={()=>setOpen(true)}
     placeholder="Buscar produtores, culturas, análises…"
     aria-label="Buscar produtores, visitas, oportunidades, módulos e ferramentas"
     aria-expanded={open}
    />
    {query&&<button type="button" aria-label="Limpar busca" onClick={()=>{setQuery('');setOpen(false)}}><X size={14}/></button>}
   </div>
   <button type="button" className="icon-btn is-search-compact" aria-label="Buscar produtores, visitas, oportunidades e módulos" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?<X size={19}/>:<Search size={19}/>}</button>
   <button type="button" className="icon-btn" aria-label={alerts?`Abrir pendências: ${alerts} em aberto`:'Abrir relatórios e alertas'} onClick={()=>onNavigate?.('reports')}>
    <Bell size={19}/>
    {alerts>0&&<i className="icon-badge" aria-hidden="true">{alerts>9?'9+':alerts}</i>}
   </button>
   <button type="button" className="topbar-avatar" aria-label="Abrir preferências da conta" onClick={()=>onNavigate?.('settings')}>{initials}</button>
  </div>
  {open&&<div className="global-search" role="dialog" aria-label="Busca global">
   <div className="global-search-field">
    <Search size={17} aria-hidden="true"/>
    <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar produtor, visita, oportunidade ou módulo…" aria-label="Termo de busca"/>
   </div>
   {query.trim()
    ?results.length
     ?<ul className="global-search-results">{results.map(item=>
       <li key={item.id}><button type="button" onClick={()=>run(item)}><small>{item.kind}</small><b>{item.label}</b>{item.hint&&<span>{item.hint}</span>}</button></li>
      )}</ul>
     :<p className="global-search-empty">Nada encontrado na carteira desta sessão.</p>
    :<p className="global-search-empty">A busca cobre a carteira carregada, a agenda, o funil e os módulos da VAL.</p>}
  </div>}
 </header>
}
