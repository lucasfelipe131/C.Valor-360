export const agronomicScanProvenanceVersion='AgronomicScanProvenance.v1'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const nullable=value=>clean(value,180)||null
const failure=(message,code)=>Object.assign(new Error(message),{code,statusCode:422})

export const scanAnalysisTypes=Object.freeze({
 nutrition:'NUTRISCAN',disease:'FITOSCAN',insect:'INSETOSCAN',weed:'DANINHASCAN',
 NUTRISCAN:'NUTRISCAN',FITOSCAN:'FITOSCAN',INSETOSCAN:'INSETOSCAN',DANINHASCAN:'DANINHASCAN'
})

export function normalizeScanAnalysisType(value){
 const key=clean(value,40)
 const normalized=scanAnalysisTypes[key]||scanAnalysisTypes[key.toLowerCase()]
 if(!normalized)throw failure('O tipo da análise agronômica não é suportado.','scan_analysis_type_invalid')
 return normalized
}

export function normalizeScanSourceAttachment(value={}){
 const attachmentId=clean(value.attachmentId??value.attachment_id,72)
 if(!uuid.test(attachmentId))throw failure('A referência do attachment de origem é inválida.','scan_attachment_reference_invalid')
 const association=clean(value.association,40).toUpperCase()
 if(!['LINKED_CLIENT','UNLINKED'].includes(association))throw failure('A associação do attachment de origem é inválida.','scan_attachment_association_invalid')
 const createdAt=clean(value.createdAt??value.created_at,60)
 if(createdAt&&Number.isNaN(Date.parse(createdAt)))throw failure('A data do attachment de origem é inválida.','scan_attachment_created_at_invalid')
 return Object.freeze({
  attachmentId,
  association,
  organizationId:nullable(value.organizationId??value.organization_id),
  clientId:nullable(value.clientId??value.client_id),
  propertyId:nullable(value.propertyId??value.property_id),
  fieldId:nullable(value.fieldId??value.field_id),
  createdAt:createdAt?new Date(createdAt).toISOString():null,
  sha256:/^[0-9a-f]{64}$/i.test(clean(value.sha256,64))?clean(value.sha256,64).toLowerCase():null
 })
}

export function buildAgronomicScanProvenance({
 sourceAttachment,attachment,tenantId,ownerId,analysisType,createdAt,resultReference,
 propertyId=null,fieldId=null,integrationEventId=null
}={}){
 const source=normalizeScanSourceAttachment(sourceAttachment)
 const actualAttachmentId=clean(attachment?.id,72)
 const actualTenantId=clean(attachment?.tenantId??attachment?.tenant_id,180)
 const actualOwnerId=clean(attachment?.ownerId??attachment?.consultant_id,180)
 const actualClientId=nullable(attachment?.clientId??attachment?.client_external_key??attachment?.client_id)
 const actualClientInternalId=nullable(attachment?.client_id)
 const requestedTenantId=clean(tenantId,180)
 const requestedOwnerId=clean(ownerId,180)
 if(source.attachmentId!==actualAttachmentId)throw failure('O resultado não referencia o attachment carregado.','scan_attachment_reference_mismatch')
 if(!actualTenantId||actualTenantId!==requestedTenantId)throw failure('O attachment pertence a outra organização.','scan_attachment_cross_tenant_denied')
 if(!actualOwnerId||actualOwnerId!==requestedOwnerId)throw failure('O attachment pertence a outro responsável.','scan_attachment_owner_scope_denied')
 if(source.organizationId&&source.organizationId!==requestedTenantId)throw failure('A organização declarada no handoff diverge do attachment.','scan_attachment_organization_mismatch')
 const actualAssociation=actualClientId?'LINKED_CLIENT':'UNLINKED'
 if(source.association!==actualAssociation)throw failure('A associação declarada no handoff diverge do attachment.','scan_attachment_association_mismatch')
 if(source.clientId&&![actualClientId,actualClientInternalId].filter(Boolean).includes(source.clientId))throw failure('O produtor declarado no handoff diverge do attachment.','scan_attachment_client_mismatch')
 if(source.sha256&&attachment?.sha256&&source.sha256!==String(attachment.sha256).toLowerCase())throw failure('O hash declarado no handoff diverge do attachment.','scan_attachment_hash_mismatch')
 const resultCreatedAt=clean(createdAt,60)
 if(!resultCreatedAt||Number.isNaN(Date.parse(resultCreatedAt)))throw failure('A data do resultado agronômico é inválida.','scan_result_created_at_invalid')
 const resultRef=clean(resultReference,240)
 if(!resultRef)throw failure('O resultado agronômico precisa de uma referência formal.','scan_result_reference_required')
 return Object.freeze({
  contract_version:agronomicScanProvenanceVersion,
  attachment_id:actualAttachmentId,
  organization_id:requestedTenantId,
  client_id:actualClientInternalId,
  client_external_key:actualClientId,
  property_id:nullable(propertyId),
  field_id:nullable(fieldId),
  association:actualAssociation,
  analysis_type:normalizeScanAnalysisType(analysisType),
  attachment_created_at:source.createdAt||attachment?.createdAt||attachment?.created_at||null,
  result_created_at:new Date(resultCreatedAt).toISOString(),
  result_reference:resultRef,
  source_event_id:nullable(integrationEventId),
  provenance:Object.freeze({source:'manual-do-agronomo',handoff:'valor360:session-media',binary_storage:'val_attachments',result_storage:'integration_events',human_review_required:true})
 })
}
