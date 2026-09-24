import {createHash} from 'node:crypto'
import {containsPromptInjection,knowledgeLifecycleStates,normalizeSearchText,text} from './policy.js'
import {containsPrescriptiveContent} from './general-answer-provider.js'

export const knowledgeSourceRequestVersion='val.knowledge_source_request.v1'

// Por que a dúvida virou pedido. A causa decide o rigor da aprovação: assunto regulado só é
// respondido sobre fonte oficial com o trecho citado, enquanto falta de cobertura aceita a mesma
// régua A–D que o acervo curado já usa.
export const sourceRequestReasons=Object.freeze(['REGULATED_SOURCE_REQUIRED','LIBRARY_NO_COVERAGE'])

// knowledgeLifecycleStates existe em policy.js desde a primeira versão da Biblioteca e nunca teve
// quem produzisse um DRAFT: o acervo é corpus versionado, somente leitura. Este módulo é o produtor
// que faltava — a dúvida sem resposta entra como rascunho em vez de morrer no texto de recusa.
const transitions=Object.freeze({
 DRAFT:Object.freeze(['UNDER_REVIEW','REJECTED']),
 UNDER_REVIEW:Object.freeze(['APPROVED','REJECTED','DRAFT']),
 APPROVED:Object.freeze(['SUPERSEDED','EXPIRED']),
 REJECTED:Object.freeze(['UNDER_REVIEW']),
 SUPERSEDED:Object.freeze([]),
 EXPIRED:Object.freeze(['UNDER_REVIEW'])
})

// Uma resposta de bula só pode existir sobre o registro oficial. O domínio do publicador é a única
// checagem que não depende de o revisor julgar a autoridade de um texto que ele mesmo colou: quem
// aprova pode errar sobre o conteúdo, mas não sobre a procedência do endereço.
const officialRegulatedHosts=Object.freeze(['gov.br','embrapa.br'])
const MAX_QUESTION=500
const MAX_EXCERPT=2000
const MAX_ASKED_BY=50
const fail=(code,violations)=>{throw Object.assign(new Error('Pedido de fonte inválido.'),{name:'KnowledgeSourceRequestError',code,violations:[...new Set(violations)]})}
const httpsUrl=value=>{try{const url=new URL(String(value||''));return url.protocol==='https:'?url:null}catch{return null}}

export function isOfficialRegulatedSourceUrl(value){
 const url=httpsUrl(value)
 if(!url)return false
 const host=url.hostname.toLowerCase()
 return officialRegulatedHosts.some(allowed=>host===allowed||host.endsWith(`.${allowed}`))
}

// A mesma dúvida chega de vários consultores e não pode virar vários pedidos: o revisor precisa ver
// uma linha com o peso dela, não vinte linhas iguais. O tenant entra na chave porque acervo aprovado
// é por organização, e a pergunta entra normalizada de propósito, para "qual a carência do produto?"
// e "carencia do produto" colidirem. A chave é hash: a fila indexa sem guardar texto no índice.
//
// O domínio NÃO entra na chave. Ele é atribuído pelo roteador a partir do estado da conversa e a
// mesma pergunta pode cair em buckets diferentes em conversas diferentes — o que fragmentaria a
// fila e, pior, faria a fonte já aprovada não ser encontrada na próxima vez que alguém perguntasse.
// A pergunta é a mesma pergunta independentemente do bucket; o domínio fica como metadado da linha.
// A pergunta é cortada em MAX_QUESTION antes de virar chave — nos DOIS lados. Registrar cortava e
// consultar não: uma pergunta longa era aprovada e nunca respondida, porque a chave da consulta
// nunca batia com a da linha.
export function sourceRequestKey({tenantId='',question=''}={}){
 const normalized=normalizeSearchText(text(question).replace(/\s+/g,' ').slice(0,MAX_QUESTION))
 if(!normalized||!text(tenantId))return ''
 return createHash('sha256').update(`${text(tenantId)}\u001f${normalized}`).digest('hex').slice(0,32)
}

