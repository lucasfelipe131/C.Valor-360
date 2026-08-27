import assert from 'node:assert/strict'
import test from 'node:test'
import {buildAgronomicScanProvenance,normalizeScanAnalysisType,normalizeScanSourceAttachment} from '../server/agronomic-scan-provenance.js'
import {ValRepository} from '../server/repository.js'
import {normalizeIntegrationEvent,requiresTechnicalSignature} from '../server/ingestion.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {executeCapabilityPlan} from '../server/decision-copilot/capability-executor.js'

const tenantA='10000000-0000-4000-8000-000000000001'
const tenantB='20000000-0000-4000-8000-000000000002'
const ownerA='30000000-0000-4000-8000-000000000003'
const ownerB='40000000-0000-4000-8000-000000000004'
const clientA='cliente-a'

const source=(attachment,patch={})=>({
 attachmentId:attachment.id,association:attachment.association,organizationId:attachment.organizationId,
 clientId:attachment.clientId||'',createdAt:attachment.createdAt,sha256:attachment.sha256,...patch
})

const scanEvent=({attachment,externalId='manual-scan:result-1',analysisType='NUTRISCAN',clientExternalKey=attachment.clientId||'',patch={}})=>({
 schemaVersion:1,type:'agronomic.scan.completed',source:'manual-do-agronomo',externalId,
 occurredAt:'2026-08-27T12:00:00.000Z',clientExternalKey,propertyExternalKey:'',fieldExternalKey:'',payloadHash:externalId,
 payload:{provenanceContractVersion:'AgronomicScanProvenance.v1',analysisType,resultReference:'manual-photo-diagnosis:result-1',resultCreatedAt:'2026-08-27T12:00:00.000Z',context:{clientId:clientExternalKey,propertyId:'',fieldId:''},sourceAttachments:[source(attachment)],result:{summary:'Clorose internerval; confirmar em campo.',imageQuality:'adequada',analyzedAt:'2026-08-27T11:59:00.000Z'},safety:{classification:'ASSISTED_TRIAGE_NOT_PRESCRIPTION'},...patch}
})

function fallbackRepository(tenantId=tenantA){
 let store={val:{attachments:[],integrationEvents:[],signals:[]}}
 const repository=new ValRepository({db:{configured:false},tenantId,readStore:()=>structuredClone(store),saveStore:value=>{store=structuredClone(value)}})
 return {repository,read:()=>structuredClone(store)}
}

test('contrato normaliza NutriScan/FitoScan e falha fechado para referência inválida',()=>{
 assert.equal(normalizeScanAnalysisType('nutrition'),'NUTRISCAN')
 assert.equal(normalizeScanAnalysisType('disease'),'FITOSCAN')
 assert.throws(()=>normalizeScanSourceAttachment({attachmentId:'forjado',association:'UNLINKED'}),error=>error.code==='scan_attachment_reference_invalid')
})

test('proveniência formal deriva organização e vínculo do attachment, não da declaração do browser',()=>{
 const attachment={id:'50000000-0000-4000-8000-000000000005',tenant_id:tenantA,consultant_id:ownerA,client_id:'60000000-0000-4000-8000-000000000006',client_external_key:clientA,sha256:'a'.repeat(64),created_at:'2026-08-27T10:00:00.000Z'}
 const result=buildAgronomicScanProvenance({sourceAttachment:{attachmentId:attachment.id,association:'LINKED_CLIENT',organizationId:tenantA,clientId:clientA,createdAt:attachment.created_at,sha256:attachment.sha256},attachment,tenantId:tenantA,ownerId:ownerA,analysisType:'FITOSCAN',createdAt:'2026-08-27T12:00:00.000Z',resultReference:'manual-photo-diagnosis:result-1'})
 assert.equal(result.contract_version,'AgronomicScanProvenance.v1')
 assert.equal(result.attachment_id,attachment.id)
 assert.equal(result.organization_id,tenantA)
 assert.equal(result.client_external_key,clientA)
 assert.equal(result.analysis_type,'FITOSCAN')
 assert.throws(()=>buildAgronomicScanProvenance({sourceAttachment:{attachmentId:attachment.id,association:'LINKED_CLIENT',organizationId:tenantB,clientId:clientA},attachment,tenantId:tenantA,ownerId:ownerA,analysisType:'FITOSCAN',createdAt:'2026-08-27T12:00:00Z',resultReference:'result'}),error=>error.code==='scan_attachment_organization_mismatch')
 assert.throws(()=>buildAgronomicScanProvenance({sourceAttachment:{attachmentId:attachment.id,association:'LINKED_CLIENT',clientId:clientA},attachment,tenantId:tenantA,ownerId:ownerB,analysisType:'FITOSCAN',createdAt:'2026-08-27T12:00:00Z',resultReference:'result'}),error=>error.code==='scan_attachment_owner_scope_denied')
})

