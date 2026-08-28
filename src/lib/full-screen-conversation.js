const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const safePart=value=>encodeURIComponent(clean(value,180)||'none')

export const fullScreenConversationVersion='val.full_screen_conversation.v1'
export const fullScreenThreadLimit=12
export const fullScreenTurnLimit=20

export function conversationScopeKey({clientId='',context=null}={}){
 const client=clean(clientId,180)
 // O objeto ativo evolui dentro da conversa; ele não cria uma nova thread.
 // Assim texto, voz, visita, talhão, foto, PDF e ferramentas mantêm o mesmo
 // conversationId enquanto o consultor conversa sobre o mesmo produtor.
 return client?`client:${client}`:'__global__'
}

export function createConversationThreadKey({clientId='',threadId=''}={}){
 const id=clean(threadId,180)||globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`
 return `${conversationScopeKey({clientId})}:conversation:${safePart(id)}`
}

export function createScopedRegistrationDraft({text='',clientId='',threadKey=''}={}){
 const candidate=clean(text,3000)
 const client=clean(clientId,180)
 const thread=clean(threadKey,500)
 return candidate&&client&&thread?{text:candidate,clientId:client,threadKey:thread}:null
}

export function registrationDraftTextForScope(draft,{clientId='',threadKey=''}={}){
 if(!draft||String(draft.clientId)!==String(clientId)||String(draft.threadKey)!==String(threadKey))return ''
 return clean(draft.text,3000)
}

export function conversationScopeLabel({client=null,context=null}={}){
 if(context?.label)return clean(context.label,120)
 if(client?.name)return clean(client.name,120)
 return 'Conversa geral'
}

export function conversationGroupLabel(value,now=new Date()){
 const date=new Date(value||0)
 if(Number.isNaN(date.getTime()))return 'Anteriores'
 const start=new Date(now);start.setHours(0,0,0,0)
 const target=new Date(date);target.setHours(0,0,0,0)
 const days=Math.round((start-target)/86_400_000)
 if(days===0)return 'Hoje'
 if(days===1)return 'Ontem'
 return 'Anteriores'
}

const latestText=turn=>{
 if(turn?.role==='user'||turn?.role==='system')return clean(turn.text,160)
 const reasoning=turn?.payload?.advice?.ai_reasoning||{}
 return clean(reasoning.recommended_strategy?.reading||turn?.payload?.advice?.answer,160)
}

export function buildConversationHistory({threads={},metadata={},clients=[],query='',now=new Date()}={}){
 const names=new Map((Array.isArray(clients)?clients:[]).map(client=>[String(client?.id),clean(client?.name,120)]))
 const needle=clean(query,120).toLocaleLowerCase('pt-BR')
 return Object.entries(threads).flatMap(([key,turns])=>{
  if(!Array.isArray(turns)||!turns.length)return []
  const meta=metadata[key]||{}
  const last=turns.at(-1)||{}
  const clientName=names.get(String(meta.clientId||''))||clean(meta.clientName,120)
  const label=clean(meta.label,120)||clientName||'Conversa geral'
  const preview=latestText(last)||latestText([...turns].reverse().find(item=>latestText(item)))||'Conversa em andamento'
  const at=last.at||meta.updatedAt||meta.createdAt||new Date(0).toISOString()
  const searchable=`${label} ${clientName} ${preview}`.toLocaleLowerCase('pt-BR')
  if(needle&&!searchable.includes(needle))return []
  return [{key,label,clientName,clientId:clean(meta.clientId,180),context:meta.context||null,preview,at,group:conversationGroupLabel(at,now),turnCount:turns.length}]
 }).sort((left,right)=>new Date(right.at)-new Date(left.at)).slice(0,fullScreenThreadLimit)
}

export function conversationWorkspaceStorageKey(storageScope='session'){
 return `valor360:val-full-screen:v1:${safePart(storageScope||'session')}`
}

export function readConversationWorkspace(storage,storageScope='session'){
 if(!storage?.getItem)return {threads:{},metadata:{}}
 try{
  const parsed=JSON.parse(storage.getItem(conversationWorkspaceStorageKey(storageScope))||'null')
  if(parsed?.version!==fullScreenConversationVersion||!parsed.threads||!parsed.metadata)return {threads:{},metadata:{}}
  return {threads:parsed.threads,metadata:parsed.metadata}
 }catch{return {threads:{},metadata:{}}}
}

export function writeConversationWorkspace(storage,storageScope,{threads={},metadata={}}={}){
 if(!storage?.setItem)return false
 try{
  const allowed=buildConversationHistory({threads,metadata}).map(item=>item.key)
  const boundedThreads={};const boundedMetadata={}
  for(const key of allowed){boundedThreads[key]=(threads[key]||[]).slice(-fullScreenTurnLimit);boundedMetadata[key]=metadata[key]||{}}
  storage.setItem(conversationWorkspaceStorageKey(storageScope),JSON.stringify({version:fullScreenConversationVersion,threads:boundedThreads,metadata:boundedMetadata,savedAt:new Date().toISOString()}))
  return true
 }catch{return false}
}

export function contextStatusLabel({client=null,context=null}={}){
 if(context?.type==='opportunity')return 'Oportunidade ativa'
 if(context?.type==='visit'||context?.type==='visit_draft')return 'Visita ativa'
 if(context?.type==='agronomic_tool'||context?.type==='soil_analysis')return 'Contexto agronômico'
 if(client)return 'Contexto confirmado'
 return 'Sem produtor selecionado'
}
