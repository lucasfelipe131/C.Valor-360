import React,{useEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,BadgeDollarSign,BrainCircuit,CalendarClock,ChevronDown,Fish,Gamepad2,HeartHandshake,Lightbulb,MapPin,MessageSquareText,Percent,Save,Target,Trophy} from 'lucide-react'
import ProducerProfileEditor from '../components/ProducerProfileEditor'
import ProducerBusinessOverview from '../components/ProducerBusinessOverview'
import ProducerFieldGallery from '../components/ProducerFieldGallery'
import VoiceCapture from '../components/voice/VoiceCapture'
import {compactBRL,commercialMetrics,metricValue} from '../lib/commercial-metrics'
import {canonicalVoiceChange,resolveCommitmentResource,selectLatestEvidenceVisit} from '../lib/copilot-view-model'

const Section=({title,children})=><article className="panel detail-section"><h3>{title}</h3>{children}</article>
const Drilldown=({eyebrow,title,children})=><details className="client-drilldown"><summary><span><small>{eyebrow}</small><b>{title}</b></span><ChevronDown/></summary><div className="client-drilldown-content">{children}</div></details>
const contextFields=['property','crops','area','weeds','diseases','insects','soil','goal','competitors','notes']
const contextBase=client=>({property:client.commercial?.property||'',crops:client.cultures||'',area:client.area||'',weeds:'',diseases:'',insects:'',soil:'',goal:'',competitors:'',notes:''})
const contextValues=value=>Object.fromEntries(contextFields.map(field=>[field,String(value?.[field]??'')]))
const contextDate=value=>{if(!value)return '';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'':parsed.toLocaleString('pt-BR')}
const localId=value=>{let hash=2166136261;for(const char of String(value||''))hash=Math.imul(hash^char.codePointAt(0),16777619);return (hash>>>0).toString(36)}
const money=value=>`R$ ${Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}`
const shown=value=>value===null||value===undefined||value===''?'Não informado':String(value)
const visitDate=visit=>{const parsed=new Date(visit?.completedAt||visit?.occurredAt||visit?.scheduledAt||visit?.date||'');return Number.isNaN(parsed.getTime())?null:parsed}
const shortDate=value=>{const parsed=value instanceof Date?value:new Date(value||'');return Number.isNaN(parsed.getTime())?'Data a confirmar':parsed.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).replace('.','')}
const terminalOpportunity=stage=>/fechado|ganho|perdido|cancelado|closed|won|lost/i.test(String(stage||''))

