import React from 'react'
export default function RevenueOutcomeHistory({outcomes=[]}){
 if(!outcomes.length)return <p>Último resultado: ainda não registrado.</p>
 const latest=outcomes[0]
 return <><p>Último resultado: {latest.outcome_type||'Registrado'}{latest.measured_at?' · '+new Date(latest.measured_at).toLocaleDateString('pt-BR'):''}</p><details><summary>Resultados e suas evidências</summary>{outcomes.slice(0,20).map(outcome=><article key={outcome.id||outcome.outcome_id}><strong>{outcome.outcome_type||'Resultado registrado'}</strong><p>{outcome.notes||outcome.result?.summary||''}</p>{outcome.result?.margin!=null&&<p>Margem informada: {outcome.result.margin} {outcome.result.margin_unit||'(unidade não informada)'}</p>}<p>Visita: {outcome.visit_id||'Não informada'} · Decisão: {outcome.result?.decision_card_id||outcome.recommendation_id||'Não informada'} · Ação: {outcome.action_plan_id||'Não informada'} · Compromisso: {outcome.commitment_id||'Não informado'}</p><p>Fontes: {(outcome.evidence_refs||[]).map(ref=>ref.id||ref.source_ref).filter(Boolean).join(', ')||'Não informadas'}</p></article>)}</details></>
}
