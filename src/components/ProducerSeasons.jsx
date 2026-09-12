import {useNavigationGuard} from '../lib/use-navigation-guard'
import React,{useEffect,useRef,useState} from 'react'
import {compareSeasons,cropPotential,emptySeasonCrops,numeric,previousYield,seasonCode,seasonOrder,validSeasonCode} from '../lib/producer-seasons'
import {formatNumber} from '../lib/producer-display'
import {openSeasonReport} from '../lib/season-report'
import '../val-producer-seasons.css'
export function useProducerSeasons(clientId){
 const [data,setData]=useState({clientId,status:'loading',seasons:[],isDemo:false,error:''}),[attempt,setAttempt]=useState(0)
 useEffect(()=>{
  let active=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort('timeout'),15000)
  setData({clientId,status:'loading',seasons:[],isDemo:false,error:''})
  fetch(`/api/clients/${encodeURIComponent(clientId)}/season-plans`,{signal:controller.signal}).then(async response=>{if(response.status===401)window.dispatchEvent(new Event('valor360:unauthorized'));if(!response.ok)throw new Error('Não foi possível carregar as safras.');return response.json()}).then(payload=>{if(active)setData({...payload,clientId,status:'ready',error:''})}).catch(error=>{if(active)setData({clientId,status:'error',seasons:[],isDemo:false,error:error.message})}).finally(()=>clearTimeout(timer))
  return()=>{active=false;clearTimeout(timer);controller.abort()}
 },[clientId,attempt])
 const visible=data.clientId===clientId?data:{clientId,status:'loading',seasons:[],isDemo:false,error:''}
 return {...visible,retry:()=>setAttempt(v=>v+1),saved:row=>setData(current=>current.clientId===clientId?({...current,seasons:[...current.seasons.filter(s=>s.season!==row.season),row]}):current)}
}
const blank=season=>({season,revision:0,sourceNote:'',observedOn:new Date().toISOString().slice(0,10),crops:emptySeasonCrops()})
const columns=[['areaHa','Área (ha)'],['expectedYield','Produtividade projetada (sc/ha)'],['actualYield','Produtividade realizada (sc/ha)'],['retainedSc','Reserva / consumo (sc)'],['otherBuyersSc','Outros compradores (sc)'],['targetSharePct','Participação desejada (%)'],['deliveredSc','Entrega declarada à unidade (sc)']]
export default function ProducerSeasons({client,resource}){
 const [selected,setSelected]=useState('2627V'),[newCode,setNewCode]=useState(''),[draft,setDraft]=useState(blank('2627V'))
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('')
 useNavigationGuard(dirty,{busy,label:'cadastro de safra'})
 const request=useRef(null)
 useEffect(()=>()=>request.current?.abort('unmount'),[])
 useEffect(()=>{if(!dirty)setDraft(resource.seasons.find(s=>s.season===selected)||blank(selected))},[selected,resource.seasons,dirty])
 const switchSeason=code=>{if(dirty&&!window.confirm('Descartar alterações não salvas desta safra?'))return;setDirty(false);setSelected(code);setNotice('');setError('')}
 const edit=patch=>{setDraft(current=>({...current,...patch}));setDirty(true);setNotice('')}
 const editCrop=(crop,key,value)=>edit({crops:draft.crops.map(row=>row.crop===crop?{...row,[key]:numeric(value)}:row)})
 const save=async()=>{
  // O servidor recusa a safra sem origem dos dados (400). Barrar aqui evita que o consultor
  // preencha as quatro culturas e so descubra o campo faltante depois da ida ao servidor.
  if(!String(draft.sourceNote||'').trim()){setError('Informe a origem dos dados antes de salvar a safra.');return}
  setBusy(true);setError('');const controller=new AbortController();request.current=controller;const timer=setTimeout(()=>controller.abort('timeout'),15000)
  try{
   const response=await fetch(`/api/clients/${encodeURIComponent(client.id)}/season-plans`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft),signal:controller.signal})
   if(response.status===401)window.dispatchEvent(new Event('valor360:unauthorized'))
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar a safra.')
   resource.saved(data.season);setDraft(data.season);setDirty(false);setNotice('Safra salva. Relatório e metas atualizados com os valores informados.')
  }catch(e){if(controller.signal.reason!=='unmount')setError(controller.signal.aborted?'A gravação não foi confirmada. Recarregue antes de tentar novamente.':e.message)}finally{clearTimeout(timer);request.current=null;setBusy(false)}
 }
 const codes=[...new Set(['2627V','2727I',...resource.seasons.map(s=>s.season),selected])].sort(compareSeasons)
 const history=resource.seasons.filter(s=>s.season!==selected).sort((a,b)=>compareSeasons(a.season,b.season))
 if(resource.status==='loading')return <section className="p360-card" role="status">Carregando safras…<span className="p360-skeleton"/></section>
 if(resource.status==='error')return <section className="p360-card" role="alert"><p>{resource.error}</p><button onClick={resource.retry}>Recarregar safras</button></section>
 return <section className="p360-card producer-seasons"><header><div><h3>Safras, potencial de grãos e metas</h3><p>Cadastro consolidado do produtor • áreas por cultura, sem duplicar os talhões.</p></div><button disabled={busy||dirty||!draft.revision} onClick={()=>{try{openSeasonReport(client,draft,history)}catch(e){setError(e.message)}}}>Relatório / PDF</button></header>
 {resource.isDemo&&<p className="p360-demo-notice">Dados demonstrativos • sem validade para produtores reais.</p>}
 <div className="season-form-head"><label>Safra<select disabled={busy} value={selected} onChange={e=>switchSeason(e.target.value)}>{codes.map(code=><option key={code}>{code}</option>)}</select></label><label>Nova safra (nome livre)<input disabled={busy} value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} placeholder="Ex.: Verão 2028/29" maxLength={30}/></label><button disabled={busy||!validSeasonCode(newCode)} onClick={()=>{switchSeason(seasonCode(newCode));setNewCode('')}}>Criar / abrir safra</button><p>Digite o nome que utiliza: 2829V, Inverno 2029 ou Safrinha 2029. Preencha e salve para cadastrar. A média automática usa somente códigos com período reconhecido; nos demais, informe a projeção manualmente.</p></div>
 <div className="season-form-head"><label className="season-source">Origem dos dados (obrigatório)<input disabled={busy} required aria-required="true" value={draft.sourceNote} onChange={e=>edit({sourceNote:e.target.value})} maxLength={500} placeholder="Conversa com o produtor, levantamento ou documento"/></label><label>Data de referência<input disabled={busy} type="date" value={draft.observedOn} max={new Date().toISOString().slice(0,10)} onChange={e=>edit({observedOn:e.target.value})}/></label></div>
 <p className="season-explanation">Volumes em sacas de 60 kg. Deixe em branco o que não foi informado. Informe 0 apenas quando confirmado. A produtividade realizada registra o histórico; a projetada é a premissa usada no potencial.</p>
 <div className="season-crop-grid">{draft.crops.map(row=>{const potential=cropPotential(row),past=previousYield(resource.seasons,selected,row.crop);return <article className="season-crop" key={row.crop}><h4>{row.crop}</h4><div className="season-inputs">{columns.map(([key,label])=><label key={key}>{label}<input disabled={busy} aria-label={`${row.crop} — ${label}`} type="number" min="0" max={key==='targetSharePct'?100:undefined} step="any" value={row[key]??''} placeholder="Não informado" onChange={e=>editCrop(row.crop,key,e.target.value)}/></label>)}</div>{past&&<button disabled={busy} onClick={()=>{const refs=past.seasons.join(', ');edit({crops:draft.crops.map(r=>r.crop===row.crop?{...r,expectedYield:Number(past.yield.toFixed(4))}:r),sourceNote:`${draft.sourceNote}${draft.sourceNote?'; ':''}${row.crop}: projeção pela média ponderada das safras ${refs}`.slice(0,500)})}}>Usar média histórica: {formatNumber(past.yield)} sc/ha ({past.count} safras)</button>}
 <dl data-provenance={resource.isDemo?'DEMO':'ESTIMATE'}><div><dt>Produção estimada</dt><dd>{formatNumber(potential.productionSc)} sc</dd></div><div><dt>Potencial disponível para entrega</dt><dd>{formatNumber(potential.availableSc)} sc</dd></div><div><dt>Meta para a unidade</dt><dd>{formatNumber(potential.targetSc)} sc</dd></div><div><dt>Falta para a meta</dt><dd>{formatNumber(potential.remainingSc)} sc</dd></div></dl>{potential.conflict&&<p role="alert">Reserva e outros compradores excedem a produção estimada. Revise os valores.</p>}</article>})}</div>
 <p className="season-explanation">Potencial = área × produtividade projetada − reserva/consumo − outros compradores. Meta = potencial × participação desejada. As entregas declaradas ainda não são conciliadas com notas ou contratos. Projeções não criam oportunidades nem fatos no Copiloto.</p>
 <div className="season-save"><button className="season-primary" disabled={busy||!dirty} onClick={save}>{busy?'Salvando…':'Salvar safra e metas'}</button><button disabled={busy} onClick={()=>{if(!dirty||window.confirm('Descartar alterações e recarregar?')){setDirty(false);resource.retry()}}}>Recarregar</button>{dirty&&<span>Alterações não salvas • salve para gerar o relatório.</span>}</div>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 <h4>Produtividades de safras anteriores</h4><div className="p360-table-scroll"><table className="p360-table"><thead><tr><th>Safra</th><th>Cultura</th><th>Área (ha)</th><th>Realizada (sc/ha)</th><th>Fonte</th></tr></thead><tbody>{history.flatMap(s=>s.crops.filter(r=>r.actualYield!=null).map(r=><tr key={`${s.season}-${r.crop}`}><td>{s.season}</td><td>{r.crop}</td><td>{formatNumber(r.areaHa)}</td><td>{formatNumber(r.actualYield)}</td><td>{s.sourceNote}</td></tr>))}{!history.some(s=>s.crops.some(r=>r.actualYield!=null))&&<tr><td colSpan={5}>Sem produtividade histórica informada.</td></tr>}</tbody></table></div>
 </section>
}
