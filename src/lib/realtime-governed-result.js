const clean=(value,max=6000)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max)

export function realtimeGovernedError(error,{reason='OTHER'}={}){
 const code=String(error?.payload?.code||'')
 if([404,409,422].includes(Number(error?.status))&&/^val_[a-z_]+$/.test(code)&&error?.payload?.error){
  return {status:/not_found|not_authorized/.test(code)?'NOT_FOUND':'INPUT_REQUIRED',reason,result:clean(error.payload.error,1200)}
 }
 return {status:'UNAVAILABLE',reason,result:'Não consegui concluir esta consulta agora. Sua pergunta foi preservada.'}
}

// Keep the server's answer, scope and epistemic qualifiers together when the
// speech model renders it. A clarification is not a completed producer lookup.
export function realtimeGovernedResult(response,{reason='OTHER'}={}){
 if(response?.cancelled)return {status:'CANCELLED',reason,result:'A consulta foi interrompida. Aguarde o pedido atual.'}
 if(response?.clarification){
  const clarification=response.clarification
  return {status:'CLARIFICATION_REQUIRED',reason,result:clean(response.responseText),clarification:{
   reference:clean(clarification.reference,180),question:clean(clarification.question,500),
   options:(Array.isArray(clarification.options)?clarification.options:[]).slice(0,5).map(option=>({id:clean(option.id,180),name:clean(option.name,180),municipality:clean(option.municipality,180)}))
  }}
 }
 if(!response?.responseText)return {status:'UNAVAILABLE',reason,result:'Não consegui concluir esta consulta. Não há resultado confirmado para responder.'}
 const reasoning=response.payload?.advice?.ai_reasoning||{}
 const scope=response.verifiedScope
 const scopeVerified=Boolean(scope?.tenantId&&scope?.ownerId&&scope?.conversationId&&Number.isSafeInteger(scope?.contextEpoch)&&scope.contextEpoch>=0&&scope.domain)
 const sources=Array.isArray(reasoning.evidence_to_use)?reasoning.evidence_to_use:[]
 return {
  status:response.blocked?'INPUT_REQUIRED':'COMPLETED',reason,result:clean(response.responseText),
  ...(scopeVerified?{contextScope:scope,responseId:clean(reasoning.reasoning_id,180)}:{}),
  sources:sources.slice(0,8).map(source=>({source_ref:clean(source.source_ref||source.id,240),source_type:clean(source.source_type,80),epistemic_type:clean(source.epistemic_type,80),observed_at:clean(source.observed_at,80),valid_until:clean(source.valid_until,80)})),
  presentationRule:'Preserve o sentido, as fontes e as limitações da resposta. Conhecimento geral da IA não comprova fatos de produtor nem registro, preço ou indicação vigente de produto.'
 }
}
