import React,{useMemo,useState} from 'react'
import {ArrowDownUp,ChevronRight,Clock3,MapPin,MessageCircle,Percent,Search,Sprout,Target,WalletCards} from 'lucide-react'
import {compactBRL,commercialMetrics,metricValue} from '../lib/commercial-metrics'
import {normalizeText} from '../lib/profile'
import {resolveOpportunityCandidate} from '../lib/opportunity-pipeline'

const filters=[['all','Todos'],['opportunity','Com oportunidade'],['potential','Potencial em aberto'],['profile','Perfil pendente']]
const clean=value=>String(value??'').trim()
const lastContact=client=>client.commercial?.lastContactDays!==null&&client.commercial?.lastContactDays!==undefined&&Number.isFinite(Number(client.commercial.lastContactDays))?Number(client.commercial.lastContactDays):null
const clientSearchText=client=>normalizeText([client.name,client.municipality,client.cultures,client.commercial?.property,client.primaryProfile,client.secondaryProfile,client.commercial?.opportunity,client.commercial?.mainCategories].map(clean).join(' '))
const opportunityFor=(client,items=[])=>items.find(item=>String(item.clientId)===String(client.id)&&String(item.stage||'').toLowerCase()!=='fechado')||null
const attentionScore=(client,opportunity)=>{const metrics=commercialMetrics(client);const days=lastContact(client);return (opportunity||resolveOpportunityCandidate(client)?50:0)+(opportunity?.nextActionAt&&new Date(opportunity.nextActionAt)<new Date()?35:0)+(metrics.openPotential>0?Math.min(30,Math.log10(metrics.openPotential+1)*5):0)+(days===null?4:Math.min(20,days/4))+(client.commercial?.decisionWindow?12:0)+(client.commercial?.commercialRisk?8:0)}

