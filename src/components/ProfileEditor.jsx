import React,{useEffect,useState} from 'react'

async function preparePhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15000000)throw new Error('Selecione JPEG, PNG ou WebP de até 15 MB.')
 const bitmap=await createImageBitmap(file)
 try{
  const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height)
  const photo=canvas.toDataURL('image/jpeg',.8)
  if(photo.length>333350)throw new Error('Escolha uma imagem menor para a foto de perfil.')
  return photo
 }finally{bitmap.close()}
}
export default function ProfileEditor({clientId=null,propertyId=null,onSaved}){
 const endpoint=clientId?`/api/clients/${encodeURIComponent(clientId)}${propertyId?`/properties/${encodeURIComponent(propertyId)}`:''}/profile-photo`:'/api/auth/profile'
 const photoLabel=propertyId?'Foto da propriedade':clientId?'Foto do produtor':'Meu perfil'
 const [profile,setProfile]=useState(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{const controller=new AbortController();setProfile(null);setEditing(false);setError('');fetch(endpoint,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível carregar o perfil.');return data}).then(setProfile).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[endpoint])
 useEffect(()=>{
  if(!editing)return
  const leave=event=>{if(busy){event.preventDefault();setError('Aguarde o salvamento da foto terminar.');return}if(!window.confirm('Há um perfil em edição. Sair sem salvar?'))event.preventDefault()}
  const unload=event=>{event.preventDefault();event.returnValue=''}
  window.addEventListener('val:before-navigation',leave);window.addEventListener('beforeunload',unload)
  return()=>{window.removeEventListener('val:before-navigation',leave);window.removeEventListener('beforeunload',unload)}
 },[editing,busy])
 const save=async event=>{event.preventDefault();setBusy(true);setError('');try{const response=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo:profile.photo,...(!clientId?{name:profile.name}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar.');setProfile(data);setEditing(false);onSaved?.(data);window.dispatchEvent(new Event('val:profile-updated'))}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="profile-editor" aria-label={photoLabel}>
  {profile?.photo&&<img src={profile.photo} alt={photoLabel} width="64" height="64" style={{objectFit:'cover',borderRadius:16}}/>}
  {!editing&&profile&&<button type="button" className="soft-btn" onClick={()=>setEditing(true)}>{propertyId?'Editar foto da propriedade':clientId?'Editar foto':'Editar meu perfil'}</button>}
  {editing&&<form onSubmit={save}>
   {!clientId&&<label>Nome<input required maxLength={120} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>}
   <label>Foto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);setError('');try{const photo=await preparePhoto(file);setProfile(p=>({...p,photo}))}catch(error){setError(error.message)}finally{setBusy(false)}}}/></label>
   <button disabled={busy} type="submit">{busy?'Salvando…':'Salvar perfil'}</button>
  </form>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
