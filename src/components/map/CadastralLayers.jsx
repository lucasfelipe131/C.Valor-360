import React,{useEffect,useRef,useState} from 'react'
import {Layers,Upload,Trash2,Search,RefreshCw} from 'lucide-react'
import {CADASTRAL_TYPES,CADASTRAL_COLORS,normalizeCadastralGeoJSON,filterCadastral} from '../../lib/cadastral-map'
import {createCadastralLoader,officialReferenceLayers,cadastralViewportKey} from '../../lib/cadastral-viewport'
export default function CadastralLayers({onChange,viewport,onStatusChange,panelOnly=false}){
 const [open,setOpen]=useState(false),[imports,setImports]=useState([]),[type,setType]=useState('CAR'),[query,setQuery]=useState(''),[error,setError]=useState(''),[uploading,setUploading]=useState(false)
 const [payload,setPayload]=useState(null),[status,setStatus]=useState('idle'),[visible,setVisible]=useState({CAR:true,SIGEF:true,'Matrícula':true})
 const file=useRef(null),loader=useRef(null)
 useEffect(()=>{loader.current=createCadastralLoader({onData:setPayload,onStatus:(next,message='')=>{setStatus(next);setError(message)}});return()=>loader.current?.cancel()},[])
 const viewportKey=cadastralViewportKey(viewport)
 useEffect(()=>{loader.current?.update(viewport);return()=>loader.current?.cancel()},[viewportKey])
 useEffect(()=>{
  const official=payload?officialReferenceLayers(payload).filter(layer=>visible[layer.type]):[]
  onChange([...official,...imports.filter(l=>l.visible)].map(l=>({...l,geojson:filterCadastral(l.geojson,query)})))
 },[payload,imports,query,visible,onChange])
 const upload=async event=>{
  const selected=event.target.files?.[0];event.target.value='';if(!selected)return
  setUploading(true);setError('')
  try{if(selected.size>5*1024*1024)throw new Error('Use um arquivo de até 5 MB.');if(imports.length>=6)throw new Error('Remova uma importação antes de adicionar outra (máximo 6).');const geojson=normalizeCadastralGeoJSON(JSON.parse(await selected.text()));setImports(current=>[...current,{id:crypto.randomUUID(),name:selected.name,type,color:CADASTRAL_COLORS[type],visible:true,geojson}])}catch(e){setError(e instanceof SyntaxError?'Arquivo inválido. Exporte como GeoJSON WGS84.':e.message)}finally{setUploading(false)}
 }
 useEffect(()=>{
  const unavailable=['car','sigef'].filter(key=>payload?.[key]?.status==='unavailable')
  const text=status==='loading'?'Carregando CAR, SIGEF e matrículas…':status==='idle'?'Cadastros automáticos: aproxime o mapa.':status==='error'?'Cadastros indisponíveis. Abra Camadas para tentar novamente.':unavailable.length?`${unavailable.map(key=>key.toUpperCase()).join(' / ')} indisponível. Veja Camadas.`:`Cadastros atualizados · ${viewport?.uf||''}`
  onStatusChange?.(text)
 },[status,payload,viewportKey,onStatusChange])
 const official=payload?officialReferenceLayers(payload):[]
 return <div className="val-cadastral">{!panelOnly&&<button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Layers size={16}/>Camadas e cadastros</button>}{(panelOnly||open)&&<div className="val-cadastral-panel">
  <strong>CAR • SIGEF • Matrículas</strong><p className="val-cadastral-auto" role="status">{status==='loading'?'Carregando cadastros da área visível…':status==='idle'?'Aproxime o mapa para carregar os cadastros automaticamente.':status==='error'?'Consulta indisponível. Tente atualizar as camadas.':`Atualização automática · ${viewport?.uf||''}`}</p>
  <div className="val-cadastral-toggles" role="group" aria-label="Cadastros automáticos">{CADASTRAL_TYPES.map(t=><button type="button" key={t} aria-pressed={visible[t]} onClick={()=>setVisible(v=>({...v,[t]:!v[t]}))}><i style={{background:CADASTRAL_COLORS[t]}}/>{t}{status==='ready'&&<span>{filterCadastral(official.find(l=>l.type===t)?.geojson||{features:[]},query).features.length}</span>}</button>)}</div>
  {payload&&<div className="val-cadastral-sources">{['car','sigef'].map(key=><p key={key}><b>{key.toUpperCase()}</b> · {payload[key]?.note||'Fonte indisponível.'}</p>)}<p>Matrículas: números informados pelo SIGEF. Sem número na fonte, a parcela não entra neste filtro.</p>{(payload.car?.limited||payload.sigef?.limited)&&<p>A consulta atingiu o limite de resultados. Aproxime o mapa para ver mais detalhes.</p>}</div>}
  <button type="button" disabled={!viewportKey||status==='loading'} onClick={()=>loader.current?.update(viewport,{refresh:true})}><RefreshCw size={15}/>Atualizar camadas</button>
  <label><Search size={14}/>Filtrar código / matrícula / nome<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nos cadastros carregados"/></label>
  <details><summary>Adicionar arquivo de referência</summary><p>Importe um GeoJSON WGS84 para sobrepor seus limites.</p><div className="val-cadastral-upload"><label>Tipo<select value={type} disabled={uploading} onChange={e=>setType(e.target.value)}>{CADASTRAL_TYPES.map(t=><option key={t}>{t}</option>)}</select></label><input ref={file} type="file" accept=".geojson,.json" hidden onChange={upload}/><button type="button" disabled={uploading} onClick={()=>file.current?.click()}><Upload size={16}/>{uploading?'Lendo…':'Importar limite'}</button></div></details>
  {imports.map(layer=><div className="val-cadastral-item" key={layer.id}><label><input type="checkbox" checked={layer.visible} onChange={()=>setImports(current=>current.map(l=>l.id===layer.id?{...l,visible:!l.visible}:l))}/><span style={{color:layer.color}}>●</span>{layer.type} · {layer.name} ({filterCadastral(layer.geojson,query).features.length})</label><button type="button" aria-label={`Remover camada ${layer.name}`} onClick={()=>setImports(current=>current.filter(l=>l.id!==layer.id))}><Trash2 size={14}/></button></div>)}
  <p>Referências desta tela. Não vinculam imóveis ao produtor. CAR e SIGEF não substituem a conferência da matrícula.</p>{error&&<p role="alert">{error}</p>}
 </div>}</div>
}
