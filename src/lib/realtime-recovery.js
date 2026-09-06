// Session admission and transport failures are separate from a spoken turn.
// Keep the server's deadline rather than restarting a countdown on every click.
export function realtimeRetrySeconds(retryAt,now=Date.now()){
 return Math.max(0,Math.ceil((Number(retryAt)-now)/1000)||0)
}

export function realtimeRetryDelay(payload={},headers=null,now=Date.now()){
 const seconds=Number(payload?.retryAfterSeconds)
 if(Number.isFinite(seconds)&&seconds>0)return Math.ceil(seconds)
 const header=headers?.get?.('Retry-After')
 if(header){
  const numeric=Number(header)
  if(Number.isFinite(numeric))return Math.max(0,Math.ceil(numeric))
  const date=Date.parse(header)
  if(Number.isFinite(date))return Math.max(0,Math.ceil((date-now)/1000))
 }
 return 0
}

export function realtimeFailureMessage(error={}){
 const code=String(error.code||error.name||'')
 if(code==='NotAllowedError')return 'O microfone não foi liberado. Permita o acesso ao microfone nas configurações deste site para conversar.'
 if(code==='NotFoundError')return 'Não encontrei um microfone. Conecte um microfone ou continue digitando.'
 if(code==='NotReadableError')return 'Não consegui acessar o microfone. Verifique se outro aplicativo está usando o dispositivo.'
 if(code==='AbortError'||code==='TimeoutError'||code==='REALTIME_CONNECT_TIMEOUT')return 'A conexão de voz demorou demais. Verifique sua conexão e tente novamente.'
 if(code==='TypeError')return 'A conexão de voz foi interrompida. Verifique sua internet e tente novamente.'
 return String(error.message||'Não consegui abrir a conversa por voz. Você pode continuar digitando.')
}

export function realtimeEventSuppressedWhilePaused(type){
 return ['input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','response.created','output_audio_buffer.started'].includes(type)
}
