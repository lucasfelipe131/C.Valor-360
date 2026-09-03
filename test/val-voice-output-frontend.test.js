import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {
 VAL_VOICE_OUTPUT_POLICY,
 browserSpeechAvailable,
 createBrowserSpeechPlayback,
 normalizeSpeechText,
 selectPreferredPortugueseVoice
} from '../src/hooks/useSpeechSynthesis.js'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const hookSource=read('../src/hooks/useSpeechSynthesis.js')
const componentSource=read('../src/components/copilot/ValAudioResponse.jsx')
const styles=read('../src/val-audio-response.css')

class MockUtterance{
 constructor(text){
  this.text=text
  this.lang=''
  this.voice=null
  this.rate=1
  this.pitch=1
  this.volume=1
 }
}

function speechFixture(){
 const spoken=[]
 const synth={
  cancelCount:0,
  pauseCount:0,
  resumeCount:0,
  current:null,
  getVoices:()=>[
   {name:'English',lang:'en-US',default:true,localService:true},
   {name:'Português Portugal',lang:'pt-PT',default:false,localService:true},
   {name:'Luciana Brasil',lang:'pt-BR',default:false,localService:true}
  ],
  speak(utterance){this.current=utterance;spoken.push(utterance);utterance.onstart?.()},
  pause(){this.pauseCount+=1;this.current?.onpause?.()},
  resume(){this.resumeCount+=1;this.current?.onresume?.()},
  cancel(){this.cancelCount+=1}
 }
 return {synth,spoken}
}

test('voice output — política garante execução browser-native e zero persistência',()=>{
 assert.deepEqual(VAL_VOICE_OUTPUT_POLICY,{
  version:'val.voice_output_policy.v1',
 engine:'BROWSER_WEB_SPEECH',
 persistence:'NONE',
 records_audio:false,
  stores_text_in_val:false,
  sends_backend_request:false,
  browser_service_may_use_network:true
 })
 for(const forbidden of ['fetch(','localStorage','sessionStorage','indexedDB','MediaRecorder','getUserMedia'])assert.doesNotMatch(hookSource,new RegExp(forbidden.replace(/[()]/g,'\\$&'),'i'))
 assert.match(componentSource,/Sem persistência pela VAL:/)
 assert.match(componentSource,/não grava nem envia este áudio ao próprio backend/)
 assert.match(componentSource,/navegador ou sistema operacional pode usar seu serviço de voz/)
})

test('voice output — normaliza texto e prefere voz pt-BR local',()=>{
 const voices=[
  {name:'Default PT',lang:'pt-PT',default:true,localService:true},
  {name:'Luciana Brasil',lang:'pt_BR',default:false,localService:true},
  {name:'English',lang:'en-US',default:false,localService:true}
 ]
 assert.equal(normalizeSpeechText('  Olá\u0000\n  produtor.  '),'Olá produtor.')
 assert.equal(selectPreferredPortugueseVoice(voices),voices[1])
 assert.equal(selectPreferredPortugueseVoice([{name:'English',lang:'en-US'}]),null)
})

test('voice output — runtime reproduz, pausa, continua, para e repete sem reter áudio',()=>{
 const {synth,spoken}=speechFixture()
 const statuses=[]
 const selected=[]
 const playback=createBrowserSpeechPlayback({
  speechSynthesis:synth,
  SpeechSynthesisUtterance:MockUtterance,
  onStatus:value=>statuses.push(value),
  onVoice:value=>selected.push(value)
 })

 assert.equal(playback.supported,true)
 assert.equal(playback.speak('Minha leitura para o produtor.',{rate:9,pitch:-1,volume:2}),true)
 assert.equal(spoken.length,1)
 assert.equal(spoken[0].text,'Minha leitura para o produtor.')
 assert.equal(spoken[0].lang,'pt-BR')
 assert.equal(spoken[0].voice.name,'Luciana Brasil')
 assert.equal(spoken[0].rate,2)
 assert.equal(spoken[0].pitch,0)
 assert.equal(spoken[0].volume,1)
 assert.deepEqual(selected.at(-1),{name:'Luciana Brasil',lang:'pt-BR'})
 assert.equal(playback.getSnapshot().status,'speaking')

 assert.equal(playback.pause(),true)
 assert.equal(playback.getSnapshot().status,'paused')
 assert.equal(playback.resume(),true)
 assert.equal(playback.getSnapshot().status,'speaking')
 assert.equal(playback.stop(),true)
 assert.deepEqual(playback.getSnapshot(),{status:'idle',lastText:'Minha leitura para o produtor.',active:false,disposed:false})
 assert.equal(playback.repeat(),true)
 assert.equal(spoken.length,2)
 assert.equal(spoken[1].text,'Minha leitura para o produtor.')
 spoken[1].onend?.()
 assert.equal(playback.getSnapshot().status,'ended')
 assert.ok(statuses.includes('paused'))
 assert.ok(synth.cancelCount>=3)
})

