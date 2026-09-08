import React,{useState,useEffect,useRef} from 'react'
import {seasonCode,validSeasonCode} from '../lib/producer-seasons'
import {ExternalLink,FileCheck} from 'lucide-react'
export default function ProducerTechnicalReport({client,seasons=[]}){
 const frame=useRef(null),[height,setHeight]=useState(1400)
 useEffect(()=>{const receive=event=>{if(event.origin===window.location.origin&&event.source===frame.current?.contentWindow&&event.data?.type==='val:technical-report-height'&&event.data.clientId===client.id&&Number.isFinite(event.data.height))setHeight(Math.max(500,Math.min(20000,event.data.height)))};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[client.id])
 const codes=[...new Set(['2627V','2727I',...seasons.map(s=>s.season)].filter(Boolean))].sort().reverse()
 const [selected,setSelected]=useState('2627V'),[newSeason,setNewSeason]=useState('')
 if(!codes.includes(selected))codes.unshift(selected)
 const url=`/tecnico/producer-report?clientId=${encodeURIComponent(client.id)}&season=${encodeURIComponent(selected)}`
 return <section className="p360-card p360-technical-report"><header><div className="p360-report-title"><span><FileCheck size={23}/></span><div><h3>Relatório técnico</h3><small>Manual do Agrônomo · planejamento e fechamento da safra</small></div></div><div className="p360-report-toolbar"><label className="p360-season-select">Safra<select value={selected} onChange={e=>setSelected(e.target.value)}>{codes.map(code=><option key={code}>{code}</option>)}</select></label><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Abrir ampliado</a></div></header><details className="p360-report-new-season"><summary>Criar ou abrir outra safra</summary><div className="season-form-head"><label>Nome da safra<input value={newSeason} onChange={e=>setNewSeason(e.target.value)} maxLength={30} placeholder="Ex.: Inverno 2029"/></label><button disabled={!validSeasonCode(newSeason)} onClick={()=>{setSelected(seasonCode(newSeason));setNewSeason('')}}>Abrir safra</button></div></details><iframe ref={frame} key={`${client.id}:${selected}`} title={`Relatório técnico de ${client.name}`} src={url} allow="camera; web-share" style={{width:'100%',height:`${height}px`,border:0,borderRadius:'12px',background:'#f5f9f7'}}/></section>
}
