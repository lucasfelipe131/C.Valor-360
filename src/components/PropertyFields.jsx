import React,{useEffect,useRef,useState} from 'react'
import {SlidersHorizontal,Check,Crosshair,LocateFixed,MapPin,PencilRuler,Plus,Save,Trash2,Undo2,X} from 'lucide-react'
import {cropColor,formatNumber} from '../lib/producer-display'
import {SEASON_CROPS,seasonCode,validSeasonCode} from '../lib/producer-seasons'
import {validProductiveRing,fieldProduction} from '../lib/productive-map'
import SatelliteMap from './map/SatelliteMap'
import {formatCoordinates,formatHectares,polygonAreaHa,validLocation} from '../lib/property-map'

// Propriedade e talhões no perfil do produtor. Sede por toque no mapa ou
// GPS; talhão desenhado tocando nos cantos, com área calculada do contorno.
// Tudo passa por confirmação explícita ("Salvar propriedade") — nada é
// gravado enquanto o consultor ainda está marcando.

const fieldKey=index=>`new-${Date.now().toString(36)}-${index}`
const numberOrNull=value=>{const parsed=Number(String(value??'').replace(',','.'));return value===''||value===null||value===undefined||!Number.isFinite(parsed)?null:parsed}
export const fromProfile=(profile,selectedSeason='')=>({
 propertyId:profile?.property?.id,
 propertyName:profile?.property?.name||'',
 location:validLocation(profile?.property?.location),
 fields:(profile?.fields||[]).map(field=>{
  const history=field.seasons?.length?field.seasons:(field.season?[{season:field.season,crop:field.crop,areaHa:field.areaHa,productivityTarget:field.productivityTarget,unit:field.productivityUnit||(field.productivityTarget!=null?'sc/ha':'')}]:[])
  const assignment=selectedSeason?history.find(row=>row.season===selectedSeason):history[0]
  const yieldValue=assignment?.unit==='sc/ha'?assignment.productivityTarget:null
  return {key:field.id,id:field.id,name:field.name,areaHa:(assignment?.areaHa??field.areaHa)==null?'':String(assignment?.areaHa??field.areaHa),crop:assignment?.crop||'',season:selectedSeason||assignment?.season||'',points:field.points||[],productivityTarget:yieldValue??'',productivityUnit:assignment?.unit||'',productivityTargetTouched:false,clearGeometry:false}
 })
})

