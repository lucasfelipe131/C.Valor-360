import test from 'node:test'
import assert from 'node:assert/strict'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {buildGeneralNoClientResponse,regulatedClaimStub,sourceRequestRegisteredNote} from '../server/decision-copilot/capability-executor.js'

const tenant='00000000-0000-4000-8000-000000000001'
const owner='00000000-0000-4000-8000-000000000101'
const research={domains:['gov.br','embrapa.br'],callCostUsd:0.03}
const embrapa='https://www.embrapa.br/plantio-direto'
const concept='como o plantio direto reduz a erosão do solo'
const researchOutput=(text,citations=[{url:embrapa,title:'Sistema plantio direto'}])=>({status:'completed',output:[{type:'web_search_call',action:{type:'search'}},{type:'message',content:[{type:'output_text',text,annotations:citations.map(item=>({type:'url_citation',...item}))}]}],output_text:text,usage:{input_tokens:1000,output_tokens:200}})
const goodAnswer='O plantio direto mantém a palhada sobre o solo, o que protege contra o impacto da chuva e reduz a erosão.'
const memoryAnswer={status:'completed',output_text:'O plantio direto conserva o solo porque a palhada reduz o escoamento e a erosão.',usage:{input_tokens:100,output_tokens:40}}

// Distingue a pesquisa da resposta de memória pelo que o corpo da chamada pede.
function provider({searchResult=researchOutput(goodAnswer)}={}){
 const calls=[]
 return {calls,responses:{create:async body=>{const kind=body.tools?.[0]?.type==='web_search'?'web_search':'memory';calls.push(kind);return kind==='web_search'?searchResult:memoryAnswer}}}
}
const ask=async(message,{aiClient=null,withResearch=true,sourceRequests=null}={})=>{
 const route=routeSystemCapability({message,intentHint:'ASK_GENERAL',hasClient:false})
 const response=await buildGeneralNoClientResponse({message,route,organizationId:tenant,ownerId:owner,conversationId:`general:${message}`,aiClient,aiModel:aiClient?'gpt-5.6-luna':'',sourceRequests,research:withResearch?research:null})
 return {response,reasoning:response.advice.ai_reasoning,answer:response.advice.answer}
}

