import {useEffect} from 'react'

/**
 * Guarda de saída de tela. `dirty` diz que há trabalho digitado a perder; `busy` diz que há uma
 * gravação em andamento e a saída precisa esperar.
 *
 * Cada formulário aberto perguntava por conta própria. Sair da aba do mapa com dois formulários
 * sujos custava DUAS caixas de confirmação — e recusar a segunda jogava fora o "sim" da primeira,
 * de graça. A decisão agora viaja na própria tentativa de navegação: quem pergunta primeiro marca o
 * evento, e os demais respeitam a resposta em vez de perguntar de novo.
 *
 * `onBlocked` existe para a saída barrada não ser silenciosa: sem ele, tocar em outra aba durante
 * uma gravação simplesmente não fazia nada e nada era dito.
 */
export function useNavigationGuard(dirty,{busy=false,label='formulário',question='',onBlocked=null}={}){
 useEffect(()=>{
  if(typeof window==='undefined'||typeof window.addEventListener!=='function')return
  if(!dirty&&!busy)return
  const leave=event=>{
   if(event.defaultPrevented||event.valNavigationConfirmed)return
   if(busy){event.preventDefault();onBlocked?.();return}
   if(window.confirm(question||`Há alterações não salvas no ${label}. Sair sem salvar?`))event.valNavigationConfirmed=true
   else event.preventDefault()
  }
  const unload=event=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('val:before-navigation',leave)
  window.addEventListener('beforeunload',unload)
  return()=>{window.removeEventListener('val:before-navigation',leave);window.removeEventListener('beforeunload',unload)}
 },[dirty,busy,label,question,onBlocked])
}
