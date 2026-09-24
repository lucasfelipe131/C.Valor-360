import {approvedSourceAnswer,approvedSourceExpired,buildSourceRequest,sourceCandidates,sourceRequestKey,sourceRequestTransition} from './source-requests.js'
import {text} from './policy.js'

const MAX_ASKED_BY=50
// O copiloto está no meio de uma resposta com prazo de 28 s: uma fila parada não pode segurar a
// conversa. Consultas vindas dele levam prazo curto e o sinal da requisição.
const COPILOT_QUERY_TIMEOUT_MS=2_000
const queryOptions=({signal,timeoutMs=COPILOT_QUERY_TIMEOUT_MS}={})=>({...(signal?{signal}:{}),timeoutMs})
const row=value=>value?Object.freeze({
 contract_version:'val.knowledge_source_request.v1',request_key:String(value.request_key),tenant_id:String(value.tenant_id),
 domain:String(value.domain),reason:String(value.reason),question:String(value.question),status:String(value.status),
 asked_count:Number(value.asked_count)||0,asked_by:Object.freeze(Array.isArray(value.asked_by)?value.asked_by.map(String):[]),
 created_at:value.created_at instanceof Date?value.created_at.toISOString():value.created_at,
 last_asked_at:value.last_asked_at instanceof Date?value.last_asked_at.toISOString():value.last_asked_at,
 source:value.source?Object.freeze({...value.source}):null,approved_by:value.approved_by||null,
 approved_at:value.approved_at instanceof Date?value.approved_at.toISOString():value.approved_at||null,
 rejection_reason:value.rejection_reason||null,
 candidates:Object.freeze(Array.isArray(value.candidates)?value.candidates.map(item=>Object.freeze({...item})):[]),
 candidates_researched_at:value.candidates_researched_at instanceof Date?value.candidates_researched_at.toISOString():value.candidates_researched_at||null,
 candidates_researched_by:value.candidates_researched_by||null
}):null

const columns='tenant_id,request_key,domain,reason,question,status,asked_count,asked_by,source,approved_by,approved_at,rejection_reason,created_at,last_asked_at,candidates,candidates_researched_at,candidates_researched_by'

