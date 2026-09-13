import {useEffect,useState} from 'react'

// A foto que o consultor sobe em "Meu perfil" era gravada e devolvida pela API, mas nao aparecia em
// lugar nenhum do produto: a topbar e a barra lateral mostravam sempre as iniciais. O consultor
// subia a foto, via a confirmacao de salvo e continuava vendo as mesmas duas letras.
// A foto e recarregada no evento que o proprio editor de perfil ja dispara ao salvar.
export function useAccountPhoto(enabled=true){
 const [photo,setPhoto]=useState(null)
 useEffect(()=>{
  if(!enabled){setPhoto(null);return}
  let active=true
  const controller=new AbortController()
  const load=()=>fetch('/api/auth/profile',{signal:controller.signal})
   .then(response=>response.ok?response.json():null)
   .then(data=>{if(active)setPhoto(typeof data?.photo==='string'&&data.photo.startsWith('data:image/')?data.photo:null)})
   .catch(()=>{})
  load()
  window.addEventListener('val:profile-updated',load)
  return()=>{active=false;controller.abort();window.removeEventListener('val:profile-updated',load)}
 },[enabled])
 return photo
}