export default function Client360({client,visits=[],opportunities=[],storageScope,onBack,onPrepare,onUpdate,onSaved,onRefreshPortfolio,onAsk}){
 const metrics=commercialMetrics(client)
 const storageKey=`valor360-tech-${storageScope||'session'}-${localId(client.id)}`
 const [tech,setTech]=useState(()=>{
  try{const draft=JSON.parse(sessionStorage.getItem(storageKey));return draft?{...contextBase(client),...contextValues(draft)}:contextBase(client)}catch{return contextBase(client)}
 })
 const revisions=useRef(Object.fromEntries(contextFields.map(field=>[field,0])))
 const [contextMeta,setContextMeta]=useState({status:'',updatedAt:''})
 const [loadingContext,setLoadingContext]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const [overviewRevision,setOverviewRevision]=useState(0)
 const [commitmentResource,setCommitmentResource]=useState({status:'loading',items:[],error:''})
 const [voiceChange,setVoiceChange]=useState(null)
 const [memoryRefreshError,setMemoryRefreshError]=useState('')
 const additionalNeedLabel=client.additionalNeedStatus==='none_declared'?'Nenhuma necessidade adicional declarada':client.additionalNeed||'Não informado'
 const edit=(field,value)=>{revisions.current[field]=(revisions.current[field]||0)+1;setTech(current=>{const next={...current,[field]:value};sessionStorage.setItem(storageKey,JSON.stringify(next));return next})}
 const mergeRemote=(remote,started)=>setTech(current=>{const next={...current};contextFields.forEach(field=>{if(revisions.current[field]===started[field]&&remote?.[field]!==undefined)next[field]=String(remote[field]??'')});return next})

 useEffect(()=>{
  const controller=new AbortController();const started={...revisions.current};setLoadingContext(true);setError('')
  const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal
  fetch(`/api/clients/${encodeURIComponent(client.id)}/context`,{signal}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error('O complemento salvo não pôde ser carregado.');return response.json()}).then(payload=>{if(payload.context){mergeRemote(payload.context,started);setContextMeta({status:payload.context.status||'',updatedAt:payload.context.updatedAt||''})}}).catch(exception=>{if(exception.name!=='AbortError')setError(exception.name==='TimeoutError'?'O servidor demorou para carregar o complemento.':exception.message)}).finally(()=>{if(!controller.signal.aborted)setLoadingContext(false)})
  return()=>controller.abort()
 },[client.id])
 useEffect(()=>{
  const controller=new AbortController()
  setCommitmentResource(current=>({status:'loading',items:current.items,error:''}))
  const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal
  fetch(`/api/v1/commitments?clientId=${encodeURIComponent(client.id)}`,{signal}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Os compromissos não puderam ser verificados.');return payload}).then(payload=>{if(payload)setCommitmentResource({status:'success',items:Array.isArray(payload.commitments)?payload.commitments:[],error:''})}).catch(exception=>{if(exception.name!=='AbortError')setCommitmentResource({status:'error',items:[],error:exception.name==='TimeoutError'?'A verificação demorou além do limite.':exception.message})})
  return()=>controller.abort()
 },[client.id,overviewRevision])

 const save=async()=>{const snapshot=contextValues(tech);const started={...revisions.current};setSaving(true);setError('');try{const response=await fetch(`/api/clients/${encodeURIComponent(client.id)}/context`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível salvar o complemento.');if(payload.context){mergeRemote(payload.context,started);setContextMeta({status:payload.context.status||'',updatedAt:payload.context.updatedAt||''})}if(contextFields.every(field=>revisions.current[field]===started[field]))sessionStorage.removeItem(storageKey);setOverviewRevision(value=>value+1);onSaved?.('Complemento técnico salvo na nuvem e incorporado à memória da VAL.')}catch(exception){setError(exception.message)}finally{setSaving(false)}}

 const lastEvidenceVisit=useMemo(()=>selectLatestEvidenceVisit(visits,client.id),[visits,client.id])
 const activeOpportunity=useMemo(()=>opportunities.filter(item=>String(item.clientId)===String(client.id)&&!terminalOpportunity(item.stage)).sort((a,b)=>new Date(b.updatedAt||b.updated_at||0)-new Date(a.updatedAt||a.updated_at||0))[0]||null,[opportunities,client.id])
 const commitmentView=useMemo(()=>resolveCommitmentResource(commitmentResource),[commitmentResource])
 const opportunityText=activeOpportunity?.title||client.commercial?.opportunity||'Ainda não identificada — nenhuma oportunidade confirmada neste momento.'
 const changedText=voiceChange?.summary||lastEvidenceVisit?.summary||(contextMeta.updatedAt?`Contexto do consultor atualizado em ${shortDate(contextMeta.updatedAt)}.`:'Nenhuma mudança recente confirmada.')
 const lastVisitInProgress=lastEvidenceVisit&&(String(lastEvidenceVisit.lifecycleStatus||lastEvidenceVisit.lifecycle_status).toUpperCase()==='IN_PROGRESS'||/em andamento|iniciad/i.test(String(lastEvidenceVisit.status||'')))
 const lastVisitText=lastEvidenceVisit?`${lastVisitInProgress?'Visita iniciada':'Visita confirmada'} em ${shortDate(visitDate(lastEvidenceVisit))}${lastEvidenceVisit.summary?` — ${lastEvidenceVisit.summary}`:lastEvidenceVisit.objective?` — objetivo registrado: ${lastEvidenceVisit.objective}`:''}`:'Nenhuma visita realizada ou iniciada.'
 const nextCommitmentText=commitmentView.state==='loading'?'Verificando compromissos confirmados…':commitmentView.state==='error'?'Não foi possível verificar os compromissos agora.':commitmentView.state==='ready'?`${commitmentView.commitment.description} — ${shortDate(commitmentView.commitment.due_at||commitmentView.commitment.dueAt)}`:'Nenhum compromisso futuro confirmado.'

 return <div className="page-stack client-memory-page">
  <button className="back-btn" onClick={onBack}><ArrowLeft size={17}/>Voltar</button>
  <section className="client-hero">
   <div><span className="eyebrow">MEMÓRIA DO PRODUTOR</span><h2>{client.name}</h2><p><MapPin size={15}/>{client.municipality} • {client.area} • {client.cultures}</p><div className="tag-row"><span>{metrics.profileMeasured?client.primaryProfile:'Perfil a medir'}</span><span>IRT {metricValue(client.irt,metrics.irtKnown)}</span><span>NPS {metricValue(client.nps,metrics.npsKnown)}</span></div></div>
   <div className="hero-actions"><button onClick={onAsk}><MessageSquareText size={17}/>Perguntar à VAL</button><button onClick={onPrepare}><BrainCircuit size={17}/>Preparar visita</button><VoiceCapture clientId={client.id} interactionType="CLIENT_NOTE" label="Registrar áudio" description="Conte o que mudou" sourceContext={{page:'CLIENT_360'}} onConfirmed={async payload=>{const canonical=canonicalVoiceChange(payload);setVoiceChange(canonical);setMemoryRefreshError('');setOverviewRevision(value=>value+1);try{await onRefreshPortfolio?.()}catch{setMemoryRefreshError('A informação foi confirmada, mas esta visão não conseguiu recarregar a carteira agora.')}onSaved?.(canonical?'Áudio confirmado e incorporado ao contexto futuro deste produtor.':'Revisão concluída sem nova informação consolidada.')}}/></div>
  </section>

  <section className="client-living-memory" aria-label="Memória viva do produtor">
   <header><div><span className="eyebrow">EM UMA LEITURA</span><h3>O que importa agora</h3></div><small>Somente informações registradas ou confirmadas.</small></header>
   <div className="client-memory-grid">
    <article><MessageSquareText/><small>O QUE MUDOU</small><p>{changedText}</p></article>
    <article className="is-priority"><Lightbulb/><small>PRIORIDADE / OPORTUNIDADE</small><p>{opportunityText}</p></article>
    <article><CalendarClock/><small>ÚLTIMA VISITA COMPROVADA</small><p>{lastVisitText}</p></article>
    <article><Target/><small>PRÓXIMO COMPROMISSO</small><p>{nextCommitmentText}</p>{commitmentView.state==='error'&&<em className="client-memory-source-status" role="status">{commitmentResource.error}</em>}</article>
   </div>
   {memoryRefreshError&&<p className="client-memory-refresh-error" role="status">{memoryRefreshError}</p>}
  </section>

  <Drilldown eyebrow="NEGÓCIO" title="Ver negócio, oportunidades e indicadores">
   <section className="four-grid"><div className="mini-stat producer-canonical-stat"><HeartHandshake/><small>IRT / NPS</small><b>{metricValue(client.irt,metrics.irtKnown)} <em>/</em> {metricValue(client.nps,metrics.npsKnown)}</b><span>Relacionamento e recomendação</span></div><div className="mini-stat producer-canonical-stat is-highlight"><BadgeDollarSign/><small>Potencial em aberto</small><b>{compactBRL(metrics.openPotential,{known:metrics.openPotentialKnown})}</b><span>Potencial total menos compras atuais</span></div><div className="mini-stat producer-canonical-stat"><Target/><small>Pipeline aberto</small><b>{compactBRL(metrics.openPipeline,{known:metrics.pipelineKnown})}</b><span>Oportunidades ainda não fechadas</span></div><div className="mini-stat producer-canonical-stat"><Percent/><small>Share realizado</small><b>{metricValue(metrics.realizedShare,metrics.shareKnown,'%')}</b><span>Compras atuais sobre o potencial</span></div></section>
   <ProducerBusinessOverview client={client} refreshToken={overviewRevision}/>
   <Section title="Cadastro comercial de referência"><dl className="info-list commerce-detail-list"><div><dt>Compras globais registradas</dt><dd>{money(client.commercial?.purchaseTotal)}</dd></div><div><dt>Negócios reconhecidos</dt><dd>{Number(client.commercial?.purchaseCount||0)}</dd></div><div><dt>Categorias principais</dt><dd>{shown(client.commercial?.mainCategories)}</dd></div><div><dt>Concorrentes</dt><dd>{shown(client.commercial?.competitors)}</dd></div><div><dt>Telefone</dt><dd>{shown(client.commercial?.phone)}</dd></div><div><dt>E-mail</dt><dd>{shown(client.commercial?.email)}</dd></div></dl></Section>
   {client.commercial?.score!==undefined&&<Section title="Indicadores descritivos do histórico de negócios"><div className="learned-business-grid"><div><small>ÍNDICE HEURÍSTICO</small><b>{client.commercial.score}/100</b><span>{client.commercial.priority} prioridade de triagem</span></div><div><small>VOLUME INFORMADO</small><b>R$ {Number(client.commercial.revenue||0).toLocaleString('pt-BR')}</b><span>{client.commercial.frequency||0} registros reconhecidos</span></div><div><small>TICKET MÉDIO INFORMADO</small><b>{client.commercial.averageTicket===null?'Não calculado':`R$ ${Number(client.commercial.averageTicket||0).toLocaleString('pt-BR',{maximumFractionDigits:0})}`}</b><span>{client.commercial.conversion===null?'Status de ganho/perda não informado':`${client.commercial.conversion}% entre os ${client.commercial.knownOutcomes||0} resultados classificados`}</span></div><div><small>COBERTURA DE EVIDÊNCIA</small><b>{client.commercial.evidenceCoverage||0}%</b><span>{(client.commercial.categories||[]).join(' • ')||'Categorias a reconhecer'}</span></div></div></Section>}
  </Drilldown>

  <Drilldown eyebrow="RELACIONAMENTO" title="Ver perfil e preferências">
   <Section title="Preferências pessoais para um relacionamento próximo"><div className="relationship-glance"><div><Trophy/><small>Time do coração</small><b>{shown(client.relationship?.favoriteTeam)}</b></div><div><Fish/><small>Pescaria</small><b>{client.relationship?.likesFishing?'Gosta':client.relationship?.fishingStyle?'Preferência registrada':'Não informado'}</b><span>{shown(client.relationship?.fishingStyle)}</span></div><div><Gamepad2/><small>Hobbies</small><b>{shown(client.relationship?.hobbies)}</b></div><div><HeartHandshake/><small>Família</small><b>{shown(client.relationship?.family)}</b></div></div><dl className="info-list relationship-detail-list"><div><dt>Como prefere ser chamado</dt><dd>{shown(client.relationship?.preferredName)}</dd></div><div><dt>Aniversário</dt><dd>{shown(client.relationship?.birthday)}</dd></div><div><dt>Lazer</dt><dd>{shown(client.relationship?.leisure)}</dd></div><div><dt>Comidas e bebidas</dt><dd>{[client.relationship?.favoriteFoods,client.relationship?.favoriteDrinks].filter(Boolean).join(' • ')||'Não informado'}</dd></div><div><dt>Valores pessoais</dt><dd>{shown(client.relationship?.personalValues)}</dd></div><div><dt>Preferência de negociação</dt><dd>{shown(client.relationship?.negotiationPreferences)}</dd></div></dl></Section>
   <div className="detail-grid"><Section title="Como esse produtor quer ser atendido"><dl className="info-list"><div><dt>Canal</dt><dd>{client.servicePreference}</dd></div><div><dt>Frequência</dt><dd>{client.contactFrequency}</dd></div><div><dt>Conteúdo</dt><dd>{client.contentPreference}</dd></div><div><dt>Pós-venda</dt><dd>{client.postSalePreference}</dd></div></dl></Section><Section title="Como ele decide"><dl className="info-list"><div><dt>Principal influência</dt><dd>{client.decisionDriver}</dd></div><div><dt>Apresentação técnica</dt><dd>{client.technicalPresentation}</dd></div><div><dt>Confiança</dt><dd>{client.trustDriver}</dd></div><div><dt>Nova tecnologia</dt><dd>{client.innovationBehavior}</dd></div></dl></Section></div>
   <div className="detail-grid"><Section title="NPS e percepção de valor"><dl className="info-list"><div><dt>NPS</dt><dd>{client.nps} — {client.npsClass}</dd></div><div><dt>Mais valorizado</dt><dd>{client.valuedAspect}</dd></div><div><dt>Para nota 10</dt><dd>{client.missingFor10||'—'}</dd></div><div><dt>Necessidade adicional</dt><dd>{additionalNeedLabel}</dd></div></dl></Section><Section title="Escalas do relacionamento"><div className="score-bars">{Object.entries(client.scoresScale||{}).map(([key,value])=><div key={key}><span>{({trust:'Confiança',contact:'Contato',value:'Valor',innovation:'Inovação',continuity:'Continuidade',recommendation:'Recomendação'})[key]}</span><div><i style={{width:(Number(value||0)*10)+'%'}}></i></div><b>{value}/10</b></div>)}</div></Section></div>
   <Section title="Adicionar ou atualizar informações"><ProducerProfileEditor client={client} onSave={async(id,input)=>{await onUpdate?.(id,input);setOverviewRevision(value=>value+1);onSaved?.('Cadastro completo salvo na nuvem e atualizado para a VAL.')}}/></Section>
  </Drilldown>

  <Drilldown eyebrow="CAMPO E AGRONOMIA" title="Ver observações e dados técnicos">
   <ProducerFieldGallery clientId={client.id} clientName={client.name} onSaved={onSaved}/>
   <Section title="Complemento técnico preenchido pelo consultor"><div className="tag-row"><span>{loadingContext?'Carregando memória':contextMeta.status==='verified'?'Memória verificada':contextMeta.status==='proposed'?'Entrada do consultor • verificação pendente':'Ainda não registrada'}</span>{contextDate(contextMeta.updatedAt)&&<span>Atualizada em {contextDate(contextMeta.updatedAt)}</span>}</div><div className="form-grid"><label>Propriedade<input value={tech.property} onChange={event=>edit('property',event.target.value)} placeholder="Ex.: Fazenda Santa Rita"/></label><label>Área / culturas<input value={tech.area+' • '+tech.crops} onChange={()=>{}} readOnly/></label><label>Principais plantas daninhas<input value={tech.weeds} onChange={event=>edit('weeds',event.target.value)} placeholder="Ex.: buva em 20% do talhão; 3 plantas/m²"/></label><label>Doenças recorrentes<input value={tech.diseases} onChange={event=>edit('diseases',event.target.value)} placeholder="Ex.: ferrugem-asiática observada em R3"/></label><label>Insetos / pragas<input value={tech.insects} onChange={event=>edit('insects',event.target.value)} placeholder="Ex.: 2 percevejos por metro de pano"/></label><label>Resumo de solo<input value={tech.soil} onChange={event=>edit('soil',event.target.value)} placeholder="Ex.: pH 5,2 • V% 58 • argila 42%"/></label><label>Meta do produtor<input value={tech.goal} onChange={event=>edit('goal',event.target.value)} placeholder="Ex.: atingir 75 sc/ha de soja com margem positiva"/></label><label>Concorrentes / categorias adquiridas fora da empresa<input value={tech.competitors} onChange={event=>edit('competitors',event.target.value)} placeholder="Ex.: sementes — Empresa X; fungicidas — Empresa Y"/></label><label className="wide">Observações<textarea value={tech.notes} onChange={event=>edit('notes',event.target.value)} placeholder="Ex.: decisão em setembro; validar custo em R$/ha e resposta em sc/ha."/></label></div>{error&&<div className="form-error" role="alert">{error}</div>}<button className="primary-btn" onClick={save} disabled={saving}><Save size={16}/>{saving?'Salvando…':'Salvar na memória da VAL'}</button></Section>
  </Drilldown>
 </div>
}
