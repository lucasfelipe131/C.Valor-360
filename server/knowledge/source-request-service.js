import {text} from './policy.js'
import {sourceCandidates} from './source-requests.js'

// technical_reviewer já existe no conjunto de papéis do produto e é exatamente quem responde
// tecnicamente por uma afirmação de bula. Consultor vê a própria dúvida virar pedido, mas não
// aprova a fonte que fará a VAL responder para a organização inteira.
const REVIEW_ROLES=new Set(['admin','technical_reviewer'])
const accessError=(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code,exposeMessage:true})
const requestKeyPattern=/^[a-f0-9]{32}$/

export function createKnowledgeSourceRequestService({store=null,findCandidates=null}={}){
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
  researchAvailable:Boolean(store&&findCandidates),
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
  // Aprovar a partir de DRAFT, REJECTED ou EXPIRED passa por UNDER_REVIEW no mesmo gesto. A tela
  // oferecia "Anexar fonte" nesses estados e o servidor recusava a transição direta — o revisor
  // preenchia tudo e lia um erro sem saída.
  async approve({identity,requestKey='',source=null}={}){
   const actor=assertReviewer(identity);assertAvailable()
   const key=assertKey(requestKey)
   const current=await store.get({tenantId:identity.tenantId,requestKey:key})
   if(!current)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   if(['DRAFT','REJECTED','EXPIRED'].includes(current.status))await store.transition({tenantId:identity.tenantId,requestKey:key,next:'UNDER_REVIEW',actor})
   const updated=await store.transition({tenantId:identity.tenantId,requestKey:key,next:'APPROVED',source,actor})
   if(!updated)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   return updated
  },
  // A busca é paga e roda com o limite de quem a disparou. Ela sugere onde procurar; aprovar
  // continua exigindo abrir a fonte e colar o trecho literal.
  async researchCandidates({identity,requestKey='',signal}={}){
   const actor=assertReviewer(identity);assertAvailable()
   if(!findCandidates)throw accessError('A pesquisa de fontes está desligada neste ambiente (VAL_WEB_RESEARCH_ENABLED).',503,'knowledge_source_research_disabled')
   const key=assertKey(requestKey)
   const request=await store.get({tenantId:identity.tenantId,requestKey:key})
   if(!request)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   if(request.status==='APPROVED')throw accessError('Este pedido já tem fonte aprovada.',409,'knowledge_source_request_already_approved')
   const result=await findCandidates({identity,question:request.question,signal})
   const found=sourceCandidates(result?.citations||[]).length
   const updated=await store.saveCandidates({tenantId:identity.tenantId,requestKey:key,citations:result?.citations||[],actor})
   if(!updated)throw accessError('O pedido mudou de estado durante a pesquisa. Recarregue a fila.',409,'knowledge_source_request_conflict')
   // A tela decide a mensagem pelo que a busca trouxe agora, não pelo que já havia gravado.
   return {...updated,research_found:found}
  },
  async reject({identity,requestKey='',reason=''}={}){
   const actor=assertReviewer(identity);assertAvailable()
   const updated=await store.transition({tenantId:identity.tenantId,requestKey:assertKey(requestKey),next:'REJECTED',rejectionReason:reason,actor})
   if(!updated)throw accessError('Pedido de fonte não encontrado nesta organização.',404,'knowledge_source_request_not_found')
   return updated
  }
 })
}
