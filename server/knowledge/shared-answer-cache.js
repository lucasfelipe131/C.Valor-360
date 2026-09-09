import {createHash} from 'node:crypto'
import {loadKnowledgeLibrary} from './library.js'
import {containsPromptInjection,normalizeSearchText} from './policy.js'
import {stripMessagePreamble} from '../message-preamble.js'
import {hasPrivateQuestionContext} from '../decision-copilot/general-question-context.js'

const hash=value=>createHash('sha256').update(value).digest('hex')
export const sharedAnswerPolicyVersion='val.public-general-answer.v1'
export const sharedAnswerTtlMs=7*24*60*60*1000
const words=value=>normalizeSearchText(value).split(' ').filter(Boolean)
const canonicalQuestion=question=>{
 const normalized=normalizeSearchText(question)
 return (stripMessagePreamble(normalized)||normalized).replace(/^(?:o que e|como funciona|explique|defina)\s+(?:(?:o|a|os|as)\s+)?/,'')
}
let vocabulary
function publicVocabulary(){
 if(vocabulary)return vocabulary
 const library=loadKnowledgeLibrary()
 vocabulary=new Set(words(library.items.filter(item=>item.retrieval_eligible).map(item=>[item.title,item.statement,...item.triggers].join(' ')).join(' ')))
 for(const word of words('o a os as de do da dos das em no na nos nas e ou se sem por para com como qual quais que quanto quando onde porque porquê nao sim uma um sobre explique explicar explica saber gostaria quero queria entenda entender funciona funcionamento significado diferenca entre comparacao vantagens desvantagens fotossintese clorofila cloroplasto respiracao celular microbiota urease ureia enterrada incorporada lanco volatilizacao nitrogenio cigarrinha cigarrinhas enfezamento inseticida aplicacao milho soja trigo canola sorgo cultura germinacao emergencia plantas plantio sol luz agua carbono oxigenio glicose terra lua distancia kilometros quilometros media ciencia biologia conceito duvida melhor pior mais menos'))vocabulary.add(word)
 return vocabulary
}

export function isShareableGeneralQuestion(question=''){
 const source=String(question).trim()
 if(!source||source.length>800||hasPrivateQuestionContext(source)||containsPromptInjection(source)||/[\d@{}<>]|https?:|www\./i.test(source))return false
 const normalized=normalizeSearchText(source)
 if(/\b(?:hoje|agora|atual|cotacao|previsao|dose|dosagem|mistura|senha|segredo|memoria|anexo|documento|contato|usuario|owner|tenant|pessoal|confidencial)\b/.test(normalized))return false
 const tokens=words(stripMessagePreamble(normalized)||normalized)
 // Conservative public vocabulary: unknown names or case details still reach the
 // assistant, but cannot be published to the shared answer store.
 return tokens.length>1&&tokens.every(token=>publicVocabulary().has(token))
}

export function isShareableGeneralAnswer(answer=''){
 const source=String(answer).trim()
 return source.length>10&&source.length<=1200&&!hasPrivateQuestionContext(source)&&!containsPromptInjection(source)&&!/(?:https?:|www\.|@|\b\d{5,}\b|\b(?:tenant|owner|conversation|senha|segredo|confidencial)\b)/i.test(source)
}

export function createSharedKnowledgeAnswerCache({database,clock=Date.now,ttlMs=sharedAnswerTtlMs,policyVersion=sharedAnswerPolicyVersion}={}){
 const library=loadKnowledgeLibrary()
 const revision=hash(JSON.stringify({policyVersion,items:library.items,sources:library.sources}))
 const duration=Math.min(sharedAnswerTtlMs,Math.max(1000,Number(ttlMs)||sharedAnswerTtlMs))
 const inFlight=new Map()
 const query=(sql,params)=>database.query(sql,params,{timeoutMs:1500})
 const annotate=(result,status,expiresAt=null)=>({...result,cache:{status,scope:'PUBLIC_GENERAL',evidenceStatus:'UNVERIFIED_MODEL_KNOWLEDGE',expiresAt}})
 return Object.freeze({
  async resolve({question,model,generate,validate=()=>false}){
   if(!database?.configured||!model||!isShareableGeneralQuestion(question))return annotate(await generate(),'BYPASS')
   // No question, transcript, producer identity, owner or tenant is stored.
   const normalized=canonicalQuestion(question)
   const key=hash(JSON.stringify({question:normalized,locale:'pt-BR',model,revision}))
   const valid=text=>isShareableGeneralAnswer(text)&&validate(text)===true
   try{
    const {rows=[]}=await query('SELECT answer_text, answer_hash, evidence_status, expires_at FROM val_shared_knowledge_answers WHERE cache_key=$1 AND policy_revision=$2 AND model=$3 AND expires_at>NOW()',[key,revision,model])
    const row=rows[0]
    const expires=Date.parse(row?.expires_at)
    if(row&&expires>clock()&&expires<=clock()+duration&&row.evidence_status==='UNVERIFIED_MODEL_KNOWLEDGE'&&row.answer_hash===hash(row.answer_text)&&valid(row.answer_text))return annotate({text:row.answer_text,costUsd:0,modelCalls:0},'HIT',new Date(expires).toISOString())
   }catch{return annotate(await generate(),'UNAVAILABLE')}
   if(inFlight.has(key)){
    const shared=await inFlight.get(key)
    if(shared.text&&valid(shared.text))return annotate({...shared,costUsd:0,modelCalls:0},'COALESCED',shared.cache?.expiresAt)
    return annotate(await generate(),'BYPASS')
   }
   const work=(async()=>{
    const generated=await generate()
    if(!generated.text||!valid(generated.text))return annotate(generated,'NOT_STORED')
    const expiresAt=new Date(clock()+duration).toISOString()
    try{
     await query(`INSERT INTO val_shared_knowledge_answers (cache_key,policy_revision,model,answer_text,answer_hash,evidence_status,expires_at)
      VALUES ($1,$2,$3,$4,$5,'UNVERIFIED_MODEL_KNOWLEDGE',$6)
      ON CONFLICT (cache_key) DO UPDATE SET answer_text=EXCLUDED.answer_text,answer_hash=EXCLUDED.answer_hash,evidence_status=EXCLUDED.evidence_status,created_at=NOW(),expires_at=EXCLUDED.expires_at`,[key,revision,model,generated.text,hash(generated.text),expiresAt])
     return annotate(generated,'MISS',expiresAt)
    }catch{return annotate(generated,'UNAVAILABLE')}
   })()
   inFlight.set(key,work)
   try{return await work}finally{inFlight.delete(key)}
  }
 })
}