test('dúvida conceitual é respondida por pesquisa citada antes da memória do modelo',async()=>{
 const aiClient=provider()
 const {answer,reasoning,response}=await ask(concept,{aiClient})
 assert.deepEqual(aiClient.calls,['web_search'])
 assert.match(answer,/reduz a erosão/)
 assert.match(answer,/Fontes: Sistema plantio direto \(www\.embrapa\.br\)/)
 assert.doesNotMatch(answer,/https?:\/\//)
 assert.equal(reasoning.evidence_status,'WEB_RESEARCH_CITED')
 assert.equal(reasoning.confidence.level,'PESQUISA_CITADA')
 assert.match(reasoning.confidence.rationale,/não passou por revisão humana/)
 assert.deepEqual(reasoning.knowledge_refs,[{url:embrapa,title:'Sistema plantio direto',host:'www.embrapa.br'}])
 // Sem atalho: a resposta pesquisada passou pelo mesmo crivo de relevância da resposta de memória.
 assert.equal(reasoning.grounding.question_relevance,'PASS')
 assert.ok(response.responseMetadata.aiGeneralKnowledgeCostUsd>=0.03,'a busca entra no teto do consultor')
 assert.equal(response.responseMetadata.webResearch.citations,1)
})

test('com a pesquisa desligada nada muda: nenhuma busca, resposta de memória como antes',async()=>{
 const aiClient=provider()
 const {reasoning}=await ask(concept,{aiClient,withResearch:false})
 assert.deepEqual(aiClient.calls,['memory'])
 assert.equal(reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
})

// Dose e bula só saem de fonte aprovada por uma pessoa. A pesquisa automática não responde isso.
test('assunto regulado nunca é pesquisado para responder: recusa e vira pedido de fonte',async()=>{
 const aiClient=provider()
 const registered=[]
 const {answer}=await ask('qual a dose de glifosato por hectare',{aiClient,sourceRequests:{register:async input=>{registered.push(input);return {...input,status:'DRAFT'}},findApprovedAnswer:async()=>null}})
 assert.equal(aiClient.calls.includes('web_search'),false)
 assert.equal(answer,`${regulatedClaimStub}${sourceRequestRegisteredNote}`)
 assert.equal(registered[0].reason,'REGULATED_SOURCE_REQUIRED')
})

test('fonte aprovada tem precedência sobre a pesquisa',async()=>{
 const aiClient=provider()
 const approved={request_key:'b'.repeat(32),reason:'LIBRARY_NO_COVERAGE',citation:{title:'Circular técnica',publisher:'Embrapa',url:'https://www.embrapa.br/circular',authority:'A',year:2025,accessed_at:null},excerpt:'A palhada do plantio direto reduz a perda de solo por erosão hídrica.',approved_by:'agronomo@val.test',approved_at:'2026-09-22T13:00:00.000Z'}
 const {reasoning}=await ask(concept,{aiClient,sourceRequests:{register:async()=>{},findApprovedAnswer:async()=>approved}})
 assert.deepEqual(aiClient.calls,[])
 assert.equal(reasoning.evidence_status,'APPROVED_EXTERNAL_SOURCE')
})

test('pesquisa recusada cai na memória, e a busca que falhou ainda conta no teto',async()=>{
 const offList=provider({searchResult:researchOutput(goodAnswer,[{url:'https://blog-agro.exemplo.com/post',title:'Blog'}])})
 const {reasoning,response}=await ask(concept,{aiClient:offList})
 assert.deepEqual(offList.calls,['web_search','memory'])
 assert.equal(reasoning.evidence_status,'UNVERIFIED_MODEL_KNOWLEDGE')
 assert.ok(response.responseMetadata.aiGeneralKnowledgeCostUsd>=0.03)
 assert.equal(response.responseMetadata.webResearch,undefined)
})

// Ter fonte não autoriza prescrever: dose por área continua exclusiva de fonte aprovada.
test('pesquisa que prescreve dose é descartada mesmo com citação válida',async()=>{
 const prescriptive=provider({searchResult:researchOutput('No plantio direto, aplique 2 l/ha de dessecante antes da semeadura para reduzir a erosão.')})
 const {reasoning,answer}=await ask(concept,{aiClient:prescriptive})
 assert.notEqual(reasoning.evidence_status,'WEB_RESEARCH_CITED')
 assert.doesNotMatch(answer,/2 l\/ha/)
})

test('sem cliente de IA — teto estourado — não há pesquisa',async()=>{
 const {reasoning}=await ask(concept,{aiClient:null})
 assert.notEqual(reasoning.evidence_status,'WEB_RESEARCH_CITED')
})

// A resposta pesquisada é síntese do modelo, com pronome anafórico legítimo ("Ela ocorre nos
// cloroplastos"). Recebia a régua estrita do trecho literal e era barrada onde a memória passava.
test('pronome anafórico numa resposta pesquisada não é lido como afirmação sobre um indivíduo',async()=>{
 const question='como funciona a fotossíntese nas plantas'
 const text='A fotossíntese converte luz em energia química nas plantas. Ela ocorre nos cloroplastos das folhas.'
 const aiClient=provider({searchResult:researchOutput(text,[{url:'https://www.embrapa.br/fotossintese',title:'Fotossíntese'}])})
 const {reasoning}=await ask(question,{aiClient})
 assert.equal(reasoning.evidence_status,'WEB_RESEARCH_CITED')
 assert.equal(reasoning.grounding?.blocked===true,false)
})

test('carência com número de dias numa resposta pesquisada é descartada mesmo citada',async()=>{
 const withInterval=provider({searchResult:researchOutput('No plantio direto a palhada reduz a erosão. A carência do dessecante é de 7 dias.')})
 const {reasoning,answer}=await ask(concept,{aiClient:withInterval})
 assert.notEqual(reasoning.evidence_status,'WEB_RESEARCH_CITED')
 assert.doesNotMatch(answer,/7 dias/)
})
