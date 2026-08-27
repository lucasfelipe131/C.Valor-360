import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
 containsInlineImage,
 sanitizePhotoDiagnosisPayload,
} from '../manual/app/lib/photo-diagnosis-record.ts'
import {normalizeDiagnosisMode} from '../manual/app/valor360-navigation.ts'

const read=relative=>readFileSync(join(process.cwd(),relative),'utf8')

test('os quatro scans permanecem disponíveis e FitoScan é o nome canônico',()=>{
 const component=read('manual/app/PhotoDiagnosis.tsx')
 for(const name of ['NutriScan','FitoScan','InsetoScan','DaninhaScan'])assert.match(component,new RegExp(`name: "${name}"`))
 assert.equal(normalizeDiagnosisMode('NutriScan'),'nutrition')
 assert.equal(normalizeDiagnosisMode('FitoScan'),'disease')
 assert.equal(normalizeDiagnosisMode('FitScan'),'disease')
 assert.equal(normalizeDiagnosisMode('InsetoScan'),'insect')
 assert.equal(normalizeDiagnosisMode('DaninhaScan'),'weed')
 assert.doesNotMatch(component,/name: "FitScan"/)
})

test('resultado só é salvo por ação humana explícita com contexto, provenance e safety',()=>{
 const component=read('manual/app/PhotoDiagnosis.tsx')
 const records=read('manual/app/records.ts')
 const route=read('manual/app/api/records/route.ts')
 const archive=read('manual/app/RecordsArchive.tsx')
 assert.match(component,/async function saveDiagnosis\(\)/)
 assert.match(component,/onClick=\{\(\) => void saveDiagnosis\(\)\}/)
 assert.match(component,/Salvar resultado revisado no histórico/)
 assert.match(component,/type: "photo_diagnosis"/)
 assert.match(component,/confirmation: "USER_EXPLICIT"/)
 assert.match(component,/classification: "ASSISTED_TRIAGE_NOT_PRESCRIPTION"/)
 assert.match(component,/navigationRequestId/)
 assert.match(component,/id: recordId/)
 assert.match(component,/diagnosisRecordId\.current = recordId/)
 assert.match(component,/context\.clientId,[\s\S]*context\.propertyId,[\s\S]*context\.fieldId,[\s\S]*context\.analysisId/)
 assert.match(component,/function updateAgronomicContext/)
 assert.match(component,/imageRetention: "METADATA_ONLY"/)
 assert.match(records,/\| "photo_diagnosis"/)
 assert.match(records,/photo_diagnosis: "Diagnóstico assistido por imagem"/)
 assert.match(route,/"photo_diagnosis"/)
 assert.match(route,/containsInlineImage\(body\.payload\)/)
 assert.match(archive,/\{ key: "photo_diagnosis", label: "Diagnósticos" \}/)
})

test('sanitização elimina base64 e previews sem apagar metadados técnicos',()=>{
 const payload={
  context:{clientId:'client-1',fieldId:'field-1'},
  images:[{fileName:'folha.jpg',mimeType:'image/jpeg',sizeBytes:321,sha256:'a'.repeat(64),dataUrl:'data:image/jpeg;base64,AAAA'}],
  result:{summary:'Clorose visível',safetyNote:'Confirmar em campo',preview:'blob:https://example.invalid/1'},
  hiddenPdf:'data:application/pdf;base64,AAAA',
  provenance:{confirmation:'USER_EXPLICIT'},
 }
 assert.equal(containsInlineImage(payload),true)
 const safe=sanitizePhotoDiagnosisPayload(payload)
 assert.equal(containsInlineImage(safe),false)
 assert.equal(safe.context.clientId,'client-1')
 assert.equal(safe.images[0].fileName,'folha.jpg')
 assert.equal(safe.images[0].sha256,'a'.repeat(64))
 assert.equal('dataUrl' in safe.images[0],false)
 assert.equal('preview' in safe.result,false)
 assert.equal('hiddenPdf' in safe,false)
 assert.equal(safe.result.safetyNote,'Confirmar em campo')
 assert.equal(safe.storagePolicy.rawImagesStored,false)
 assert.equal(safe.storagePolicy.inlineBinaryStored,false)
})

test('registro guarda somente evidência descritiva/hash, nunca dataUrl ou preview',()=>{
 const component=read('manual/app/PhotoDiagnosis.tsx')
 const saveBlock=component.slice(component.indexOf('async function saveDiagnosis'),component.indexOf('function reset()'))
 assert.match(saveBlock,/imageEvidence: photos\.map/)
 assert.match(saveBlock,/fileName: photo\.name/)
 assert.match(saveBlock,/mimeType: photo\.mimeType/)
 assert.match(saveBlock,/sizeBytes: photo\.sizeBytes/)
 assert.match(saveBlock,/sha256: photo\.sha256/)
 assert.doesNotMatch(saveBlock,/photo\.dataUrl/)
 assert.doesNotMatch(saveBlock,/photo\.preview/)
 assert.match(saveBlock,/rawImagesStored: false/)
})
