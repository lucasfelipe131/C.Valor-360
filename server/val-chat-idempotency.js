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

// A epoca da conversa entra na chave. Sem ela, "Novo assunto." - que e um comando explicito de
// descarte e sobe a epoca - era DESFEITO pelo registro: repetir a pergunta devolvia a analise
// anterior ao reset e fazia a epoca da thread andar para tras. Medido: epoch 0 -> reset -> 1 ->
// repeticao volta com a recomendacao de antes e epoch 0.
export function valChatTurnFingerprint({tenantId='',ownerId='',conversationId='',clientId='',mode='',message='',attachmentIds=[],contextEpoch=0}={}){
 const parts=[text(tenantId,180),text(ownerId,180),text(conversationId,180),text(clientId,180),text(mode,40).toLowerCase(),text(message),[...(Array.isArray(attachmentIds)?attachmentIds:[])].map(item=>text(item,80)).sort().join('|'),`epoch:${Number.isSafeInteger(contextEpoch)&&contextEpoch>=0?contextEpoch:0}`]
 // Sem tenant, dono, conversa ou pergunta nao ha turno para repetir: cada pedido e o seu proprio.
 if(!parts[0]||!parts[1]||!parts[2]||!parts[5])return ''
 return createHash('sha256').update(parts.join(String.fromCharCode(0))).digest('hex')
}

// Registrar um fato novo tem que apagar o verniz. Medido: o consultor pergunta, registra a visita e
// a memoria, pergunta de novo para ver o efeito, e dentro dos 90 s recebe byte a byte a analise de
// ANTES do registro - com o mesmo recommendationId e o mesmo hash de contexto - enquanto a resposta
// correta, medida no controle, era outra. Todo endpoint de escrita ja chama invalidateValContextScope;
// o registro passou a ser invalidado no mesmo lugar.
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
  remember(key,payload,now=Date.now(),scope={}){
   if(!key||payload==null)return false
   entries.delete(key)
   entries.set(key,{payload,at:now,tenantId:text(scope.tenantId,180),ownerId:text(scope.ownerId,180)})
   prune(now)
   return true
  },
  invalidate({tenantId='',ownerId=''}={}){
   const scopedTenant=text(tenantId,180),scopedOwner=text(ownerId,180)
   if(!scopedOwner)return 0
   let removed=0
   for(const [key,entry] of entries){
    if(entry.ownerId!==scopedOwner)continue
    if(scopedTenant&&entry.tenantId&&entry.tenantId!==scopedTenant)continue
    entries.delete(key);removed+=1
   }
   return removed
  },
  get size(){return entries.size},
  clear(){entries.clear()}
 }
}