test('fluxo fallback preserva attachment → NutriScan → result reference para vínculo e UNLINKED',async()=>{
 const {repository}=fallbackRepository()
 const linked=await repository.createAttachment({tenantId:tenantA,ownerId:ownerA,clientId:clientA,association:'LINKED_CLIENT',originalName:'folha.jpg',mimeType:'image/jpeg',sizeBytes:3,dataBase64:'YWJj'})
 await repository.ingestEvent({tenantId:tenantA,ownerId:ownerA,event:scanEvent({attachment:linked}),signals:[]})
 const linkedResult=await repository.getAttachment({tenantId:tenantA,ownerId:ownerA,id:linked.id})
 assert.equal(linkedResult.analysis.latestScanResult.attachment_id,linked.id)
 assert.equal(linkedResult.analysis.latestScanResult.client_external_key,clientA)
 assert.equal(linkedResult.analysis.latestScanResult.result_reference,'manual-photo-diagnosis:result-1')
 assert.equal(linkedResult.analysis.latestScanResult.analysis_type,'NUTRISCAN')

 const unlinked=await repository.createAttachment({tenantId:tenantA,ownerId:ownerA,association:'UNLINKED',originalName:'sem-vinculo.jpg',mimeType:'image/jpeg',sizeBytes:4,dataBase64:'ZGVmZw=='})
 await repository.ingestEvent({tenantId:tenantA,ownerId:ownerA,event:scanEvent({attachment:unlinked,externalId:'manual-scan:unlinked',analysisType:'FITOSCAN',clientExternalKey:''}),signals:[]})
 const unlinkedResult=await repository.getAttachment({tenantId:tenantA,ownerId:ownerA,id:unlinked.id})
 assert.equal(unlinkedResult.clientId,null)
 assert.equal(unlinkedResult.association,'UNLINKED')
 assert.equal(unlinkedResult.analysis.latestScanResult.client_id,null)
 assert.equal(unlinkedResult.analysis.latestScanResult.association,'UNLINKED')

 const context=await repository.getClientContext({tenantId:tenantA,ownerId:ownerA,clientId:clientA,client:{id:clientA,name:'Cliente A'}})
 assert.equal(context.attachments.length,1)
 assert.equal(context.attachments[0].id,linked.id)
 assert.equal(context.attachments[0].dataBase64,undefined)
 assert.equal(context.attachments[0].analysis.latestScanResult.result_reference,'manual-photo-diagnosis:result-1')
 const message='VAL, me mostra o último NutriScan.'
 const route=routeSystemCapability({message,hasClient:true})
 assert.equal(route.path,'TOOL')
 assert.equal(route.capabilities[0],'NUTRISCAN')
 const latest=await executeCapabilityPlan({route,message,context,clientId:clientA})
 assert.equal(latest.tool_result.status,'EXECUTED')
 assert.equal(latest.tool_result.facts.attachment_id,linked.id)
 assert.equal(latest.tool_result.facts.result_reference,'manual-photo-diagnosis:result-1')
 assert.equal(latest.tool_result.facts.source_attachment_reference,linked.id)

 const missingMessage='VAL, me mostra o último FitoScan.'
 const missingRoute=routeSystemCapability({message:missingMessage,hasClient:true})
 const missing=await executeCapabilityPlan({route:missingRoute,message:missingMessage,context,clientId:clientA})
 assert.equal(missing.tool_result.status,'NO_DATA')
 assert.deepEqual(missing.capabilities_used,[])
})

test('resultado de tenant/owner diferente não consegue localizar nem atualizar attachment',async()=>{
 const {repository}=fallbackRepository()
 const attachment=await repository.createAttachment({tenantId:tenantA,ownerId:ownerA,association:'UNLINKED',originalName:'origem.jpg',mimeType:'image/jpeg',sizeBytes:3,dataBase64:'YWJj'})
 await assert.rejects(repository.ingestEvent({tenantId:tenantA,ownerId:ownerB,event:scanEvent({attachment,externalId:'manual-scan:owner-b',clientExternalKey:''}),signals:[]}),error=>error.code==='scan_attachment_scope_invalid')
 const foreignRepository=fallbackRepository(tenantB).repository
 await assert.rejects(foreignRepository.ingestEvent({tenantId:tenantB,ownerId:ownerA,event:scanEvent({attachment,externalId:'manual-scan:tenant-b',clientExternalKey:''}),signals:[]}),error=>error.code==='scan_attachment_scope_invalid')
})

test('evento de resultado é técnico, assinado e validado antes da ingestão',()=>{
 assert.equal(requiresTechnicalSignature('agronomic.scan.completed'),true)
 const attachment={id:'70000000-0000-4000-8000-000000000007',association:'UNLINKED',organizationId:tenantA,clientId:null,createdAt:'2026-08-27T10:00:00Z',sha256:'b'.repeat(64)}
 const normalized=normalizeIntegrationEvent(scanEvent({attachment,clientExternalKey:''}))
 assert.equal(normalized.type,'agronomic.scan.completed')
 assert.equal(normalized.payload.sourceAttachments[0].attachmentId,attachment.id)
 assert.throws(()=>normalizeIntegrationEvent(scanEvent({attachment,clientExternalKey:'',patch:{provenanceContractVersion:'forjada'}})),/não suportada/i)
})
