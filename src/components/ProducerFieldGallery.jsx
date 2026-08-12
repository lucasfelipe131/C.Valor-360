import React,{useEffect,useRef,useState} from 'react'
import {Camera,CalendarDays,Check,Eye,ImagePlus,Images,LoaderCircle,Pencil,Save,Tag,Trash2,X} from 'lucide-react'

const PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp'])
const MAX_PHOTO_BYTES=6_000_000
const categories=['Visão geral','Emergência e estande','Plantas daninhas','Doenças','Insetos e pragas','Nutrição','Solo','Dano climático','Manejo e aplicação','Outro']
const statusLabels={received:'Enviada',interpreted:'Lida pela VAL',confirmed:'Evidência confirmada',stored:'Na memória do produtor'}
const today=()=>{const value=new Date();value.setMinutes(value.getMinutes()-value.getTimezoneOffset());return value.toISOString().slice(0,10)}
const emptyMeta=()=>({label:'',category:'Visão geral',observedAt:today(),notes:''})
const formatSize=value=>Number(value||0)>=1_000_000?`${(Number(value)/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(Number(value||0)/1000))} KB`
const formatDate=value=>{if(!value)return 'Data não informada';const parsed=new Date(`${String(value).slice(0,10)}T12:00:00`);return Number.isNaN(parsed.getTime())?'Data não informada':parsed.toLocaleDateString('pt-BR')}
const fileLabel=name=>String(name||'Foto da lavoura').replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim()||'Foto da lavoura'
const fieldPhoto=item=>({label:item?.analysis?.fieldPhoto?.label||fileLabel(item?.originalName),category:item?.analysis?.fieldPhoto?.category||'Visão geral',observedAt:item?.analysis?.fieldPhoto?.observedAt||String(item?.createdAt||'').slice(0,10),notes:item?.analysis?.fieldPhoto?.notes||''})
const mergePhoto=(list,item)=>[item,...list.filter(entry=>entry.id!==item.id)].sort((left,right)=>String(right.createdAt||'').localeCompare(String(left.createdAt||'')))

function fileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Não consegui abrir esta foto.'));reader.readAsDataURL(file)})}
function imageFromUrl(url){return new Promise((resolve,reject)=>{const image=new window.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não consegui preparar esta foto. Use JPEG, PNG ou WebP.'));image.src=url})}
async function preparePhoto(file){
 if(!PHOTO_TYPES.has(file.type))throw new Error('Use uma foto JPEG, PNG ou WebP.')
 if(file.size<=4_000_000)return file
 const url=URL.createObjectURL(file)
 try{
  const image=await imageFromUrl(url);const scale=Math.min(1,2200/image.naturalWidth,2200/image.naturalHeight)
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height)
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!blob)throw new Error('Não consegui reduzir esta foto.')
  if(blob.size>MAX_PHOTO_BYTES)throw new Error('A foto ainda ficou maior que 6 MB depois da redução.')
  return new File([blob],`${fileLabel(file.name)}.jpg`,{type:'image/jpeg',lastModified:file.lastModified})
 }finally{URL.revokeObjectURL(url)}
}

export default function ProducerFieldGallery({clientId,clientName,onSaved}){
 const [photos,setPhotos]=useState([])
 const [draft,setDraft]=useState(emptyMeta)
 const [editing,setEditing]=useState('')
 const [editMeta,setEditMeta]=useState(emptyMeta)
 const [state,setState]=useState({loading:true,uploading:false,saving:false,error:''})
 const cameraInput=useRef(null)
 const galleryInput=useRef(null)

 useEffect(()=>{
  const controller=new AbortController();setState(current=>({...current,loading:true,error:''}))
  fetch(`/api/val/attachments?clientId=${encodeURIComponent(clientId)}`,{signal:controller.signal})
   .then(async response=>{const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível carregar as fotos.');return payload})
   .then(payload=>{setPhotos((payload.attachments||[]).filter(item=>item.mimeType?.startsWith('image/')));setState(current=>({...current,loading:false,error:''}))})
   .catch(error=>{if(error.name!=='AbortError')setState(current=>({...current,loading:false,error:error.message}))})
  return()=>controller.abort()
 },[clientId])

 const patchPhoto=async(item,metadata,status=item.status==='received'?'stored':item.status)=>{
  const response=await fetch('/api/val/attachments',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,status,analysis:{...(item.analysis||{}),fieldPhoto:{...metadata,source:'client360',updatedAt:new Date().toISOString()}}}),signal:AbortSignal.timeout(15000)})
  const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível salvar a identificação da foto.');return payload.attachment
 }

 const upload=async event=>{
  const files=Array.from(event.target.files||[]).slice(0,6);event.target.value='';if(!files.length||state.uploading)return
  setState(current=>({...current,uploading:true,error:''}))
  try{
   let added=0
   for(const [index,original] of files.entries()){
    const file=await preparePhoto(original);const dataUrl=await fileDataUrl(file)
    const response=await fetch('/api/val/attachments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,originalName:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl}),signal:AbortSignal.timeout(60000)})
    const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível enviar esta foto.')
    const label=draft.label.trim()?files.length>1?`${draft.label.trim()} • ${index+1}`:draft.label.trim():fileLabel(file.name)
    const stored=await patchPhoto(payload.attachment,{...draft,label});setPhotos(current=>mergePhoto(current,stored));added++
   }
   setDraft(emptyMeta());onSaved?.(`${added} ${added===1?'foto salva':'fotos salvas'} na nuvem e vinculada${added===1?'':'s'} a ${clientName||'este produtor'}.`)
  }catch(error){setState(current=>({...current,error:error.message}))}finally{setState(current=>({...current,uploading:false}))}
 }

 const startEdit=item=>{setEditing(item.id);setEditMeta(fieldPhoto(item));setState(current=>({...current,error:''}))}
 const saveEdit=async event=>{
  event.preventDefault();const item=photos.find(photo=>photo.id===editing);if(!item||state.saving)return
  setState(current=>({...current,saving:true,error:''}))
  try{const updated=await patchPhoto(item,{...editMeta,label:editMeta.label.trim()||fileLabel(item.originalName)});setPhotos(current=>mergePhoto(current,updated));setEditing('');onSaved?.('Identificação da foto atualizada na nuvem.')}catch(error){setState(current=>({...current,error:error.message}))}finally{setState(current=>({...current,saving:false}))}
 }
 const remove=async item=>{
  if(!window.confirm(`Remover “${fieldPhoto(item).label}” da galeria deste produtor?`))return
  setState(current=>({...current,saving:true,error:''}))
  try{const response=await fetch('/api/val/attachments',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,status:'rejected'}),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível remover a foto.');setPhotos(current=>current.filter(photo=>photo.id!==item.id));onSaved?.('Foto removida da galeria do produtor.')}catch(error){setState(current=>({...current,error:error.message}))}finally{setState(current=>({...current,saving:false}))}
 }

 return <section className="producer-field-gallery" aria-labelledby="producer-field-gallery-title">
  <header><div><span className="field-gallery-icon"><Images/></span><div><span className="eyebrow">HISTÓRICO VISUAL DA LAVOURA</span><h3 id="producer-field-gallery-title">Fotos vinculadas ao produtor</h3><p>Registre o que foi observado, onde se encaixa e quando aconteceu. A foto fica disponível no mesmo login e pode compor o contexto da VAL.</p></div></div><span className="field-gallery-count">{photos.length} {photos.length===1?'foto':'fotos'}</span></header>
  <div className="field-photo-composer">
   <div className="field-photo-fields"><label>Rótulo da foto<input value={draft.label} maxLength="120" onChange={event=>setDraft(current=>({...current,label:event.target.value}))} placeholder="Ex.: Soja — Talhão Norte, V4"/></label><label>Categoria<select value={draft.category} onChange={event=>setDraft(current=>({...current,category:event.target.value}))}>{categories.map(category=><option key={category}>{category}</option>)}</select></label><label>Data observada<input type="date" value={draft.observedAt} onChange={event=>setDraft(current=>({...current,observedAt:event.target.value}))}/></label><label className="wide">Notas da observação<textarea rows="2" value={draft.notes} maxLength="1000" onChange={event=>setDraft(current=>({...current,notes:event.target.value}))} placeholder="Ex.: 12 plantas/m, reboleira de 8 × 15 m; conferir após 7 dias."/></label></div>
   <div className="field-photo-actions"><input ref={cameraInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={upload}/><input ref={galleryInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={upload}/><button type="button" onClick={()=>cameraInput.current?.click()} disabled={state.uploading}><Camera/>{state.uploading?'Enviando…':'Tirar foto'}</button><button type="button" onClick={()=>galleryInput.current?.click()} disabled={state.uploading}><ImagePlus/>Escolher da galeria</button><small>JPEG, PNG ou WebP • até 6 MB por foto • até 6 por envio</small></div>
  </div>
  {state.error&&<div className="form-error" role="alert">{state.error}</div>}
  {state.loading?<div className="field-gallery-loading" role="status"><LoaderCircle className="val-spinner"/><span>Carregando fotos deste produtor…</span></div>:photos.length?<div className="field-photo-grid">{photos.map(item=>{const metadata=fieldPhoto(item);return <article key={item.id} className={editing===item.id?'is-editing':''}>
   <a className="field-photo-preview" href={`/api/val/attachments/${item.id}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${metadata.label}`}><img src={`/api/val/attachments/${item.id}`} alt={metadata.label} loading="lazy"/><span><Eye/>Ampliar</span></a>
   <div className="field-photo-copy"><div className="field-photo-tags"><span><Tag/>{metadata.category}</span><span><CalendarDays/>{formatDate(metadata.observedAt)}</span></div><h4>{metadata.label}</h4><p>{metadata.notes||'Sem observação complementar.'}</p><small>{formatSize(item.sizeBytes)} • {statusLabels[item.status]||item.status}</small></div>
   {editing===item.id?<form className="field-photo-edit" onSubmit={saveEdit}><label>Rótulo<input required value={editMeta.label} maxLength="120" onChange={event=>setEditMeta(current=>({...current,label:event.target.value}))}/></label><label>Categoria<select value={editMeta.category} onChange={event=>setEditMeta(current=>({...current,category:event.target.value}))}>{categories.map(category=><option key={category}>{category}</option>)}</select></label><label>Data<input type="date" value={editMeta.observedAt} onChange={event=>setEditMeta(current=>({...current,observedAt:event.target.value}))}/></label><label className="wide">Notas<textarea rows="3" value={editMeta.notes} maxLength="1000" onChange={event=>setEditMeta(current=>({...current,notes:event.target.value}))}/></label><div><button type="button" onClick={()=>setEditing('')}><X/>Cancelar</button><button className="save" disabled={state.saving}><Save/>{state.saving?'Salvando…':'Salvar'}</button></div></form>:<div className="field-photo-card-actions"><button type="button" onClick={()=>startEdit(item)}><Pencil/>Editar dados</button><button type="button" className="danger" disabled={state.saving} onClick={()=>remove(item)}><Trash2/>Remover</button></div>}
  </article>})}</div>:<div className="field-gallery-empty"><ImagePlus/><div><b>Nenhuma foto registrada</b><span>Use a câmera ou escolha imagens para começar o histórico visual.</span></div></div>}
  <footer><Check/><span>As fotos ficam vinculadas ao produtor e isoladas no seu login.</span></footer>
 </section>
}
