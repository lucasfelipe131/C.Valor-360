export const VAL_CONSULTATIVE_SEQUENCE=['preparar','alinhar','descobrir','dimensionar','construir_valor','propor','comprometer']

export function isConsultativeStage(value,sequence=VAL_CONSULTATIVE_SEQUENCE){
 return sequence.includes(String(value||''))
}

export function createSequenceControl(suggestedStage='preparar',sequence=VAL_CONSULTATIVE_SEQUENCE){
 const suggested=isConsultativeStage(suggestedStage,sequence)?suggestedStage:sequence[0]
 return {openStage:suggested,workingStage:null}
}

export function transitionSequenceControl(current,event={},sequence=VAL_CONSULTATIVE_SEQUENCE){
 const state=current&&typeof current==='object'?current:createSequenceControl(event.suggestedStage,sequence)
 const suggested=isConsultativeStage(event.suggestedStage,sequence)?event.suggestedStage:sequence[0]
 if(event.type==='open'&&isConsultativeStage(event.stage,sequence))return {...state,openStage:event.stage}
 if(event.type==='work'&&isConsultativeStage(event.stage,sequence))return {openStage:event.stage,workingStage:event.stage}
 if(event.type==='follow-suggestion')return {openStage:suggested,workingStage:null}
 if(event.type==='sync-suggestion'&&!state.workingStage)return {...state,openStage:suggested}
 return state
}

export function adjacentConsultativeStage(stage,direction,sequence=VAL_CONSULTATIVE_SEQUENCE){
 const index=Math.max(0,sequence.indexOf(stage))
 const next=Math.min(sequence.length-1,Math.max(0,index+direction))
 return sequence[next]
}
