import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {
 cancelVoiceInteraction,
 confirmVoiceInteraction,
 createVoiceInteraction,
 getVoiceInteraction
} from '../src/lib/voice-interactions-client.js'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const component=read('../src/components/voice/VoiceCapture.jsx')
const recorder=read('../src/hooks/useVoiceRecorder.js')
const styles=read('../src/voice-capture.css')
const client360=read('../src/pages/Client360.jsx')
const visits=read('../src/pages/Visits.jsx')
const prepareVisitSimple=read('../src/components/visit/PrepareVisitSimple.jsx')

const occurrences=(source,fragment)=>source.split(fragment).length-1

test('VoiceCapture frontend — launcher SSR preserva rótulo, descrição e bloqueio sem produtor',async()=>{
 const vite=await createServer({root:new URL('..',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:VoiceCapture}=await vite.ssrLoadModule('/src/components/voice/VoiceCapture.jsx')
  const enabled=renderToStaticMarkup(React.createElement(VoiceCapture,{clientId:'client-voice-1',interactionType:'CLIENT_NOTE',label:'Registrar áudio',description:'Informação ou lembrete'}))
  const disabled=renderToStaticMarkup(React.createElement(VoiceCapture,{clientId:'',label:'Registrar áudio'}))
  assert.match(enabled,/class="voice-capture-launcher"/)
  assert.match(enabled,/aria-haspopup="dialog"/)
  assert.match(enabled,/aria-expanded="false"/)
  assert.match(enabled,/>Registrar áudio</)
  assert.match(enabled,/>Informação ou lembrete</)
  assert.doesNotMatch(enabled,/ disabled=""/)
  assert.match(disabled,/ disabled=""/)
 }finally{await vite.close()}
})

test('VoiceCapture frontend — Cliente 360 expõe CLIENT_NOTE com confirmação e refresh',()=>{
 assert.equal(occurrences(client360,'interactionType="CLIENT_NOTE"'),1)
 assert.match(client360,/label="Registrar áudio"/)
 assert.match(client360,/sourceContext=\{\{page:'CLIENT_360'\}\}/)
 assert.match(client360,/onConfirmed=\{async payload=>\{const canonical=canonicalVoiceChange\(payload\)/)
 assert.match(client360,/setOverviewRevision\(value=>value\+1\)/)
 assert.match(client360,/await onRefreshPortfolio\?\.\(\)/)
 assert.doesNotMatch(client360,/interactionType="CLIENT_NOTE"[^>]*visitId=/)
})

test('VoiceCapture frontend — PRE, FIELD e POST aparecem uma vez e usam contexto da visita',()=>{
 const visitSurfaces=`${visits}\n${prepareVisitSimple}`
 for(const type of ['PRE_VISIT','FIELD_NOTE','POST_VISIT'])assert.equal(occurrences(visitSurfaces,`interactionType="${type}"`),1,type)
 assert.match(prepareVisitSimple,/interactionType="PRE_VISIT"[^>]*preparation_id:preparation\.preparation_id/)
 assert.match(visits,/interactionType="FIELD_NOTE"[^>]*moment:'FIELD_WORK'/)
 assert.match(visits,/interactionType="POST_VISIT"[^>]*moment:'POST_VISIT'/)
 assert.match(prepareVisitSimple,/label="Falar com a VAL"/)
 assert.match(visits,/label="Registrar observação rápida"/)
 assert.match(visits,/label="Me conte como foi"/)
 assert.doesNotMatch(visits,/interactionType="PRE_VISIT"/)
 assert.match(visits,/payload\?\.result\?\.preparation_result/)
 assert.match(visits,/payload\?\.result\?\.visit/)
})

test('VoiceCapture frontend — lifecycle canônico bloqueia superfícies em estados terminais',()=>{
 for(const state of ['PLANNED','PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'])assert.match(visits,new RegExp(`'${state}'`))
 assert.match(visits,/preVisitVoiceLifecycle=new Set\(\['PLANNED','PREPARED'\]\)/)
 assert.match(visits,/fieldVoiceLifecycle=new Set\(\['IN_PROGRESS'\]\)/)
 assert.match(visits,/postVisitVoiceLifecycle=new Set\(\['IN_PROGRESS','COMPLETED_PENDING_REVIEW'\]\)/)
 assert.match(visits,/closedVoiceLifecycle=new Set\(\['COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'\]\)/)
 assert.match(visits,/canPrepare=preVisitVoiceLifecycle\.has\(lifecycle\)/)
 assert.match(visits,/canCaptureDuring=fieldVoiceLifecycle\.has\(lifecycle\)/)
 assert.match(visits,/canCloseVisit=postVisitVoiceLifecycle\.has\(lifecycle\)/)
 assert.match(prepareVisitSimple,/\{canVoice&&<VoiceCapture[^>]*interactionType="PRE_VISIT"/)
 assert.match(visits,/\{canCaptureDuring&&<aside[^>]*visit-field-voice/)
 assert.match(visits,/\{canCloseVisit&&<VoiceCapture[^>]*interactionType="POST_VISIT"/)
})

test('VoiceCapture frontend — hook invalida operações antigas e limpa mídia com segurança',()=>{
 assert.match(recorder,/MAX_VOICE_DURATION_SECONDS=900/)
 assert.match(recorder,/MAX_VOICE_BYTES=6_000_000/)
 assert.match(recorder,/generationRef=useRef\(0\)/)
 assert.ok(occurrences(recorder,'generationRef.current+=1')>=3)
 assert.ok(occurrences(recorder,'generationRef.current!==generation')>=4)
 assert.match(recorder,/getUserMedia\(\{audio:/)
 assert.match(recorder,/stream\.getTracks\(\)\.forEach\(track=>track\.stop\(\)\)/)
 assert.match(recorder,/URL\.revokeObjectURL/)
 assert.match(recorder,/recorder\.ondataavailable=.*generationRef\.current!==generation/)
 assert.match(recorder,/const selectFile=.*generationRef\.current\+1/s)
 assert.match(recorder,/setStatus\('validating'\)/)
 assert.doesNotMatch(recorder,/cancelledRef/)
})

test('VoiceCapture frontend — captura mantém um toque, fallback texto e cancelamento explícito',()=>{
 assert.match(component,/const launch=\(\)=>\{confirmationNotifiedRef\.current=false;setOpen\(true\);setMode\('AUDIO'\);setPhase\('capture'\);setError\(''\);const pendingId=readPending\(\);if\(pendingId\)resumePending\(pendingId\);else recorder\.start\(\)\}/)
 assert.match(component,/const recorderBusy=recorder\.status==='requesting'\|\|recorder\.status==='validating'/)
 assert.match(component,/disabled=\{recorderBusy\}[^>]*>.*Escolher áudio salvo/s)
 assert.match(component,/aria-label="Escolher arquivo de áudio"[^>]*disabled=\{recorderBusy\}/)
 assert.match(component,/htmlFor=\{manualTextId\}>Conte livremente/)
 assert.match(component,/id=\{manualTextId\}[^>]*maxLength="20000"/)
 assert.match(component,/Digitar em vez disso/)
 assert.match(component,/recorder\.cancelRecording/)
 assert.match(component,/cancelVoiceInteraction\(remoteId\)/)
 assert.match(component,/>Cancelar operação</)
 assert.match(component,/aria-label=\{phase==='success'\?'Fechar':'Cancelar e fechar'\}/)
 assert.match(component,/disabled=\{recorder\.status==='recording'\} className=\{mode==='TEXT'/)
 assert.match(component,/recorder\.status==='validating'\?'Validando áudio…'/)
})

test('VoiceCapture frontend — revisão acessível precede confirmação e mantém decisões humanas',()=>{
 const errorIndex=component.indexOf('voice-error voice-review-error')
 const footerIndex=component.indexOf('voice-review-footer')
 assert.ok(errorIndex>0&&footerIndex>errorIndex,'erro de revisão deve aparecer antes do rodapé sticky')
 assert.match(component,/role="alert"/)
 assert.match(component,/aria-invalid=\{dueInvalid\|\|undefined\}/)
 assert.match(component,/aria-invalid=\{statementInvalid\|\|undefined\}/)
 assert.match(component,/querySelector\('\[aria-invalid="true"\]'\)\?\.focus\(\)/)
 assert.match(component,/Preencha ou remova toda informação vazia antes de confirmar/)
 assert.match(component,/aria-label=\{`Remover \$\{categoryLabel\}:/)
 assert.match(component,/Texto da nova informação/)
 assert.match(component,/decision:'REJECTED'/)
 assert.match(component,/decision:item\.decision/)
 assert.match(component,/additions:added/)
 assert.match(component,/Confirmar tudo<\/button>/)
 assert.match(component,/Somente os itens mantidos acima serão confirmados/)
 assert.match(component,/<details className="voice-transcript">/)
 assert.ok(component.indexOf('await confirmVoiceInteraction')<component.indexOf('await onConfirmed(result)'))
})

test('VoiceCapture frontend — NEXT_STEP possui uma única fonte revisável e respeita editar/remover',()=>{
 assert.match(component,/const nextItems=postVisit\?\[/)
 assert.match(component,/active\.filter\(item=>item\.category==='NEXT_STEP'\)/)
 assert.match(component,/className="voice-post-next"/)
 assert.match(component,/item\.category==='NEXT_STEP'&&item\.decision!=='REJECTED'/)
 assert.match(component,/category==='NEXT_STEP'&&item\.decision!=='REJECTED'\?\{\.\.\.item,decision:'REJECTED'\}/)
 assert.doesNotMatch(component,/const \[nextStep,setNextStep\]/)
 assert.doesNotMatch(component,/nextStep:isPostVisit/)
 assert.doesNotMatch(component,/nextStepAt:isPostVisit/)
})

test('VoiceCapture frontend — confirmação falha volta à revisão e sucesso notifica uma vez ao concluir',()=>{
 assert.match(component,/setRetryStage\('confirm'\);setError\([^;]+\);setPhase\('review'\)/)
 assert.match(component,/querySelector\('\.voice-review-error'\)\?\.focus\(\)/)
 assert.match(component,/confirmationNotifiedRef=useRef\(false\)/)
 assert.match(component,/const finishSuccess=\(\)=>\{if\(confirmationNotifiedRef\.current\)\{close\(\{cancelRemote:false\}\);return\}/)
 assert.match(component,/onClick=\{finishSuccess\}>Concluir/)
 assert.match(component,/phase==='success'\?finishSuccess\(\):close\(\)/)
 assert.match(component,/!isPostVisit\(interactionType\)&&onConfirmed&&!confirmationNotifiedRef\.current/)
})

test('VoiceCapture frontend — retoma ID pendente sem persistir conteúdo ou áudio local',()=>{
 assert.match(component,/pendingStoragePrefix='valor360:voice-pending:v1'/)
 assert.match(component,/sessionStorage\.getItem\('valor360-active-storage-scope'\)/)
 assert.match(component,/localStorage\.setItem\(pendingKey,JSON\.stringify\(\{interaction_id:String\(id\),saved_at:Date\.now\(\)\}\)\)/)
 assert.match(component,/const resumePending=async id=>/)
 assert.match(component,/if\(status==='PENDING_REVIEW'\)\{hydrateReview\(current\);return\}/)
 const persistedRecord=component.match(/localStorage\.setItem\(pendingKey,JSON\.stringify\(([^\n]+)\)/)?.[1]||''
 assert.doesNotMatch(persistedRecord,/audio|transcript|candidate|manual/i)
})

test('VoiceCapture frontend — affordances mobile têm sheet, safe area, toque e texto legível',()=>{
 assert.match(styles,/@media\(max-width:700px\)/)
 assert.match(styles,/max-height:94dvh/)
 assert.match(styles,/safe-area-inset-bottom/)
 assert.match(styles,/\.voice-capture-launcher\{width:100%;min-height:48px\}/)
 assert.match(styles,/\.voice-capture-launcher\{font-size:14px\}/)
 assert.match(styles,/\.voice-capture-launcher small\{font-size:12px/)
 assert.match(styles,/\.voice-text-fallback textarea[^}]*font-size:16px/)
 assert.match(styles,/\.voice-review-footer button\{min-height:48px\}/)
 assert.match(styles,/prefers-reduced-motion:reduce/)
 assert.match(styles,/\.client-hero \.hero-actions \.voice-capture-launcher\{[^}]*background:#edf8f4[^}]*color:#17684f/)
 assert.match(styles,/\.voice-post-next\{grid-column:1\/-1/)
 for(const color of ['#4d685f','#526b63','#596e67','#516b62'])assert.match(styles,new RegExp(color))
})

test('Voice interaction client — criação, consulta, confirmação e cancelamento usam contratos exatos',async()=>{
 const originalFetch=globalThis.fetch
 const calls=[]
 globalThis.fetch=async(path,init={})=>{
  calls.push({path:String(path),method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined})
  return new Response(JSON.stringify({voice_interaction:{voice_interaction_id:'voice-ui-1',state:'CONFIRMED'}}),{status:200,headers:{'content-type':'application/json'}})
 }
 try{
  await createVoiceInteraction({clientId:'client-1',visitId:'visit-1',interactionType:'POST_VISIT',sourceContext:{page:'VISITS'},manualText:'  relato confirmado  '})
  await getVoiceInteraction('voice-ui-1')
  await confirmVoiceInteraction('voice-ui-1',{items:[{candidate_id:'candidate-1',decision:'CONFIRMED',statement:'Levar comparativo.'}],additions:[{candidate_id:'candidate-2',category:'OBJECTION',epistemic_status:'FACT_CANDIDATE',statement:'Preço alto.'}],outcomeType:'FOLLOW_UP',nextStep:'  Retornar quinta  ',nextStepAt:'2026-08-27',noAction:false})
  await cancelVoiceInteraction('voice-ui-1')
 }finally{globalThis.fetch=originalFetch}

 assert.deepEqual(calls.map(item=>[item.method,item.path]),[
  ['POST','/api/v1/voice-interactions'],
  ['GET','/api/v1/voice-interactions/voice-ui-1'],
  ['POST','/api/v1/voice-interactions/voice-ui-1/confirm'],
  ['POST','/api/v1/voice-interactions/voice-ui-1/cancel']
 ])
 assert.deepEqual(calls[0].body,{client_id:'client-1',visit_id:'visit-1',interaction_type:'POST_VISIT',source_context:{page:'VISITS'},manual_text:'relato confirmado'})
 assert.deepEqual(calls[2].body,{
  items:[{candidate_id:'candidate-1',decision:'CONFIRMED',statement:'Levar comparativo.'}],
  additions:[{candidate_id:'candidate-2',category:'OBJECTION',epistemic_status:'FACT_CANDIDATE',statement:'Preço alto.'}],
  outcome_type:'FOLLOW_UP',next_step:'Retornar quinta',next_step_at:'2026-08-27',no_action:false
 })
 assert.deepEqual(calls[3].body,{})
})
