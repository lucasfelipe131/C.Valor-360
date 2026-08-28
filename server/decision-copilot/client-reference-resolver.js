export const clientReferenceResolutionVersion='val.client_reference_resolution.v1'

const clean=(value,max=500)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
export const normalizeClientReference=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim()

const currentClientReference=/^(?:ele|ela|dele|dela|nele|nela|esse|essa|este|esta|esse cliente|essa cliente|este cliente|esta cliente|esse produtor|essa produtora|este produtor|esta produtora)$/i
const temporalOnly=/^(?:amanh[ãa]|hoje|agora|depois|mais tarde|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo)$/i
const trailingContext=/\s+(?:amanh[ãa]|hoje|depois|mais tarde|na pr[óo]xima semana|esta semana|para (?:uma|a|o)|pra (?:uma|a|o)|porque\b|pois\b|e (?:quero|preciso|vou|vamos)\b).*$/iu

const naturalReferencePatterns=Object.freeze([
 {kind:'EXPLICIT_NAME',pattern:/\bcomo\s+(?:est[aá]|t[aá]|anda)\s+(?:(?:o|a)\s+)?(?:cliente|produtor|produtora)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'AUTHORIZED_NAME_CANDIDATE',pattern:/\bcomo\s+(?:est[aá]|t[aá]|anda)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:vou|vamos|iremos?|pretendo)\s+(?:visitar|ver|encontrar)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:vou|vamos|iremos?)\s+(?:no|na|ao|[àa])\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:visitar|ver|encontrar)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:volta|volte|voltar|retoma|retome|retomar)\s+(?:para|pro|pra|ao|[àa]|no|na|com)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:troca|troque|muda|mude|alterar|mudar)\s+(?:o\s+cliente\s+)?(?:para|pro|pra|ao|[àa])\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\bagora\s+(?:com\s+)?(?<reference>(?:o|a)\s+[^,.!?;]+)/iu},
])

const stripReference=value=>{
 let reference=clean(value,220).replace(trailingContext,'').trim()
 reference=reference.replace(/^(?:(?:o|a|ao|[àa]|pro|pra|no|na)\s+)?(?:cliente|produtor|produtora)\s+/iu,'')
 reference=reference.replace(/^(?:o|a|ao|[àa])\s+/iu,'').replace(/\s+(?:por favor|pfv)$/iu,'').trim()
 return reference
}

export function extractNaturalClientReference(message){
 const source=clean(message,2000)
 if(!source)return Object.freeze({kind:'NONE',reference:null})
 for(const {kind,pattern} of naturalReferencePatterns){
  const match=source.match(pattern)
  if(!match?.groups?.reference)continue
  const reference=stripReference(match.groups.reference)
  if(!reference||temporalOnly.test(reference))return Object.freeze({kind:'NONE',reference:null})
  if(currentClientReference.test(reference))return Object.freeze({kind:'CURRENT_CLIENT',reference})
  return Object.freeze({kind,reference})
 }
 if(/\b(?:ele|ela|dele|dela|nele|nela|esse cliente|essa cliente|esse produtor|essa produtora)\b/iu.test(source))return Object.freeze({kind:'CURRENT_CLIENT',reference:source.match(/\b(?:ele|ela|dele|dela|nele|nela|esse cliente|essa cliente|esse produtor|essa produtora)\b/iu)?.[0]||null})
 return Object.freeze({kind:'NONE',reference:null})
}

const safeClient=client=>{
 if(!client||typeof client!=='object')return null
 const id=clean(client.id??client.external_key??client.externalKey,180)
 const name=clean(client.name,180)
 if(!id||!name)return null
 const municipality=clean(client.municipality,140)||null
 return Object.freeze({id,name,municipality})
}

const uniqueAuthorizedClients=clients=>{
 const byId=new Map()
 for(const value of Array.isArray(clients)?clients:[]){
  const client=safeClient(value)
  if(client&&!byId.has(client.id))byId.set(client.id,client)
 }
 return [...byId.values()]
}

