import React,{useEffect,useState} from 'react'
import {fetchJsonResource,requestJsonResource} from '../hooks/useAsyncResource'
import './DecisionPanel.css'

const confidence={HIGH:'Alta',MEDIUM:'Média',LOW:'Baixa'}
const band={NOW:'Agora',TODAY:'Hoje',THIS_WEEK:'Nesta semana',MONITOR:'Acompanhar'}
const date=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Prazo a confirmar'
const money=value=>value?.amount==null?'Valor desconhecido':new Intl.NumberFormat('pt-BR',{style:'currency',currency:value.currency||'BRL',maximumFractionDigits:0}).format(value.amount)
const feedbackOptions={USEFUL:'Útil',NOT_USEFUL:'Não útil',ACTION_SELECTED:'Escolher ação',ACTION_EXECUTED:'Ação executada',ACTION_ADAPTED:'Ação adaptada',ACTION_DISMISSED:'Ação descartada'}

export function DecisionCard({card,onClient,onPrepare,readOnly=false}){
 const [pending,setPending]=useState(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[history,setHistory]=useState(null)
 const submit=async()=>{
  setBusy(true);setNotice('')
  try{await requestJsonResource(`/api/decisions/cards/${encodeURIComponent(card.id)}/feedback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pending.id,feedback:pending.kind,note}),timeoutMs:15000});setNotice('Feedback registrado. Os registros comerciais permanecem sob sua confirmação.');setPending(null);setNote('')}
  catch(error){setNotice(error.message)}finally{setBusy(false)}
 }
 const showHistory=async()=>{try{setHistory(await fetchJsonResource(`/api/decisions/cards/${encodeURIComponent(card.id)}`,{timeoutMs:15000}))}catch(error){setNotice(error.message)}}
 return <article className="nba-card" aria-label={`Decisão para ${card.producer.name}`}>
  <header><div><span className="nba-band">{band[card.priority_band]||card.priority_band} · {card.priority_score} pontos</span><h3>{card.producer.name}</h3></div><span className="nba-confidence">Confiança {confidence[card.confidence.level]}</span></header>
  <p className="nba-action">{card.next_best_action}</p>
  <p className="nba-reason">{card.why_this_producer}</p>
  <div className="nba-meta"><span>{date(card.deadline)}</span><span>{money(card.expected_value)}</span></div>
  <div className="nba-links">{onClient&&<button onClick={()=>onClient(card.producer.id)}>Abrir produtor</button>}{onPrepare&&card.decision_type==='PREPARAR_VISITA'&&<button onClick={()=>onPrepare(card.producer.id,card)}>Preparar visita</button>}</div>
  <details><summary>Por que agora e evidências</summary><div className="nba-details">
   <p><b>Por que agora:</b> {card.why_now}</p><p><b>Se agir:</b> {card.if_act}</p><p><b>Se esperar:</b> {card.if_wait}</p>
   <p><b>Canal:</b> {card.recommended_channel} · {card.recommended_timing}</p>
   <p><b>Valor:</b> {money(card.expected_value)}. {card.expected_value.status==='UNKNOWN'?'Falta base para estimar.':'Valor registrado associado à decisão; não é lucro ou receita garantida.'}</p>
   <p><b>Confiança:</b> {confidence[card.confidence.level]} · {card.confidence.fresh_count} evidências atuais de {card.confidence.evidence_count}; {card.confidence.critical_missing} informações materiais ausentes.</p>
   {card.priority_change&&<p><b>Mudança de prioridade:</b> {card.priority_change.previous_score} → {card.priority_change.current_score} pontos. {card.priority_change.reason==='EVIDENCE_CHANGED'?'As evidências mudaram.':card.priority_change.reason==='POLICY_CHANGED'?'A política de pontuação mudou.':'O prazo ou a posição na carteira mudou.'}</p>}
   <div className="nba-table"><table><thead><tr><th>Dimensão</th><th>Contribuição</th><th>Estado</th></tr></thead><tbody>{Object.entries(card.score_breakdown.dimensions).map(([key,value])=><tr key={key}><td>{key}</td><td>{value.points} / {value.weight}</td><td>{value.state==='NO_DATA'?'Sem dados':value.state==='POSITIVE_SIGNAL'?'Sinal registrado':'Sem sinal de prioridade'}</td></tr>)}</tbody></table></div>
   <p>Dados ausentes não são sinais negativos. Política: {card.policy_version}.</p>
   {card.score_breakdown.penalties.length>0&&<p>A pontuação foi reduzida nas evidências vencidas ou com data futura.</p>}
   {card.missing_information.length>0&&<div><h4>Falta saber</h4><ul>{card.missing_information.map(item=><li key={item.key}>{item.question}</li>)}</ul>{card.decision_interview?.questions?.[0]&&<p><b>Pergunta agora:</b> {card.decision_interview.questions[0].question}</p>}</div>}
   <h4>Evidências</h4><ul className="nba-evidence">{card.evidence.map(e=><li key={e.id}><span>{e.claim_supported}</span><small>{e.source_type} · {e.source_id} · {e.observed_at?date(e.observed_at):'Data de observação desconhecida'}</small>{e.provenance&&<small>Origem {e.source} · evento {e.external_id} · entidade {e.canonical_entity} · versão {e.version??'legada'} · recebido {date(e.ingested_at)}</small>}</li>)}</ul>
   <small>Gerado em {date(card.generated_at)} · versão {card.revision||1}.</small>
   {!readOnly&&<><button onClick={showHistory}>Ver auditoria</button>{history&&<ol>{history.audit.map((a,i)=><li key={i}>{a.action} · {date(a.created_at)}</li>)}</ol>}<div className="nba-feedback">{Object.entries(feedbackOptions).map(([kind,label])=><button key={kind} onClick={()=>{setPending({kind,id:crypto.randomUUID()});setNotice('')}}>{label}</button>)}</div></>}
  </div></details>
  {pending&&<div className="nba-confirm" role="group" aria-label="Confirmar feedback"><b>Registrar: {feedbackOptions[pending.kind]}?</b><p>Este registro relata sua decisão; não envia mensagens nem altera oportunidades, compromissos ou recomendações técnicas.</p><label>Observação opcional<textarea value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label><button disabled={busy} onClick={submit}>Confirmar registro</button><button disabled={busy} onClick={()=>setPending(null)}>Cancelar</button></div>}
  {notice&&<p role="status">{notice}</p>}
 </article>
}

export default function DecisionPanel({clientId='',scope='',title='Prioridades de hoje',onClient,onPrepare,kind='',opportunityId='',limit=5}){
 const [reload,setReload]=useState(0),[state,setState]=useState({key:'',data:null,error:''})
 const key=`${scope}:${clientId}:${reload}`
 useEffect(()=>{const controller=new AbortController();let active=true
  fetchJsonResource(`/api/decisions${clientId?'?clientId='+encodeURIComponent(clientId):''}`,{signal:controller.signal,timeoutMs:25000,fallbackMessage:'Não foi possível carregar as decisões.'}).then(data=>{if(active)setState({key,data,error:''})}).catch(e=>{if(active&&e.name!=='AbortError')setState({key,data:null,error:e.message})})
  return()=>{active=false;controller.abort()}
 },[key,clientId])
 const data=state.key===key?state.data:null,error=state.key===key?state.error:''
 if(data&&(!data.enabled||!data.flags?.decision_cards))return null
 const cards=(clientId||kind?data?.cards:data?.items||[] )||[]
 const shown=cards.filter(c=>(!kind||c.decision_type===kind)).slice(0,Math.min(5,limit))
 return <section className="nba-panel" aria-label={title}><header><div><span>VAL · DECISÕES DA CARTEIRA</span><h2>{title}</h2></div><button onClick={()=>setReload(n=>n+1)}>Atualizar prioridades</button></header>{error?<p role="alert">{error}</p>:!data?<p role="status">Consultando evidências da sua carteira…</p>:shown.length?<div className="nba-grid">{opportunityId&&shown[0]?.opportunity_id!==opportunityId&&<p>A prioridade atual do produtor está ligada a outra decisão. Confira abaixo os fatos e o risco de espera antes de avançar esta oportunidade.</p>}{shown.map(card=><DecisionCard key={`${key}:${card.id}`} card={card} onClient={onClient} onPrepare={onPrepare}/>)}</div>:<p>{opportunityId?'Esta oportunidade não é a decisão prioritária atual do produtor. Abra o produtor para consultar a próxima melhor ação.':data.emptyReason||'Nenhuma prioridade comprovada neste contexto.'}</p>}<small>A VAL recomenda. Você decide.</small></section>
}
