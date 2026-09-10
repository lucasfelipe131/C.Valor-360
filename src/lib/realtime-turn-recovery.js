// A retry stays in the provider conversation: do not replay the user message or
// replace the session instructions that bind its producer, epoch and tools.
export function realtimeTurnResponseOptions(turn){
 return {
  metadata:{val_turn_id:String(turn.id)},
  tool_choice:turn.hasToolResult?'none':{type:'function',name:'val_governed_tool'}
 }
}

export function realtimeTurnFailureMessage({heardAudio=false}={}){
 return heardAudio
  ? 'A resposta foi interrompida. Sua pergunta foi preservada; toque em Tentar novamente para ouvir a resposta desde o início.'
  : 'Não consegui concluir esta resposta. Sua pergunta foi preservada; toque em Tentar novamente.'
}

export function realtimeCompletedTranscript(response,fallback=''){
 const pieces=(response?.output||[]).filter(item=>item.type==='message'&&item.role==='assistant').flatMap(item=>(item.content||[]).map(content=>content.transcript||content.text||'')).filter(Boolean)
 return pieces.length?pieces.join(' '):fallback
}

export function realtimePartialMessageIds(response){
 return (response?.output||[]).filter(item=>item.id&&item.type==='message'&&item.role==='assistant').map(item=>item.id)
}
