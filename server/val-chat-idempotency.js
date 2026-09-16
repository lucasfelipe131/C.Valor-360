import {createHash} from 'node:crypto'

// OFFLINE-03. O POST /api/val/chat nao tinha idempotencia nenhuma. Quando a resposta se perde na
// volta - sinal fraco, tunel, troca de torre - o servidor JA produziu, persistiu e contabilizou a
// analise; o consultor nao recebe nada, reenvia, e o mesmo turno vira DUAS recomendacoes e DOIS
// eventos de uso. Medido com proxy TCP que descarta os bytes de resposta na volta: 0 -> 1 -> 2 em
// val_recommendations e em usage_events(val_analysis). No painel do gestor uma pergunta aparece
// como duas analises, e a resposta que o servidor ja tinha produzido fica irrecuperavel.
//
// A chave NAO e o requestId. Medido no cliente: GlobalValCopilot, ValPanel e ValDecisionWorkspace
// chamam createValProgressRequestId() a cada envio, entao o reenvio real chega com um id novo e
// dedup por requestId protegeria apenas um reenvio sintetico. O que se repete de verdade e o TURNO:
// mesmo tenant, mesmo dono, mesma conversa, mesmo produtor, mesmo modo, mesmos anexos e a mesma
// pergunta, dentro de uma janela curta.
//
// Em memoria de proposito: e um verniz de reenvio, nao um registro de negocio. O que precisa durar
// - a recomendacao - ja esta no Postgres, e um reinicio do processo apenas volta ao comportamento
// anterior, em vez de exigir replicacao de estado entre instancias.
const text=(value,limit=4000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit)

export function valChatTurnFingerprint({tenantId='',ownerId='',conversationId='',clientId='',mode='',message='',attachmentIds=[]}={}){
 const parts=[text(tenantId,180),text(ownerId,180),text(conversationId,180),text(clientId,180),text(mode,40).toLowerCase(),text(message),[...(Array.isArray(attachmentIds)?attachmentIds:[])].map(item=>text(item,80)).sort().join('|')]
 // Sem tenant, dono, conversa ou pergunta nao ha turno para repetir: cada pedido e o seu proprio.
 if(!parts[0]||!parts[1]||!parts[2]||!parts[5])return ''
 return createHash('sha256').update(parts.join(String.fromCharCode(0))).digest('hex')
}

export function createValChatIdempotencyLedger({ttlMs=90_000,maxEntries=200}={}){
 const entries=new Map()
 const prune=now=>{
  for(const [key,entry] of entries)if(now-entry.at>ttlMs)entries.delete(key)
  while(entries.size>maxEntries)entries.delete(entries.keys().next().value)
 }
 return {
  replay(key,now=Date.now()){
   if(!key)return null
   prune(now)
   const entry=entries.get(key)
   if(!entry||now-entry.at>ttlMs)return null
   return entry.payload
  },
  remember(key,payload,now=Date.now()){
   if(!key||payload==null)return false
   entries.delete(key)
   entries.set(key,{payload,at:now})
   prune(now)
   return true
  },
  get size(){return entries.size},
  clear(){entries.clear()}
 }
}
