import React,{useEffect,useState} from 'react'
import {Check,Crosshair,LocateFixed,MapPin,PencilRuler,Plus,Save,Trash2,Undo2,X} from 'lucide-react'
import SatelliteMap from './map/SatelliteMap'
import {formatCoordinates,formatHectares,polygonAreaHa,validLocation} from '../lib/property-map'

// Propriedade e talhões no perfil do produtor. Sede por toque no mapa ou
// GPS; talhão desenhado tocando nos cantos, com área calculada do contorno.
// Tudo passa por confirmação explícita ("Salvar propriedade") — nada é
// gravado enquanto o consultor ainda está marcando.

const fieldKey=index=>`new-${Date.now().toString(36)}-${index}`
const numberOrNull=value=>{const parsed=Number(String(value??'').replace(',','.'));return value===''||value===null||value===undefined||!Number.isFinite(parsed)?null:parsed}
const fromProfile=profile=>({
 propertyName:profile?.property?.name||'',
 location:validLocation(profile?.property?.location),
 fields:(profile?.fields||[]).map(field=>({key:field.id,id:field.id,name:field.name,areaHa:field.areaHa==null?'':String(field.areaHa),crop:field.crop||'',season:field.season||'',points:field.points||[],clearGeometry:false}))
})

export default function PropertyFields({client,onSaved,onRefreshPortfolio}){
 const [form,setForm]=useState(fromProfile(null))
 const [removed,setRemoved]=useState([])
 const [mode,setMode]=useState('')
 const [draft,setDraft]=useState([])
 const [dirty,setDirty]=useState(false)
 const [state,setState]=useState({loading:true,saving:false,error:'',notice:''})

 useEffect(()=>{
  if(!client?.id)return
  const controller=new AbortController()
  setState({loading:true,saving:false,error:'',notice:''});setMode('');setDraft([]);setRemoved([]);setDirty(false)
  fetch(`/api/clients/${encodeURIComponent(client.id)}/property`,{signal:controller.signal}).then(async response=>{
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}
   const payload=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(payload.error||'A propriedade não pôde ser carregada agora.')
   return payload
  }).then(payload=>{if(payload)setForm(fromProfile(payload));setState(current=>({...current,loading:false}))})
   .catch(error=>{if(error.name!=='AbortError')setState(current=>({...current,loading:false,error:error.message}))})
  return()=>controller.abort()
 },[client?.id])

 const update=patch=>{setForm(current=>({...current,...patch}));setDirty(true);setState(current=>({...current,error:'',notice:''}))}
 const updateField=(key,patch)=>update({fields:form.fields.map(field=>field.key===key?{...field,...patch}:field)})
 const addField=(extra={})=>update({fields:[...form.fields,{key:fieldKey(form.fields.length),id:null,name:`Talhão ${form.fields.length+1}`,areaHa:'',crop:'',season:'',points:[],clearGeometry:false,...extra}]})
 const removeField=field=>{
  if(!window.confirm(`Remover o talhão "${field.name}"? Análises ligadas a ele perdem o vínculo.`))return
  if(field.id)setRemoved(current=>[...current,field.id])
  update({fields:form.fields.filter(item=>item.key!==field.key)})
 }
 const onMapClick=point=>{
  if(mode==='pin'){update({location:point});setMode('')}
  else if(mode==='draw')setDraft(current=>[...current,point])
 }
 const finishDraft=()=>{
  if(draft.length<3)return
  addField({points:draft,areaHa:polygonAreaHa(draft).toFixed(2)})
  setDraft([]);setMode('')
 }
 const useGps=()=>{
  if(!navigator.geolocation){setState(current=>({...current,error:'Este aparelho não oferece localização por GPS ao navegador.'}));return}
  navigator.geolocation.getCurrentPosition(
   position=>update({location:{lat:Number(position.coords.latitude.toFixed(6)),lng:Number(position.coords.longitude.toFixed(6))}}),
   ()=>setState(current=>({...current,error:'Não consegui obter sua posição. Permita o acesso à localização ou marque no mapa.'})),
   {enableHighAccuracy:true,timeout:15000}
  )
 }
 const save=async()=>{
  setState(current=>({...current,saving:true,error:'',notice:''}))
  try{
   const response=await fetch(`/api/clients/${encodeURIComponent(client.id)}/property`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    propertyName:form.propertyName,location:form.location||null,removedFieldIds:removed,
    fields:form.fields.map(field=>({id:field.id,name:field.name,areaHa:numberOrNull(field.areaHa),crop:field.crop,season:field.season,points:field.points,clearGeometry:field.clearGeometry}))
   }),signal:AbortSignal.timeout(20000)})
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   const payload=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(payload.error||'A propriedade não pôde ser salva.')
   setForm(fromProfile(payload));setRemoved([]);setDirty(false)
   setState({loading:false,saving:false,error:'',notice:'Propriedade e talhões salvos.'})
   onSaved?.('Propriedade e talhões salvos na memória do produtor.')
   await onRefreshPortfolio?.()
  }catch(error){setState(current=>({...current,saving:false,error:error.message||'A propriedade não pôde ser salva.'}))}
 }

 const mapped=form.fields.filter(field=>field.points.length>=3)
 const draftArea=draft.length>=3?formatHectares(polygonAreaHa(draft)):''

 return <section className="property-fields" aria-label="Propriedade e talhões no mapa">
  <header className="property-fields-head">
   <div>
    <small>NO MAPA</small>
    <label className="property-fields-name">Propriedade<input value={form.propertyName} placeholder={client?.commercial?.property||'Propriedade principal'} onChange={event=>update({propertyName:event.target.value})}/></label>
    <p>{form.location?<><MapPin size={14}/>Sede em {formatCoordinates(form.location)}</>:'Sede ainda sem localização no mapa.'}</p>
   </div>
   <div className="property-fields-tools" role="group" aria-label="Ferramentas do mapa">
    <button type="button" className={mode==='pin'?'active':''} onClick={()=>{setMode(mode==='pin'?'':'pin');setDraft([])}}><Crosshair size={16}/>{mode==='pin'?'Toque no mapa…':'Marcar sede'}</button>
    <button type="button" onClick={useGps}><LocateFixed size={16}/>Usar meu GPS</button>
    <button type="button" className={mode==='draw'?'active':''} onClick={()=>{setMode(mode==='draw'?'':'draw');setDraft([])}}><PencilRuler size={16}/>{mode==='draw'?'Desenhando…':'Desenhar talhão'}</button>
   </div>
  </header>

  {mode==='pin'&&<p className="property-fields-hint" role="status">Toque no ponto da sede da propriedade. Use o zoom até enxergar a casa ou o barracão.</p>}
  {mode==='draw'&&<p className="property-fields-hint" role="status">Toque nos cantos do talhão, um a um. {draft.length} ponto{draft.length===1?'':'s'} marcado{draft.length===1?'':'s'}{draftArea?` • ${draftArea}`:''}</p>}

  <SatelliteMap
   center={form.location}
   pins={form.location?[{...form.location,label:'',title:'Sede'}]:[]}
   polygons={mapped.map(field=>({points:field.points,label:field.name}))}
   draft={draft}
   fit={!mode}
   onClick={onMapClick}
   height={320}
   className={mode?'is-editing':''}
   label="Mapa da propriedade sobre imagem de satélite"
  />

  {mode==='draw'&&<div className="property-fields-draw">
   <button type="button" className="is-primary" disabled={draft.length<3} onClick={finishDraft}><Check size={16}/>Concluir talhão</button>
   <button type="button" disabled={!draft.length} onClick={()=>setDraft(current=>current.slice(0,-1))}><Undo2 size={16}/>Desfazer ponto</button>
   <button type="button" onClick={()=>{setDraft([]);setMode('')}}><X size={16}/>Cancelar</button>
  </div>}

  <div className="property-fields-list">
   <div className="property-fields-list-head"><h5>Talhões</h5><button type="button" onClick={()=>addField()}><Plus size={15}/>Adicionar sem contorno</button></div>
   {form.fields.length
    ?form.fields.map(field=><div className="property-field-row" key={field.key}>
      <label>Nome<input value={field.name} onChange={event=>updateField(field.key,{name:event.target.value})}/></label>
      <label>Área (ha)<input inputMode="decimal" value={field.areaHa} placeholder={field.points.length>=3?formatHectares(polygonAreaHa(field.points)):'Ex.: 42,5'} onChange={event=>updateField(field.key,{areaHa:event.target.value})}/></label>
      <label>Cultura<input value={field.crop} placeholder="Ex.: soja" onChange={event=>updateField(field.key,{crop:event.target.value})}/></label>
      <label>Safra<input value={field.season} placeholder="2025/26" onChange={event=>updateField(field.key,{season:event.target.value})}/></label>
      <span className={`property-field-geo${field.points.length>=3?' is-mapped':''}`}>{field.points.length>=3?'Contorno no mapa':'Sem contorno'}</span>
      <button type="button" className="property-field-remove" aria-label={`Remover talhão ${field.name}`} onClick={()=>removeField(field)}><Trash2 size={15}/></button>
     </div>)
    :<p className="property-fields-empty">Nenhum talhão cadastrado. Desenhe no mapa ou adicione pelo nome.</p>}
  </div>

  <footer className="property-fields-foot">
   <small>{state.loading?'Carregando o que já está registrado…':'Sede e talhões ficam na memória do produtor e alimentam o Manual do Agrônomo e a rota das visitas.'}</small>
   <div>
    {form.location&&<button type="button" className="is-ghost" onClick={()=>update({location:null})}>Limpar sede</button>}
    <button type="button" className="is-primary" disabled={state.saving||state.loading||!dirty} onClick={save}><Save size={16}/>{state.saving?'Salvando…':'Salvar propriedade'}</button>
   </div>
  </footer>
  {state.error&&<p className="property-fields-error" role="alert">{state.error}</p>}
  {state.notice&&<p className="property-fields-notice" role="status">{state.notice}</p>}
 </section>
}
