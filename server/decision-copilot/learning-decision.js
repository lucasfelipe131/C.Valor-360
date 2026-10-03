const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function learningDecisionQuery(message){return /o que a val aprendeu|padroes.*aguardando revisao|evidencia.*sustenta.*candidato|evidencia contraria|mudancas.*publicadas|qual foi revertida/.test(normalize(message))}
export function learningDecisionResponse(result){
 const lines=(result.candidates||[]).slice(0,8).map(c=>`${c.id}: hipótese ${c.hypothesis}; ${c.supporting_evidence.length} evidências favoráveis, ${c.contrary_evidence.length} contrárias; ${c.status}. Escopo: ${JSON.stringify(c.scope)}. Amostra insuficiente para generalizar.`)
 const answer=[`O que aprendemos? Foram identificados ${(result.candidates||[]).length} candidatos nesta página autorizada. Revisão humana pendente não constitui conhecimento publicado.`,...lines,`Publicações nesta página: ${(result.publications||[]).length}. Rollbacks: ${(result.rollback_history||[]).length}.`].join('\n')
 return {engineMode:'rules',model:'deterministic',advice:{answer,next_best_action:'Revise as evidências na Central de Aprendizado.',automatic_execution:false},responseMetadata:{source:'ORGANIZATIONAL_LEARNING_V1',providerCalls:0,automaticCrmWrite:false}}
}
