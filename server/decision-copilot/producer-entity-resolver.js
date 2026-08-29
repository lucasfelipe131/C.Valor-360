export const producerEntityResolverVersion='val.producer_entity_resolver.v1'
export const clientReferenceResolutionVersion='val.client_reference_resolution.v1'

const clean=(value,max=500)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
export const normalizeClientReference=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim()

const currentClientReference=/^(?:ele|ela|dele|dela|nele|nela|esse|essa|este|esta|esse cliente|essa cliente|este cliente|esta cliente|esse produtor|essa produtora|este produtor|esta produtora)$/i
const temporalOnly=/^(?:amanh[ãa]|hoje|agora|depois|mais tarde|segunda|ter[cç]a|quarta|quinta|sexta|s[áa]bado|domingo)$/i
const trailingContext=/\s+(?:amanh[ãa]|hoje|depois|mais tarde|na pr[óo]xima semana|esta semana|para (?:uma|a|o)|pra (?:uma|a|o)|porque\b|pois\b|e (?:quero|preciso|vou|vamos)\b).*$/iu

const naturalReferencePatterns=Object.freeze([
 {kind:'EXPLICIT_NAME',pattern:/\bcomo\s+(?:est[aá]|t[aá]|anda)\s+(?:(?:o|a)\s+)?(?:cliente|produtor|produtora)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'AUTHORIZED_NAME_CANDIDATE',pattern:/\bcomo\s+(?:est[aá]|t[aá]|anda)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'AUTHORIZED_NAME_CANDIDATE',pattern:/\b(?:abre|abra|abrir|mostra|mostre|mostrar|procura|procure|buscar?)\s+(?:(?:o|a)\s+)?(?:(?:cliente|produtor|produtora|fazenda|propriedade)\s+)?(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:prepara|prepare|preparar|monta|monte)\s+(?:(?:a|uma)\s+)?(?:visita|conversa)\s+(?:de|do|da|para|pro|pra|com)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:vou|vamos|iremos?|pretendo)\s+(?:visitar|ver|encontrar)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:vou|vamos|iremos?)\s+(?:no|na|ao|[àa])\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:visitar|ver|encontrar)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:volta|volte|voltar|retoma|retome|retomar)\s+(?:para|pro|pra|ao|[àa]|no|na|com)\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\b(?:troca|troque|muda|mude|alterar|mudar)\s+(?:o\s+cliente\s+)?(?:para|pro|pra|ao|[àa])\s+(?<reference>[^,.!?;]+)/iu},
 {kind:'EXPLICIT_NAME',pattern:/\bagora\s+(?:com\s+)?(?<reference>(?:o|a)\s+[^,.!?;]+)/iu},
])

const stripReference=value=>{
 let reference=clean(value,220).replace(trailingContext,'').trim()
 reference=reference.replace(/^(?:(?:o|a|ao|[àa]|pro|pra|no|na)\s+)?(?:cliente|produtor|produtora|fazenda|propriedade)\s+/iu,'')
 reference=reference.replace(/^(?:o|a|ao|[àa])\s+/iu,'').replace(/\s+(?:por favor|pfv)$/iu,'').trim()
 return reference
}

