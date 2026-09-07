const limitError=(code,message,retryAfterSeconds)=>Object.assign(new Error(message),{code,statusCode:429,exposeMessage:true,safeToRetry:true,retryAfterSeconds})

// Startup failures are not sessions. Keep the successful-session quota separate
// from the short abuse window, the in-flight lock and provider recovery backoff.
export function createRealtimeSessionAdmission({limit=6,now=Date.now}={}){
 const windowMs=600_000
 const actors=new Map()
 const stateFor=key=>{
  const time=now()
  for(const [actor,state] of actors)if(!state.pending&&state.touchedAt+windowMs<=time)actors.delete(actor)
  const state=actors.get(key)||{successes:[],requests:[],pending:null,failures:0,cooldownUntil:0,touchedAt:time}
  state.successes=state.successes.filter(value=>value+windowMs>time)
  state.requests=state.requests.filter(value=>value+60_000>time)
  state.touchedAt=time
  actors.set(key,state)
  return state
 }
 const inspect=key=>{
  const state=stateFor(key),time=now()
  if(state.pending)return {allowed:false,code:'realtime_voice_session_pending',message:'A conexão de voz já está sendo preparada. Aguarde um instante.',retryAfterSeconds:2}
  if(state.cooldownUntil>time)return {allowed:false,code:'realtime_voice_retry_cooldown',message:state.canRetry===false?'O serviço de voz precisa de uma revisão de configuração. Você pode continuar por texto.':'A conexão de voz está se recuperando. Tente novamente em instantes.',canRetry:state.canRetry!==false,retryAfterSeconds:Math.max(1,Math.ceil((state.cooldownUntil-time)/1000))}
  if(state.successes.length>=limit)return {allowed:false,code:'realtime_voice_rate_limit',message:'Você abriu várias sessões de voz. Aguarde para iniciar outra.',retryAfterSeconds:Math.max(1,Math.ceil((state.successes[0]+windowMs-time)/1000))}
  return {allowed:true,retryAfterSeconds:0}
 }
 return Object.freeze({
  assertRequestAllowed(key){
   const state=stateFor(key)
   if(state.requests.length>=60)throw limitError('realtime_voice_request_limit','Muitas solicitações de voz em sequência. Aguarde um instante.',Math.max(1,Math.ceil((state.requests[0]+60_000-now())/1000)))
   state.requests.push(now())
  },
  inspect,
  begin(key){
   const admission=inspect(key)
   if(!admission.allowed)throw Object.assign(limitError(admission.code,admission.message,admission.retryAfterSeconds),{safeToRetry:admission.canRetry!==false})
   const token=Symbol('realtime-startup')
   stateFor(key).pending=token
   return {key,token}
  },
  complete(ticket,{success=false,recoveryRequired=false,retryAfterSeconds=0,canRetry=true}={}){
   const state=stateFor(ticket.key)
   if(state.pending!==ticket.token)return 0
   state.pending=null
   if(success){state.successes.push(now());state.failures=0;state.cooldownUntil=0;return 0}
   if(!recoveryRequired)return 0
   state.canRetry=canRetry
   state.failures=Math.min(5,state.failures+1)
   const delay=Math.min(120,Math.max(Math.min(30,2**state.failures),Number(retryAfterSeconds)||0))
   state.cooldownUntil=now()+delay*1000
   return delay
  }
 })
}
