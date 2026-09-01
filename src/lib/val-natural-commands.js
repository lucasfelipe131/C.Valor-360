import {assertCompletedAssistantTurnScope} from './full-screen-conversation.js'

const clean=(value,max=3000)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,Math.max(0,Number.isFinite(Number(max))?Number(max):3000))
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
 const summary=normalized.match(/^(?:agora\s+)?(?:resume|resuma)(?:\s+(?:isso|a resposta|sua resposta anterior|a resposta anterior))?(?:\s+em uma linha)?(?:,?\s+mantendo\s+(?:(?<same_client>(?:o\s+)?mesmo\s+produtor)|(?<expected_client>[a-z0-9][a-z0-9 '-]{0,119}?)\s+como\s+produtor\s+atual))?(?:\s+e\s+sem\s+executar\s+nova\s+busca)?$/)
 if(exact(normalized,'resume','resuma')||summary)return {action:'SUMMARIZE',local:true,persistence:'NONE',expectedClientReference:clean(summary?.groups?.expected_client,120)||null,requiresCurrentClient:Boolean(summary?.groups?.same_client||summary?.groups?.expected_client)}
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

export function naturalCommandMatchesClient(command,client){
 if(!command?.requiresCurrentClient)return true
 const current=fold(client?.name)
 const expected=fold(command.expectedClientReference)
 if(!current)return false
 if(!expected)return true
 return current===expected||current.startsWith(`${expected} `)||expected.startsWith(`${current} `)
}

const settledResponseActions=new Set(['SUMMARIZE','REPEAT','GOLDEN_QUESTIONS_ONLY','OUTPUT_AUDIO','DEEPEN','EXPLAIN','SHOW_NUMBERS','EXPLAIN_WHY'])
export const naturalCommandNeedsSettledResponse=command=>Boolean(settledResponseActions.has(command?.action))

const monotonicNow=()=>globalThis.performance?.now?.()??Date.now()
const responseId=()=>globalThis.crypto?.randomUUID?.()||`fast-${Date.now()}-${Math.random().toString(36).slice(2)}`
const fastIntent=action=>({SUMMARIZE:'FOLLOW_UP_RESUME',REPEAT:'FOLLOW_UP_REPEAT',GOLDEN_QUESTIONS_ONLY:'FOLLOW_UP_GOLDEN_QUESTIONS'}[action]||`FOLLOW_UP_${clean(action,80)}`)
const cleanMultiline=(value,max=3000)=>String(value??'').replace(/[\r\t]+/g,' ').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').slice(0,max)

function directFastTurn(command,text,scope={},source=null){
 const at=monotonicNow()
 const answer=cleanMultiline(text,3000)
 if(!Number.isSafeInteger(scope.contextEpoch)||scope.contextEpoch<0)throw Object.assign(new Error('O follow-up não possui contextEpoch exato.'),{code:'val_follow_up_scope_mismatch',scopeField:'contextEpoch',reason:'invalid'})
 return {
  role:'assistant_text',mode:'FAST',status:'completed',serverGrounded:true,grounding:'DERIVED_FROM_SERVER_GROUNDED',command:command.action,intent:fastIntent(command.action),
  answer,text:answer,responseId:responseId(),producerId:clean(scope.producerId,180)||null,
  conversationId:clean(scope.conversationId,180)||null,contextEpoch:scope.contextEpoch,
  goldenQuestions:Array.isArray(source?.goldenQuestions)?source.goldenQuestions.slice(0,3):[],sourceResponseId:clean(source?.responseId,180)||null,
  persistence:'NONE',trace:{CLIENT_INPUT:at,CLIENT_SEND:at,CLIENT_RESPONSE_RECEIVED:monotonicNow(),STORE_UPDATED:null,RENDER_COMMITTED:null}
 }
}

const completedSource=(source,scope)=>assertCompletedAssistantTurnScope(source?.role?source:{role:'assistant',status:'completed',serverGrounded:source?.serverGrounded===true,grounding:source?.grounding,payload:source},scope)

export function localNaturalCommandTurn(command,source,scope={}){
 if(!command?.local)return null
 const settled=naturalCommandNeedsSettledResponse(command)?completedSource(source,scope):null
 const questions=Array.isArray(settled?.goldenQuestions)?settled.goldenQuestions.slice(0,3):[]
 if(command.action==='SUMMARIZE'){
  const reading=settled.text
  const firstSentence=reading.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim()||reading
  return directFastTurn(command,clean(firstSentence,500),settled,settled)
 }
 if(command.action==='GOLDEN_QUESTIONS_ONLY')return directFastTurn(command,questions.length?questions.map((item,index)=>`${index+1}. ${clean(item?.question||item)}`).join('\n'):'A leitura atual não gerou Perguntas de Ouro.',settled,settled)
 if(command.action==='REPEAT')return directFastTurn(command,settled.text,settled,settled)
 if(command.action==='OUTPUT_AUDIO')return directFastTurn(command,settled.text,settled,settled)
 const messages={
  OUTPUT_TEXT:'Certo. A partir de agora respondo por escrito.',
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