// A guarda de client_id nunca dispara pelo caminho geral, que por construção não tem produtor.
// O que chega é a PERGUNTA — e ela pode nomear uma pessoa, citar um CPF ou dizer "dele". A fila é
// lida por outra pessoa; pergunta que aponta um indivíduo não é conhecimento geral e fica de fora.
const documentNumber=/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/
const individualReference=/\b(?:dele|dela|deles|delas|deste produtor|desse produtor|desta produtora|dessa produtora|deste cliente|desse cliente|meu produtor|minha produtora|meu cliente|minha cliente)\b/i
const namedPerson=/\b(?:do|da|de|para|com|sr\.?|sra\.?|senhor|senhora|produtor|produtora|cliente)\s+(?:o\s|a\s)?\p{Lu}[\p{Ll}\p{M}'’-]+(?:\s+(?:d[aeo]s?\s+)?\p{Lu}[\p{Ll}\p{M}'’-]+)+/u
export function questionReferencesIndividual(question=''){
 const value=text(question)
 return documentNumber.test(value)||individualReference.test(value)||namedPerson.test(value)
}

export function buildSourceRequest({tenantId='',ownerId='',question='',domain='GENERAL',reason='LIBRARY_NO_COVERAGE',clientId='',now=new Date()}={}){
 const violations=[]
 if(!text(tenantId))violations.push('tenant_id')
 if(!text(ownerId))violations.push('owner_id')
 // O funil que alimenta este módulo é o caminho geral, sem produtor selecionado e sem memória
 // privada — o próprio general-answer-provider declara isso. Aceitar um pedido com produtor colado
 // transformaria a fila de revisão, que é lida por outra pessoa, num vazamento entre carteiras.
 if(text(clientId))violations.push('client_id.not_allowed')
 const asked=text(question).replace(/\s+/g,' ').slice(0,MAX_QUESTION)
 if(!asked)violations.push('question')
 else if(containsPromptInjection(asked))violations.push('question.injection')
 else if(questionReferencesIndividual(asked))violations.push('question.private')
 if(!sourceRequestReasons.includes(reason))violations.push('reason')
 const requestKey=sourceRequestKey({tenantId,question:asked})
 if(!requestKey)violations.push('request_key')
 if(violations.length)fail('knowledge_source_request_invalid',violations)
 const at=new Date(now).toISOString()
 return Object.freeze({
  contract_version:knowledgeSourceRequestVersion,request_key:requestKey,tenant_id:text(tenantId),
  domain:text(domain).toUpperCase()||'GENERAL',reason,question:asked,status:'DRAFT',
  asked_count:1,asked_by:Object.freeze([text(ownerId)]),created_at:at,last_asked_at:at,
  source:null,approved_by:null,approved_at:null,rejection_reason:null
 })
}

export function mergeSourceRequest(existing,incoming){
 if(!existing)return incoming
 if(existing.request_key!==incoming?.request_key)fail('knowledge_source_request_key_mismatch',['request_key'])
 const askedBy=[...new Set([...(existing.asked_by||[]),...(incoming.asked_by||[])])].slice(0,MAX_ASKED_BY)
 return Object.freeze({...existing,asked_count:(Number(existing.asked_count)||0)+1,asked_by:Object.freeze(askedBy),last_asked_at:incoming.last_asked_at})
}

// Sem o trecho citado, "responder com fonte aprovada" continua sendo o modelo falando de memória
// com um link decorativo ao lado. O excerto é o que a resposta cita, e é ele que a torna auditável.
export function validateSourceCandidate(source,{reason='LIBRARY_NO_COVERAGE'}={}){
 if(!source||typeof source!=='object'||Array.isArray(source))return ['missing']
 const violations=[]
 for(const key of ['title','publisher','url'])if(!text(source[key]))violations.push(key)
 if(!['A','B','C','D'].includes(source.authority))violations.push('authority')
 if(source.year!=null&&(!Number.isInteger(source.year)||source.year<1900))violations.push('year')
 if(!httpsUrl(source.url))violations.push('url')
 if(containsPromptInjection([source.title,source.publisher,source.notes,source.excerpt]))violations.push('injection')
 // A resposta entregue É o trecho. Aprovação sem trecho era aceita e nunca servida: a linha ficava
 // presa em APPROVED e o consultor continuava lendo a promessa de revisão.
 if(!text(source.excerpt))violations.push('excerpt.required')
 if(text(source.excerpt).length>MAX_EXCERPT)violations.push('excerpt.length')
 // O que decide o rigor é o conteúdo, não só a causa registrada: um trecho com dose, mistura ou
 // eficácia de marca é informação de bula onde quer que a pergunta tenha sido classificada.
 const regulated=reason==='REGULATED_SOURCE_REQUIRED'||containsPrescriptiveContent(text(source.excerpt))
 if(regulated){
  if(source.authority!=='A')violations.push('authority.regulated')
  if(!isOfficialRegulatedSourceUrl(source.url))violations.push('url.official_required')
  if(!text(source.accessed_at))violations.push('accessed_at')
 }
 return [...new Set(violations)]
}

