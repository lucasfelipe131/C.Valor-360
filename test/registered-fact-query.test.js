import test from 'node:test'
import assert from 'node:assert/strict'
import {registeredFactQuery,registeredFactPresentation} from '../server/registered-fact-query.js'
import {buildFastClientResponse} from '../server/decision-copilot/capability-router.js'
const client={id:'genor',name:'Genor TEST',tenant_id:'tenant',context_owner_id:'owner',client_id:'genor'}
const now=new Date().toISOString()
test('crop facts preserve seasons, field declarations and narrative disagreement without sums',()=>{
 const query=registeredFactQuery('Quantos hectares Genor planta de milho?')
 const result=registeredFactPresentation({query,client,declaredSeasons:[{season:'2627V',updatedAt:now,crops:[{crop:'Milho',areaHa:70}]},{season:'2526V',updatedAt:now,crops:[{crop:'Milho',areaHa:60}]}],narratives:[{id:'visit-1',source_type:'visit',observedAt:now,text:'O milho ocupa 65 hectares.'}]})
 assert.match(result.answer,/70 ha/);assert.match(result.answer,/60 ha/);assert.match(result.answer,/65 hectares/)
 assert.doesNotMatch(result.answer,/195/);assert.match(result.action,/safras distintas/)
 const response=buildFastClientResponse({facts:{client},presentationOverride:result,message:'Quantos hectares Genor planta de milho?',organizationId:'tenant',ownerId:'owner'})
 assert.ok(JSON.stringify(response).includes('70 ha'))
})
test('hobby narrative is retrieved and absent data does not create an interview',()=>{
 const query=registeredFactQuery('Qual é o hobby do Genor?')
 const result=registeredFactPresentation({query,client,narratives:[{id:'interaction-1',source_type:'interaction',observedAt:now,text:'Seu hobby é pescar com a família.'}]})
 assert.match(result.answer,/pescar/)
 assert.doesNotMatch(registeredFactPresentation({query,client}).answer,/pescar/)
 const response=buildFastClientResponse({facts:{client},presentationOverride:result,message:'Qual é o hobby do Genor?',organizationId:'tenant',ownerId:'owner'})
 assert.ok(JSON.stringify(response).includes('pescar'))
})
test('ellipsis requires factual area antecedent and temporal query restricts season',()=>{
 assert.equal(registeredFactQuery('E de soja?',{previousMessage:'Qual o preço do milho?'}),null)
 assert.equal(registeredFactQuery('E de soja?',{previousMessage:'Quantos hectares ele planta de milho?'}).crop,'soja')
 const query=registeredFactQuery('Qual a área de milho na safra 2627V?')
 const result=registeredFactPresentation({query,client,declaredSeasons:[{season:'2627V',crops:[{crop:'Milho',areaHa:70}]},{season:'2526V',crops:[{crop:'Milho',areaHa:60}]}]})
 assert.match(result.answer,/70 ha/);assert.doesNotMatch(result.answer,/60 ha/)
})

test('missing data is a grounded gap without generic questions',()=>{
 const result=registeredFactPresentation({query:registeredFactQuery('Qual o hobby dele?'),client})
 const response=buildFastClientResponse({facts:{client},presentationOverride:result,message:'Qual o hobby dele?',organizationId:'tenant',ownerId:'owner'})
 assert.equal(response.advice.ai_reasoning.decision_interview.questions.length,0)
 assert.match(response.advice.answer,/Informação ausente/)
})
