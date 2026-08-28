const attachmentIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const publicAttachmentPatchContractVersion='val.public_attachment_patch.v1'
export const publicAttachmentPatchStatuses=Object.freeze(['confirmed','stored','rejected'])
export const publicAttachmentPatchKeys=Object.freeze(['id','status','fieldPhoto'])

const allowedStatuses=new Set(publicAttachmentPatchStatuses)
const allowedKeys=new Set(publicAttachmentPatchKeys)

function contractError(message,code){
 return Object.assign(new Error(message),{statusCode:400,code})
}

const fieldPhotoCategories=new Set(['Visão geral','Emergência e estande','Plantas daninhas','Doenças','Insetos e pragas','Nutrição','Solo','Dano climático','Manejo e aplicação','Outro'])
function normalizeFieldPhoto(value){
 if(value===undefined)return undefined
 if(!value||typeof value!=='object'||Array.isArray(value))throw contractError('Metadados da foto inválidos.','attachment_field_photo_invalid')
 const extra=Object.keys(value).filter(key=>!['label','category','observedAt','notes'].includes(key))
 if(extra.length)throw contractError('Os metadados da foto contêm campos não permitidos.','attachment_field_photo_fields_forbidden')
 const label=String(value.label||'').replace(/\s+/g,' ').trim().slice(0,120)
 const category=String(value.category||'').trim()
 const observedAt=String(value.observedAt||'').trim()
 const notes=String(value.notes||'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,1000)
 if(!label)throw contractError('Informe o rótulo da foto.','attachment_field_photo_label_required')
 if(!fieldPhotoCategories.has(category))throw contractError('Categoria de foto inválida.','attachment_field_photo_category_invalid')
 const observedDate=new Date(`${observedAt}T12:00:00Z`)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)||Number.isNaN(observedDate.getTime())||observedDate.toISOString().slice(0,10)!==observedAt)throw contractError('Data observada inválida.','attachment_field_photo_date_invalid')
 return Object.freeze({label,category,observedAt,notes,source:'client360',updatedAt:new Date().toISOString()})
}

/**
 * Normalizes the body accepted by the authenticated, browser-facing attachment
 * PATCH route. Analysis is intentionally server-managed: scan provenance and
 * latestScanResult may only be written by trusted analysis/ingestion flows.
 */
export function normalizePublicAttachmentPatch(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw contractError('Atualização de arquivo inválida.','attachment_public_patch_invalid')
 if(Object.prototype.hasOwnProperty.call(payload,'analysis'))throw contractError('A análise do arquivo é gerenciada somente pelo servidor.','attachment_analysis_server_managed')

 const unexpected=Object.keys(payload).filter(key=>!allowedKeys.has(key))
 if(unexpected.length)throw contractError('A atualização pública contém campos não permitidos.','attachment_public_patch_fields_forbidden')

 const id=String(payload.id||'').trim()
 if(!attachmentIdPattern.test(id))throw contractError('Arquivo inválido.','attachment_public_patch_id_invalid')

 const fieldPhoto=normalizeFieldPhoto(payload.fieldPhoto)
 const hasStatus=Object.prototype.hasOwnProperty.call(payload,'status')
 const status=hasStatus?String(payload.status||'').trim().toLowerCase():undefined
 if(hasStatus&&!allowedStatuses.has(status))throw contractError('Estado de arquivo não permitido nesta operação.','attachment_public_patch_status_forbidden')
 if(!hasStatus&&!fieldPhoto)throw contractError('Informe o estado ou os metadados que deseja atualizar.','attachment_public_patch_empty')

 return Object.freeze({id,...(hasStatus?{status}:{}),...(fieldPhoto?{fieldPhoto}:{})})
}
