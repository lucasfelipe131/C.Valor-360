import {text} from './policy.js'

// technical_reviewer já existe no conjunto de papéis do produto e é exatamente quem responde
// tecnicamente por uma afirmação de bula. Consultor vê a própria dúvida virar pedido, mas não
// aprova a fonte que fará a VAL responder para a organização inteira.
const REVIEW_ROLES=new Set(['admin','technical_reviewer'])
const accessError=(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code,exposeMessage:true})
const requestKeyPattern=/^[a-f0-9]{32}$/

export function createKnowledgeSourceRequestService({store=null}={}){
 const assertReviewer=identity=>{
  if(!identity?.tenantId)throw accessError('Sessão sem organização válida.',403,'knowledge_source_request_scope_invalid')
  if(!REVIEW_ROLES.has(text(identity.role)))throw accessError('A revisão de fontes é restrita à administração e à revisão técnica.',403,'knowledge_source_request_forbidden')
  // Aprovar é assumir responsabilidade técnica, e responsabilidade precisa de nome. Uma sessão de
  // demonstração não tem a quem atribuir a resposta que a VAL passará a dar.
  const actor=text(identity.email)||text(identity.id)
  if(!actor||identity.demo===true)throw accessError('A revisão de fontes exige um acesso nomeado.',403,'knowledge_source_request_actor_required')
  return actor
 }
 const assertAvailable=()=>{
  if(!store)throw accessError('A fila de fontes exige PostgreSQL configurado neste ambiente.',503,'knowledge_source_request_unavailable')
 }
 const assertKey=value=>{
  const requestKey=text(value)
  if(!requestKeyPattern.test(requestKey))throw accessError('Pedido de fonte inválido.',400,'knowledge_source_request_invalid')
  return requestKey
 }
 return Object.freeze({
  available:Boolean(store),
  async list({identity,status=''}={}){
   assertReviewer(identity);assertAvailable()
   return {contract_version:'val.knowledge_source_request_queue.v1',requests:await store.list({tenantId:identity.tenantId,status})}
  },
  async review({identity,requestKey=''}={}){
   const actor=assertReviewer(identity);assertAvailable()
   const updated=await store.transition({tenantId:identity.tenantId,requestKey:assertKey(requestKey),next:'UNDER_REVIEW',actor})
   if(!updated)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   return updated
  },
  async approve({identity,requestKey='',source=null}={}){
   const actor=assertReviewer(identity);assertAvailable()
   const updated=await store.transition({tenantId:identity.tenantId,requestKey:assertKey(requestKey),next:'APPROVED',source,actor})
   if(!updated)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   return updated
  },
  async reject({identity,requestKey='',reason=''}={}){
   const actor=assertReviewer(identity);assertAvailable()
   const updated=await store.transition({tenantId:identity.tenantId,requestKey:assertKey(requestKey),next:'REJECTED',rejectionReason:reason,actor})
   if(!updated)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   return updated
  }
 })
}