export default function Clients({clients=[],opportunities=[],onClient,onNew}){
 const [q,setQ]=useState('')
 const [filter,setFilter]=useState('all')
 const [sort,setSort]=useState('attention')
 const prepared=useMemo(()=>clients.map(client=>({client,metrics:commercialMetrics(client),candidate:resolveOpportunityCandidate(client),opportunity:opportunityFor(client,opportunities)})),[clients,opportunities])
 const list=useMemo(()=>prepared.filter(item=>{
  if(q&&!clientSearchText(item.client).includes(normalizeText(q)))return false
  if(filter==='opportunity'&&!item.candidate&&!item.opportunity)return false
  if(filter==='potential'&&!(item.metrics.openPotentialKnown&&item.metrics.openPotential>0))return false
  if(filter==='profile'&&item.metrics.profileMeasured)return false
  return true
 }).sort((a,b)=>{
  if(sort==='potential')return b.metrics.openPotential-a.metrics.openPotential||clean(a.client.name).localeCompare(clean(b.client.name),'pt-BR')
  if(sort==='contact')return (lastContact(b.client)??-1)-(lastContact(a.client)??-1)||clean(a.client.name).localeCompare(clean(b.client.name),'pt-BR')
  if(sort==='name')return clean(a.client.name).localeCompare(clean(b.client.name),'pt-BR')
  return attentionScore(b.client,b.opportunity)-attentionScore(a.client,a.opportunity)||clean(a.client.name).localeCompare(clean(b.client.name),'pt-BR')
 }),[prepared,q,filter,sort])
 const openTotal=prepared.reduce((sum,item)=>sum+(item.metrics.openPotentialKnown?item.metrics.openPotential:0),0)
 const activeCount=prepared.filter(item=>item.candidate||item.opportunity).length
 const pendingProfiles=prepared.filter(item=>!item.metrics.profileMeasured).length
 const openClient=item=>onClient(item.client)
 return <div className="page-stack producer-list-page">
  <section className="producer-portfolio-summary" aria-label="Resumo da carteira"><div><span className="eyebrow">CARTEIRA INTELIGENTE</span><h2>Produtores e prioridades</h2><p>Busque, filtre e abra cada dossiê sem perder o contexto comercial.</p></div><dl><div><dt>Produtores</dt><dd>{clients.length}</dd></div><div><dt>Potencial em aberto</dt><dd>{compactBRL(openTotal,{known:prepared.some(item=>item.metrics.openPotentialKnown)})}</dd></div><div><dt>Oportunidades</dt><dd>{activeCount}</dd></div><div><dt>Perfis pendentes</dt><dd>{pendingProfiles}</dd></div></dl></section>
  <section className="producer-list-controls" aria-label="Busca e organização da carteira">
   <div className="search-row"><div className="search-box"><Search size={18}/><input value={q} onChange={event=>setQ(event.target.value)} placeholder="Buscar nome, município, propriedade, cultura ou oportunidade..." aria-label="Buscar produtores"/></div><button className="primary-btn" onClick={onNew}>+ Novo produtor</button></div>
   <div className="producer-filter-row"><div role="group" aria-label="Filtrar produtores">{filters.map(([value,label])=><button type="button" key={value} className={filter===value?'active':''} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div><label><ArrowDownUp/><span>Ordenar</span><select value={sort} onChange={event=>setSort(event.target.value)} aria-label="Ordenar produtores"><option value="attention">Atenção comercial</option><option value="potential">Maior potencial em aberto</option><option value="contact">Mais tempo sem contato</option><option value="name">Nome A–Z</option></select></label></div>
  </section>
  <div className="list-summary"><span><b>{list.length}</b> de {clients.length} produtores</span><span>Dados protegidos no seu login</span></div>
  {list.length?<section className="client-grid">{list.map(item=>{const c=item.client;const metrics=item.metrics;const opportunity=item.opportunity;const days=lastContact(c);const opportunityTitle=opportunity?.title||item.candidate?.title||c.commercial?.opportunity||'Descoberta ainda não iniciada';return <article className="client-card" key={c.id} role="button" tabIndex="0" aria-label={`Abrir visão 360 de ${c.name}`} onClick={()=>openClient(item)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openClient(item)}}}>
   <div className="client-top"><div className="initials">{clean(c.name).split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'P'}</div><div className="client-pills"><span className={`profile-pill ${metrics.profileMeasured?'':'is-pending'}`}>{metrics.profileMeasured?c.primaryProfile:'Perfil a medir'}</span>{c.commercial?.score!==undefined&&<span className="ai-score-pill">Índice {c.commercial.score}</span>}</div></div>
   <div className="client-identity"><h3>{c.name}</h3><p><MapPin/>{clean(c.municipality)||'Município a informar'}</p><p><Sprout/>{clean(c.cultures)||'Culturas a informar'}</p></div>
   <div className="client-stats" aria-label={`Indicadores de ${c.name}`}>
    <span><Target/><small>IRT / NPS</small><b>{metrics.irtKnown?Number(c.irt).toLocaleString('pt-BR'):'—'} <em>/</em> {metrics.npsKnown?Number(c.nps).toLocaleString('pt-BR'):'—'}</b></span>
    <span className="is-highlight"><WalletCards/><small>Potencial aberto</small><b>{compactBRL(metrics.openPotential,{known:metrics.openPotentialKnown})}</b></span>
    <span><Target/><small>Pipeline</small><b>{compactBRL(metrics.openPipeline,{known:metrics.pipelineKnown})}</b></span>
    <span><Percent/><small>Share realizado</small><b>{metricValue(metrics.realizedShare,metrics.shareKnown,'%')}</b></span>
   </div>
   <div className="client-opportunity"><MessageCircle/><span><small>PRÓXIMA CONVERSA</small><b>{opportunityTitle}</b>{opportunity?.nextAction&&<em>{opportunity.nextAction}</em>}</span></div>
   <div className="client-footer"><span><Clock3/>{days===null?'Último contato a registrar':days===0?'Contato hoje':`${days} dias desde o contato`}</span><strong>Abrir visão 360 <ChevronRight/></strong></div>
  </article>})}</section>:<section className="producer-list-empty"><Search/><h3>Nenhum produtor encontrado</h3><p>Ajuste a busca ou os filtros; nenhum cadastro foi alterado.</p><button type="button" onClick={()=>{setQ('');setFilter('all')}}>Limpar filtros</button></section>}
 </div>
}
