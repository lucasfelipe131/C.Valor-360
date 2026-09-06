import React,{useEffect,useState} from 'react'
import {ChevronRight} from 'lucide-react'

// Segundo plano sob demanda.
//
// A regra do produto é simples: o que importa fica visível; o que interessa
// às vezes fica a um toque. Este componente é esse toque. Nasce fechado, e a
// escolha do usuário é lembrada por chave — quem abre "Números da carteira"
// uma vez encontra aberto na próxima visita, sem impor isso a quem não abriu.

const STORAGE_PREFIX='valor360-disclosure:'

const readStored=(id,fallback)=>{
 if(!id)return fallback
 try{
  const stored=localStorage.getItem(STORAGE_PREFIX+id)
  return stored===null?fallback:stored==='1'
 }catch{return fallback}
}

export default function Disclosure({id,title,hint,defaultOpen=false,className='',children}){
 const [open,setOpen]=useState(()=>readStored(id,defaultOpen))
 useEffect(()=>{
  if(!id)return
  try{localStorage.setItem(STORAGE_PREFIX+id,open?'1':'0')}catch{}
 },[id,open])

 return <details className={`val-disclosure${className?` ${className}`:''}`} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>
   <span className="val-disclosure-title">
    <b>{title}</b>
    {hint&&<small>{hint}</small>}
   </span>
   <ChevronRight size={17} aria-hidden="true"/>
  </summary>
  <div className="val-disclosure-body">{children}</div>
 </details>
}
