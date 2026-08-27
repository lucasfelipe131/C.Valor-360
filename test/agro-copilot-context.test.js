import assert from 'node:assert/strict'
import test from 'node:test'
import {
 buildAgroCopilotLaunchContext,
 createAgroSessionMediaMessage,
 createAgroHeroActionPayload,
 createAgroHeroContext,
 createAgroHeroStates,
 createAgroWorkspaceMessage,
 inferAgroHeroIntent,
 mostSpecificAgroContext,
 normalizeAgroToolDescriptor,
 resolveAgroHeroFileMime,
 transitionAgroHeroState,
 validateAgroHeroFile
} from '../src/lib/agro-hero-actions.js'

test('contexto agronômico escolhe o objeto mais específico sem perder o produtor',()=>{
 const context=createAgroHeroContext({
  producer:{id:'producer-1',name:'João'},
  property:{id:'property-1',name:'Fazenda Horizonte'},
  field:{id:'field-1',name:'Talhão Norte'},
  analysis:{id:'analysis-1',name:'Análise agosto'}
 })
 assert.equal(context.clientId,'producer-1')
 assert.equal(mostSpecificAgroContext(context).type,'analysis')
 assert.deepEqual(buildAgroCopilotLaunchContext(context).context,{type:'analysis',id:'analysis-1',label:'Análise agosto'})
})

test('ferramenta ativa entra no contexto quando não há objeto de campo',()=>{
 const context=createAgroHeroContext({producer:{id:'producer-1'},tool:{id:'calculadoras',label:'Calculadoras'}})
 const launch=buildAgroCopilotLaunchContext(context)
 assert.equal(launch.clientId,'producer-1')
 assert.deepEqual(launch.context,{type:'agronomic_tool',id:'calculadoras',label:'Calculadoras'})
 assert.equal(launch.persistenceMode,'NONE')
})

test('descritor do Copilot vira navegação same-origin compatível com o Manual atual',()=>{
 const descriptor=normalizeAgroToolDescriptor({id:'FitScan',page:'diagnostico',mode:'disease',label:'FitoScan'})
 assert.deepEqual(descriptor,{id:'fitscan',page:'diagnostico',tool:'diagnosis',mode:'disease',diagnosisMode:'disease',calculator:'',label:'FitoScan'})
 const message=createAgroWorkspaceMessage({
  context:{producer:{id:'producer-1',name:'João'},property:{id:'property-1',name:'Fazenda'},field:{id:'field-1',name:'Talhão'},analysis:{id:'analysis-1',name:'Solo'}},
  tool:descriptor,
  requestId:'request-1'
 })
 assert.deepEqual(message,{
  type:'valor360:navigate',version:1,requestId:'request-1',page:'diagnostico',tool:'diagnosis',mode:'disease',diagnosisMode:'disease',
  context:{clientId:'producer-1',clientName:'João',propertyId:'property-1',propertyName:'Fazenda',fieldId:'field-1',fieldName:'Talhão',analysisId:'analysis-1'}
 })
 assert.doesNotMatch(JSON.stringify(message),/tenant|owner|workspace/i)
})

test('ação multimodal preserva o arquivo apenas para entrega ao adapter',()=>{
 const file={name:'analise-solo.pdf',type:'application/pdf',size:4096}
 const payload=createAgroHeroActionPayload({action:'file',prompt:'Interprete.',context:{producer:{id:'producer-1'}},file})
 assert.equal(payload.action,'FILE')
 assert.equal(payload.capture,'file')
 assert.equal(payload.mode,'ASK')
 assert.equal(payload.attachment.file,file)
 assert.equal(payload.attachment.intent,'ANALYZE_SOIL')
 assert.equal(payload.agroContext.clientId,'producer-1')
})

test('intenção provável distingue foto, análise de solo e documento genérico',()=>{
 assert.equal(inferAgroHeroIntent('photo',{name:'folha.jpg',type:'image/jpeg'}),'IMAGE_DIAGNOSIS')
 assert.equal(inferAgroHeroIntent('file',{name:'Laudo de fertilidade.pdf',type:'application/pdf'}),'ANALYZE_SOIL')
 assert.equal(inferAgroHeroIntent('file',{name:'recomendacoes.txt',type:'text/plain'}),'ASK_AGRONOMIC')
})

test('arquivo sem MIME só é aceito quando a extensão permitida é explícita',()=>{
 assert.equal(validateAgroHeroFile({name:'solo.csv',type:'',size:300},'file').ok,true)
 assert.equal(validateAgroHeroFile({name:'foto.webp',type:'',size:300},'photo').ok,true)
 assert.equal(validateAgroHeroFile({name:'arquivo.bin',type:'',size:300},'file').code,'FILE_TYPE_INVALID')
 assert.equal(resolveAgroHeroFileMime({name:'laudo.pdf',type:'application/octet-stream'}),'application/pdf')
 assert.equal(validateAgroHeroFile({name:'foto.jpg',type:'application/pdf',size:300},'file').code,'FILE_TYPE_INVALID')
})

test('handoff efêmero do host é one-shot, sem autoridade e correlacionado à navegação',()=>{
 const file={name:'campo.png',type:'image/png',size:1024}
 const message=createAgroSessionMediaMessage({files:[file],intent:'IMAGE_DIAGNOSIS',navigationRequestId:'navigation-1',transferId:'transfer-1'})
 assert.deepEqual(message,{
  type:'valor360:session-media',version:2,transferId:'transfer-1',navigationRequestId:'navigation-1',
  persistenceMode:'NONE',association:'UNLINKED',intent:'IMAGE_DIAGNOSIS',files:[file],sourceAttachments:[]
 })
 assert.doesNotMatch(JSON.stringify({...message,files:[]}),/tenant|owner|clientId|producer/i)
 assert.throws(()=>createAgroSessionMediaMessage({files:[{name:'dados.txt',type:'text/plain',size:10}],intent:'ASK_AGRONOMIC',navigationRequestId:'navigation-1'}),error=>error.code==='UNSUPPORTED_MEDIA_TYPE')
 assert.throws(()=>createAgroSessionMediaMessage({files:[file],intent:'IMAGE_DIAGNOSIS'}),error=>error.code==='NAVIGATION_REQUIRED')
})

test('máquina de estados é imutável e rejeita transições fora do contrato',()=>{
 const initial=createAgroHeroStates()
 const loading=transitionAgroHeroState(initial,'voice','loading',{phase:'requesting',message:'Microfone'})
 assert.equal(initial.voice.status,'idle')
 assert.deepEqual(loading.voice,{status:'loading',phase:'requesting',message:'Microfone',errorCode:''})
 assert.throws(()=>transitionAgroHeroState(loading,'unknown','loading'),/Ação/)
 assert.throws(()=>transitionAgroHeroState(loading,'voice','done'),/Estado/)
})

test('contexto vazio permite pergunta geral sem inventar produtor',()=>{
 const context=createAgroHeroContext()
 const launch=buildAgroCopilotLaunchContext(context)
 assert.equal(launch.clientId,'')
 assert.equal(launch.context,null)
 assert.deepEqual(context.context_refs,[])
})
