import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Layers,Upload,Trash2,Search,RefreshCw,Focus,PencilRuler} from 'lucide-react'
import {CADASTRAL_TYPES,CADASTRAL_COLORS,normalizeCadastralGeoJSON,filterCadastral,cadastralDetails,referenceParts} from '../../lib/cadastral-map'
import {parseCadastralFile,prepareReferenceDraft} from '../../lib/cadastral-import'
import {createCadastralLoader,officialReferenceLayers,cadastralViewportKey} from '../../lib/cadastral-viewport'

export default function CadastralLayers({onChange,viewport,onStatusChange,panelOnly=false,clientId=null,onFocusReference,onUseReference,adoptionDisabled=false}){
 const [open,setOpen]=useState(false),[imports,setImports]=useState([]),[type,setType]=useState('CAR'),[query,setQuery]=useState(''),[error,setError]=useState(''),[uploading,setUploading]=useState(false)
 const [payload,setPayload]=useState(null),[status,setStatus]=useState('idle'),[visible,setVisible]=useState({CAR:true,SIGEF:true,'Matrícula':true})
 const [registered,setRegistered]=useState(null),[registryStatus,setRegistryStatus]=useState('idle'),[registryAttempt,setRegistryAttempt]=useState(0)
 const [selectedId,setSelectedId]=useState(''),[limit,setLimit]=useState(12)
 const file=useRef(null),loader=useRef(null),importRun=useRef(0),cancelImport=useRef(null)
 useEffect(()=>{loader.current=createCadastralLoader({onData:setPayload,onStatus:(next,message='')=>{setStatus(next);setError(message)}});return()=>{loader.current?.cancel();importRun.current++;cancelImport.current?.()}},[])
 const viewportKey=cadastralViewportKey(viewport)
 const enabledSources=[...(visible.CAR?['car']:[]),...(visible.SIGEF||visible['Matrícula']?['sigef-particular','sigef-publico']:[])]
 const sourceKey=enabledSources.join(',')
 // update decides whether an in-flight query still covers the new view.
 useEffect(()=>{loader.current?.update(viewport,{sources:enabledSources})},[viewportKey,sourceKey])
 const sourceProgress=(()=>{
  if(!payload?.sourceStates)return ''
  const car=payload.sourceStates.car,sigef=[payload.sourceStates['sigef-particular'],payload.sourceStates['sigef-publico']]
  return [car!=='disabled'&&`CAR ${car==='loading'?'carregando':car==='error'?'indisponível':'pronto'}`,sigef.some(state=>state!=='disabled')&&`SIGEF ${sigef.includes('loading')?sigef.includes('ready')?'parcial, carregando restante':'carregando':sigef.every(state=>state==='error')?'indisponível':sigef.includes('error')?'parcial':'pronto'}`].filter(Boolean).join(' · ')
 })()
 useEffect(()=>{
  setRegistered(null)
  if(!clientId){setRegistryStatus('idle');return}
  let active=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  setRegistryStatus('loading')
  fetch(`/api/workspace?scope=producer-map&clientId=${encodeURIComponent(clientId)}`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Não foi possível consultar as matrículas cadastradas.')
   return response.json()
  }).then(data=>{
   if(!active)return
   const features=(data.registrations||[]).flatMap(row=>{
    try{
     const coordinates=row.points.map(p=>[p.lng,p.lat]);if(coordinates[0][0]!==coordinates.at(-1)[0]||coordinates[0][1]!==coordinates.at(-1)[1])coordinates.push(coordinates[0])
     return normalizeCadastralGeoJSON({type:'Feature',geometry:{type:'Polygon',coordinates:[coordinates]},properties:{matricula:row.number,titular:row.ownerName,nome:row.propertyName,produtorVinculado:row.producerName,cartorio:row.registryOffice,situacao:row.status,fonte:row.source,demonstrativo:row.isDemo?'DEMO':''}}).features
    }catch{return []}
   }).map((feature,index)=>({...feature,properties:{...feature.properties,_referenceIndex:index+1}}))
   setRegistered({id:'registered-matriculas',name:'Matrículas cadastradas no Manual',type:'Matrícula',color:CADASTRAL_COLORS['Matrícula'],visible:true,registered:true,geojson:{type:'FeatureCollection',features}});setRegistryStatus('ready')
  }).catch(()=>{if(active)setRegistryStatus('error')}).finally(()=>clearTimeout(timer))
  return()=>{active=false;controller.abort();clearTimeout(timer)}
 },[clientId,registryAttempt])
 const allLayers=useMemo(()=>[...(payload?officialReferenceLayers(payload):[]),...(registered?[registered]:[]),...imports],[payload,registered,imports])
 const filteredLayers=useMemo(()=>allLayers.map(layer=>query.trim()?{...layer,geojson:filterCadastral(layer.geojson,query)}:layer),[allLayers,query])
 const shownLayers=useMemo(()=>filteredLayers.filter(layer=>visible[layer.type]&&layer.visible),[filteredLayers,visible])
 useEffect(()=>{onChange(shownLayers)},[shownLayers,onChange])
 const parts=useMemo(()=>shownLayers.flatMap(referenceParts),[shownLayers])
 const selected=parts.find(part=>part.id===selectedId)
 const prepared=useMemo(()=>{
  if(!selected)return null
  try{return prepareReferenceDraft(selected.feature)}catch(e){return {error:e.message}}
 },[selected])
 const select=part=>{setSelectedId(part.id);onFocusReference?.(part.feature)}
 const upload=async event=>{
  const chosen=event.target.files?.[0];event.target.value='';if(!chosen)return
  const run=++importRun.current;setUploading(true);setError('')
  try{
   if(chosen.size>5*1024*1024)throw new Error('Use um arquivo de até 5 MB.')
   if(imports.length>=6)throw new Error('Remova uma importação antes de adicionar outra (máximo 6).')
   const source=await chosen.text();if(run!==importRun.current)return
   // Parsing stays off the UI thread on mobile. No file leaves this browser.
   const geojson=typeof Worker==='undefined'?parseCadastralFile(source,chosen.name):await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../../lib/cadastral-import.worker.js',import.meta.url),{type:'module'})
    const finish=(error,data)=>{clearTimeout(timer);worker.terminate();cancelImport.current=null;error?reject(error):resolve(data)}
    const timer=setTimeout(()=>finish(new Error('A leitura demorou demais. Exporte uma propriedade por arquivo.')),20000)
    cancelImport.current=()=>finish(new Error('Importação cancelada.'))
    worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data.geojson)
    worker.onerror=()=>finish(new Error('Não foi possível ler o arquivo. Tente novamente.'))
    worker.postMessage({source,filename:chosen.name})
   })
   if(run!==importRun.current)return
   const layer={id:crypto.randomUUID(),name:chosen.name,type,color:CADASTRAL_COLORS[type],visible:true,geojson}
   setImports(current=>[...current,layer]);setVisible(current=>({...current,[type]:true}));setQuery('');setSelectedId('');setLimit(12)
   onFocusReference?.(geojson)
  }catch(e){if(run===importRun.current)setError(e instanceof SyntaxError?'Arquivo inválido. Use KML ou GeoJSON WGS84.':e.message)}
  finally{if(run===importRun.current)setUploading(false)}
 }
 useEffect(()=>{
  const unavailable=['car','sigef'].filter(key=>payload?.[key]?.status==='unavailable')
  onStatusChange?.(sourceProgress||(status==='loading'?'Atualizando CAR e SIGEF…':status==='idle'?'Cadastros automáticos: aproxime o mapa.':status==='error'?'Consulta indisponível. Camadas anteriores preservadas.':unavailable.length?`${unavailable.map(key=>key.toUpperCase()).join(' / ')} indisponível. Veja Camadas.`:`Cadastros atualizados · ${viewport?.uf||''}`))
 },[status,payload,viewportKey,onStatusChange,sourceProgress])
 const details=selected?cadastralDetails(selected.feature):null
 return <div className="val-cadastral">
  {!panelOnly&&<button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Layers size={16}/>Camadas e cadastros</button>}
  {(panelOnly||open)&&<div className="val-cadastral-panel">
   <strong>CAR • SIGEF • Matrículas</strong>
   <p className="val-cadastral-auto" role="status">{sourceProgress||(status==='loading'?'Atualizando referências da área visível…':status==='idle'?'Aproxime o mapa para consultar CAR e SIGEF. Você já pode importar um KML.':status==='error'?'Consulta indisponível. As referências anteriores permanecem visíveis; atualize para conferir.':`Atualização automática · ${viewport?.uf||''}`)}</p>
   <div className="val-cadastral-toggles" role="group" aria-label="Cadastros automáticos">{CADASTRAL_TYPES.map(t=>{const count=allLayers.filter(l=>l.type===t&&l.visible).reduce((sum,l)=>sum+filterCadastral(l.geojson,query).features.length,0);const loading=t==='CAR'?payload?.sourceStates?.car==='loading':payload?.loadingSources?.some(source=>source.startsWith('sigef'));return <button type="button" key={t} aria-pressed={visible[t]} onClick={()=>setVisible(value=>({...value,[t]:!value[t]}))}><i style={{background:CADASTRAL_COLORS[t]}}/>{t}<span>{count||loading?'':0}{count||''}{loading?'…':''}</span></button>})}</div>
   <div className="val-cadastral-upload"><label>Camada do arquivo<select value={type} disabled={uploading} onChange={e=>setType(e.target.value)}>{CADASTRAL_TYPES.map(t=><option key={t}>{t}</option>)}</select></label><input ref={file} type="file" accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json" hidden onChange={upload}/><button type="button" disabled={uploading} onClick={()=>file.current?.click()}><Upload size={16}/>{uploading?'Lendo arquivo…':'Importar KML / GeoJSON'}</button></div>
   <p>Importe o KML do CAR para visualizar os limites e usá-los como base do talhão.</p>
   <label><Search size={14}/>Buscar matrícula, titular ou imóvel<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(12)}} placeholder="Nome do titular ou número da matrícula"/></label>
   {clientId&&<p role="status">{registryStatus==='loading'?'Carregando matrículas cadastradas…':registryStatus==='error'?<>Matrículas cadastradas indisponíveis. <button type="button" onClick={()=>setRegistryAttempt(value=>value+1)}>Tentar novamente</button></>:registryStatus==='ready'&&!registered?.geojson.features.length?'Nenhuma matrícula com contorno cadastrada para este produtor.':'Titulares do cadastro do Manual identificados pela fonte.'}</p>}
   {selected&&<section className="val-reference-preview" aria-label="Prévia do limite selecionado">
    <strong>{selected.label}</strong>
    <dl><dt>Matrícula</dt><dd>{details.registry||'Não informada'}</dd><dt>Titular</dt><dd>{details.holder||'Não informado na fonte'}</dd><dt>Fonte</dt><dd>{selected.layer.name}{selected.layer.official?' · consulta oficial':selected.layer.registered?' · cadastro do usuário':' · declarado no arquivo'}</dd></dl>
    {details.holder&&<p>Nome informado na fonte; vínculo de propriedade sujeito à conferência da matrícula.</p>}
    {onUseReference&&<>
     <p>{prepared?.error||`${prepared.areaHa.toLocaleString('pt-BR',{maximumFractionDigits:2})} ha de contorno. Confirme qual parte é produtiva.`}</p>
     {prepared?.simplified&&<p>Prévia simplificada: {prepared.originalVertices} → {prepared.points.length} pontos; diferença de área de {prepared.differencePercent.toFixed(3)}%. Revise o desenho antes de salvar.</p>}
     <button type="button" disabled={adoptionDisabled||Boolean(prepared?.error)} onClick={()=>onUseReference({...prepared,label:selected.label,source:selected.layer.name},'contour')}><PencilRuler size={16}/>Usar contorno no talhão</button>
     <button type="button" disabled={adoptionDisabled} onClick={()=>onUseReference({points:[],label:selected.label,source:selected.layer.name},'guide')}>Desenhar usando este limite como guia</button>
     <p>Escolha cultura e safra, revise a área e salve o mapeamento para confirmar.</p>
    </>}
   </section>}
   <div className="val-reference-results" aria-label="Imóveis e matrículas carregados">
    {parts.slice(0,limit).map(part=>{const d=cadastralDetails(part.feature);return <button type="button" key={part.id} aria-pressed={selectedId===part.id} onClick={()=>select(part)}><Focus size={16}/><span><b>{part.layer.type} · {d.registry||part.label}</b><small>{d.holder?`Titular: ${d.holder}`:'Titular não informado na fonte'}</small><small>{part.layer.name}{part.feature.properties.demonstrativo==='DEMO'?' · DEMONSTRATIVO':''}</small></span></button>})}
    {!parts.length&&<p>{query?'Nenhum limite corresponde à busca.':status==='loading'?'Buscando limites. Cada camada aparece assim que responder.':'Nenhum limite carregado nesta área.'}</p>}
    {parts.length>limit&&<button type="button" onClick={()=>setLimit(value=>value+12)}>Mostrar mais ({parts.length-limit})</button>}
   </div>
   {imports.map(layer=><div className="val-cadastral-item" key={layer.id}><label><input type="checkbox" checked={layer.visible} onChange={()=>setImports(current=>current.map(l=>l.id===layer.id?{...l,visible:!l.visible}:l))}/><span style={{color:layer.color}}>●</span>{layer.type} · {layer.name}</label><button type="button" aria-label={`Remover camada ${layer.name}`} onClick={()=>setImports(current=>current.filter(l=>l.id!==layer.id))}><Trash2 size={14}/></button></div>)}
   <button type="button" disabled={!viewportKey||status==='loading'} onClick={()=>{loader.current?.update(viewport,{refresh:true,sources:enabledSources});setRegistryAttempt(value=>value+1)}}><RefreshCw size={15}/>Atualizar camadas</button>
   {payload&&<details className="val-cadastral-sources"><summary>Fontes e atualização</summary>{['car','sigef'].map(key=><p key={key}><b>{key.toUpperCase()}</b> · {payload[key]?.note||(status==='loading'?'Aguardando esta fonte.':'Sem consulta disponível.')}{payload[key]?.queriedAt&&<> · Consulta: {new Date(payload[key].queriedAt).toLocaleString('pt-BR')}</>}</p>)}{(payload.car?.limited||payload.sigef?.limited)&&<p>Consulta parcial. Aguarde as fontes restantes ou aproxime o mapa para ver mais detalhes.</p>}</details>}
   <p>A consulta pública do SIGEF informa números de matrícula, sem titulares. Nomes aparecem somente quando constam no cadastro ou arquivo importado. Referências não vinculam imóveis automaticamente ao produtor.</p>
   {error&&<p role="alert">{error}</p>}
  </div>}
 </div>
}
