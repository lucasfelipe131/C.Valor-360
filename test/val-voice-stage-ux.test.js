import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('voice stage — estados, controles e falha preservam uma saída utilizável',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {ValRealtimeConversationStage}=await vite.ssrLoadModule('/src/components/copilot/ValRealtimeConversation.jsx')
  const stage=(state,props={})=>renderToStaticMarkup(React.createElement(ValRealtimeConversationStage,{state,onFallbackText:()=>{},onFallbackPushToTalk:()=>{},...props}))
  await t.test('pensando mantém pausa disponível para desligar o microfone',()=>{
   const markup=stage({status:'THINKING',microphoneActive:true})
   assert.match(markup,/Pensando na sua pergunta/)
   assert.match(markup,/data-microphone-active="true"/)
   assert.match(markup,/aria-label="Pausar modo conversa e desligar o microfone"/)
   assert.match(markup,/aria-label="Continuar a conversa por texto"/)
   assert.match(markup,/aria-label="Sair do modo conversa"/)
  })
  await t.test('pausa informa microfone desligado e permite retomar',()=>{
   const markup=stage({status:'PAUSED',microphoneActive:false})
   assert.match(markup,/Conversa pausada/)
   assert.match(markup,/data-microphone-active="false"/)
   assert.match(markup,/aria-label="Retomar modo conversa"/)
   assert.doesNotMatch(markup,/aria-label="Pausar modo conversa/)
  })
  await t.test('falha expõe motivo real e espera calculada, sem bloquear texto e encerramento',()=>{
   const markup=stage({status:'FALLBACK',microphoneActive:false,error:'O serviço de voz está temporariamente indisponível.',retryAfterSeconds:75,canRetry:false})
   assert.match(markup,/O serviço de voz está temporariamente indisponível\./)
   assert.match(markup,/role="timer" aria-live="off">1:15/)
   assert.match(markup,/<button[^>]*disabled=""[^>]*aria-label="Tentar modo conversa novamente"/)
   assert.match(markup,/Apertar para falar/)
   const controls=markup.split('aria-label="Controles do modo conversa"')[1]
   assert.match(controls,/Continuar a conversa por texto/)
   assert.match(controls,/Sair do modo conversa/)
   assert.doesNotMatch(controls,/disabled=""/)
  })
  await t.test('fim da espera torna a tentativa disponível',()=>{
   const markup=stage({status:'FALLBACK',microphoneActive:false,retryAfterSeconds:0,canRetry:true})
   const retry=markup.match(/<button[^>]*aria-label="Tentar modo conversa novamente"[^>]*>/)?.[0]
   assert.ok(retry)
   assert.doesNotMatch(retry,/disabled/)
   assert.doesNotMatch(markup,/role="timer"/)
  })
  await t.test('bloqueio de reprodução oferece retomada explícita de áudio',()=>{
   const markup=stage({status:'SPEAKING',microphoneActive:true,audioBlocked:true},{onResumeAudio:()=>{}})
   assert.match(markup,/aria-label="Retomar áudio da VAL"/)
   assert.match(markup,/Continuar a conversa por texto/)
  })
  await t.test('fala exibe transcrição legível e escapada, sem executar conteúdo',()=>{
   const markup=stage({status:'SPEAKING',microphoneActive:true,canBargeIn:true,interimTranscript:'E a última visita?',assistantTranscript:'<script>window.leak()</script> Vou consultar o histórico.'})
   assert.match(markup,/VAL está falando/)
   assert.match(markup,/aria-label="Interromper a VAL e falar"/)
   assert.match(markup,/aria-label="Transcrição da conversa"/)
   assert.match(markup,/E a última visita\?/)
   assert.match(markup,/&lt;script&gt;/)
   assert.doesNotMatch(markup,/<script>/)
  })
  // Enquanto uma capacidade governada roda (round trip de segundos), o palco nao pode convidar o
  // consultor a falar: a fala nova abriria uma segunda resposta e derrubaria a sessao.
  await t.test('ferramenta governada em voo mostra trabalho em vez de convidar a falar',()=>{
   const markup=stage({status:'LISTENING',microphoneActive:true},{processing:true})
   assert.match(markup,/Pensando na sua pergunta/)
   assert.doesNotMatch(markup,/Estou ouvindo/)
   assert.doesNotMatch(markup,/Fale naturalmente/)
   const idle=stage({status:'LISTENING',microphoneActive:true})
   assert.match(idle,/Estou ouvindo/)
  })
 }finally{await vite.close()}
})