export default function PropertyFields({client,onSaved,onRefreshPortfolio}){
 const [form,setForm]=useState(fromProfile(null))
 const savedProfile=useRef(null)
 const [mapSeason,setMapSeason]=useState('2627V')
 const mapSeasonRef=useRef(mapSeason);mapSeasonRef.current=mapSeason
 const [newMapSeason,setNewMapSeason]=useState('')
 const [removed,setRemoved]=useState([])
 const [mode,setMode]=useState('')
 const [draft,setDraft]=useState([])
 const [editKey,setEditKey]=useState(null)
 const [toolsOpen,setToolsOpen]=useState(false)
 const [drawing,setDrawing]=useState({crop:'',season:'2627V',productivityTarget:''})
 const [cropFilter,setCropFilter]=useState('')
 const [dirty,setDirty]=useState(false)
 const [loaded,setLoaded]=useState(false)
 const [properties,setProperties]=useState([])
 const [selection,setSelection]=useState({clientId:null,propertyId:undefined})
 const [state,setState]=useState({loading:true,saving:false,error:'',notice:''})
 const requestVersion=useRef(0)
 const saveRequest=useRef(null)
 const selectedPropertyId=selection.clientId===client?.id?selection.propertyId:undefined
 const busy=state.loading||state.saving||!loaded

 useEffect(()=>{
  const version=++requestVersion.current
  setEditKey(null);setCropFilter('');setForm(fromProfile(null));setLoaded(false);setMode('');setDraft([]);setRemoved([]);setDirty(false)
  if(!client?.id){setProperties([]);setState({loading:false,saving:false,error:'',notice:''});return}
  const controller=new AbortController()
  setState({loading:true,saving:false,error:'',notice:''})
  const query=selectedPropertyId?`?propertyId=${encodeURIComponent(selectedPropertyId)}`:''
  fetch(`/api/clients/${encodeURIComponent(client.id)}/property${query}`,{signal:controller.signal}).then(async response=>{
   if(controller.signal.aborted||version!==requestVersion.current)return null
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}
   const payload=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(payload.error||'A propriedade não pôde ser carregada agora.')
   return payload
  }).then(payload=>{
   if(controller.signal.aborted||version!==requestVersion.current)return
   if(payload){savedProfile.current=payload;setForm(fromProfile(payload,mapSeasonRef.current));setProperties(payload.properties||[]);setLoaded(true)}
   setState(current=>({...current,loading:false}))
  }).catch(error=>{if(!controller.signal.aborted&&version===requestVersion.current)setState(current=>({...current,loading:false,error:error.message}))})
  return()=>{controller.abort();saveRequest.current?.abort();requestVersion.current++}
 },[client?.id,selectedPropertyId])

 const selectProperty=propertyId=>{
  if(state.loading||state.saving||propertyId===form.propertyId)return
  if((dirty||draft.length)&&!window.confirm('Você tem alterações não salvas. Descartar as alterações e trocar de propriedade?'))return
  setSelection({clientId:client.id,propertyId})
 }
 const update=patch=>{if(busy)return;setForm(current=>({...current,...patch}));setDirty(true);setState(current=>({...current,error:'',notice:''}))}
 const updateField=(key,patch)=>update({fields:form.fields.map(field=>field.key===key?{...field,...patch,...(Object.hasOwn(patch,'productivityTarget')?{productivityTargetTouched:true}:{})}:field)})
 const addField=(extra={})=>update({fields:[...form.fields,{key:fieldKey(form.fields.length),id:null,name:`Talhão ${form.fields.length+1}`,areaHa:'',crop:'',season:mapSeason,points:[],productivityTarget:'',clearGeometry:false,...extra}]})
 const removeField=field=>{
  if(!window.confirm(`Remover o talhão "${field.name}"? Isso remove a área física de todas as safras; análises ligadas a ela perdem o vínculo.`))return
  if(field.id)setRemoved(current=>[...current,field.id])
  update({fields:form.fields.filter(item=>item.key!==field.key)})
 }
 const onMapClick=point=>{
  if(busy)return
  if(mode==='pin'){update({location:point});setMode('')}
  else if(mode==='draw')setDraft(current=>[...current,point])
 }
 const finishDraft=()=>{
  if(!validProductiveRing(draft)){setState(current=>({...current,error:'O contorno precisa de pelo menos três cantos distintos e não pode cruzar sobre si mesmo.'}));return}
  if(!drawing.crop||!validSeasonCode(drawing.season)){setState(current=>({...current,error:'Escolha a cultura e informe o nome da safra (2 a 30 caracteres).'}));return}
  const values={...drawing,season:mapSeason,points:draft,areaHa:polygonAreaHa(draft).toFixed(2)}
  if(editKey)updateField(editKey,values);else addField(values)
  setEditKey(null)
  setDraft([]);setMode('')
 }
 const useGps=()=>{
  if(!navigator.geolocation){setState(current=>({...current,error:'Este aparelho não oferece localização por GPS ao navegador.'}));return}
  const version=requestVersion.current
  navigator.geolocation.getCurrentPosition(
   position=>{if(version===requestVersion.current&&!saveRequest.current)update({location:{lat:Number(position.coords.latitude.toFixed(6)),lng:Number(position.coords.longitude.toFixed(6))}})},
   ()=>{if(version===requestVersion.current)setState(current=>({...current,error:'Não consegui obter sua posição. Permita o acesso à localização ou marque no mapa.'}))},
   {enableHighAccuracy:true,timeout:15000}
  )
 }
 const save=async()=>{
  if(busy||!dirty)return
  const version=requestVersion.current
  const controller=new AbortController()
  saveRequest.current=controller
  const timeout=setTimeout(()=>controller.abort('timeout'),20000)
  setState(current=>({...current,saving:true,error:'',notice:''}))
  try{
   const response=await fetch(`/api/clients/${encodeURIComponent(client.id)}/property`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    propertyId:form.propertyId,propertyName:form.propertyName,location:form.location||null,removedFieldIds:removed,
    fields:form.fields.map(field=>({id:field.id,name:field.name,areaHa:numberOrNull(field.areaHa),crop:field.crop,season:field.season,...((!field.id||field.productivityTargetTouched||field.productivityUnit==='sc/ha')?{productivityTarget:numberOrNull(field.productivityTarget)}:{}),points:field.points,clearGeometry:field.clearGeometry}))
   }),signal:controller.signal})
   if(controller.signal.aborted||version!==requestVersion.current)return
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   const payload=await response.json().catch(()=>({}))
   if(controller.signal.aborted||version!==requestVersion.current)return
   if(!response.ok)throw new Error(payload.error||'A propriedade não pôde ser salva.')
   savedProfile.current=payload;setForm(fromProfile(payload,mapSeasonRef.current));setProperties(payload.properties||[]);setRemoved([]);setDirty(false)
   setState({loading:false,saving:false,error:'',notice:'Propriedade e talhões salvos.'})
   onSaved?.('Propriedade e talhões salvos na memória do produtor.')
   await onRefreshPortfolio?.()
  }catch(error){if(version===requestVersion.current&&saveRequest.current===controller&&(!controller.signal.aborted||controller.signal.reason==='timeout'))setState(current=>({...current,saving:false,error:controller.signal.reason==='timeout'?'A gravação demorou demais. Tente novamente.':error.message||'A propriedade não pôde ser salva.'}))}
  finally{clearTimeout(timeout);if(saveRequest.current===controller)saveRequest.current=null}
 }

 const visible=form.fields.filter(field=>!cropFilter||field.crop===cropFilter)
 const mapped=visible.filter(field=>field.points.length>=3&&field.key!==editKey)
 const draftArea=draft.length>=3?formatHectares(polygonAreaHa(draft)):''

 const seasonCodes=[...new Set(['2627V','2727I',mapSeason,...(savedProfile.current?.fields||[]).flatMap(f=>(f.seasons||[]).map(row=>row.season)),...(savedProfile.current?.fields||[]).map(f=>f.season)].filter(Boolean))].sort().reverse()
 const changeMapSeason=code=>{
  if(busy||!validSeasonCode(code)&&!seasonCodes.includes(code))return
  if((dirty||draft.length)&&!window.confirm('Descartar alterações não salvas e trocar de safra?'))return
  setMapSeason(code);setDrawing(current=>({...current,season:code,crop:'',productivityTarget:''}));setForm(fromProfile(savedProfile.current,code));setDirty(false);setDraft([]);setEditKey(null);setMode('');setRemoved([]);setState(current=>({...current,error:'',notice:''}))
 }
 const navigateMap=()=>{if(draft.length&&!window.confirm('Descartar os pontos ainda não concluídos e voltar a navegar?'))return;setMode('');setDraft([]);setEditKey(null);setToolsOpen(false)}
 const startDrawing=()=>{if(draft.length&&!window.confirm('Descartar os pontos ainda não concluídos e iniciar outra área?'))return;setEditKey(null);setDraft([]);setDrawing({crop:'',season:mapSeason,productivityTarget:''});setMode('draw');setToolsOpen(true)}
 const editorActions=[
  {id:'pin',label:'Sede',Icon:Crosshair,disabled:busy,active:mode==='pin',onClick:()=>{if(draft.length&&!window.confirm('Descartar os pontos ainda não concluídos?'))return;setDraft([]);setEditKey(null);setMode('pin');setToolsOpen(false)}},
  {id:'draw',label:'Talhão / cultura',Icon:PencilRuler,disabled:busy,active:mode==='draw',onClick:startDrawing},
  {id:'filters',label:'Safras e culturas',Icon:SlidersHorizontal,disabled:busy,active:toolsOpen,onClick:()=>setToolsOpen(value=>!value)},
  {id:'gps',label:'Meu GPS',Icon:LocateFixed,disabled:busy,onClick:useGps}
 ]
 const footerTools=<div><span><b>{mapSeason}</b> · {dirty?'Alterações não salvas':'Mapeamento cadastrado'}{mode==='draw'?` · ${draft.length} pontos em desenho`:''}</span><button type="button" className="is-primary" disabled={busy||!dirty||mode==='draw'} onClick={save}><Save size={16}/>{state.saving?'Salvando…':'Salvar mapeamento'}</button>{state.error&&<small role="alert">{state.error}</small>}{state.notice&&<small role="status">{state.notice}</small>}</div>
 const editorTools=toolsOpen&&<div className="productive-map-tools">
 <button type="button" aria-expanded={toolsOpen} onClick={()=>setToolsOpen(value=>!value)}><PencilRuler size={16}/>{toolsOpen?'Recolher ferramentas':'Abrir ferramentas'}</button>
 {!toolsOpen&&mode==='draw'&&<button type="button" disabled={busy||draft.length<3} onClick={finishDraft}><Check size={16}/>Concluir área</button>}
 {toolsOpen&&<>
   <div className="property-fields-tools" role="group" aria-label="Ferramentas do mapa">
    <button type="button" disabled={busy} className={mode==='pin'?'active':''} onClick={()=>{setEditKey(null);setMode(mode==='pin'?'':'pin');setDraft([])}}><Crosshair size={16}/>{mode==='pin'?'Toque no mapa…':'Marcar sede'}</button>
    <button type="button" disabled={busy} onClick={useGps}><LocateFixed size={16}/>Usar meu GPS</button>
    <button type="button" disabled={busy} className={mode==='draw'?'active':''} onClick={()=>{setEditKey(null);setMode(mode==='draw'?'':'draw');setDraft([])}}><PencilRuler size={16}/>{mode==='draw'?'Desenhando…':'Circular área produtiva'}</button>
   </div>
 <div className="productive-map-filters"><label>Cultura no mapa<select value={cropFilter} onChange={e=>setCropFilter(e.target.value)}><option value="">Todas</option>{[...new Set(form.fields.map(f=>f.crop).filter(Boolean))].map(crop=><option key={crop}>{crop}</option>)}</select></label><label>Safra no mapa<select disabled={busy} value={mapSeason} onChange={e=>changeMapSeason(e.target.value)}>{seasonCodes.map(season=><option key={season}>{season}</option>)}</select></label><label>Nova safra<input value={newMapSeason} maxLength={30} placeholder="Ex.: Inverno 2029" onChange={e=>setNewMapSeason(e.target.value.toUpperCase())}/></label><button type="button" disabled={busy||!validSeasonCode(newMapSeason)} onClick={()=>{changeMapSeason(seasonCode(newMapSeason));setNewMapSeason('')}}>Criar / abrir safra</button></div>
 {mode==='draw'&&<div className="productive-drawing"><label>Cultura<select disabled={busy} value={drawing.crop} onChange={e=>setDrawing(current=>({...current,crop:e.target.value}))}><option value="">Selecionar</option>{SEASON_CROPS.map(crop=><option key={crop}>{crop}</option>)}</select></label><label>Safra<input readOnly value={mapSeason}/></label><label>Produtividade projetada (sc/ha)<input disabled={busy} type="number" min="0" max="1000" step="any" value={drawing.productivityTarget} placeholder="Não informada" onChange={e=>setDrawing(current=>({...current,productivityTarget:e.target.value}))}/></label><p>{draft.length} pontos · Área aproximada: {draftArea||'—'} · Potencial: {formatNumber(validProductiveRing(draft)?fieldProduction({...drawing,areaHa:polygonAreaHa(draft)}):null)} sc. Toque em um ponto azul para apagá-lo.</p><div className="property-fields-draw"><button type="button" disabled={busy||draft.length<3} onClick={finishDraft}><Check size={16}/>Concluir área</button><button type="button" disabled={busy||!draft.length} onClick={()=>setDraft(current=>current.slice(0,-1))}><Undo2 size={16}/>Desfazer ponto</button><button type="button" disabled={busy} onClick={()=>{setDraft([]);setEditKey(null);setMode('')}}><X size={16}/>Cancelar desenho</button></div></div>}
 <button type="button" className="is-primary" disabled={busy||!dirty||mode==='draw'} onClick={save}><Save size={16}/>Salvar propriedade</button>
 </>}
 {state.error&&<p role="alert">{state.error}</p>}{state.notice&&<p role="status">{state.notice}</p>}
 </div>

 return <section className="property-fields" aria-label="Propriedade e talhões no mapa">
  <header className="property-fields-head">
   <div>
    <small>NO MAPA</small>
    {properties.length>1&&<label className="property-fields-name">Escolher propriedade<select aria-label="Escolher propriedade" disabled={state.loading||state.saving} value={form.propertyId||selectedPropertyId||''} onChange={event=>selectProperty(event.target.value)}>{properties.map(property=><option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}
    <label className="property-fields-name">Propriedade<input disabled={busy} value={form.propertyName} placeholder={client?.commercial?.property||'Propriedade principal'} onChange={event=>update({propertyName:event.target.value})}/></label>
    <p>{form.location?<><MapPin size={14}/>Sede em {formatCoordinates(form.location)}</>:'Sede ainda sem localização no mapa.'}</p>
   </div>

  </header>

  {mode==='pin'&&<p className="property-fields-hint" role="status">Toque no ponto da sede da propriedade. Use o zoom até enxergar a casa ou o barracão.</p>}
  {mode==='draw'&&<p className="property-fields-hint" role="status">Toque nos cantos do talhão, um a um. {draft.length} ponto{draft.length===1?'':'s'} marcado{draft.length===1?'':'s'}{draftArea?` • ${draftArea}`:''}</p>}

  <SatelliteMap
   center={form.location}
   pins={form.location?[{...form.location,label:'',title:'Sede'}]:[]}
   polygons={mapped.map(field=>({points:field.points,color:cropColor(field.crop),label:`${field.name} • ${field.crop||'Cultura não informada'} • ${field.season||'Safra não informada'}`}))}
   adaptive
   editorActions={editorActions}
   onNavigateMap={navigateMap}
   onPanelChange={()=>setToolsOpen(false)}
   footerTools={footerTools}
   editorTools={editorTools}
   onDraftPointClick={mode==='draw'?index=>setDraft(current=>current.filter((_,i)=>i!==index)):null}
   draft={draft}
   fit={!mode}
   onClick={onMapClick}
   height={320}
   className={mode?'is-editing':''}
   label="Mapa da propriedade sobre imagem de satélite"
  />

  {mode==='draw'&&<div className="property-fields-draw">
   <button type="button" className="is-primary" disabled={busy||draft.length<3} onClick={finishDraft}><Check size={16}/>Concluir talhão</button>
   <button type="button" disabled={busy||!draft.length} onClick={()=>setDraft(current=>current.slice(0,-1))}><Undo2 size={16}/>Desfazer ponto</button>
   <button type="button" disabled={busy} onClick={()=>{setDraft([]);setEditKey(null);setMode('')}}><X size={16}/>Cancelar</button>
  </div>}

  <div className="property-fields-list">
   <div className="property-fields-list-head"><h5>Talhões</h5><button type="button" disabled={busy} onClick={()=>addField()}><Plus size={15}/>Adicionar sem contorno</button></div>
   {form.fields.length
    ?form.fields.map(field=><div className="property-field-row" key={field.key}>
      <label>Nome<input disabled={busy} value={field.name} onChange={event=>updateField(field.key,{name:event.target.value})}/></label>
      <label>Área (ha)<input disabled={busy} inputMode="decimal" value={field.areaHa} placeholder={field.points.length>=3?formatHectares(polygonAreaHa(field.points)):'Ex.: 42,5'} onChange={event=>updateField(field.key,{areaHa:event.target.value})}/></label>
      <label>Cultura<select disabled={busy} value={field.crop} onChange={event=>updateField(field.key,{crop:event.target.value})}><option value="">Não informada</option>{[...new Set([...SEASON_CROPS,field.crop].filter(Boolean))].map(crop=><option key={crop}>{crop}</option>)}</select></label>
      <label>Safra<input readOnly value={mapSeason}/></label>
      <label>Produtividade projetada (sc/ha)<input disabled={busy} type="number" min="0" max="1000" step="any" value={field.productivityTarget} placeholder="Não informada" onChange={event=>updateField(field.key,{productivityTarget:event.target.value})}/></label>
      <span className="property-field-potential">Potencial {field.crop||'da cultura'}: <b>{formatNumber(fieldProduction(field))} sc</b></span>
      <button type="button" disabled={busy||mode==='draw'} aria-label={`Editar contorno ${field.name}`} onClick={()=>{setEditKey(field.key);setDraft(field.points);setDrawing({crop:field.crop,season:field.season,productivityTarget:field.productivityTarget});setMode('draw');setToolsOpen(true)}}><PencilRuler size={15}/>Editar pontos</button>
      <span className={`property-field-geo${field.points.length>=3?' is-mapped':''}`}>{field.points.length>=3?'Contorno no mapa':'Sem contorno'}</span>
      <button type="button" disabled={busy} className="property-field-remove" aria-label={`Remover talhão ${field.name}`} onClick={()=>removeField(field)}><Trash2 size={15}/></button>
     </div>)
    :<p className="property-fields-empty">Nenhum talhão cadastrado. Desenhe no mapa ou adicione pelo nome.</p>}
  </div>

  <p className="property-fields-hint">O mesmo talhão é reutilizado entre safras; cultura e produtividade pertencem à safra selecionada. Áreas desenhadas são aproximações. Potencial por talhão = área × produtividade projetada (sacas de 60 kg). Não soma culturas nem presume que toda a propriedade é produtiva. As camadas cadastrais são apenas referências.</p>
  <footer className="property-fields-foot">
   <small>{state.loading?'Carregando o que já está registrado…':'Sede e talhões ficam na memória do produtor e alimentam o Manual do Agrônomo e a rota das visitas.'}</small>
   <div>
    {form.location&&<button type="button" disabled={busy} className="is-ghost" onClick={()=>update({location:null})}>Limpar sede</button>}
    <button type="button" className="is-primary" disabled={busy||!dirty||mode==='draw'} onClick={save}><Save size={16}/>{state.saving?'Salvando…':'Salvar propriedade'}</button>
   </div>
  </footer>
  {state.error&&<p className="property-fields-error" role="alert">{state.error}</p>}
  {state.notice&&<p className="property-fields-notice" role="status">{state.notice}</p>}
 </section>
}
