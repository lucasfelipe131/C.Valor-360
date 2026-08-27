import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
 createManualSessionMediaResult,
 manualSessionMediaMaxBytes,
 normalizeManualSessionMedia,
 validateManualSessionMedia,
} from '../manual/app/valor360-session-media.ts'
import {createAgroSessionMediaMessage} from '../src/lib/agro-hero-actions.js'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')
const image=(name='campo.jpg',type='image/jpeg',size=512)=>new File([new Uint8Array(size)],name,{type})
const pdf=(name='laudo-solo.pdf',size=512)=>new File([new Uint8Array(size)],name,{type:'application/pdf'})
const envelope=(patch={})=>({
 type:'valor360:session-media',version:2,transferId:'transfer-1',navigationRequestId:'navigation-1',
 persistenceMode:'NONE',association:'UNLINKED',intent:'IMAGE_DIAGNOSIS',files:[image()],sourceAttachments:[],...patch,
})

test('handoff efêmero aceita foto e laudo sem produtor ou autoridade',()=>{
 const photo=normalizeManualSessionMedia(envelope({tenantId:'tenant-forjado',ownerId:'owner-forjado'}))
 assert.equal(photo.intent,'IMAGE_DIAGNOSIS')
 assert.equal(photo.persistenceMode,'NONE')
 assert.equal(photo.association,'UNLINKED')
 assert.equal(photo.files.length,1)
 assert.deepEqual(photo.sourceAttachments,[])
 assert.equal('tenantId' in photo,false)
 assert.equal('ownerId' in photo,false)

 const soil=normalizeManualSessionMedia(envelope({transferId:'transfer-2',intent:'ANALYZE_SOIL',files:[pdf()]}))
 assert.equal(soil.intent,'ANALYZE_SOIL')
 assert.equal(soil.files[0].type,'application/pdf')
})

test('host e Manual compartilham o contrato por structured clone sem serializar bytes',()=>{
 const outbound=createAgroSessionMediaMessage({
  files:[image()],intent:'IMAGE_DIAGNOSIS',navigationRequestId:'navigation-1',transferId:'transfer-bridge',
 })
 const inbound=normalizeManualSessionMedia(structuredClone(outbound))
 assert.equal(inbound.transferId,'transfer-bridge')
 assert.equal(inbound.navigationRequestId,'navigation-1')
 assert.equal(inbound.intent,'IMAGE_DIAGNOSIS')
 assert.equal(inbound.files.length,1)
 assert.equal(inbound.files[0].size,512)
 assert.doesNotMatch(JSON.stringify(outbound),/base64|dataUrl|tenant|owner/i)
})

test('handoff preserva attachment_id e associação como claim sem delegar autorização',()=>{
 const attachment={id:'50000000-0000-4000-8000-000000000005',organizationId:'10000000-0000-4000-8000-000000000001',clientId:'cliente-a',association:'LINKED_CLIENT',createdAt:'2026-08-27T10:00:00Z',sha256:'a'.repeat(64)}
 const outbound=createAgroSessionMediaMessage({files:[image()],sourceAttachments:[attachment],intent:'IMAGE_DIAGNOSIS',navigationRequestId:'navigation-1'})
 const inbound=normalizeManualSessionMedia(structuredClone(outbound))
 assert.equal(inbound.version,2)
 assert.equal(inbound.association,'LINKED_CLIENT')
 assert.equal(inbound.sourceAttachments[0].attachmentId,attachment.id)
 assert.equal(inbound.sourceAttachments[0].organizationId,attachment.organizationId)
 assert.equal(inbound.sourceAttachments[0].clientId,attachment.clientId)
 assert.equal('ownerId' in inbound.sourceAttachments[0],false)
})

