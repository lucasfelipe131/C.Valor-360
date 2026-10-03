import RevenueValuePlan from './RevenueValuePlan'
import RevenueImpactForm from './RevenueImpactForm'
import RevenueOutcomeForm from './RevenueOutcomeForm'
import {summarizeRevenueProjections} from '../lib/commercial-intelligence'
import CommercialCoachCard from './CommercialCoachCard'
import React,{useEffect,useState} from 'react'
import {fetchJsonResource} from '../hooks/useAsyncResource'
import './RevenuePanel.css'
const money=value=>value===null||value===undefined?'Desconhecido':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(value)
const labels={open_pipeline:'Pipeline ativo',won_value:'Ganho comprovado',open_potential:'Potencial aberto',stalled_value:'Valor parado',value_in_decision:'Em decisão',lost_value:'Valor perdido'}
export default function RevenuePanel({clientId='',scope='',compact=false,visits=false,managementParams=null}){
 const [limit,setLimit]=useState(25)
 const [revision,setRevision]=useState(0)
 const [state,setState]=useState(null),[error,setError]=useState('')
 const key=`${scope}:${clientId}:${managementParams}:${revision}`
 useEffect(()=>{const controller=new AbortController();let active=true;setLimit(25);setState(null);setError('');fetchJsonResource(managementParams!==null?`/api/management/revenue?${managementParams}`:`/api/revenue${clientId?'?clientId='+encodeURIComponent(clientId):''}`,{signal:controller.signal,timeoutMs:30000}).then(value=>{if(active)setState({key,value})}).catch(error=>{if(active&&error.name!=='AbortError')setError('Leitura de valor indisponível. Tente novamente mais tarde.')});return()=>{active=false;controller.abort()}},[key])
 const data=state?.key===key?state.value:null
 if(data?.enabled===false)return null
 const producers=data?.producers||[]
 const summary=summarizeRevenueProjections(producers),aggregate=metric=>summary.metrics[metric]
 return <section className="revenue-panel" aria-label={compact?'Valor em movimento':'Meu impacto'}><h2>{managementParams!==null?'VALOR DA UNIDADE':compact?'VALOR EM MOVIMENTO':'MEU IMPACTO'}</h2>
 {error?<p role="alert">{error}</p>:!data?<p role="status">Consultando valor e evidências…</p>:<>
 <div className="revenue-metrics">{(compact?['value_in_decision','stalled_value']:Object.keys(labels)).map(metric=><article key={metric}><span>{labels[metric]}</span><strong>{money(aggregate(metric))}</strong></article>)}</div>
 <p>{producers.reduce((sum,p)=>sum+(p.overdue_commitments||0),0)} compromissos vencidos · {producers.reduce((sum,p)=>sum+(p.visit_loops||[]).filter(loop=>loop.state==='OPEN').length,0)} visitas com ciclo por fechar</p>
 {!compact&&<p>{summary.outcomes_recorded} resultados · {summary.outcome_counts.NO_DECISION} sem decisão · {summary.outcome_counts.TECHNICAL_RESULT} técnicos · {summary.outcome_counts.RELATIONSHIP_PROGRESS} avanços relacionais</p>}
 {data.generated_at&&<small>Leitura: {new Date(data.generated_at).toLocaleString('pt-BR')}. </small>}<small>Potencial, pipeline e ganho são categorias sobrepostas. Não somar como receita.</small>
 {data.behavior&&<details><summary>Execução observável da unidade</summary>{Object.entries({opportunities_with_next_step_percent:'Oportunidades com próxima ação',commitments_with_deadline_percent:'Compromissos com prazo',visits_with_closed_loop_percent:'Visitas com ciclo fechado',opportunities_with_value_plan_percent:'Oportunidades com plano de valor'}).map(([key,label])=><p key={key}>{label}: {data.behavior[key]===null?'Desconhecido':data.behavior[key].toFixed(1)+'%'}</p>)}<p>Tempo planejado até o próximo passo: {data.behavior.mean_hours_until_planned_next_step===null?'Desconhecido':data.behavior.mean_hours_until_planned_next_step.toFixed(1)+' h'}</p><small>Indicadores de processo, sem classificação de pessoas. Carteira atual; resultados no período selecionado.</small></details>}
 {data.groups&&<details><summary>Recortes de valor</summary>{Object.entries(data.groups).map(([dimension,groups])=><details key={dimension}><summary>{{consultant:'Consultor',municipality:'Município',crop:'Cultura',category:'Categoria'}[dimension]}</summary>{groups.map((group,index)=><p key={index}>{Array.isArray(group.key)?group.key.join(', '):group.key}: pipeline {money(group.metrics?.open_pipeline??group.pipeline_value??null)}</p>)}</details>)}</details>}
 {!compact&&producers.slice(0,limit).map(producer=><details key={producer.producer}><summary>{producer.name||'Produtor'} · {producer.outcomes.length} resultados registrados</summary><p>Compras: {money(producer.metrics.current_purchases)} · Potencial: {money(producer.metrics.potential_total)}</p><p>Share: {producer.metrics.realized_share_percent===null?'Desconhecido':producer.metrics.realized_share_percent.toFixed(1)+'%'} · Fórmula: compras atuais ÷ potencial total × 100</p>{producer.warnings.length>0&&<p role="status">Compras excedem o potencial informado. Revise a base.</p>}{producer.opportunities.map(opportunity=><article key={opportunity.id}><strong>{opportunity.title||'Oportunidade'}</strong><p>{opportunity.health||'Fechada'} · {opportunity.scenario} · {money(opportunity.value)}</p><p>Próxima ação: {opportunity.next_action||'A definir'}</p><p>ValuePlan: {opportunity.value_plan?.status==='RECORDED'?'Registrado':'A construir'}</p>{managementParams===null&&<RevenueValuePlan opportunity={opportunity} onSaved={()=>setRevision(value=>value+1)}/>}</article>)}{managementParams===null&&<><RevenueOutcomeForm producer={producer} onSaved={()=>setRevision(value=>value+1)}/><RevenueImpactForm producer={producer} onSaved={()=>setRevision(value=>value+1)}/></>}</details>)}
 {!compact&&limit<producers.length&&<button onClick={()=>setLimit(value=>value+25)}>Mostrar mais produtores ({Math.min(limit,producers.length)}/{producers.length})</button>}
 {!compact&&data.coach_cards?.length>0&&<details><summary>Orientações para a execução · {data.coach_cards.length}</summary>{data.coach_cards.slice(0,20).map(card=><CommercialCoachCard key={card.id} card={card}/>)}</details>}
 {!compact&&data.impacts?.map(impact=><details key={impact.impact_id}><summary>Impacto observado: {impact.metric}</summary><p>{impact.before} → {impact.after} {impact.unit} · Variação: {impact.delta}</p><p>{impact.attribution_status} · {impact.measured_at}</p><p>Fontes: {impact.source_refs.map(ref=>typeof ref==='string'?ref:ref.id).join(', ')}</p></details>)}
 {visits&&<p>Feche o ciclo da visita: qual decisão ocorreu, qual compromisso foi combinado, qual resultado foi observado e qual evidência o comprova?</p>}
 </>}
 </section>
}
