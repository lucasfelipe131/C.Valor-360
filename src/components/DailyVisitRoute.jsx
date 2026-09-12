import React,{useEffect,useState} from 'react'
import HomeVisitMap from './map/HomeVisitMap'
import {summarizeVisitSuggestion} from '../lib/visit-suggestion-summary'
import '../val-daily-route.css'

export default function DailyVisitRoute({clients,scheduled=[],storageScope,onClient,onOpenProperty,onPrepare}){
 const dayKey=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})
 const today=dayKey(new Date())
 const todayScheduled=scheduled.filter(row=>row.at&&dayKey(row.at)===today)
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/visit-routes/daily-suggestions',{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível consultar as sugestões.');return data})
   .then(data=>{const known=new Set(todayScheduled.map(row=>String(row.clientId)));setRows([...todayScheduled.map(row=>({...row,label:'Visita agendada',reason:row.objective,confirmed:true})),...data.suggestions.filter(row=>!known.has(String(row.clientId)))]);setError(data.truncated?'Parte do histórico ficou fora da consulta. Confira a carteira.':'')})
   .catch(e=>{if(!controller.signal.aborted){setRows(todayScheduled.map(row=>({...row,label:'Visita agendada',reason:row.objective,confirmed:true})));setError(e.message)}})
  return()=>controller.abort()
 },[storageScope,revision,today,JSON.stringify(scheduled)])
 useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh)},[])
 const move=(index,delta)=>setRows(current=>{const next=[...current];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next})
 return <div>
  <HomeVisitMap entries={rows} clients={clients} storageScope={storageScope} onOpenProperty={onOpenProperty}/>
  <p className="home-panel-note">Ordem sugerida por prioridade e proximidade em linha reta. Confirme disponibilidade e deslocamentos por estrada. Sugestões não são agendamentos.</p>
  {error&&<p role="status">{error}</p>}
  <ol className="daily-route-list">{rows.map((row,index)=>{const client=clients.find(c=>String(c.id)===String(row.clientId));const summary=summarizeVisitSuggestion(row);return <li className="daily-route-item" key={row.id}>
   <div className="daily-route-heading">
    <button className="home-producer-link daily-route-name" onClick={()=>client&&onClient(client)}>{row.clientName||client?.name}</button>
    <div className="daily-route-status"><span>{row.label}</span>
     {row.confirmed&&row.at&&<time>{new Date(row.at).toLocaleString('pt-BR')}</time>}
     {!row.confirmed&&row.dueAt&&<time>Prazo registrado: {new Date(row.dueAt).toLocaleDateString('pt-BR')}</time>}
    </div>
   </div>
   <p className="daily-route-reason">{summary.reason}</p>
   {summary.nextStep&&<p className="daily-route-next"><b>Próximo passo registrado:</b> {summary.nextStep}</p>}
   <div className="daily-route-actions">
    <button className="soft-btn" disabled={!client} onClick={()=>client&&onPrepare(client,row)}>Preparar visita</button>
    <div className="daily-route-order"><button aria-label={`Antecipar ${row.clientName}`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button>
     <button aria-label={`Mover ${row.clientName} para depois`} disabled={index===rows.length-1} onClick={()=>move(index,1)}>↓</button></div>
   </div>
   {(summary.full||summary.nextFull)&&<details className="daily-route-details"><summary>Ver registro completo</summary>
    <p>{summary.full}</p>{summary.nextFull&&summary.nextFull!==summary.full&&<p><b>Próximo passo registrado:</b> {summary.nextFull}</p>}
   </details>}
  </li>})}</ol>
  {!rows.length&&<p>Nenhum compromisso disponível para sugerir visitas.</p>}
  <button className="soft-btn" onClick={()=>setRevision(value=>value+1)}>Atualizar roteiro</button>
 </div>
}