const result=({status,kind='NONE',reference=null,reasonCode,client=null,options=[],current=null})=>Object.freeze({
 contract_version:clientReferenceResolutionVersion,
 status,
 reference_kind:kind,
 reference:reference?clean(reference,220):null,
 normalized_reference:reference?normalizeClientReference(reference):null,
 reason_code:reasonCode,
 client,
 options:Object.freeze(options),
 previous_client:current,
 changed_client:Boolean(client&&current&&client.id!==current.id),
})

const matchAuthorizedClients=(reference,clients)=>{
 const normalized=normalizeClientReference(reference)
 if(!normalized)return {reasonCode:'INVALID_CLIENT_REFERENCE',matches:[]}
 const idMatches=clients.filter(client=>String(client.id)===clean(reference,180))
 if(idMatches.length)return {reasonCode:'AUTHORIZED_ID_MATCH',matches:idMatches}
 const named=clients.map(client=>({client,name:normalizeClientReference(client.name),tokens:normalizeClientReference(client.name).split(' ').filter(Boolean)}))
 const exact=named.filter(item=>item.name===normalized).map(item=>item.client)
 if(exact.length)return {reasonCode:'EXACT_NAME_MATCH',matches:exact}
 const referenceTokens=normalized.split(' ').filter(Boolean)
 const prefix=named.filter(item=>referenceTokens.length&&referenceTokens.every((token,index)=>item.tokens[index]===token)).map(item=>item.client)
 if(prefix.length)return {reasonCode:'NAME_PREFIX_MATCH',matches:prefix}
 if(referenceTokens.length===1){
  const token=named.filter(item=>item.tokens.includes(referenceTokens[0])).map(item=>item.client)
  if(token.length)return {reasonCode:'NAME_TOKEN_MATCH',matches:token}
 }
 return {reasonCode:'CLIENT_REFERENCE_NOT_FOUND',matches:[]}
}

/**
 * Resolve uma referência somente contra uma carteira que já foi autorizada no backend.
 * `currentClientId` é tratado apenas como dica: ele também precisa existir nessa carteira.
 */
export function resolveAuthorizedClientReference({message='',reference='',authorizedClients=[],currentClientId=null}={}){
 const clients=uniqueAuthorizedClients(authorizedClients)
 const current=currentClientId==null?null:clients.find(client=>String(client.id)===String(currentClientId))||null
 const extracted=reference?{kind:currentClientReference.test(stripReference(reference))?'CURRENT_CLIENT':'EXPLICIT_NAME',reference:stripReference(reference)}:extractNaturalClientReference(message)
 if(extracted.kind==='NONE')return result({status:'NONE',reasonCode:'NO_CLIENT_REFERENCE',current})
 if(extracted.kind==='CURRENT_CLIENT'){
  if(!current)return result({status:'NOT_FOUND',kind:extracted.kind,reference:extracted.reference,reasonCode:'CURRENT_CLIENT_NOT_AUTHORIZED',current:null})
  return result({status:'RESOLVED',kind:extracted.kind,reference:extracted.reference,reasonCode:'CURRENT_CLIENT_RESOLVED',client:current,current})
 }
 const matched=matchAuthorizedClients(extracted.reference,clients)
 if(matched.matches.length===0&&extracted.kind==='AUTHORIZED_NAME_CANDIDATE')return result({status:'NONE',kind:extracted.kind,reference:extracted.reference,reasonCode:'AUTHORIZED_NAME_EVIDENCE_ABSENT',current})
 if(matched.matches.length===0)return result({status:'NOT_FOUND',kind:extracted.kind,reference:extracted.reference,reasonCode:matched.reasonCode,current})
 if(matched.matches.length>1)return result({status:'AMBIGUOUS',kind:extracted.kind,reference:extracted.reference,reasonCode:'AMBIGUOUS_CLIENT_REFERENCE',options:matched.matches,current})
 return result({status:'RESOLVED',kind:extracted.kind,reference:extracted.reference,reasonCode:matched.reasonCode,client:matched.matches[0],current})
}
