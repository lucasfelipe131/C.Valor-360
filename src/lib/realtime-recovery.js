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

// O microfone e o transporte falham em momentos diferentes: getUserMedia acontece antes de
// qualquer chamada paga, e só depois dele o browser troca SDP com o provider. Tratar as duas
// coisas como "microfone desligado" mandou o consultor para as permissões do navegador
// enquanto o microfone já estava capturando e quem tinha falhado era o servidor de voz.
const MICROPHONE_FAILURE_CODES=new Set(['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError','MICROPHONE_PERMISSION_DENIED'])
export function realtimeFailureIsMicrophone(code){return MICROPHONE_FAILURE_CODES.has(String(code||''))}

// Um fetch rejeitado pelo browser chega sem status e sem corpo. Guardar nome e mensagem é a
// única pista que sobrevive ao encerramento da sessão, e ela precisa ser curta e sem conteúdo
// falado para poder ser registrada no servidor.
export function realtimeTransportDetail(error={},limit=180){
 const source=error?.cause&&(error.cause.name||error.cause.message)?error.cause:error
 const name=String(source?.name||'')
 const message=String(source?.message||'')
 return `${name}${name&&message?': ':''}${message}`.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit)
}

export function realtimeFailureMessage(error={}){
 const code=String(typeof error.code==='string'&&error.code||error.name||'')
 if(code==='NotAllowedError')return 'O microfone não foi liberado. Permita o acesso ao microfone nas configurações deste site para conversar.'
 if(code==='NotFoundError')return 'Não encontrei um microfone. Conecte um microfone ou continue digitando.'
 if(code==='NotReadableError')return 'Não consegui acessar o microfone. Verifique se outro aplicativo está usando o dispositivo.'
 if(code==='AbortError'||code==='TimeoutError'||code==='REALTIME_CONNECT_TIMEOUT')return 'A conexão de voz demorou demais. Verifique sua conexão e tente novamente.'
 // O microfone já foi concedido quando estes dois acontecem: dizer "verifique sua internet"
 // com todas as outras chamadas da mesma aba respondendo só atrasa o diagnóstico.
 if(code==='WEBRTC_SDP_EXCHANGE_FAILED')return 'Seu microfone está liberado, mas não consegui falar com o servidor de voz. Tente novamente ou use "Apertar para falar".'
 if(code==='WEBRTC_PROVIDER_REJECTED')return 'O servidor de voz recusou a conexão de áudio. Tente novamente em instantes ou use "Apertar para falar".'
 if(code==='TypeError')return 'A conexão de voz foi interrompida. Verifique sua internet e tente novamente.'
 return String(error.message||'Não consegui abrir a conversa por voz. Você pode continuar digitando.')
}

export function realtimeEventSuppressedWhilePaused(type){
 return ['input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','response.created','output_audio_buffer.started'].includes(type)
}
