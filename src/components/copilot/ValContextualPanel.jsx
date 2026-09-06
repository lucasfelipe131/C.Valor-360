import React from 'react'
import {BookOpenCheck,ChevronRight,Clock3,Database,FileSearch,History,Leaf,PanelRightClose,ShieldCheck,Sprout,Target,UserRound} from 'lucide-react'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=700)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const labelDate=value=>{const date=new Date(value||'');return Number.isNaN(date.getTime())?'Não registrada':date.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).replace('.','')}
const clientIdOf=item=>String(item?.clientId??item?.client_id??'')

function Empty({children}){return <p className="val-context-empty">{children}</p>}
function Fact({label,value}){if(!text(value))return null;return <div className="val-context-fact"><small>{label}</small><b>{text(value)}</b></div>}

export default function ValContextualPanel({open,tab='context',onTab,onClose,client=null,context=null,visits=[],opportunities=[],latestPayload=null,history=[],onOpenModule,onSelectHistory}){
 if(!open)return null
 const reasoning=latestPayload?.advice?.ai_reasoning||{}
 const clientVisits=list(visits).filter(item=>client&&clientIdOf(item)===String(client.id)).sort((a,b)=>new Date(b.completedAt||b.updatedAt||b.scheduledAt||b.date||0)-new Date(a.completedAt||a.updatedAt||a.scheduledAt||a.date||0))
 const clientOpportunities=list(opportunities).filter(item=>client&&clientIdOf(item)===String(client.id))
 // "Ultima visita" e a ultima concluida; uma visita futura agendada aparecia aqui como se ja tivesse
 // acontecido.
 const completedVisit=item=>/COMPLETED|realizad|conclu|done/i.test(String(item?.lifecycleStatus??item?.status??''))||Boolean(item?.completedAt??item?.occurredAt)
 const lastVisit=clientVisits.find(completedVisit)||null
 const activeOpportunity=clientOpportunities.find(item=>!/fechado|perdido|cancelado/i.test(String(item.stage||'')))||clientOpportunities[0]
 const facts=list(reasoning.facts_used)
 const knowledge=list(reasoning.knowledge_refs)
 const agronomySources=reasoning.agronomic_context?.sources||{}
 const agronomySourceLabel=[
  ['Análises de solo',agronomySources.soil_analyses],
  ['Relatórios / observações',agronomySources.field_reports],
  ['Diagnósticos / anexos',agronomySources.attachments],
  ['NDVI / alertas',agronomySources.ndvi],
  ['Registros do Manual',agronomySources.manual_records]
 ].filter(([,value])=>Number(value)>0).map(([label,value])=>`${label}: ${value}`).join(' • ')
 const currentData=reasoning.premises?.current_data||{}
 const weatherLabel=/WEATHER/i.test(String(reasoning.intent||''))&&currentData.source
  ?`${currentData.status||'fonte identificada'} • ${currentData.source.name||currentData.source.source_name||currentData.source.id||'referência autorizada'}`
  :''
 const crops=Array.isArray(client?.cultures)?client.cultures.join(', '):client?.cultures||client?.commercial?.cultures
 const tabs=[['context','CONTEXTO',UserRound],['memory','MEMÓRIA',Database],['agronomy','AGRONOMIA',Sprout],['evidence','EVIDÊNCIAS',FileSearch],['history','HISTÓRICO',History]]
 return <aside className="val-contextual-panel" aria-label="Painel contextual da VAL">
  <header><div><small>APROFUNDAR</small><h2>{client?.name||context?.label||'Conversa geral'}</h2></div><button type="button" onClick={onClose} aria-label="Recolher painel contextual"><PanelRightClose/></button></header>
  <nav aria-label="Camadas de contexto">{tabs.map(([id,label,Icon])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>onTab?.(id)}><Icon/><span>{label}</span></button>)}</nav>
  <div className="val-contextual-body">
   {tab==='context'&&<section><div className="val-context-panel-heading"><UserRound/><div><small>CONTEXTO ATIVO</small><h3>O que acompanha esta conversa</h3></div></div>{client?<div className="val-context-facts"><Fact label="Produtor" value={client.name}/><Fact label="Cultura" value={crops}/><Fact label="Safra" value={client.commercial?.season||client.season}/><Fact label="Município" value={client.municipality}/><Fact label="Objeto ativo" value={context?.label}/><Fact label="Oportunidade" value={activeOpportunity?.title||activeOpportunity?.hypothesis}/><Fact label="Objetivo" value={reasoning.objective}/><Fact label="Compromisso" value={reasoning.next_commitment||lastVisit?.nextCommitment}/></div>:<Empty>Selecione um produtor quando quiser cruzar memória, histórico, agronomia e oportunidades. Mercado e commodities continuam disponíveis sem conta.</Empty>}</section>}
   {tab==='memory'&&<section><div className="val-context-panel-heading"><Database/><div><small>MEMÓRIA MATERIAL</small><h3>Somente o que muda decisão</h3></div></div>{client?<div className="val-memory-list"><Fact label="Perfil confirmado" value={client.primaryProfile}/><Fact label="Decisor / preferência" value={client.decisionDriver||client.commercial?.decisionMaker}/><Fact label="Última visita" value={lastVisit&&`${labelDate(lastVisit.completedAt||lastVisit.scheduledAt||lastVisit.date)} • ${lastVisit.summary||lastVisit.objective||lastVisit.status||'registro disponível'}`}/><Fact label="Último compromisso" value={lastVisit?.nextCommitment||lastVisit?.next_commitment}/><Fact label="Oportunidade ativa" value={activeOpportunity?.title||activeOpportunity?.hypothesis}/>{!lastVisit&&!activeOpportunity&&!client.primaryProfile&&<Empty>Nenhuma memória material ficou disponível nesta superfície.</Empty>}</div>:<Empty>Memória de produtor só aparece depois da seleção de uma conta autorizada.</Empty>}<p className="val-memory-policy"><ShieldCheck/>Conversa não promove memória. REGISTER exige revisão e confirmação.</p></section>}
   {tab==='agronomy'&&<section><div className="val-context-panel-heading"><Sprout/><div><small>AGRONOMIA</small><h3>Campo, análises e alertas</h3></div></div>{client?<><div className="val-context-facts"><Fact label="Culturas" value={crops}/><Fact label="Estágio / contexto" value={client.technicalContext?.stage||client.cropStage}/><Fact label="Necessidade / observação" value={client.additionalNeed||client.technicalContext?.observation}/><Fact label="Análises, diagnósticos e alertas" value={agronomySourceLabel}/><Fact label="Clima atual" value={weatherLabel}/><Fact label="Safety" value={reasoning.agronomic_context?.safety_note}/></div><button type="button" className="val-context-open" onClick={()=>onOpenModule?.('agro')}><Leaf/>Ver Inteligência Agronômica<ChevronRight/></button></>:<Empty>Abra uma análise ou selecione um produtor para trazer o contexto agronômico para a conversa.</Empty>}</section>}
   {tab==='evidence'&&<section><div className="val-context-panel-heading"><FileSearch/><div><small>EVIDÊNCIAS</small><h3>Fatos, fontes e conhecimento</h3></div></div>{facts.length?<ul className="val-context-evidence">{facts.slice(0,12).map((item,index)=><li key={item.id||index}><span>{item.source_type||item.sourceType||'fonte'}</span><p>{item.statement||item.claim_supported||item.title}</p></li>)}</ul>:<Empty>A resposta atual ainda não apresentou evidências materializadas.</Empty>}{knowledge.length>0&&<><div className="val-context-panel-heading is-small"><BookOpenCheck/><div><small>KNOWLEDGE ITEMS</small><h3>Biblioteca e Manual</h3></div></div><ul className="val-context-knowledge">{knowledge.slice(0,8).map((item,index)=><li key={item.id||item.knowledge_item_id||index}><BookOpenCheck/>{item.title||item.source_ref||item.id||'Referência governada'}</li>)}</ul></>}</section>}
   {tab==='history'&&<section><div className="val-context-panel-heading"><History/><div><small>HISTÓRICO</small><h3>Conversas organizadas por contexto</h3></div></div>{history.length?<div className="val-context-history">{history.map(item=><button type="button" key={item.key} onClick={()=>onSelectHistory?.(item)}><Clock3/><span><b>{item.label}</b><small>{item.group} • {item.turnCount} mensagens</small><p>{item.preview}</p></span><ChevronRight/></button>)}</div>:<Empty>Nenhuma conversa nesta sessão.</Empty>}</section>}
  </div>
 </aside>
}