export function extractNaturalClientReference(message){
 const source=clean(message,2000)
 if(!source)return Object.freeze({kind:'NONE',reference:null})
 if(/\b(?:volta|volte|retoma|retome)\s+(?:(?:para|pro|pra|ao|no)\s+)?(?:(?:o\s+)?produtor\s+)?anterior\b/iu.test(source))return Object.freeze({kind:'PREVIOUS_CLIENT',reference:'anterior'})
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

const textList=value=>{
 if(Array.isArray(value))return value.map(item=>clean(item?.name??item?.label??item,180)).filter(Boolean)
 return clean(value,1000).split(/[,;|]+/).map(item=>clean(item,180)).filter(Boolean)
}

const safeClient=client=>{
 if(!client||typeof client!=='object')return null
 const id=clean(client.id??client.external_key??client.externalKey,180)
 const name=clean(client.name,180)
 if(!id||!name)return null
 return Object.freeze({id,name,municipality:clean(client.municipality,140)||null})
}

const searchableClient=client=>{
 const safe=safeClient(client)
 if(!safe)return null
 const aliases=textList(client.aliases??client.commercial?.aliases)
 const properties=textList(client.properties)
 return {safe,aliases,properties,names:[safe.name,...aliases],recent:Boolean(client.recent)}
}

const uniqueAuthorizedClients=clients=>{
 const byId=new Map()
 for(const value of Array.isArray(clients)?clients:[]){
  const client=searchableClient(value)
  if(client&&!byId.has(client.safe.id))byId.set(client.safe.id,client)
 }
 return [...byId.values()]
}

const result=({status,kind='NONE',reference=null,reasonCode,client=null,options=[],current=null,match=null})=>Object.freeze({
 contract_version:clientReferenceResolutionVersion,
 resolver_version:producerEntityResolverVersion,
 status,
 reference_kind:kind,
 reference:reference?clean(reference,220):null,
 normalized_reference:reference?normalizeClientReference(reference):null,
 reason_code:reasonCode,
 client,
 options:Object.freeze(options),
 previous_client:current,
 changed_client:Boolean(client&&current&&client.id!==current.id),
 match:match?Object.freeze(match):null,
})

const levenshtein=(left,right)=>{
 if(left===right)return 0
 if(!left.length)return right.length
 if(!right.length)return left.length
 const previous=Array.from({length:right.length+1},(_,index)=>index)
 for(let row=1;row<=left.length;row+=1){
  const current=[row]
  for(let column=1;column<=right.length;column+=1)current[column]=Math.min(current[column-1]+1,previous[column]+1,previous[column-1]+(left[row-1]===right[column-1]?0:1))
  for(let column=0;column<current.length;column+=1)previous[column]=current[column]
 }
 return previous[right.length]
}

const similarity=(left,right)=>{
 const longest=Math.max(left.length,right.length)
 return longest?1-levenshtein(left,right)/longest:1
}

const matchAuthorizedClients=(reference,clients)=>{
 const normalized=normalizeClientReference(reference)
 if(!normalized)return {reasonCode:'INVALID_CLIENT_REFERENCE',matches:[],match:null}
 const raw=clean(reference,180)
 const idMatches=clients.filter(item=>item.safe.id===raw)
 if(idMatches.length)return {reasonCode:'AUTHORIZED_ID_MATCH',matches:idMatches.map(item=>item.safe),match:{kind:'ID',confidence:1}}
 const rows=clients.map(item=>{
  const names=item.names.map(name=>normalizeClientReference(name)).filter(Boolean)
  const properties=item.properties.flatMap(name=>{const normalizedName=normalizeClientReference(name);const withoutType=normalizedName.replace(/^(?:fazenda|propriedade|sitio|chacara)\s+/,'');return [normalizedName,withoutType]}).filter(Boolean)
  return {...item,names,properties,primary:normalizeClientReference(item.safe.name),tokens:normalizeClientReference(item.safe.name).split(' ').filter(Boolean)}
 })
 const exactName=rows.filter(item=>item.primary===normalized)
 if(exactName.length)return {reasonCode:'EXACT_NAME_MATCH',matches:exactName.map(item=>item.safe),match:{kind:'EXACT_NAME',confidence:1}}
 const exactAlias=rows.filter(item=>item.names.slice(1).includes(normalized))
 if(exactAlias.length)return {reasonCode:'EXACT_ALIAS_MATCH',matches:exactAlias.map(item=>item.safe),match:{kind:'ALIAS',confidence:.98}}
 const exactProperty=rows.filter(item=>item.properties.includes(normalized))
 if(exactProperty.length)return {reasonCode:'EXACT_PROPERTY_MATCH',matches:exactProperty.map(item=>item.safe),match:{kind:'PROPERTY',confidence:.96}}
 const referenceTokens=normalized.split(' ').filter(Boolean)
 const prefix=rows.filter(item=>referenceTokens.length&&referenceTokens.every((token,index)=>item.tokens[index]===token))
 if(prefix.length)return {reasonCode:'NAME_PREFIX_MATCH',matches:prefix.map(item=>item.safe),match:{kind:'PREFIX',confidence:.92}}
 if(referenceTokens.length===1){
  const token=rows.filter(item=>item.tokens.includes(referenceTokens[0]))
  if(token.length)return {reasonCode:'NAME_TOKEN_MATCH',matches:token.map(item=>item.safe),match:{kind:'TOKEN',confidence:.9}}
 }
 const threshold=normalized.length>=6?.84:.9
 const scored=rows.map(item=>{
  const candidates=[...item.names.map(name=>({kind:'FUZZY_NAME',value:name})),...item.properties.map(value=>({kind:'FUZZY_PROPERTY',value}))]
  const best=candidates.map(candidate=>({...candidate,score:similarity(normalized,candidate.value)})).sort((left,right)=>right.score-left.score)[0]
  return {item,best}
 }).filter(entry=>entry.best?.score>=threshold).sort((left,right)=>right.best.score-left.best.score)
 if(!scored.length)return {reasonCode:'CLIENT_REFERENCE_NOT_FOUND',matches:[],match:null}
 const top=scored[0].best.score
 const tied=scored.filter(entry=>top-entry.best.score<.06)
 return {reasonCode:tied.length>1?'AMBIGUOUS_FUZZY_REFERENCE':'FUZZY_TRANSCRIPT_MATCH',matches:tied.map(entry=>entry.item.safe),match:{kind:tied[0].best.kind,confidence:Number(top.toFixed(3))}}
}

/** Resolve apenas entidades previamente autorizadas e já escopadas pelo backend. */
export function resolveAuthorizedClientReference({message='',reference='',authorizedClients=[],currentClientId=null,recentClientIds=[]}={}){
 const clients=uniqueAuthorizedClients(authorizedClients)
 const current=currentClientId==null?null:clients.find(item=>String(item.safe.id)===String(currentClientId))?.safe||null
 const recent=(Array.isArray(recentClientIds)?recentClientIds:[]).map(id=>clients.find(item=>String(item.safe.id)===String(id))?.safe).filter(client=>client&&client.id!==current?.id)
 const extracted=reference?{kind:currentClientReference.test(stripReference(reference))?'CURRENT_CLIENT':'EXPLICIT_NAME',reference:stripReference(reference)}:extractNaturalClientReference(message)
 if(extracted.kind==='NONE')return result({status:'NONE',reasonCode:'NO_CLIENT_REFERENCE',current})
 if(extracted.kind==='CURRENT_CLIENT'){
  if(!current)return result({status:'NOT_FOUND',kind:extracted.kind,reference:extracted.reference,reasonCode:'CURRENT_CLIENT_NOT_AUTHORIZED',current:null})
  return result({status:'RESOLVED',kind:extracted.kind,reference:extracted.reference,reasonCode:'CURRENT_CLIENT_RESOLVED',client:current,current,match:{kind:'CURRENT_CONTEXT',confidence:1}})
 }
 if(extracted.kind==='PREVIOUS_CLIENT'){
  if(!recent.length)return result({status:'NOT_FOUND',kind:extracted.kind,reference:extracted.reference,reasonCode:'PREVIOUS_CLIENT_NOT_AUTHORIZED',current})
  return result({status:'RESOLVED',kind:extracted.kind,reference:extracted.reference,reasonCode:'PREVIOUS_CLIENT_RESOLVED',client:recent[0],current,match:{kind:'RECENT_CONTEXT',confidence:1}})
 }
 const matched=matchAuthorizedClients(extracted.reference,clients)
 if(matched.matches.length===0&&extracted.kind==='AUTHORIZED_NAME_CANDIDATE')return result({status:'NONE',kind:extracted.kind,reference:extracted.reference,reasonCode:'AUTHORIZED_NAME_EVIDENCE_ABSENT',current})
 if(matched.matches.length===0)return result({status:'NOT_FOUND',kind:extracted.kind,reference:extracted.reference,reasonCode:matched.reasonCode,current})
 if(matched.matches.length>1)return result({status:'AMBIGUOUS',kind:extracted.kind,reference:extracted.reference,reasonCode:'AMBIGUOUS_CLIENT_REFERENCE',options:matched.matches,current,match:matched.match})
 return result({status:'RESOLVED',kind:extracted.kind,reference:extracted.reference,reasonCode:matched.reasonCode,client:matched.matches[0],current,match:matched.match})
}
