import React,{useCallback,useEffect,useState} from 'react'

// O erro do navegador chegava cru na tela: "The source image could not be decoded" em ingles, no
// meio de um produto em portugues, sem dizer o que fazer. Cada falha de leitura vira uma frase que
// o consultor consegue agir em cima.
async function preparePhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15000000)throw new Error('Selecione JPEG, PNG ou WebP de até 15 MB.')
 let bitmap
 try{bitmap=await createImageBitmap(file)}
 catch{throw new Error('Não foi possível abrir esta imagem. O arquivo pode estar corrompido ou não ser uma foto; tente outra.')}
 try{
  const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
  const context=canvas.getContext('2d')
  if(!context)throw new Error('Este navegador não conseguiu preparar a imagem. Tente por outro navegador ou envie outra foto.')
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height)
  let photo
  try{photo=canvas.toDataURL('image/jpeg',.8)}
  catch{throw new Error('Não foi possível preparar esta imagem para envio. Tente outra foto.')}
  if(photo.length>333350)throw new Error('Escolha uma imagem menor para a foto de perfil.')
  return photo
 }finally{bitmap.close()}
}
export default function ProfileEditor({clientId=null,propertyId=null,onSaved}){
 const endpoint=clientId?`/api/clients/${encodeURIComponent(clientId)}${propertyId?`/properties/${encodeURIComponent(propertyId)}`:''}/profile-photo`:'/api/auth/profile'
 const photoLabel=propertyId?'Foto da propriedade':clientId?'Foto do produtor':'Meu perfil'
 const [profile,setProfile]=useState(null),[saved,setSaved]=useState(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{const controller=new AbortController();setProfile(null);setSaved(null);setEditing(false);setError('');fetch(endpoint,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível carregar o perfil.');return data}).then(data=>{setProfile(data);setSaved(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[endpoint,attempt])
 // Abrir o editor nao e ter trabalho para perder. Antes, so entrar em modo de edicao ja armava a
 // confirmacao de saida e o aviso do navegador: quem abriu "Editar foto da propriedade" e nao mudou
 // nada era barrado do mesmo jeito. A guarda passou a valer pelo que mudou, nao pelo modo aberto.
 const dirty=Boolean(editing&&saved&&(profile?.photo!==saved.photo||(!clientId&&profile?.name!==saved.name)))
 useEffect(()=>{
  if(!dirty&&!busy)return
  const leave=event=>{
   if(event.defaultPrevented||event.valNavigationConfirmed)return
   if(busy){event.preventDefault();setError('Aguarde o salvamento da foto terminar.');return}
   if(window.confirm('Há um perfil em edição. Sair sem salvar?'))event.valNavigationConfirmed=true
   else event.preventDefault()
  }
  const unload=event=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('val:before-navigation',leave);window.addEventListener('beforeunload',unload)
  return()=>{window.removeEventListener('val:before-navigation',leave);window.removeEventListener('beforeunload',unload)}
 },[dirty,busy])
 // Sem isto o consultor que clicava em "Editar foto" por engano ficava preso: nao havia botao de
 // desistir e qualquer tentativa de sair caia na caixa de confirmacao de edicao pendente.
 const cancel=useCallback(()=>{if(busy)return;setProfile(saved);setEditing(false);setError('')},[busy,saved])
 const save=async event=>{event.preventDefault();setBusy(true);setError('');try{const response=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo:profile.photo,...(!clientId?{name:profile.name}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar.');setProfile(data);setSaved(data);setEditing(false);onSaved?.(data);window.dispatchEvent(new Event('val:profile-updated'))}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="profile-editor" aria-label={photoLabel}>
  {profile?.photo&&<img src={profile.photo} alt={photoLabel} width="64" height="64" style={{objectFit:'cover',borderRadius:16}}/>}
  {!editing&&profile&&<button type="button" className="soft-btn" onClick={()=>setEditing(true)}>{propertyId?'Editar foto da propriedade':clientId?'Editar foto':'Editar meu perfil'}</button>}
  {editing&&<form onSubmit={save}>
   {!clientId&&<label>Nome<input required maxLength={120} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>}
   <label>Foto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);setError('');try{const photo=await preparePhoto(file);setProfile(p=>({...p,photo}))}catch(error){setError(error.message)}finally{setBusy(false)}}}/></label>
   <button disabled={busy} type="submit">{busy?'Salvando…':'Salvar perfil'}</button>
   <button type="button" className="soft-btn" disabled={busy} onClick={cancel}>Cancelar edição</button>
  </form>}
  {error&&<p role="alert">{error}</p>}
  {/* Falha na leitura inicial deixava a tela sem perfil e sem botao nenhum: nao dava nem para tentar de novo. */}
  {error&&!profile&&<button type="button" className="soft-btn" onClick={()=>{setError('');setAttempt(value=>value+1)}}>Tentar de novo</button>}
 </section>
}