test('receiver falha fechado para política, MIME, tamanho e lote incompatíveis',()=>{
 assert.equal(manualSessionMediaMaxBytes,6_000_000)
 assert.equal(normalizeManualSessionMedia(envelope({persistenceMode:'STORE'})),null)
 assert.equal(normalizeManualSessionMedia(envelope({association:'LINKED_CLIENT'})),null)
 assert.equal(normalizeManualSessionMedia(envelope({files:[image('vazia.jpg','image/jpeg',0)]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({files:[image('grande.jpg','image/jpeg',manualSessionMediaMaxBytes+1)]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({files:[image('animada.gif','image/gif')]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({intent:'ANALYZE_SOIL',files:[pdf('a.pdf'),pdf('b.pdf')]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({intent:'IMAGE_DIAGNOSIS',files:[image(),pdf()]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({intent:'ANALYZE_SOIL',files:[new File(['x'],'dados.csv',{type:'text/csv'})]})),null)
 assert.equal(normalizeManualSessionMedia(envelope({version:1})),null)
 assert.equal(validateManualSessionMedia(envelope({files:[image('animada.gif','image/gif')]})).errorCode,'UNSUPPORTED_MEDIA_TYPE')
 assert.equal(validateManualSessionMedia(envelope({files:[image('vazia.jpg','image/jpeg',0)]})).errorCode,'FILE_EMPTY')
 assert.equal(validateManualSessionMedia(envelope({files:[image('grande.jpg','image/jpeg',manualSessionMediaMaxBytes+1)]})).errorCode,'FILE_TOO_LARGE')
 assert.equal(validateManualSessionMedia(envelope({intent:'ANALYZE_SOIL',files:[pdf('a.pdf'),pdf('b.pdf')]})).errorCode,'INVALID_FILE_COUNT')
})

test('ACK não devolve nome, bytes ou autoridade',()=>{
 const result=createManualSessionMediaResult({
  transferId:'transfer-1',navigationRequestId:'navigation-1',status:'APPLIED',
  intent:'IMAGE_DIAGNOSIS',acceptedCount:2,
 })
 assert.deepEqual(result,{
  type:'valor360:session-media-result',version:2,transferId:'transfer-1',navigationRequestId:'navigation-1',
  status:'APPLIED',intent:'IMAGE_DIAGNOSIS',acceptedCount:2,errorCode:null,
 })
 assert.doesNotMatch(JSON.stringify(result),/filename|content|tenant|owner|base64/i)
})

test('Manual recebe mídia somente do iframe pai, correlaciona navegação e deduplica transferId',()=>{
 const page=read('manual/app/page.tsx')
 assert.match(page,/event\.origin !== window\.location\.origin/)
 assert.match(page,/event\.source !== window\.parent/)
 assert.match(page,/message\?\.type !== "valor360:session-media"/)
 assert.match(page,/command\.navigationRequestId !== activeNavigation\.requestId/)
 assert.match(page,/sessionMediaResults\.current\.get\(identity\.transferId\)/)
 assert.match(page,/pendingSessionMedia\.current\.has\(identity\.transferId\)/)
 assert.match(page,/"NAVIGATION_MISMATCH"/)
})

test('foto é apenas preparada e solo apenas staged até ação explícita',()=>{
 const page=read('manual/app/page.tsx')
 const diagnosis=read('manual/app/PhotoDiagnosis.tsx')
 const receiver=page.slice(page.indexOf('if (message?.type !== "valor360:session-media")'),page.indexOf('window.addEventListener("message"'))
 assert.match(receiver,/setPhotoSessionMedia\(command\)/)
 assert.match(receiver,/setSoilSessionMedia\(command\)/)
 assert.doesNotMatch(receiver,/importSoilFile|saveRecord|onSave/)
 const sessionEffect=diagnosis.slice(diagnosis.indexOf('if (!sessionMedia || sessionMedia.intent'),diagnosis.indexOf('function removePhoto'))
 assert.match(sessionEffect,/ingestPhotos\(sessionMedia\.files, sessionMedia\.sourceAttachments\)/)
 assert.doesNotMatch(sessionEffect,/analyze\(|saveDiagnosis\(|saveRecord\(/)
 assert.match(page,/Sem vínculo e somente nesta sessão/)
 assert.match(page,/Interpretar arquivo/)
 assert.match(page,/if \(file\) void onFile\(file\)/)
})

test('backend exige produtor por padrão e aceita somente UNLINKED explícito',()=>{
 const server=read('server.js')
 assert.match(server,/association==='LINKED_CLIENT'&&!clientId/)
 assert.match(server,/association==='UNLINKED'&&clientId/)
 assert.match(server,/association=clean\(payload\.association\)\.toUpperCase\(\)\|\|'LINKED_CLIENT'/)
 assert.doesNotMatch(read('manual/app/valor360-session-media.ts'),/fetch\(|sessionStorage|localStorage|saveRecord/)
})

test('host encerra o ciclo, limpa intenção antiga e só entrega lote efêmero compatível',()=>{
 const copilot=read('src/components/GlobalValCopilot.jsx')
 const agro=read('src/pages/Agro.jsx')
 const app=read('src/App.jsx')
 const openUnlinked=copilot.slice(copilot.indexOf('const openUnlinkedWorkspace='),copilot.indexOf('const ask='))
 assert.match(openUnlinked,/imageBatch/)
 assert.match(openUnlinked,/soilFile/)
 assert.match(openUnlinked,/setSeedAttachmentIntent\(''\)/)
 assert.match(openUnlinked,/onNavigate\?\.\(\{page:'agro'/)
 assert.doesNotMatch(openUnlinked,/append\(/)
 assert.match(copilot,/setSelectedId\(target\.id\);setActiveContext\(null\)/)
 assert.match(copilot,/setSeedAttachmentIntent\(''\);setError\(uploadError\.message\)/)
 assert.match(copilot,/const uploadRunRef=useRef\(\{generation:0,controller:null,targetClientId:''\}\)/)
 assert.match(copilot,/const cancelUploadRun=\(\)=>\{uploadRunRef\.current\.controller\?\.abort\(\)/)
 assert.match(copilot,/const isCurrent=\(\)=>uploadRunRef\.current\.generation===generation/)
 assert.match(copilot,/if\(!isCurrent\(\)\)return false/)
 assert.match(copilot,/disabled=\{busy\|\|uploading\}/)

 const confirm=agro.slice(agro.indexOf('const confirmInitialFile='),agro.indexOf('const dismissInitialFile='))
 assert.match(confirm,/createAgroSessionMediaMessage/)
 assert.match(confirm,/postMessage\(message,window\.location\.origin\)/)
 assert.doesNotMatch(confirm,/dispatchAction|onAsk|onCapture/)
 assert.match(agro,/event\.origin!==window\.location\.origin\|\|event\.source!==frameRef\.current\?\.contentWindow/)
 assert.match(agro,/message\.type!=='valor360:session-media-result'/)
 assert.match(agro,/onInitialFileConsumed\?\.\(pending\.file\)/)
 assert.match(app,/const createEmptyAgroLaunch=/)
 assert.ok((app.match(/setAgroLaunch\(createEmptyAgroLaunch\(\)\)/g)||[]).length>=3,'logout, expiração e troca de owner devem descartar File refs')
})