test('voice output — erro e navegador sem suporte falham de forma segura',()=>{
 const unsupportedStatuses=[]
 const unsupported=createBrowserSpeechPlayback({onStatus:value=>unsupportedStatuses.push(value)})
 assert.equal(browserSpeechAvailable(),false)
 assert.equal(unsupported.supported,false)
 assert.equal(unsupported.speak('texto'),false)
 assert.equal(unsupported.pause(),false)
 assert.equal(unsupported.resume(),false)
 assert.equal(unsupported.stop(),false)
 assert.equal(unsupported.repeat(),false)
 assert.equal(unsupportedStatuses.at(-1),'unsupported')
 assert.doesNotThrow(()=>unsupported.dispose())

 const failing=createBrowserSpeechPlayback({
  speechSynthesis:{speak(){throw new Error('bloqueado')},cancel(){},getVoices(){return []}},
  SpeechSynthesisUtterance:MockUtterance
 })
 assert.equal(failing.speak('texto'),false)
 assert.equal(failing.getSnapshot().status,'error')
})

test('voice output — dispose cancela reprodução e invalida callbacks antigos',()=>{
 const {synth,spoken}=speechFixture()
 const statuses=[]
 const playback=createBrowserSpeechPlayback({speechSynthesis:synth,SpeechSynthesisUtterance:MockUtterance,onStatus:value=>statuses.push(value)})
 playback.speak('Resposta em andamento.')
 const utterance=spoken[0]
 playback.dispose()
 assert.deepEqual(playback.getSnapshot(),{status:'idle',lastText:'',active:false,disposed:true})
 assert.equal(utterance.onend,null)
 assert.equal(utterance.onerror,null)
 assert.equal(playback.speak('não deve iniciar'),false)
 assert.equal(spoken.length,1)
})

test('ValAudioResponse — SSR expõe controles acessíveis, autoplay opt-in e fallback textual',async()=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:ValAudioResponse,shouldShowSpeechFallback}=await vite.ssrLoadModule('/src/components/copilot/ValAudioResponse.jsx')
  const markup=renderToStaticMarkup(React.createElement(ValAudioResponse,{text:'Leitura da VAL.',autoPlay:false}))
  for(const label of ['Ouvir resposta','Pausar resposta','Parar resposta','Repetir resposta'])assert.match(markup,new RegExp(`aria-label="${label}"`))
  for(const copy of ['Ouvir','Pausar','Parar','Repetir','Sem persistência'])assert.match(markup,new RegExp(copy))
  assert.match(markup,/data-persistence="NONE"/)
  assert.match(markup,/role="status"/)
  assert.match(markup,/aria-live="polite"/)
  assert.match(markup,/class="val-audio-fallback">Leitura da VAL\.<\/p>/)
  assert.doesNotMatch(markup,/<audio/)
  assert.equal(shouldShowSpeechFallback({supported:true,status:'idle'}),false)
  assert.equal(shouldShowSpeechFallback({supported:true,status:'error'}),true)
  assert.equal(shouldShowSpeechFallback({supported:true,status:'indeterminado'}),true)
  assert.equal(shouldShowSpeechFallback({supported:null,status:'idle'}),true)
 }finally{await vite.close()}
 assert.match(componentSource,/autoPlay=false/)
 assert.match(componentSource,/if\(!autoPlay\|\|supported!==true/)
 assert.doesNotMatch(componentSource,/autoPlay=true/)
 assert.match(componentSource,/showFallback&&hasText&&<p className="val-audio-fallback">/)
})

test('voice output — estilos mantêm toque mobile, estado e redução de movimento',()=>{
 assert.match(styles,/\.val-audio-controls\{[^}]*grid-template-columns:repeat\(4/)
 assert.match(styles,/@media\(max-width:700px\)/)
 assert.match(styles,/\.val-audio-controls\{grid-template-columns:repeat\(2/)
 assert.match(styles,/min-height:46px/)
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/)
})
