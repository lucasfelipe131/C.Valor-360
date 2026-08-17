import React from 'react'
import {AlertTriangle,Calculator,CheckCircle2,Database,Scale,ShieldCheck,Sparkles,TrendingUp} from 'lucide-react'
import '../value-scenarios.css'

const money=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}):'Não confirmado'
const numeric=(value,suffix='')=>Number.isFinite(Number(value))?`${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2})}${suffix}`:'Não confirmado'
const text=(value,fallback='')=>String(value??fallback).replace(/\s+/g,' ').trim()

export default function ValueScenarioPanel({data,onPrepare}){
 if(!data)return null
 const inputs=data.confirmedInputs||{}
 const evidence=inputs.inputEvidence||{}
 const scenarios=Array.isArray(data.scenarios)?data.scenarios:[]
 const status=data.status
 return <section className="value-scenario-panel" aria-labelledby="value-scenario-title">
  <header><div><span><Calculator/>SIMULADOR DE VALOR</span><h4 id="value-scenario-title">Investimento, equilíbrio e cenários confirmados</h4><p>A VAL calcula somente com números que aparecem no registro da oportunidade ou em uma pergunta feita pelo consultor.</p></div><b className={`value-status is-${status}`}>{status==='calculated'?'Cenários calculados':status==='ready_for_explicit_scenarios'?'Equilíbrio calculado':'Dados incompletos'}</b></header>

  <div className="value-input-grid">
   <article><small>ÁREA DA DECISÃO</small><b>{numeric(inputs.areaHa,' ha')}</b><span><Database/>{evidence.areaHa||'Sem evidência'}</span></article>
   <article><small>INVESTIMENTO</small><b>{inputs.costPerHa!==null&&inputs.costPerHa!==undefined?`${money(inputs.costPerHa)}/ha`:'Não confirmado'}</b><span><Database/>{evidence.costPerHa||'Sem evidência'}</span></article>
   <article><small>PREÇO DA UNIDADE</small><b>{inputs.unitPrice!==null&&inputs.unitPrice!==undefined?`${money(inputs.unitPrice)}/sc`:'Não confirmado'}</b><span><Database/>{evidence.unitPrice||'Sem evidência'}</span></article>
  </div>

  {data.investmentTotal!==null&&<div className="value-break-even">
   <div><Scale/><span><small>INVESTIMENTO TOTAL</small><b>{money(data.investmentTotal)}</b></span></div>
   <div><TrendingUp/><span><small>PONTO DE EQUILÍBRIO</small><b>{numeric(data.breakEvenPerHa,' sc/ha')}</b></span></div>
   <p>O ponto de equilíbrio mostra quanto resultado econômico por hectare igualaria o investimento. Não prevê produtividade nem controle.</p>
  </div>}

  {data.missingInputs?.length>0&&<div className="value-missing"><AlertTriangle/><div><b>Falta confirmar antes de avançar</b><ul>{data.missingInputs.map(item=><li key={item}>{item}</li>)}</ul><p>{data.guidance}</p></div></div>}

  {scenarios.length>0&&<div className="value-scenario-table">
   <div className="value-scenario-heading"><CheckCircle2/><div><b>Sensibilidade informada pelo consultor</b><small>Os resultados abaixo usam as três premissas explicitamente registradas. Não são projeção automática da VAL.</small></div></div>
   <div className="value-scenario-rows">{scenarios.map(item=><article className={`is-${item.id}`} key={item.id}>
    <span><small>{item.label}</small><b>{numeric(item.unitsPerHa,' sc/ha')}</b></span>
    <span><small>Valor bruto</small><b>{money(item.grossTotal)}</b></span>
    <span><small>Saldo após investimento</small><b>{money(item.netTotal)}</b></span>
    <em>{item.evidenceIds.join(' • ')}</em>
   </article>)}</div>
  </div>}

  <footer><ShieldCheck/><div><b>Limite da simulação</b><p>{text(data.guardrail)}</p></div><button type="button" onClick={onPrepare}><Sparkles/>Levar para a conversa</button></footer>
 </section>
}
