const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function portfolioDecisionQuery(message=''){
 const value=normalized(message)
 const matched=/quem (?:eu )?(?:deveria|devo) visitar|qual produtor merece atencao|quem (?:tem|possui) maior potencial parado|(?:minha|a) proxima melhor acao|por que .{1,100}(?:esta em primeiro|subiu|desceu|deveria agir agora)|prioridades (?:de hoje|da carteira)/.test(value)
 const rankReference=String(message).match(/por qu[eê] (.+?) (?:est[aá] em primeiro|subiu|desceu)/i)?.[1]?.trim()
 const producerReference=rankReference&&!/^(ele|ela|esse produtor|este produtor|o produtor)$/i.test(rankReference)?rankReference:null
 return {matched,producerReference,portfolio:/quem |qual produtor|prioridades /.test(value),whyRank:/primeiro|subiu|desceu/.test(value),potential:/potencial parado/.test(value)}
}

export function portfolioDecisionResponse(result,{message,tenantId,ownerId,clientId=null,conversationId,contextEpoch=0,domain='COMMERCIAL'}={}){
 const query=portfolioDecisionQuery(message)
 const selected=query.potential?[...result.cards].filter(c=>c.commercial_gap>0).sort((a,b)=>b.commercial_gap-a.commercial_gap||a.producer_id.localeCompare(b.producer_id)):result.cards
 const cards=(query.portfolio?selected.filter(c=>c.eligible).slice(0,5):selected.filter(c=>!clientId||c.producer_id===clientId).slice(0,1))
 const answer=!result.enabled?'A priorização está desativada nesta versão.':!cards.length?'Não há evidência suficiente para priorizar essa carteira. Registre a decisão e o prazo do produtor.':cards.map((c,i)=>`${i+1}. ${c.producer.name} (posição ${c.rank||'não calculada'} na carteira): ${c.why_this_producer} Por que agora: ${c.why_now} Ação: ${c.next_best_action} Confiança: ${c.confidence.level}.`).join('\n\n')
 const top=cards[0],scope={tenant_id:tenantId,owner_id:ownerId,producer_id:clientId,conversation_id:conversationId,context_epoch:contextEpoch,domain}
 const interview=top?{...top.decision_interview,session_context:{...top.decision_interview.session_context,conversation_id:conversationId}}:null
 return {engineMode:'rules',model:'deterministic',decisionCards:cards,advice:{answer,next_best_action:top?.next_best_action||'Confirmar decisão e prazo.',ai_reasoning:{intent:'PORTFOLIO_DECISION',organization:{id:tenantId},client:{id:clientId||'portfolio'},conversation_id:conversationId,premises:{context_scope:scope},facts_used:cards.flatMap(c=>c.evidence.map(e=>({...e,producer_id:c.producer_id}))),confidence:top?.confidence||{level:'LOW'},decision_interview:interview,recommended_strategy:{reading:answer},golden_questions:top?.missing_information.slice(0,1).map(m=>({question:m.question,reason:m.reason}))||[],run:{status:'completed',model:'deterministic',policy_version:top?.policy_version},grounding:{passed:true,mode:'RECORDED_CANONICAL_EVIDENCE'},automatic_execution:false}},responseMetadata:{source:'PORTFOLIO_RADAR_V2',providerCalls:0,decisionIds:cards.map(c=>c.id),policyVersion:top?.policy_version,automaticCrmWrite:false}}
}
