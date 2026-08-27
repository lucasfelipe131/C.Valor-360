import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')

test('Voice Decision Copilot mantém comando natural separado de memória confirmada',()=>{
 assert.equal(resolveValNaturalCommand('Agora fala comigo').outputMode,'audio')
 assert.equal(resolveValNaturalCommand('Não registra').action,'KEEP_SESSION_ONLY')
 assert.equal(resolveValNaturalCommand('Aprofunda').local,false)
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.match(copilot,/sessionContext:\{objective:sessionObjective,replies:currentSessionReplies\.slice\(-6\)/)
 assert.match(copilot,/persistence_mode:'NONE'/)
 assert.match(copilot,/transient clientId=/)
})

test('voz do hero percorre transcrição efêmera sem produtor e interação escopada com produtor',()=>{
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.match(copilot,/createVoiceInteraction\(\{clientId:client\.id/)
 assert.match(copilot,/\/api\/val\/voice\/transcribe/)
 assert.match(copilot,/cancelVoiceInteraction\(interactionId\)/)
 const server=read('server.js')
 assert.match(server,/url\.pathname==='\/api\/val\/voice\/transcribe'/)
 assert.match(server,/persistenceMode/)
})

test('resposta falada preserva texto, controle e política sem persistência',()=>{
 const response=read('src/components/copilot/ValAudioResponse.jsx')
 const speech=read('src/hooks/useSpeechSynthesis.js')
 assert.match(response,/Ouvir resposta/)
 assert.match(response,/Pausar resposta/)
 assert.match(response,/Repetir resposta/)
 assert.match(response,/val-audio-fallback/)
 assert.match(speech,/persistence:'NONE'/)
 assert.match(speech,/records_audio:false/)
 assert.match(speech,/language==='pt-br'/)
})

test('documentação não promete TTS progressivo nem substitui UAT físico',()=>{
 const document=read('VAL_VOICE_DECISION_COPILOT_v2.md')
 assert.match(document,/Não existe TTS progressivo nesta versão/)
 assert.match(document,/não substitui essa prova física/i)
 assert.match(document,/uma a três questões por rodada/i)
})
