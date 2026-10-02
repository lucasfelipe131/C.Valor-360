import React,{useEffect,useState} from 'react'
import {fetchJsonResource} from '../hooks/useAsyncResource'
import './DecisionPanel.css'

export default function ManagementDecisions({params,scope}){
 const [state,setState]=useState({key:'',data:null,error:''}),key=`${scope}:${params}`
 useEffect(()=>{const controller=new AbortController();let active=true
  fetchJsonResource(`/api/management/decisions?${params}`,{signal:controller.signal,timeoutMs:20000}).then(data=>{if(active)setState({key,data,error:''})}).catch(e=>{if(active&&e.name!=='AbortError')setState({key,data:null,error:e.message})})
  return()=>{active=false;controller.abort()}
 },[key,params])
 const data=state.key===key?state.data:null
 if(data&&!data.enabled)return null
 return <section className="nba-panel" aria-label="Decisões da unidade"><h2>Decisões da unidade</h2><p>Prioridades atuais e ações relatadas no período selecionado. Associação não comprova causalidade.</p>{state.key===key&&state.error&&<p role="alert">{state.error}</p>}<div className="nba-management-grid">{data?.items.map(item=><article key={item.consultantId}><h3>{item.consultant}</h3><p>{item.priorities} prioridades · {item.overdue} vencidas</p><p>{item.withoutNextStep} oportunidades sem próximo passo</p><p>Valor associado: {item.recordedValue.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p><p>{item.executed} ações executadas · {item.adapted} adaptadas · {item.dismissed} descartadas</p><p>{item.useful} úteis · {item.notUseful} não úteis</p><p>Tempo médio até ação relatada: {item.meanSecondsToReportedAction==null?'Sem dado':`${Math.round(item.meanSecondsToReportedAction/60)} min`}</p><p>{item.opportunitiesChangedAfterDecision} oportunidades atualizadas após a decisão, sem atribuição causal</p><p>Evidência atual: {item.freshEvidence}/{item.totalEvidence} · Confiança alta {item.confidence.HIGH}, média {item.confidence.MEDIUM}, baixa {item.confidence.LOW}</p></article>)}</div>{data&&!data.items.length&&<p>Nenhuma decisão registrada no escopo autorizado.</p>}</section>
}
