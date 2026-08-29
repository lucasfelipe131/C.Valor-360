const clean=value=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,3000)
const fold=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[.!?]+$/g,'').trim()

export const VAL_NATURAL_COMMAND_POLICY=Object.freeze({
 version:'val.natural_commands.v1',
 persistence:'NONE',
 keeps_thread:true,
 changes_confirmed_memory:false
})

const exact=(value,...commands)=>commands.includes(value)

/**
 * Commands that only change the current conversation are resolved before the
 * model. Commands that need a new explanation keep the current thread and are
 * sent to the orchestrator with an explicit action.
 */
export function resolveValNaturalCommand(input){
 const normalized=fold(input)
 if(!normalized)return null
 const registration=clean(input).match(/^(?:registra|registre|anota|anote)\s+que\s+(.+?)[.!?]*$/i)
 if(registration)return {action:'OPEN_REGISTER',local:true,persistence:'CONFIRM_REQUIRED',candidate:clean(registration[1])}
 if(exact(normalized,'resume','resuma')||/^(?:agora\s+)?(?:resume|resuma)(?:\s+(?:isso|a resposta))?(?:\s+em uma linha)?(?:,?\s+mantendo\s+(?:o\s+)?mesmo\s+produtor)?$/.test(normalized))return {action:'SUMMARIZE',local:true,persistence:'NONE'}
 if(exact(normalized,'repete','repita')||/^(?:repete|repita)(?:\s+isso)?$/.test(normalized))return {action:'REPEAT',local:true,persistence:'NONE'}
 if(exact(normalized,'so as perguntas','agora so as perguntas','so as perguntas de ouro','somente as perguntas de ouro','so me manda as perguntas de ouro','agora me manda so as tres perguntas de ouro'))return {action:'GOLDEN_QUESTIONS_ONLY',local:true,persistence:'NONE'}
 if(exact(normalized,'agora por escrito','responda por escrito','me manda isso escrito','agora me manda isso por escrito'))return {action:'OUTPUT_TEXT',local:true,outputMode:'text',persistence:'NONE'}
 if(exact(normalized,'agora fala comigo','agora fala elas pra mim','agora fala isso pra mim','fale comigo','responda em audio','fala de novo'))return {action:'OUTPUT_AUDIO',local:true,outputMode:'audio',persistence:'NONE'}
 if(exact(normalized,'texto e audio','agora texto e audio'))return {action:'OUTPUT_BOTH',local:true,outputMode:'both',persistence:'NONE'}
 if(exact(normalized,'registra','registre'))return {action:'OPEN_REGISTER',local:true,persistence:'CONFIRM_REQUIRED'}
 if(exact(normalized,'nao registra','nao registre'))return {action:'KEEP_SESSION_ONLY',local:true,persistence:'NONE'}
 if(exact(normalized,'so o essencial','somente o essencial'))return {action:'SET_SIMPLE',local:true,density:'simple',persistence:'NONE'}
 if(exact(normalized,'aprofunda','aprofunde'))return {action:'DEEPEN',local:false,density:'analytical',persistence:'NONE'}
 if(exact(normalized,'explica melhor','explique melhor'))return {action:'EXPLAIN',local:false,persistence:'NONE'}
 if(exact(normalized,'me mostra os numeros','mostre os numeros'))return {action:'SHOW_NUMBERS',local:false,density:'analytical',persistence:'NONE'}
 if(exact(normalized,'por que voce acha isso','por que','porque'))return {action:'EXPLAIN_WHY',local:false,persistence:'NONE'}
 return null
}

const reasoningOf=payload=>payload?.advice?.ai_reasoning||{}
const answerOf=payload=>{
 const reasoning=reasoningOf(payload)
 return clean(reasoning.recommended_strategy?.reading||payload?.advice?.answer||'')
}

export function localNaturalCommandTurn(command,payload){
 if(!command?.local)return null
 const reasoning=reasoningOf(payload)
 const questions=Array.isArray(reasoning.golden_questions)?reasoning.golden_questions.slice(0,3):[]
 if(command.action==='SUMMARIZE'){
  const reading=answerOf(payload)
  const action=clean(reasoning.recommended_strategy?.action||reasoning.next_commitment||'')
  return {role:'system',command:command.action,text:reading?`${reading}${action?` Próximo passo: ${action}`:''}`:'Ainda não há uma resposta da VAL para resumir.',persistence:'NONE'}
 }
 if(command.action==='GOLDEN_QUESTIONS_ONLY')return {role:'system',command:command.action,text:questions.length?questions.map((item,index)=>`${index+1}. ${clean(item?.question||item)}`).join('\n'):'A leitura atual não gerou Perguntas de Ouro.',persistence:'NONE'}
 if(command.action==='REPEAT')return payload?{role:'assistant',command:command.action,payload,persistence:'NONE'}:{role:'system',command:command.action,text:'Ainda não há uma resposta da VAL para repetir.',persistence:'NONE'}
 const messages={
  OUTPUT_TEXT:'Certo. A partir de agora respondo por escrito.',
  OUTPUT_AUDIO:'Certo. A partir de agora respondo por áudio.',
  OUTPUT_BOTH:'Certo. A partir de agora respondo em texto e áudio.',
  OPEN_REGISTER:command.candidate?`Tenho esta informação para revisar: “${clean(command.candidate)}”. Nada será registrado sem sua confirmação.`:'Vou abrir a revisão. Nada será registrado sem sua confirmação.',
  KEEP_SESSION_ONLY:'Certo. Esta informação fica somente nesta conversa.',
  SET_SIMPLE:'Certo. Vou manter só o essencial.'
 }
 return {role:'system',command:command.action,text:messages[command.action]||'Preferência aplicada nesta conversa.',persistence:'NONE'}
}

export function naturalCommandRequest(command,input){
 if(!command||command.local)return clean(input)
 const prompts={
  DEEPEN:'Aprofunde a última leitura mantendo exatamente o produtor, o objeto ativo e os fatos confirmados desta conversa. Separe fatos, hipóteses, lacunas e evidências.',
  EXPLAIN:'Explique melhor a última leitura, em linguagem clara, sem reiniciar ou trocar o contexto atual.',
  SHOW_NUMBERS:'Mostre os números materiais da última leitura, com unidade, fonte, data e hipótese. Se não houver dado confiável, diga o que falta.',
  EXPLAIN_WHY:'Explique por que chegou à última recomendação. Mostre fatos, hipóteses, evidências e lacunas, sem inventar dados.'
 }
 return prompts[command.action]||clean(input)
}

export function normalizeValOutputMode(value){
 const normalized=String(value||'').toLowerCase()
 return ['text','audio','both'].includes(normalized)?normalized:'text'
}

const outputKey=scope=>`val.voice_decision.output.v1:${encodeURIComponent(String(scope||'session'))}`
export function hasValOutputModePreference(scope,storage=globalThis.localStorage){
 try{return storage?.getItem(outputKey(scope))!=null}catch{return false}
}
export function readValOutputMode(scope,storage=globalThis.localStorage){
 try{return normalizeValOutputMode(storage?.getItem(outputKey(scope)))}catch{return 'text'}
}
export function writeValOutputMode(scope,value,storage=globalThis.localStorage){
 const normalized=normalizeValOutputMode(value)
 try{storage?.setItem(outputKey(scope),normalized)}catch{}
 return normalized
}
