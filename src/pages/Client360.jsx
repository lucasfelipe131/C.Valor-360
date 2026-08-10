import React,{useEffect,useRef,useState} from 'react'
import { ArrowLeft, BrainCircuit, MapPin, BadgeDollarSign, HeartHandshake, MessageSquare, Target, Save, ShoppingCart, WalletCards, Trophy, Fish, Gamepad2 } from 'lucide-react'
import ProducerProfileEditor from '../components/ProducerProfileEditor'
const Section=({title,children})=><article className="panel detail-section"><h3>{title}</h3>{children}</article>
const contextFields=['property','crops','area','weeds','diseases','insects','soil','goal','competitors','notes']
const contextBase=client=>({property:client.commercial?.property||'',crops:client.cultures||'',area:client.area||'',weeds:'',diseases:'',insects:'',soil:'',goal:'',competitors:'',notes:''})
const contextValues=value=>Object.fromEntries(contextFields.map(field=>[field,String(value?.[field]??'')]))
const contextDate=value=>{if(!value)return '';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'':parsed.toLocaleString('pt-BR')}
const localId=value=>{let hash=2166136261;for(const char of String(value||''))hash=Math.imul(hash^char.codePointAt(0),16777619);return (hash>>>0).toString(36)}
const money=value=>`R$ ${Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}`
const shown=value=>value===null||value===undefined||value===''?'Não informado':String(value)
export default function Client360({client,storageScope,onBack,onPrepare,onUpdate,onSaved}){
 const storageKey=`valor360-tech-${storageScope||'session'}-${localId(client.id)}`
 const [tech,setTech]=useState(()=>{
  try{const draft=JSON.parse(sessionStorage.getItem(storageKey));return draft?{...contextBase(client),...contextValues(draft)}:contextBase(client)}catch{return contextBase(client)}
 })
 const revisions=useRef(Object.fromEntries(contextFields.map(field=>[field,0])))
 const [contextMeta,setContextMeta]=useState({status:'',updatedAt:''})
 const [loadingContext,setLoadingContext]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const additionalNeedLabel=client.additionalNeedStatus==='none_declared'?'Nenhuma necessidade adicional declarada':client.additionalNeed||'Não informado'
 const edit=(field,value)=>{revisions.current[field]=(revisions.current[field]||0)+1;setTech(current=>{const next={...current,[field]:value};sessionStorage.setItem(storageKey,JSON.stringify(next));return next})}
 const mergeRemote=(remote,started)=>setTech(current=>{const next={...current};contextFields.forEach(field=>{if(revisions.current[field]===started[field]&&remote?.[field]!==undefined)next[field]=String(remote[field]??'')});return next})
 useEffect(()=>{
  const controller=new AbortController();const started={...revisions.current};setLoadingContext(true);setError('')
  const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal
  fetch(`/api/clients/${encodeURIComponent(client.id)}/context`,{signal}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error('O complemento salvo não pôde ser carregado.');return response.json()}).then(payload=>{if(payload.context){mergeRemote(payload.context,started);setContextMeta({status:payload.context.status||'',updatedAt:payload.context.updatedAt||''})}}).catch(exception=>{if(exception.name!=='AbortError')setError(exception.name==='TimeoutError'?'O servidor demorou para carregar o complemento.':exception.message)}).finally(()=>{if(!controller.signal.aborted)setLoadingContext(false)})
  return()=>controller.abort()
 },[client.id])
 const save=async()=>{const snapshot=contextValues(tech);const started={...revisions.current};setSaving(true);setError('');try{const response=await fetch(`/api/clients/${encodeURIComponent(client.id)}/context`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível salvar o complemento.');if(payload.context){mergeRemote(payload.context,started);setContextMeta({status:payload.context.status||'',updatedAt:payload.context.updatedAt||''})}if(contextFields.every(field=>revisions.current[field]===started[field]))sessionStorage.removeItem(storageKey);onSaved?.(payload.context)}catch(exception){setError(exception.message)}finally{setSaving(false)}}
 return <div className="page-stack">
  <button className="back-btn" onClick={onBack}><ArrowLeft size={17}/>Voltar</button>
  <section className="client-hero">
   <div><span className="eyebrow">CLIENTE 360</span><h2>{client.name}</h2><p><MapPin size={15}/>{client.municipality} • {client.area} • {client.cultures}</p><div className="tag-row"><span>{client.primaryProfile}</span><span>{client.secondaryProfile}</span><span>IRT {client.irt}</span><span>NPS {client.nps}</span></div></div>
   <div className="hero-actions"><button onClick={onPrepare}><BrainCircuit size={17}/>Preparar com a VAL</button></div>
  </section>
  <section className="four-grid">
   <div className="mini-stat"><HeartHandshake/><small>Relacionamento</small><b>{client.irtBand}</b></div>
   <div className="mini-stat"><MessageSquare/><small>Atendimento preferido</small><b>{client.servicePreference}</b></div>
   <div className="mini-stat"><Target/><small>Oportunidade</small><b>{client.commercial?.opportunity||'Ainda não identificada'}</b></div>
   <div className="mini-stat"><BadgeDollarSign/><small>{client.commercial?.potentialValidated===false?'Índice de triagem':'Potencial validado'}</small><b>{client.commercial?.potentialValidated===false?`${client.commercial?.score||0}/100`:`R$ ${Number(client.commercial?.potential||0).toLocaleString('pt-BR')}`}</b></div>
  </section>
  <Section title="Visão global de compras e potencial"><div className="commerce-overview-grid">
   <div><ShoppingCart/><small>Compras globais registradas</small><b>{money(client.commercial?.purchaseTotal)}</b><span>{Number(client.commercial?.purchaseCount||0)} negócios reconhecidos</span></div>
   <div><BadgeDollarSign/><small>Compras da safra atual</small><b>{money(client.commercial?.purchaseCurrentSeason)}</b><span>Valor informado no cadastro</span></div>
   <div><WalletCards/><small>Potencial total</small><b>{money(client.commercial?.potentialTotal)}</b><span>Estimativa comercial declarada</span></div>
   <div><Target/><small>Potencial em aberto</small><b>{money(client.commercial?.openPotential??client.commercial?.openPipeline)}</b><span>Pipeline aberto: {money(client.commercial?.openPipeline)}</span></div>
  </div><dl className="info-list commerce-detail-list"><div><dt>Safra anterior</dt><dd>{money(client.commercial?.purchasePreviousSeason)}</dd></div><div><dt>Ticket médio global</dt><dd>{money(Number(client.commercial?.purchaseTotal||0)/Math.max(Number(client.commercial?.purchaseCount||0),1))}</dd></div><div><dt>Última compra</dt><dd>{client.commercial?.lastPurchaseAt?new Date(client.commercial.lastPurchaseAt).toLocaleDateString('pt-BR'):'Não informada'}</dd></div><div><dt>Participação na carteira</dt><dd>{client.commercial?.walletShare===null||client.commercial?.walletShare===undefined?'Não informada':`${client.commercial.walletShare}%`}</dd></div><div><dt>Categorias principais</dt><dd>{shown(client.commercial?.mainCategories)}</dd></div><div><dt>Concorrentes</dt><dd>{shown(client.commercial?.competitors)}</dd></div><div><dt>Telefone</dt><dd>{shown(client.commercial?.phone)}</dd></div><div><dt>E-mail</dt><dd>{shown(client.commercial?.email)}</dd></div></dl></Section>
  <Section title="Preferências pessoais para um relacionamento próximo"><div className="relationship-glance">
   <div><Trophy/><small>Time do coração</small><b>{shown(client.relationship?.favoriteTeam)}</b></div><div><Fish/><small>Pescaria</small><b>{client.relationship?.likesFishing?'Gosta':client.relationship?.fishingStyle?'Preferência registrada':'Não informado'}</b><span>{shown(client.relationship?.fishingStyle)}</span></div><div><Gamepad2/><small>Hobbies</small><b>{shown(client.relationship?.hobbies)}</b></div><div><HeartHandshake/><small>Família</small><b>{shown(client.relationship?.family)}</b></div>
  </div><dl className="info-list relationship-detail-list"><div><dt>Como prefere ser chamado</dt><dd>{shown(client.relationship?.preferredName)}</dd></div><div><dt>Aniversário</dt><dd>{shown(client.relationship?.birthday)}</dd></div><div><dt>Lazer</dt><dd>{shown(client.relationship?.leisure)}</dd></div><div><dt>Comidas e bebidas</dt><dd>{[client.relationship?.favoriteFoods,client.relationship?.favoriteDrinks].filter(Boolean).join(' • ')||'Não informado'}</dd></div><div><dt>Valores pessoais</dt><dd>{shown(client.relationship?.personalValues)}</dd></div><div><dt>Preferência de negociação</dt><dd>{shown(client.relationship?.negotiationPreferences)}</dd></div></dl></Section>
  <div className="detail-grid">
   <Section title="Como esse produtor quer ser atendido"><dl className="info-list">
    <div><dt>Canal</dt><dd>{client.servicePreference}</dd></div><div><dt>Frequência</dt><dd>{client.contactFrequency}</dd></div>
    <div><dt>Conteúdo</dt><dd>{client.contentPreference}</dd></div><div><dt>Pós-venda</dt><dd>{client.postSalePreference}</dd></div>
   </dl></Section>
   <Section title="Como ele decide"><dl className="info-list">
    <div><dt>Principal influência</dt><dd>{client.decisionDriver}</dd></div><div><dt>Apresentação técnica</dt><dd>{client.technicalPresentation}</dd></div>
    <div><dt>Confiança</dt><dd>{client.trustDriver}</dd></div><div><dt>Nova tecnologia</dt><dd>{client.innovationBehavior}</dd></div>
   </dl></Section>
  </div>
  <div className="detail-grid">
   <Section title="NPS e percepção de valor"><dl className="info-list">
    <div><dt>NPS</dt><dd>{client.nps} — {client.npsClass}</dd></div><div><dt>Mais valorizado</dt><dd>{client.valuedAspect}</dd></div>
    <div><dt>Para nota 10</dt><dd>{client.missingFor10||'—'}</dd></div><div><dt>Necessidade adicional</dt><dd>{additionalNeedLabel}</dd></div>
   </dl></Section>
   <Section title="Escalas do relacionamento"><div className="score-bars">
    {Object.entries(client.scoresScale||{}).map(([k,v])=><div key={k}><span>{({trust:'Confiança',contact:'Contato',value:'Valor',innovation:'Inovação',continuity:'Continuidade',recommendation:'Recomendação'})[k]}</span><div><i style={{width:(Number(v||0)*10)+'%'}}></i></div><b>{v}/10</b></div>)}
   </div></Section>
  </div>
  {client.commercial?.score!==undefined&&<Section title="Indicadores descritivos do histórico de negócios"><div className="learned-business-grid"><div><small>ÍNDICE HEURÍSTICO</small><b>{client.commercial.score}/100</b><span>{client.commercial.priority} prioridade de triagem</span></div><div><small>VOLUME INFORMADO</small><b>R$ {Number(client.commercial.revenue||0).toLocaleString('pt-BR')}</b><span>{client.commercial.frequency||0} registros reconhecidos</span></div><div><small>TICKET MÉDIO INFORMADO</small><b>{client.commercial.averageTicket===null?'Não calculado':`R$ ${Number(client.commercial.averageTicket||0).toLocaleString('pt-BR',{maximumFractionDigits:0})}`}</b><span>{client.commercial.conversion===null?'Status de ganho/perda não informado':`${client.commercial.conversion}% entre os ${client.commercial.knownOutcomes||0} resultados classificados`}</span></div><div><small>COBERTURA DE EVIDÊNCIA</small><b>{client.commercial.evidenceCoverage||0}%</b><span>{(client.commercial.categories||[]).join(' • ')||'Categorias a reconhecer'}</span></div></div></Section>}
  <Section title="Editar cadastro do produtor"><ProducerProfileEditor client={client} onSave={async(id,input)=>{await onUpdate?.(id,input);onSaved?.('Cadastro completo salvo na nuvem e atualizado para a VAL.')}}/></Section>
  <Section title="Complemento técnico preenchido pelo consultor">
   <div className="tag-row"><span>{loadingContext?'Carregando memória':contextMeta.status==='verified'?'Memória verificada':contextMeta.status==='proposed'?'Entrada do consultor • verificação pendente':'Ainda não registrada'}</span>{contextDate(contextMeta.updatedAt)&&<span>Atualizada em {contextDate(contextMeta.updatedAt)}</span>}</div>
   <div className="form-grid">
    <label>Propriedade<input value={tech.property} onChange={e=>edit('property',e.target.value)}/></label>
    <label>Área / culturas<input value={tech.area+' • '+tech.crops} onChange={()=>{}} readOnly/></label>
    <label>Principais plantas daninhas<input value={tech.weeds} onChange={e=>edit('weeds',e.target.value)} placeholder="Ex.: buva, pé-de-galinha"/></label>
    <label>Doenças recorrentes<input value={tech.diseases} onChange={e=>edit('diseases',e.target.value)}/></label>
    <label>Insetos / pragas<input value={tech.insects} onChange={e=>edit('insects',e.target.value)}/></label>
    <label>Resumo de solo<input value={tech.soil} onChange={e=>edit('soil',e.target.value)}/></label>
    <label>Meta do produtor<input value={tech.goal} onChange={e=>edit('goal',e.target.value)}/></label>
    <label>Concorrentes / categorias adquiridas fora da empresa<input value={tech.competitors} onChange={e=>edit('competitors',e.target.value)}/></label>
    <label className="wide">Observações<textarea value={tech.notes} onChange={e=>edit('notes',e.target.value)}/></label>
   </div>
   {error&&<div className="form-error" role="alert">{error}</div>}
   <button className="primary-btn" onClick={save} disabled={saving}><Save size={16}/>{saving?'Salvando…':'Salvar na memória da VAL'}</button>
  </Section>
 </div>
}
