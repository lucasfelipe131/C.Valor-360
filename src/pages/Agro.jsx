import React,{useEffect,useRef,useState} from 'react'
import {CheckCircle2,LoaderCircle,Maximize2,Minimize2} from 'lucide-react'
import Logo from '../components/Logo'

export default function Agro(){
 const [status,setStatus]=useState({loading:true,configured:false})
 const [loaded,setLoaded]=useState(false)
 const [expanded,setExpanded]=useState(false)
 const workspaceRef=useRef(null)

 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:controller.signal})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>setStatus({loading:false,configured:Boolean(data.manualIntegrationConfigured)}))
   .catch(()=>setStatus({loading:false,configured:false}))
  return()=>controller.abort()
 },[])

 useEffect(()=>{
  const syncFullscreen=()=>setExpanded(document.fullscreenElement===workspaceRef.current)
  document.addEventListener('fullscreenchange',syncFullscreen)
  return()=>document.removeEventListener('fullscreenchange',syncFullscreen)
 },[])

 useEffect(()=>{
  if(!expanded)return undefined
  const previous=document.body.style.overflow
  document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=previous}
 },[expanded])

 const toggleExpanded=async()=>{
  if(expanded&&!document.fullscreenElement){setExpanded(false);return}
  if(document.fullscreenElement){await document.exitFullscreen();return}
  try{
   if(workspaceRef.current?.requestFullscreen){await workspaceRef.current.requestFullscreen();return}
  }catch{}
  setExpanded(true)
 }

 return <div className="agro-native agro-full-page">
  <section ref={workspaceRef} className={`agro-native-workspace agro-full-workspace${expanded?' is-expanded':''}`} aria-label="Ambiente técnico integrado">
   <header className="agro-minimal-header">
    <div className="agro-minimal-brand"><Logo compact/><div><small>AMBIENTE TÉCNICO</small><strong>Inteligência Agronômica</strong></div></div>
    <div className="agro-workspace-actions">
     <span className={status.configured?'is-ready':''}><CheckCircle2/>{status.loading?'Conectando':'Mesmo login ativo'}</span>
     <button type="button" onClick={toggleExpanded} aria-pressed={expanded} title={expanded?'Reduzir ambiente técnico':'Abrir ambiente técnico em tela cheia'}>
      {expanded?<Minimize2/>:<Maximize2/>}<b>{expanded?'Reduzir':'Tela cheia'}</b>
     </button>
    </div>
   </header>
   {!loaded&&<div className="agro-frame-loading" role="status"><LoaderCircle/><b>Carregando ambiente técnico…</b><small>Sincronizando sua sessão.</small></div>}
   <iframe
    title="Inteligência Agronômica da VAL"
    src="/tecnico?embedded=1"
    onLoad={()=>setLoaded(true)}
    allow="camera 'self'; geolocation 'self'"
   />
  </section>
 </div>
}
