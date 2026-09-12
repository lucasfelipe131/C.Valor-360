import {useEffect} from 'react'

export function useNavigationGuard(dirty,{busy=false,label='formulário'}={}){
 useEffect(()=>{
  if(typeof window==='undefined'||typeof window.addEventListener!=='function')return
  if(!dirty&&!busy)return
  const leave=event=>{
   if(event.defaultPrevented)return
   if(busy){event.preventDefault();return}
   if(!window.confirm(`Há alterações não salvas no ${label}. Sair sem salvar?`))event.preventDefault()
  }
  const unload=event=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('val:before-navigation',leave)
  window.addEventListener('beforeunload',unload)
  return()=>{window.removeEventListener('val:before-navigation',leave);window.removeEventListener('beforeunload',unload)}
 },[dirty,busy,label])
}
