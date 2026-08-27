import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {after,before,test} from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {
 AGRO_HERO_FILE_POLICY,
 agroHeroContextVersion,
 agroHeroVoiceError,
 createAgroHeroActionPayload,
 createAgroHeroContext,
 createAgroHeroStates,
 createAgroHeroTelemetry,
 transitionAgroHeroState,
 validateAgroHeroFile
} from '../src/lib/agro-hero-actions.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const source=read('src/pages/Agro.jsx')
const styles=read('src/agro-workspace.css')
let vite
let markup=''

before(async()=>{
 vite=await createServer({root:new URL('..',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 const {default:Agro}=await vite.ssrLoadModule('/src/pages/Agro.jsx')
 markup=renderToStaticMarkup(React.createElement(Agro,{
  producer:{id:'producer-1',name:'João Pereira'},
  property:{id:'property-1',name:'Fazenda Horizonte'},
  field:{id:'field-1',name:'Talhão Norte'},
  analysis:{id:'analysis-1',name:'Solo 2026'},
  initialFiles:[{name:'laudo-solo.pdf',type:'application/pdf',size:2048}]
 }))
})

after(async()=>{await vite?.close()})

test('AGRO_HERO_001 — Falar com a VAL abre o fluxo local de voz com parar e cancelar',()=>{
 assert.match(markup,/data-agro-hero-action="voice"/)
 assert.match(markup,/Falar com a VAL/)
 assert.match(source,/const startVoice=\(\)=>\{/)
 assert.match(source,/mediaDevices\.getUserMedia\(\{audio:/)
 assert.match(source,/const stopVoice=\(\)=>\{/)
 assert.match(source,/const cancelVoice=\(\)=>\{/)
 assert.match(source,/Parar e enviar/)
 assert.match(source,/Cancelar/)
})

test('AGRO_HERO_002 — texto abre composer funcional no próprio hero',()=>{
 assert.match(markup,/data-agro-hero-action="text"/)
 assert.match(markup,/Digitar \/ perguntar/)
 assert.match(markup,/class="agro-hero-composer" hidden=""/)
 assert.match(markup,/placeholder="O que você precisa entender, comparar ou decidir\?"/)
 assert.match(source,/onSubmit=\{submitText\}/)
 assert.match(source,/createAgroHeroActionPayload\(\{action:'text'/)
})

test('AGRO_HERO_003 — foto usa input de câmera no mesmo gesto de ativação',()=>{
 assert.match(markup,/data-agro-hero-action="photo"/)
 assert.match(markup,/accept="image\/jpeg,image\/png,image\/webp"/)
 assert.match(markup,/capture="environment"/)
 assert.match(source,/if\(action==='photo'\)photoInputRef\.current\?\.click\(\)/)
 const chooser=source.slice(source.indexOf('const chooseCapture='),source.indexOf('const cancelCapture='))
 assert.doesNotMatch(chooser,/setTimeout|Promise|await/)
})

test('AGRO_HERO_004 — arquivo abre seletor técnico no próprio hero',()=>{
 assert.match(markup,/data-agro-hero-action="file"/)
 assert.match(markup,/\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.csv,\.txt/)
 assert.match(source,/else fileInputRef\.current\?\.click\(\)/)
 assert.equal(AGRO_HERO_FILE_POLICY.maxBytes,6_000_000)
 assert.match(markup,/Arquivos mantidos nesta conversa/)
 assert.match(markup,/laudo-solo\.pdf/)
 assert.match(markup,/Parece ser uma análise de solo\./)
 assert.match(markup,/Interpretar agora/)
 assert.match(markup,/Sem vínculo; uso somente nesta conversa\.|Contexto: João Pereira\./)
})

test('AGRO_HERO_005 — produtor, propriedade, talhão e análise permanecem no contrato',()=>{
 for(const label of ['João Pereira','Fazenda Horizonte','Talhão Norte','Solo 2026'])assert.match(markup,new RegExp(label))
 const context=createAgroHeroContext({producer:{id:'producer-1',name:'João'},property:{id:'property-1',name:'Fazenda'},field:{id:'field-1',name:'Talhão'},analysis:{id:'analysis-1',name:'Solo'}})
 const payload=createAgroHeroActionPayload({action:'text',prompt:'Interprete.',context})
 assert.equal(payload.clientId,'producer-1')
 assert.deepEqual(payload.agroContext.context_refs.map(item=>item.type),['producer','property','field','analysis'])
 assert.deepEqual(payload.context,{type:'analysis',id:'analysis-1',label:'Solo'})
 assert.equal(payload.persistenceMode,'NONE')
 assert.equal(payload.autoSubmit,true)
})

test('AGRO_HERO_006 — erros de permissão e ausência de microfone são tratáveis',()=>{
 assert.deepEqual(agroHeroVoiceError({name:'NotAllowedError'}),{code:'MICROPHONE_NOT_ALLOWED',message:'Permita o uso do microfone para falar com a VAL ou use o texto.'})
 assert.equal(agroHeroVoiceError({name:'NotFoundError'}).code,'MICROPHONE_NOT_FOUND')
 assert.equal(agroHeroVoiceError({name:'NotReadableError'}).code,'MICROPHONE_BUSY')
 assert.match(source,/role=\{feedback\.status==='error'\?'alert':'status'\}/)
})

test('AGRO_HERO_007 — upload inválido falha antes do callback e expõe estado de erro',()=>{
 assert.equal(validateAgroHeroFile({name:'malware.exe',type:'application/x-msdownload',size:1200},'file').code,'FILE_TYPE_INVALID')
 assert.equal(validateAgroHeroFile({name:'grande.pdf',type:'application/pdf',size:6_000_001},'file').code,'FILE_TOO_LARGE')
 assert.equal(validateAgroHeroFile({name:'vazio.pdf',type:'application/pdf',size:0},'file').code,'FILE_EMPTY')
 assert.equal(validateAgroHeroFile({name:'solo.pdf',type:'application/pdf',size:2048},'file').ok,true)
 assert.match(source,/if\(!validation\.ok\)\{updateAction\(action,'error'/)
})

test('AGRO_HERO_008 — contrato mobile mantém quatro ações, toque e composer legível',()=>{
 assert.match(styles,/@media\(max-width:700px\)\{/)
 assert.match(styles,/button\[data-agro-hero-action\]\{min-height:76px/)
 assert.match(styles,/button\[data-agro-hero-action="voice"\]\{grid-column:1\/-1;min-height:58px/)
 assert.match(styles,/\.agro-hero-composer textarea\{font-size:16px\}/)
 assert.match(styles,/\.agro-hero-recorder\{grid-template-columns:1fr 1fr\}/)
})

test('AGRO_HERO_009 — desktop renderiza quatro CTAs, estados e telemetria básica',()=>{
 const actions=[...markup.matchAll(/data-agro-hero-action="(voice|text|photo|file)"/g)].map(match=>match[1])
 assert.deepEqual(actions,['voice','text','photo','file'])
 let states=createAgroHeroStates()
 states=transitionAgroHeroState(states,'photo','loading',{phase:'selecting'})
 states=transitionAgroHeroState(states,'photo','success',{phase:'delivered'})
 assert.equal(states.photo.status,'success')
 const event=createAgroHeroTelemetry({action:'photo',status:'success',context:createAgroHeroContext({producer:{id:'producer-1'}}),phase:'delivered',at:'2026-08-26T00:00:00.000Z'})
 assert.deepEqual({event:event.event,action:event.action,status:event.status,clientContext:event.clientContext},{event:'agro_hero_interaction',action:'PHOTO',status:'SUCCESS',clientContext:true})
 assert.match(styles,/\.agro-decision-hero\{[^}]*grid-template-columns:minmax\(0,1\.15fr\) minmax\(330px,\.85fr\)/)
})

test('AGRO_HERO_010 — limite do hero não transporta campos de tenant ou owner',()=>{
 const forged={version:agroHeroContextVersion,tenantId:'tenant-b',ownerId:'owner-b',organizationId:'org-b',producer:{id:'producer-1',name:'João',tenantId:'tenant-b'},analysis:{id:'analysis-1',name:'Solo',ownerId:'owner-b'}}
 const context=createAgroHeroContext(forged)
 const payload=createAgroHeroActionPayload({action:'text',prompt:'Analise.',context:forged})
 const telemetry=createAgroHeroTelemetry({action:'text',status:'success',context:forged,at:'2026-08-26T00:00:00.000Z'})
 for(const value of [context,payload.agroContext,telemetry])assert.doesNotMatch(JSON.stringify(value),/tenant-b|owner-b|org-b|tenantId|ownerId|organizationId/)
 assert.equal(payload.mode,'ASK')
 assert.equal(payload.persistenceMode,'NONE')
})
