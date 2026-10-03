const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function learningDecisionQuery(message){return /o que a val aprendeu|padroes.*aguardando revisao|evidencia.*sustenta.*candidato|evidencia contraria|mudancas.*publicadas|qual foi revertida/.test(normalize(message))}
export function learningDecisionResponse(result,{message='',now=Date.now()}={}){
 const query=normalize(message),month=new Date(now);month.setUTCDate(1);month.setUTCHours(0,0,0,0)
 const inPeriod=x=>!/mes/.test(query)||(Date.parse(x.created_at)>=+month&&Date.parse(x.created_at)<=now)
 const candidates=(result.candidates||[]).filter(inPeriod),publications=(result.publications||[]).filter(inPeriod),rollbacks=(result.rollback_history||[]).filter(inPeriod)
 const id=String(message).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
 let selected=id?candidates.filter(c=>c.id===id):candidates
 if(/aguardando revisao/.test(query))selected=selected.filter(c=>['CANDIDATE','UNDER_REVIEW'].includes(c.status))
 let lines=selected.slice(0,8).map(c=>`${c.id}: hipótese ${c.hypothesis}; ${c.supporting_evidence.length} evidências favoráveis (${c.supporting_evidence.map(e=>e.id).join(', ')||'nenhuma'}), ${c.contrary_evidence.length} contrárias (${c.contrary_evidence.map(e=>e.id).join(', ')||'nenhuma registrada'}); ${c.status}. Escopo: ${JSON.stringify(c.scope)}. Amostra insuficiente para generalizar sem política e revisão.`)
 if(/publicadas/.test(query))lines=publications.map(p=>`${p.id}: ${p.kind}, versão ${p.version}, estado ${p.status}, publicada por ${p.published_by} em ${p.created_at}. ${p.payload?.reason||''} Ativação no runtime exige release autorizado.`)
 if(/revertida/.test(query))lines=rollbacks.map(r=>`${r.entity_id}: revertida por ${r.actor_id} em ${r.created_at}; motivo ${r.after_data?.reason||'consultar histórico'}; alvo ${r.after_data?.rollback_target||'registrado no histórico'}.`)
 const answer=[`Leitura da página autorizada${/mes/.test(query)?' no mês corrente (UTC)':''}; não é um total de toda a organização.`,...(lines.length?lines:['Não há registros correspondentes nesta página.']),`Agregado autorizado de candidatos da página: ${result.summary?.visible_candidates??candidates.length}. Revisão de candidato não equivale a conhecimento publicado.`].join('\n')
 return {engineMode:'rules',model:'deterministic',advice:{answer,next_best_action:'Revise as evidências e as demais páginas na Central de Aprendizado.',automatic_execution:false},responseMetadata:{source:'ORGANIZATIONAL_LEARNING_V1',providerCalls:0,automaticCrmWrite:false}}
}
