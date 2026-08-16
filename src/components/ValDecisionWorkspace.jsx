import React,{useEffect,useMemo,useRef,useState} from 'react'
import {
 Activity,AlertTriangle,ArrowRight,BarChart3,BrainCircuit,CheckCircle2,ChevronDown,ChevronRight,
 CircleDollarSign,ClipboardCheck,Database,FileCheck2,Gauge,Layers3,ListChecks,LoaderCircle,
 LockKeyhole,MessageSquareText,Network,RefreshCw,Route,ShieldCheck,Sparkles,Target,
 ThumbsDown,ThumbsUp,TimerReset,UserRoundSearch,Zap
} from 'lucide-react'
import {compactBRL,commercialMetrics} from '../lib/commercial-metrics'
import ValPanel from './ValPanel'
import '../val-decision-center.css'

const quickActions=[
 {id:'priority',label:'Priorizar a conta',icon:Target,prompt:'Cruze todo o dossiê deste produtor, compare as oportunidades abertas e indique qual decisão merece prioridade agora, com score, evidências, lacunas e próxima ação.'},
 {id:'visit',label:'Preparar visita',icon:Route,prompt:'Prepare a próxima visita para este produtor. Defina objetivo, oportunidade prioritária, perguntas úteis, critério de avanço e compromisso esperado.'},
 {id:'value',label:'Sair do preço',icon:CircleDollarSign,prompt:'O produtor está comparando preço. Ajude-me a conduzir a negociação por impacto, risco, escopo e prova, sem oferecer desconto automático.'},
 {id:'commit',label:'Fechar próximo passo',icon:ClipboardCheck,prompt:'Conduza esta oportunidade para um próximo compromisso verificável, com pendência, responsável, prazo e critério de conclusão.'}
]

const stages=[
 {id:'descobrir',label:'Descobrir'},
 {id:'dimensionar',label:'Dimensionar'},
 {id:'construir_valor',label:'Construir valor'},
 {id:'propor',label:'Propor'},
 {id:'comprometer',label:'Comprometer'}
]

const componentLabels={
 economic:'Valor econômico',urgency:'Urgência',readiness:'Prontidão',evidence:'Evidências',momentum:'Relacionamento',strategicFit:'Aderência',dataQuality:'Qualidade'
}

const priorityLabels={imediata:'Agir agora',esta_semana:'Fazer nesta semana',acompanhar:'Acompanhar',sem_acao:'Sem ação comercial',alta:'Fazer nesta semana','média':'Acompanhar',media:'Acompanhar',qualificar:'Qualificar primeiro'}
const confidenceLabels={high:'Alta',moderate:'Moderada',low:'Baixa',insufficient:'Insuficiente',not_calibrated:'Em calibração','alta':'Alta','média':'Moderada',media:'Moderada','baixa':'Baixa'}

const array=value=>Array.isArray(value)?value:[]
const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()
const number=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(100,Number(value))):null
const unique=items=>[...new Set(items.map(item=>text(item)).filter(Boolean))]
const formatAmount=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'Valor ainda não registrado'
const initials=value=>text(value,'P').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()

function scoreTone(score){
 if(score===null)return 'is-neutral'
 if(score>=82)return 'is-critical'
 if(score>=68)return 'is-high'
 if(score>=52)return 'is-medium'
 return 'is-low'
}

function normalizeEvidence(item,index){
 if(!item||typeof item!=='object')return {id:`evidence-${index}`,claim:text(item),meta:'Fonte não estruturada',uncertainty:''}
 return {
  id:item.id||`evidence-${index}`,
  claim:text(item.claim_supported||item.claim||item.summary||item.title),
  meta:[item.source_type&&String(item.source_type).replace(/_/g,' '),item.observed_at&&item.observed_at!=='unknown'&&new Date(item.observed_at).toLocaleDateString('pt-BR'),item.quality&&`qualidade ${item.quality}`].filter(Boolean).join(' • '),
  uncertainty:text(item.uncertainty)
 }
}

function Metric({icon:Icon,label,value,caption,tone='is-neutral',progress=null}){
 return <article className={`vdc-metric ${tone}`}>
  <span className="vdc-metric-icon"><Icon/></span>
  <div><small>{label}</small><strong>{value}</strong><p>{caption}</p></div>
  {progress!==null&&<span className="vdc-metric-progress" aria-label={`${label}: ${progress} de 100`}><i style={{width:`${Math.max(0,Math.min(100,progress))}%`}}/></span>}
 </article>
}