export function sourceRequestTransition(request,next,{source=null,actor='',rejectionReason='',now=new Date()}={}){
 const violations=[]
 const current=text(request?.status)
 if(!knowledgeLifecycleStates.includes(current))violations.push('status.current')
 if(!knowledgeLifecycleStates.includes(next))violations.push('status.next')
 if(!violations.length&&!transitions[current].includes(next))violations.push(`transition.${current}_to_${next}`)
 if(next==='APPROVED'){
  for(const violation of validateSourceCandidate(source,{reason:request?.reason}))violations.push(`source.${violation}`)
  // Quem aprova responde tecnicamente pela resposta que a VAL passa a dar a partir dali. Sem nome
  // registrado, uma afirmação de bula não tem dono e a fila vira carimbo anônimo.
  if(!text(actor))violations.push('actor')
 }
 if(next==='REJECTED'&&!text(rejectionReason))violations.push('rejection_reason')
 if(violations.length)fail('knowledge_source_request_transition_invalid',violations)
 const at=new Date(now).toISOString()
 if(next==='APPROVED')return Object.freeze({...request,status:next,source:Object.freeze({...source}),approved_by:text(actor),approved_at:at,rejection_reason:null})
 if(next==='REJECTED')return Object.freeze({...request,status:next,rejection_reason:text(rejectionReason).slice(0,MAX_QUESTION),approved_by:null,approved_at:null})
 return Object.freeze({...request,status:next})
}

// Candidata é endereço e título, nada mais. O texto que o modelo escreveu durante a busca não é
// guardado: ao lado do endereço ele pareceria conteúdo da fonte, e quem aprova precisa ler a fonte.
const MAX_CANDIDATES=5
export function sourceCandidates(citations=[]){
 const seen=new Set(),kept=[]
 for(const citation of Array.isArray(citations)?citations:[]){
  const url=text(citation?.url)
  if(!url||seen.has(url)||!isOfficialRegulatedSourceUrl(url))continue
  seen.add(url)
  kept.push(Object.freeze({url,title:text(citation.title).slice(0,240)||new URL(url).hostname,host:new URL(url).hostname.toLowerCase()}))
  if(kept.length>=MAX_CANDIDATES)break
 }
 return Object.freeze(kept)
}

// A resposta só é servida enquanto a fonte vale. Bula é revisada e substituída, e uma citação
// vencida é pior do que a recusa que ela substituiu: parece verificada e não está mais.
// "Vigente até 30/09" preenchido como só-data era lido como meia-noite UTC: a fonte parava de
// valer às 21h do dia 29 no Brasil. Só-data vale até o fim daquele dia no fuso da organização.
export function sourceValidUntilTime(value){
 const raw=text(value)
 if(!raw)return null
 const time=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T23:59:59.999-03:00`:raw).getTime()
 return Number.isFinite(time)?time:null
}
export function approvedSourceExpired(request,now=new Date()){
 const validUntil=sourceValidUntilTime(request?.source?.valid_until)
 return validUntil!==null&&validUntil<=new Date(now).getTime()
}
export function approvedSourceAnswer(request,now=new Date()){
 if(text(request?.status)!=='APPROVED'||!request?.source)return null
 if(approvedSourceExpired(request,now))return null
 const {title,publisher,url,authority,year,excerpt,accessed_at:accessedAt}=request.source
 return Object.freeze({request_key:request.request_key,reason:request.reason,citation:Object.freeze({title,publisher,url,authority,year:year??null,accessed_at:accessedAt??null}),excerpt:text(excerpt)||null,approved_by:request.approved_by,approved_at:request.approved_at})
}
