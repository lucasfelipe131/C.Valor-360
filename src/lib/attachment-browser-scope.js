const clean=value=>String(value??'').trim()
const linkedAssociation='LINKED_CLIENT'
const unlinkedAssociation='UNLINKED'

export const attachmentBrowserScopeVersion='val.attachment_browser_scope.v1'

export function attachmentAssociation(attachment={}){
 const declared=clean(attachment.association).toUpperCase()
 if(declared===unlinkedAssociation)return unlinkedAssociation
 return linkedAssociation
}

export function attachmentMatchesBrowserScope(attachment,{clientId='',allowUnlinked=false}={}){
 const association=attachmentAssociation(attachment)
 const activeClientId=clean(clientId)
 if(association===unlinkedAssociation)return Boolean(allowUnlinked&&!activeClientId&&!clean(attachment.clientId))
 return Boolean(activeClientId&&clean(attachment.clientId)&&clean(attachment.clientId)===activeClientId)
}

export function attachmentContentUrl(attachment,{clientId='',allowUnlinked=false}={}){
 const id=clean(attachment?.id)
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new TypeError('Attachment inválido.'),{code:'ATTACHMENT_ID_INVALID'})
 if(!attachmentMatchesBrowserScope(attachment,{clientId,allowUnlinked}))throw Object.assign(new Error('O attachment não pertence ao contexto ativo.'),{code:'ATTACHMENT_BROWSER_SCOPE_DENIED'})
 const association=attachmentAssociation(attachment)
 const scope=association===unlinkedAssociation?'association=UNLINKED':`clientId=${encodeURIComponent(clean(clientId))}`
 return `/api/val/attachments/${encodeURIComponent(id)}?${scope}`
}