function LayerCard({index,icon:Icon,title,value,description,state='ready'}){
 return <article className={`vdc-layer is-${state}`}>
  <div className="vdc-layer-top"><span>{String(index).padStart(2,'0')}</span><Icon/></div>
  <small>{title}</small>
  <strong>{value}</strong>
  <p>{description}</p>
 </article>
}

function EmptyDecision({client,onAsk,loading}){
 return <section className="vdc-empty-decision">
  <div className="vdc-empty-orbit"><BrainCircuit/></div>
  <div>
   <small>CONVERSION CORE PRONTO</small>
   <h3>Transforme o dossiê de {text(client?.name,'este produtor')} em uma decisão.</h3>
   <p>A nova VAL não começa por uma resposta pronta. Ela cruza fatos, verifica a qualidade dos dados, compara oportunidades e só então define o próximo avanço.</p>
  </div>
  <button type="button" onClick={()=>onAsk(quickActions[0].prompt)} disabled={loading}><Target/>Analisar conta agora<ArrowRight/></button>
 </section>
}

export default function ValDecisionWorkspace({clients=[],selectedClient,onSelect}){
 const [selected,setSelected]=useState(selectedClient?.id||clients[0]?.id||'')
 const [mode,setMode]=useState('daily')
 const [requestedStage,setRequestedStage]=useState(null)
 const [message,setMessage]=useState('')
 const [response,setResponse]=useState(null)
 const [status,setStatus]=useState({loading:true,data:null,error:''})
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [expertOpen,setExpertOpen]=useState(false)
 const [feedback,setFeedback]=useState({sending:false,sent:false,error:''})
 const requestRef=useRef(null)

 useEffect(()=>{if(selectedClient?.id)setSelected(selectedClient.id)},[selectedClient?.id])
 useEffect(()=>{if(!selected&&clients[0]?.id)setSelected(clients[0].id)},[clients,selected])
 useEffect(()=>()=>requestRef.current?.abort(),[])

 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:typeof AbortSignal.timeout==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal})
   .then(async result=>{const payload=await result.json().catch(()=>({}));if(!result.ok)throw new Error(payload.error||'Status indisponível.');return payload})
   .then(data=>setStatus({loading:false,data,error:''}))
   .catch(fetchError=>{if(fetchError.name!=='AbortError')setStatus({loading:false,data:null,error:fetchError.message})})
  return()=>controller.abort()
 },[])

 useEffect(()=>{
  requestRef.current?.abort()
  setResponse(null);setError('');setMessage('');setRequestedStage(null);setFeedback({sending:false,sent:false,error:''})
 },[selected])

 const client=useMemo(()=>clients.find(item=>item.id===selected)||clients[0]||null,[clients,selected])
 const clientMetrics=useMemo(()=>commercialMetrics(client||{}),[client])
 const advice=response?.advice||{}
 const core=advice.conversion_intelligence||{}
 const selectedOpportunity=core.selected_opportunity||{}
 const workflow=core.workflow||{}
 const dataQuality=core.data_quality||{}
 const learning=core.learning||{}
 const brief=advice.executive_brief||{}
 const confidence=advice.confidence||core.confidence||{}
 const evidence=array(advice.evidence_used).map(normalizeEvidence).filter(item=>item.claim)
 const contradictions=unique([...array(dataQuality.contradictions),...array(confidence.contradictions)])
 const missing=unique([...array(dataQuality.missing),...array(confidence.missing_data)]).filter(item=>!contradictions.some(problem=>item.includes(problem))).slice(0,8)
 const score=number(core.score??response?.conversionIntelligence?.score)
 const qualityScore=number(dataQuality.score)
 const confidenceScore=number(confidence.score)
 const priority=text(core.priority||response?.conversionIntelligence?.priority||brief.priority,'acompanhar')
 const priorityLabel=priorityLabels[priority]||priorityLabels[priority.toLocaleLowerCase('pt-BR')]||'Acompanhar'
 const amountKnown=selectedOpportunity.amount!==null&&selectedOpportunity.amount!==undefined&&Number.isFinite(Number(selectedOpportunity.amount))
 const sourceCount=Object.values(response?.contextCoverage||{}).reduce((sum,value)=>sum+(Number(value)||0),0)
 const components=Object.entries(selectedOpportunity.components||{}).filter(([,value])=>Number.isFinite(Number(value)))
 const reasons=array(selectedOpportunity.reasons).map(text).filter(Boolean)
 const penalties=array(selectedOpportunity.penalties).map(text).filter(Boolean)
 const humanReview=advice.human_review||{}
 const statusReady=Boolean(status.data?.conversionEngine||status.data?.decisionCore)

 const layers=[
  {icon:Network,title:'Contexto conectado',value:response?`${Math.max(sourceCount,evidence.length)} sinais cruzados`:'Pronto para cruzar',description:'Produtor, histórico, visitas, campo e oportunidades na mesma leitura.',state:response?'complete':'ready'},
  {icon:Database,title:'Qualidade dos dados',value:qualityScore!==null?`${Math.round(qualityScore)}/100`:'A medir',description:contradictions.length?`${contradictions.length} inconsistência(s) visível(is).`:`${missing.length} lacuna(s) priorizada(s).`,state:contradictions.length?'warning':qualityScore!==null?'complete':'ready'},
  {icon:Gauge,title:'Conversion Score',value:score!==null?`${Math.round(score)}/100`:'A calcular',description:'Ordena trabalho por valor, urgência, prontidão e evidência.',state:score!==null?'complete':'ready'},
  {icon:Route,title:'Próxima melhor ação',value:text(workflow.label,'A definir'),description:'Máquina de estados orienta o avanço sem improvisar.',state:workflow.label?'complete':'ready'},
  {icon:FileCheck2,title:'Evidência explicável',value:response?`${evidence.length} fonte(s)`:'Aguardando análise',description:'Fato, origem, data, incerteza e dado ausente ficam visíveis.',state:evidence.length?'complete':'ready'},
  {icon:Activity,title:'Aprendizado controlado',value:learning.sample_size!==undefined?`${Number(learning.sample_size)||0} retornos`:'Sem amostra ainda',description:text(learning.status,'Feedback real ajusta pesos apenas com amostra mínima.'),state:learning.mature?'complete':'ready'},
  {icon:ShieldCheck,title:'Governança humana',value:humanReview.required?'Revisão obrigatória':'Humano no controle',description:'A IA melhora a linguagem; regras, dados e revisão governam a decisão.',state:humanReview.required?'warning':'complete'}
 ]

 async function ask(prompt=message){
  const question=text(prompt)
  if(!client?.id||!question||loading)return
  requestRef.current?.abort()
  const controller=new AbortController();requestRef.current=controller
  setLoading(true);setError('');setFeedback({sending:false,sent:false,error:''})
  try{
   const timeout=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(120000):null
   const signal=timeout&&typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,timeout]):controller.signal
   const result=await fetch('/api/val/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({clientId:client.id,client,message:question,mode,requestedStage}),signal
   })
   const payload=await result.json().catch(()=>({}))
   if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!result.ok)throw new Error(payload.error||'Não foi possível analisar esta conta.')
   setResponse(payload);setMessage('')
  }catch(requestError){if(requestError.name!=='AbortError')setError(requestError.name==='TimeoutError'?'A análise ultrapassou o limite. Tente novamente.':requestError.message)}finally{if(requestRef.current===controller){requestRef.current=null;setLoading(false)}}
 }

 async function sendFeedback(rating,outcome){
  if(!response?.recommendationId||feedback.sending||feedback.sent)return
  setFeedback({sending:true,sent:false,error:''})
  try{
   const result=await fetch('/api/val/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recommendationId:response.recommendationId,rating,outcome}),signal:AbortSignal.timeout(10000)})
   const payload=await result.json().catch(()=>({}))
   if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   if(!result.ok)throw new Error(payload.error||'Não foi possível registrar o retorno.')
   setFeedback({sending:false,sent:true,error:''})
  }catch(feedbackError){setFeedback({sending:false,sent:false,error:feedbackError.message})}
 }

 if(!client)return <section className="val-decision-workspace vdc-no-client"><BrainCircuit/><h2>A VAL precisa de um produtor</h2><p>Cadastre ou importe uma conta para iniciar o centro de decisão.</p></section>

 return <section className="val-decision-workspace" aria-labelledby="vdc-title">
  <header className="vdc-hero">
   <div className="vdc-hero-copy">
    <span className="vdc-kicker"><Sparkles/>VAL CONVERSION CORE</span>
    <h2 id="vdc-title">Centro de Decisão Comercial</h2>
    <p>Veja primeiro <b>onde agir, por que agir e qual compromisso buscar</b>. A conversa com IA virou uma camada de apoio — não a fonte da decisão.</p>
    <div className="vdc-engine-status" aria-live="polite">
     <span className={statusReady?'is-ready':''}><i/>{status.loading?'Validando núcleo':statusReady?'Motor determinístico ativo':status.error?'Operação local protegida':'Núcleo disponível'}</span>
     <em><LockKeyhole/>IA somente para linguagem</em>
     <em><ShieldCheck/>Revisão humana preservada</em>
    </div>
   </div>
   <aside className="vdc-account-card">
    <div className="vdc-account-top"><span>{initials(client.name)}</span><div><small>CONTA EM ANÁLISE</small><h3>{client.name}</h3><p>{client.commercial?.property||client.municipality||'Propriedade não informada'}</p></div></div>
    <dl>
     <div><dt>Potencial em aberto</dt><dd>{compactBRL(clientMetrics.openPotential,{known:clientMetrics.openPotentialKnown})}</dd></div>
     <div><dt>Pipeline</dt><dd>{compactBRL(clientMetrics.openPipeline,{known:clientMetrics.pipelineKnown})}</dd></div>
     <div><dt>Culturas</dt><dd>{text(client.cultures,'A confirmar')}</dd></div>
    </dl>
    <button type="button" onClick={()=>onSelect?.(client)}><UserRoundSearch/>Abrir Cliente 360<ChevronRight/></button>
   </aside>
  </header>

  <section className="vdc-command-center" aria-label="Comandos da VAL">
   <div className="vdc-command-row">
    <label><span>Produtor</span><select value={selected} onChange={event=>setSelected(event.target.value)} disabled={loading}>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="vdc-mode-control"><span>Profundidade</span><button type="button" className={mode==='daily'?'is-active':''} onClick={()=>setMode('daily')} disabled={loading}><Zap/>Direta</button><button type="button" className={mode==='strategic'?'is-active':''} onClick={()=>setMode('strategic')} disabled={loading}><BrainCircuit/>Estratégica</button></div>
    <button className="vdc-refresh" type="button" onClick={()=>ask(response?text(response?.advice?.objective,'Recalcule a próxima melhor ação desta conta com os dados mais recentes.'):quickActions[0].prompt)} disabled={loading}><RefreshCw className={loading?'is-spinning':''}/>Atualizar decisão</button>
   </div>

   <div className="vdc-quick-actions">{quickActions.map(({id,label,icon:Icon,prompt})=><button key={id} type="button" onClick={()=>ask(prompt)} disabled={loading}><Icon/><span>{label}</span><ChevronRight/></button>)}</div>

   <div className="vdc-stage-control"><span>Etapa que você quer trabalhar</span><div>{stages.map(stage=><button key={stage.id} type="button" className={requestedStage===stage.id?'is-active':''} aria-pressed={requestedStage===stage.id} onClick={()=>setRequestedStage(current=>current===stage.id?null:stage.id)} disabled={loading}>{stage.label}</button>)}</div></div>

   <form className="vdc-composer" onSubmit={event=>{event.preventDefault();ask(message)}}>
    <MessageSquareText/>
    <textarea rows="2" value={message} onChange={event=>setMessage(event.target.value)} maxLength="1200" placeholder={`Conte o que está acontecendo com ${text(client.name).split(' ')[0]}…`} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask(message)}}}/>
    <button type="submit" disabled={!message.trim()||loading}>{loading?<LoaderCircle className="is-spinning"/>:<ArrowRight/>}<span>{loading?'Cruzando dados':'Analisar'}</span></button>
   </form>
   {(error||response?.warning)&&<div className="vdc-alert"><AlertTriangle/><span>{error||response.warning}</span></div>}
  </section>

  <section className="vdc-layer-section" aria-labelledby="vdc-layers-title">
   <header><div><Layers3/><span><small>AS SETE BARREIRAS DE DIFERENCIAÇÃO</small><h3 id="vdc-layers-title">Da informação dispersa ao negócio conduzido</h3></span></div><em>{response?'Leitura atualizada':'Pronto para analisar'}</em></header>
   <div className="vdc-layer-grid">{layers.map((layer,index)=><LayerCard key={layer.title} index={index+1} {...layer}/>)}</div>
  </section>

  {!response?<EmptyDecision client={client} onAsk={ask} loading={loading}/>:<>
   <section className="vdc-metric-grid" aria-label="Resumo da decisão">
    <Metric icon={Target} label="Prioridade" value={priorityLabel} caption={text(selectedOpportunity.stage,'Etapa ainda não informada')} tone={scoreTone(score)}/>
    <Metric icon={Gauge} label="Conversion Score" value={score!==null?`${Math.round(score)}/100`:'A medir'} caption="Ordenação operacional, não probabilidade de compra." tone={scoreTone(score)} progress={score}/>
    <Metric icon={Database} label="Qualidade dos dados" value={qualityScore!==null?`${Math.round(qualityScore)}/100`:'A medir'} caption={contradictions.length?`${contradictions.length} inconsistência(s) detectada(s).`:`${missing.length} lacuna(s) relevante(s).`} tone={contradictions.length?'is-warning':'is-good'} progress={qualityScore}/>
    <Metric icon={ShieldCheck} label="Confiança" value={confidenceLabels[text(confidence.level).toLocaleLowerCase('pt-BR')]||'Em calibração'} caption="Força da evidência; não chance de fechamento." tone={confidenceScore!==null&&confidenceScore>=70?'is-good':'is-neutral'} progress={confidenceScore}/>
   </section>

   <section className="vdc-decision-grid">
    <article className="vdc-opportunity-card">
     <header><div><span className={`vdc-score-ring ${scoreTone(score)}`} style={{'--vdc-score-angle':`${(score||0)*3.6}deg`}}><b>{score!==null?Math.round(score):'—'}</b><small>SCORE</small></span><div><small>OPORTUNIDADE PRIORITÁRIA</small><h3>{text(selectedOpportunity.title,'Conta ainda em qualificação')}</h3><p>{[text(selectedOpportunity.category),text(selectedOpportunity.stage)].filter(Boolean).join(' • ')||'Categoria e etapa ainda não informadas'}</p></div></div><em>{amountKnown?formatAmount(selectedOpportunity.amount):'Valor em aberto'}</em></header>
     <div className="vdc-why-now"><small>POR QUE AGIR NESTA OPORTUNIDADE</small>{reasons.length?<ul>{reasons.slice(0,5).map((reason,index)=><li key={`${reason}-${index}`}><CheckCircle2/><span>{reason}</span></li>)}</ul>:<p>A prioridade foi calculada com os dados disponíveis, mas os motivos ainda precisam de mais evidência.</p>}</div>
     {components.length>0&&<div className="vdc-score-components"><small>COMPOSIÇÃO DO SCORE</small><div>{components.map(([key,value])=><span key={key}><b>{componentLabels[key]||key}</b><i><em style={{width:`${Math.max(0,Math.min(100,Number(value)))}%`}}/></i><strong>{Math.round(Number(value))}</strong></span>)}</div></div>}
     {penalties.length>0&&<div className="vdc-penalties"><AlertTriangle/><span><small>REDUTORES DA PRIORIDADE</small>{penalties.map((item,index)=><b key={`${item}-${index}`}>{item}</b>)}</span></div>}
    </article>

    <article className="vdc-action-card">
     <header><span><Route/></span><div><small>PRÓXIMA MELHOR AÇÃO</small><h3>{text(workflow.label||advice.objective,'Definir o próximo avanço')}</h3></div><em>{text(brief.deadline,'No próximo contato')}</em></header>
     <p className="vdc-action-main">{text(brief.action||advice.next_best_action,'Complete o contexto mínimo antes de avançar.')}</p>
     <div className="vdc-primary-question"><MessageSquareText/><span><small>PERGUNTA PRINCIPAL</small><b>{text(brief.question||advice.next_question?.question,'Qual informação mais muda esta decisão agora?')}</b></span></div>
     <dl>
      <div><dt><ListChecks/>Avance quando</dt><dd>{text(workflow.success_gate,'Existe próximo passo aceito, responsável, prazo e critério de conclusão.')}</dd></div>
      <div><dt><AlertTriangle/>Evite</dt><dd>{text(workflow.avoid,'Não preencha lacunas com suposições nem confunda interesse com compromisso.')}</dd></div>
     </dl>
     <blockquote>{text(advice.answer,'A orientação será construída com os fatos da conta.')}</blockquote>
    </article>
   </section>

   <section className="vdc-evidence-grid">
    <article className="vdc-data-health">
     <header><Database/><span><small>SAÚDE DA DECISÃO</small><h3>O que sustenta e o que ainda limita</h3></span></header>
     <div>
      <section><small>DADOS QUE FALTAM</small>{missing.length?<ul>{missing.map((item,index)=><li key={`${item}-${index}`}><TimerReset/><span>{item}</span></li>)}</ul>:<p><CheckCircle2/>Nenhuma lacuna crítica foi sinalizada nesta leitura.</p>}</section>
      <section className={contradictions.length?'has-warning':''}><small>INCONSISTÊNCIAS</small>{contradictions.length?<ul>{contradictions.map((item,index)=><li key={`${item}-${index}`}><AlertTriangle/><span>{item}</span></li>)}</ul>:<p><CheckCircle2/>Nenhuma contradição crítica foi encontrada.</p>}</section>
     </div>
    </article>

    <article className="vdc-evidence-card">
     <header><FileCheck2/><span><small>EVIDÊNCIAS AUDITÁVEIS</small><h3>{evidence.length} fonte(s) usada(s)</h3></span></header>
     {evidence.length?<ul>{evidence.slice(0,5).map(item=><li key={item.id}><span><CheckCircle2/></span><div><b>{item.claim}</b>{item.meta&&<small>{item.meta}</small>}{item.uncertainty&&<p>Limite: {item.uncertainty}</p>}</div></li>)}</ul>:<p className="vdc-empty-copy">A decisão permaneceu em descoberta porque ainda não existem evidências suficientes.</p>}
    </article>
   </section>

   <section className="vdc-learning-strip">
    <div><Activity/><span><small>CICLO DE APRENDIZADO</small><h3>{learning.mature?'Pesos ajustados por resultado real':'Pesos padrão preservados'}</h3><p>{text(learning.status,'A VAL precisa de feedback real antes de alterar qualquer peso.')}</p></span></div>
    <dl><div><dt>Amostra</dt><dd>{Number(learning.sample_size)||0}</dd></div><div><dt>Decisão</dt><dd>{text(response?.decisionCore||core.version,'Conversion Core')}</dd></div><div><dt>IA</dt><dd>Somente linguagem</dd></div></dl>
    <div className="vdc-feedback-box"><small>Esta recomendação ajudou?</small>{feedback.sent?<span><CheckCircle2/>Retorno registrado</span>:<div><button type="button" onClick={()=>sendFeedback(5,'accepted')} disabled={feedback.sending}><ThumbsUp/>Sim</button><button type="button" onClick={()=>sendFeedback(1,'rejected')} disabled={feedback.sending}><ThumbsDown/>Não</button></div>}{feedback.error&&<em>{feedback.error}</em>}</div>
   </section>
  </>}

  <section className="vdc-expert-access">
   <div><BrainCircuit/><span><small>MODO ESPECIALISTA PRESERVADO</small><h3>SPIN, OPC, EPA, sequência consultiva, anexos e dossiê completo</h3><p>O novo centro deixa a decisão principal visível. As funcionalidades detalhadas continuam disponíveis no laboratório completo.</p></span></div>
   <button type="button" onClick={()=>setExpertOpen(value=>!value)} aria-expanded={expertOpen}>{expertOpen?'Fechar laboratório':'Abrir laboratório completo'}<ChevronDown className={expertOpen?'is-open':''}/></button>
  </section>
  {expertOpen&&<div className="vdc-expert-panel"><ValPanel clients={clients} selectedClient={client} onSelect={onSelect}/></div>}
 </section>
}
