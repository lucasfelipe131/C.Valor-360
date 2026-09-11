// Only selected, server-scoped snapshot records may support preparation.
const list=value=>Array.isArray(value)?value:[]
const text=(value,max=2200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const open=value=>/^(?:OPEN|PENDING|IN_PROGRESS|CONFIRMED|ABERTO|PENDENTE)$/i.test(text(value))
const date=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?'':parsed.toLocaleDateString('pt-BR',{timeZone:'UTC'})}

export function visitPreparationEvidence(snapshot={}){
 const scope=snapshot.context_scope||{}
 if(!scope.producer_id||!scope.tenant_id||!scope.owner_id)return []
 const relationship=snapshot.relationship_context||{}
 const groups=[['visit',relationship.visits],['interaction',relationship.interactions],['commitment',relationship.commitments]]
 return groups.flatMap(([type,wrappers])=>list(wrappers).slice(0,4).flatMap(wrapper=>{
  if(wrapper.producerId!==scope.producer_id||wrapper.tenantId!==scope.tenant_id||wrapper.ownerId!==scope.owner_id||!wrapper.evidence_ref?.id)return []
  const item=wrapper.data||{}
  const statements=[]
  const observed=wrapper.observed_at
  const when=date(observed)
  const prefix=type==='visit'?'Relato de visita':type==='interaction'?'Relato de interação':open(item.status)?'Compromisso aberto':'Compromisso registrado'
  const rawSummary=text(item.summary||item.description||item.objective,10000)
  const followup=rawSummary.split(/(?<=[.!?])\s+/).filter(sentence=>/combin|compromiss|pr[oó]xim[ao]|retorn|ficou|pendente/i.test(sentence)).slice(-2).join(' ')
  const summary=text(rawSummary,450)
  if(followup&&!summary.includes(followup))statements.push(`${prefix}: ${text(followup,500)}`)
  if(summary)statements.push(`${prefix}${when&&type!=='commitment'?` em ${when}`:''}: ${summary}`)
  if(type==='commitment'&&when)statements.push(`Data do registro do compromisso: ${when}`)
  const next=text(item.next_commitment??item.nextCommitment,320)
  if(next)statements.unshift(`Próximo passo registrado na visita: ${next}`)
  const due=date(item.due_at??item.dueAt??item.next_action_at??item.nextActionAt)
  if(due)statements.unshift(`Prazo registrado: ${due}`)
  if(type==='commitment'&&item.status)statements.push(`Status do compromisso: ${text(item.status,80)}`)
  if(!statements.length||!observed)return []
  let statement=''
  for(const part of statements){
   const available=840-statement.length
   if(available<80)break
   const bounded=part.length>available?part.slice(0,available-2).replace(/\s+\S*$/,''):part
   statement+=bounded.replace(/[.!?]+$/,'')+'. '
  }
  return [{id:`visit-preparation:${wrapper.evidence_ref.id}`,source_ref:wrapper.evidence_ref.id,source_type:type,
   epistemic_type:type==='interaction'?'OBSERVATION':'FACT',producer_id:scope.producer_id,tenant_id:scope.tenant_id,owner_id:scope.owner_id,
   observed_at:observed,valid_until:null,statement:statement.trim(),
   // A due date is not an expiry date: overdue commitments remain historical evidence.
  }]
 })).slice(0,12)
}

export const visitPreparationInstructions=`PREPARAÇÃO DE VISITA: Use os relatos e interações recentes do produtor selecionado e os compromissos registrados, mesmo em uma conversa nova. Leia o conteúdo completo: o próximo passo pode estar no fim do relato. Conecte o que aconteceu, o que ficou combinado, o prazo e o objetivo da próxima visita. Diferencie relato do consultor, fato confirmado e sua hipótese. Proponha uma abertura concreta, material a levar e próximo avanço vinculados às fontes. Não repita perguntas já respondidas nos registros. Não transforme prazo vencido em compromisso concluído, nem sugestão em promessa do produtor. Se registros divergirem, explicite a divergência e pergunte apenas o que muda a ação. Ausência de perfil, compra ou decisão final não apaga a evidência das visitas. Nunca infira comportamento ou contexto de outro produtor.`

// Fixed application policy, separate from record facts and model-generated claims.
// This is procedural guidance only; it cannot substantiate an individual producer fact.
export const visitPreparationMethod=Object.freeze({
 objective:'Defina o objetivo da próxima visita a partir dos registros recentes.',
 action:'Revise os compromissos registrados antes da visita. Apresente o próximo passo registrado e confirme o que mudou desde a conversa anterior. Defina responsável e prazo para o avanço seguinte.',
 avoid:'Evite tratar um relato como decisão final ou repetir perguntas já respondidas.',
 validate:'Confirme o status atual dos compromissos registrados.',
 reconsider:'Revise a preparação se o produtor trouxer uma mudança de prioridade.'
})
export function visitPreparationMethodEvidence(scope){
 return {id:'visit-preparation-method:v1',source_ref:'server/ai-reasoning/visit-preparation-context.js:visitPreparationMethod:v1',source_type:'approved_playbook',epistemic_type:'STRATEGY',statement:Object.values(visitPreparationMethod).join(' '),producer_id:scope.activeProducerId,tenant_id:scope.tenantId,owner_id:scope.ownerId,observed_at:'2026-09-11T00:00:00.000Z',valid_until:null}
}
