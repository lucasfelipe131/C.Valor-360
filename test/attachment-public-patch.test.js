import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {normalizePublicAttachmentPatch,publicAttachmentPatchContractVersion,publicAttachmentPatchKeys,publicAttachmentPatchStatuses} from '../server/attachment-public-patch.js'

const id='50000000-0000-4000-8000-000000000005'

test('PATCH público de attachment expõe somente transições humanas permitidas',()=>{
 assert.equal(publicAttachmentPatchContractVersion,'val.public_attachment_patch.v1')
 assert.deepEqual(publicAttachmentPatchKeys,['id','status','fieldPhoto'])
 assert.deepEqual(publicAttachmentPatchStatuses,['confirmed','stored','rejected'])
 assert.deepEqual(normalizePublicAttachmentPatch({id,status:' confirmed '}),{id,status:'confirmed'})
 assert.deepEqual(normalizePublicAttachmentPatch({id,status:'stored'}),{id,status:'stored'})
 assert.deepEqual(normalizePublicAttachmentPatch({id,status:'rejected'}),{id,status:'rejected'})
})

test('PATCH público não consegue forjar analysis.latestScanResult nem qualquer analysis',()=>{
 const forged={id,status:'confirmed',analysis:{latestScanResult:{attachment_id:id,organization_id:'tenant-forjado',result_reference:'forjado'}}}
 assert.throws(()=>normalizePublicAttachmentPatch(forged),error=>error.code==='attachment_analysis_server_managed'&&error.statusCode===400)
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'stored',analysis:null}),error=>error.code==='attachment_analysis_server_managed')
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'confirmed',latestScanResult:{result_reference:'forjado'}}),error=>error.code==='attachment_public_patch_fields_forbidden')
})

test('PATCH público usa allowlist estrita de campos, estados e id',()=>{
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'interpreted'}),error=>error.code==='attachment_public_patch_status_forbidden')
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'received'}),error=>error.code==='attachment_public_patch_status_forbidden')
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'confirmed',clientId:'outro-cliente'}),error=>error.code==='attachment_public_patch_fields_forbidden')
 assert.throws(()=>normalizePublicAttachmentPatch({id:'forjado',status:'confirmed'}),error=>error.code==='attachment_public_patch_id_invalid')
 assert.throws(()=>normalizePublicAttachmentPatch({id}),error=>error.code==='attachment_public_patch_empty')
 assert.throws(()=>normalizePublicAttachmentPatch([]),error=>error.code==='attachment_public_patch_invalid')
})

test('metadados estreitos de foto podem ser editados sem forjar transição de estado',()=>{
 const normalized=normalizePublicAttachmentPatch({id,fieldPhoto:{label:' Talhão Norte ',category:'Nutrição',observedAt:'2026-08-28',notes:'  Reb oleira   observada. '}})
 assert.equal('status' in normalized,false)
 assert.equal(normalized.fieldPhoto.label,'Talhão Norte')
 assert.equal(normalized.fieldPhoto.source,'client360')
 assert.match(normalized.fieldPhoto.updatedAt,/^\d{4}-\d{2}-\d{2}T/)
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'stored',fieldPhoto:{label:'Foto',category:'Inventada',observedAt:'2026-08-28',notes:''}}),error=>error.code==='attachment_field_photo_category_invalid')
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'stored',fieldPhoto:{label:'Foto',category:'Solo',observedAt:'2026-08-28',notes:'',latestScanResult:{}}}),error=>error.code==='attachment_field_photo_fields_forbidden')
})

test('data civil inválida não é normalizada silenciosamente',()=>{
 assert.throws(()=>normalizePublicAttachmentPatch({id,status:'stored',fieldPhoto:{label:'Talhão',category:'Visão geral',observedAt:'2026-02-31',notes:''}}),error=>error.code==='attachment_field_photo_date_invalid')
})

test('schema público v1 fecha propriedades adicionais e não declara analysis',async()=>{
 const schema=JSON.parse(await readFile(new URL('../contracts/v1/public-attachment-patch.schema.json',import.meta.url),'utf8'))
 assert.equal(schema.additionalProperties,false)
 assert.deepEqual(schema.required,['id'])
 assert.deepEqual(schema.anyOf,[{required:['status']},{required:['fieldPhoto']}])
 assert.deepEqual(schema.properties.status.enum,['confirmed','stored','rejected'])
 assert.equal(schema.properties.analysis,undefined)
 assert.equal(schema.properties.fieldPhoto.additionalProperties,false)
})