// Sem PostgreSQL a loja não existe e o copiloto se comporta exatamente como antes: o beco sem saída
// continua sendo beco. Registrar a dúvida é um ganho, não uma dependência nova para responder.
export function createKnowledgeSourceRequestStore({database}={}){
 if(!database?.configured)return null
 // A API é nomeada em vez de depender de `this`: desestruturar a loja (const {transition}=store)
 // quebraria silenciosamente a leitura do estado atual antes da transição.
 const store=Object.freeze({
  // A soma de peso acontece no próprio INSERT. Ler-modificar-escrever perderia contagem quando dois
  // consultores fazem a mesma pergunta ao mesmo tempo, que é exatamente quando o peso importa.
  async register(input={},options={}){
   const request=buildSourceRequest(input)
   const result=await database.query(
    `INSERT INTO val_knowledge_source_requests (tenant_id,request_key,domain,reason,question,status,asked_count,asked_by,created_at,last_asked_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7::jsonb,$8,$8)
     ON CONFLICT (tenant_id,request_key) DO UPDATE SET
      asked_count=val_knowledge_source_requests.asked_count+1,
      reason=CASE WHEN EXCLUDED.reason='REGULATED_SOURCE_REQUIRED' THEN EXCLUDED.reason ELSE val_knowledge_source_requests.reason END,
      asked_by=(SELECT COALESCE(jsonb_agg(item),'[]'::jsonb) FROM (SELECT DISTINCT value item FROM jsonb_array_elements(val_knowledge_source_requests.asked_by||EXCLUDED.asked_by) LIMIT ${MAX_ASKED_BY}) unique_askers),
      last_asked_at=EXCLUDED.last_asked_at,updated_at=NOW()
     RETURNING ${columns}`,
    [request.tenant_id,request.request_key,request.domain,request.reason,request.question,request.status,JSON.stringify(request.asked_by),request.created_at],queryOptions(options)
   )
   return row(result.rows[0])
  },
  async get({tenantId='',requestKey=''}={},options={}){
   const result=await database.query(`SELECT ${columns} FROM val_knowledge_source_requests WHERE tenant_id=$1 AND request_key=$2`,[text(tenantId),text(requestKey)],queryOptions(options))
   return row(result.rows[0])
  },
  async list({tenantId='',status='',limit=50}={}){
   const bounded=Math.min(200,Math.max(1,Number(limit)||50))
   const result=await database.query(
    `SELECT ${columns} FROM val_knowledge_source_requests WHERE tenant_id=$1 AND ($2='' OR status=$2)
     ORDER BY asked_count DESC,last_asked_at DESC LIMIT ${bounded}`,
    [text(tenantId),text(status).toUpperCase()]
   )
   return result.rows.map(row)
  },
  // A transição é decidida pelo módulo de domínio e só então gravada, com o status esperado no
  // WHERE: duas aprovações simultâneas não podem sobrescrever uma à outra em silêncio.
  async transition({tenantId='',requestKey='',next='',source=null,actor='',rejectionReason='',now=new Date()}={}){
   const current=await store.get({tenantId,requestKey})
   if(!current)return null
   const updated=sourceRequestTransition(current,next,{source,actor,rejectionReason,now})
   const result=await database.query(
    `UPDATE val_knowledge_source_requests SET status=$3,source=$4::jsonb,approved_by=$5,approved_at=$6,rejection_reason=$7,updated_at=NOW()
     WHERE tenant_id=$1 AND request_key=$2 AND status=$8 RETURNING ${columns}`,
    [text(tenantId),text(requestKey),updated.status,updated.source?JSON.stringify(updated.source):null,updated.approved_by,updated.approved_at,updated.rejection_reason,current.status]
   )
   if(!result.rowCount)throw Object.assign(new Error('O pedido de fonte mudou de estado durante a revisão. Recarregue a fila.'),{statusCode:409,code:'knowledge_source_request_conflict',exposeMessage:true})
   return row(result.rows[0])
  },
  // Candidatas só não sobrescrevem uma aprovação: depois de APPROVED, a fonte já foi escolhida.
  // Uma busca nova que não achou nada não apaga as candidatas já pagas por outra busca.
  async saveCandidates({tenantId='',requestKey='',citations=[],actor='',now=new Date()}={}){
   const candidates=sourceCandidates(citations)
   if(!candidates.length)return store.get({tenantId,requestKey})
   const result=await database.query(
    `UPDATE val_knowledge_source_requests SET candidates=$3::jsonb,candidates_researched_at=$4,candidates_researched_by=$5,updated_at=NOW()
     WHERE tenant_id=$1 AND request_key=$2 AND status IN ('DRAFT','UNDER_REVIEW','REJECTED','EXPIRED') RETURNING ${columns}`,
    [text(tenantId),text(requestKey),JSON.stringify(candidates),new Date(now).toISOString(),text(actor)||null]
   )
   return row(result.rows[0])
  },
  // Caminho de resposta: a pergunta vira chave e só uma fonte aprovada e vigente devolve citação.
  async findApprovedAnswer({tenantId='',question='',now=new Date()}={},options={}){
   const requestKey=sourceRequestKey({tenantId,question})
   if(!requestKey)return null
   const request=await store.get({tenantId,requestKey},options)
   if(!request)return null
   // Fonte vencida deixa de responder e VOLTA a aparecer para o revisor: sem isto a linha ficava
   // presa em APPROVED, invisível na fila, enquanto o consultor lia a promessa de revisão.
   if(request.status==='APPROVED'&&approvedSourceExpired(request,now)){
    await database.query(`UPDATE val_knowledge_source_requests SET status='EXPIRED',updated_at=NOW() WHERE tenant_id=$1 AND request_key=$2 AND status='APPROVED'`,[text(tenantId),requestKey],queryOptions(options)).catch(()=>null)
    return null
   }
   return approvedSourceAnswer(request,now)
  }
 })
 return store
}
