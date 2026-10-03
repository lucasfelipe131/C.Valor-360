import React,{lazy,Suspense,useEffect,useRef,useState} from 'react'
import './AgroTerritoryPanel.css'
const Territory=lazy(()=>import('./AgroTerritoryPanel'))
const actions={VISTORIAR:'Vistoriar o talhão',AMOSTRAR:'Coletar amostras',VALIDAR_DIAGNÓSTICO:'Validar a hipótese com o responsável técnico',COLETAR_IMAGEM:'Coletar imagens para identificação',REVISAR_ANALISE:'Revisar a análise de solo',REVISAR_HISTORICO:'Revisar o histórico'}
export function AgronomicDecisionCard({card,onFocus}){
 const [open,setOpen]=useState(false),dialog=useRef(null)
 useEffect(()=>{if(open&&dialog.current&&!dialog.current.open)dialog.current.showModal()},[open])
 const close=()=>{dialog.current?.close();setOpen(false)}
 const focus=()=>{if(onFocus)onFocus(card.map_focus);else setOpen(true)}
 return <article className="agro-territory-card" aria-label={`Talhão ${card.field.name}`} data-card-id={card.id} data-signal-id={card.signal?.signal_id}>
  <h3>{card.headline||card.field.name}</h3>
  <p className="agro-card-action"><strong>{actions[card.recommended_next_step]||card.recommended_next_step}</strong></p>
  <p>{card.why_now}</p><p>Confiança {card.confidence} · {card.validation_state}</p><p>Prazo: {card.deadline||'A confirmar com o responsável técnico'}</p>
  <p className="agro-card-context">{card.producer.name} · {card.property.name} · {card.field.name} · {card.season||'Safra não informada'} · {card.crop||'Cultura não informada'}</p>
  {card.map_focus?.geometry?<button onClick={focus}>Ver no mapa</button>:<p>GEOMETRY_UNAVAILABLE — vincule um contorno válido para localizar o talhão.</p>}
  <details><summary>Evidências e dados faltantes</summary><p>{card.why}</p><p>Sinal: {card.signal_type||card.signal?.signal_type} · Prioridade {card.priority.score??'Desativada'} · Política {card.priority.policy_version}</p>
   <ol>{card.evidence_refs.map((r,i)=><li key={i}><strong>{r.source||'Fonte ausente'}</strong><p>Referência: {r.source_ref}</p><p>Hub: {r.source_event_id||'Evento não disponível'} · Registro: {r.type}/{r.id}</p><p>Observado em: {r.observed_at||'Data desconhecida'} · Recebido em: {r.ingested_at||'Data desconhecida'}</p></li>)}</ol>
   <p>Sinal {card.signal?.signal_id} → prioridade {card.priority.policy_version} → card {card.id} · revisão {card.revision||1}</p><ul>{card.missing_information.map((m,i)=><li key={i}>{m}</li>)}</ul><p>A vistoria e a decisão exigem confirmação humana. Nenhuma prescrição automática.</p>
  </details>
  {open&&<dialog ref={dialog} className="agro-map-dialog" aria-label={`Mapa do talhão ${card.field.name}`} onCancel={close}><header><h2>{card.field.name}</h2><button onClick={close}>Fechar mapa e voltar ao card</button></header><Suspense fallback={<p role="status">Abrindo mapa…</p>}><Territory clientId={card.producer.id} map initialFocus={card.map_focus} cardsVisible={false}/></Suspense></dialog>}
 </article>
}
