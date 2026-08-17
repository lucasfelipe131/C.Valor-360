import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildMessageCalibration} from '../server/message-calibration.js'

const start=Date.parse('2026-01-01T12:00:00Z')
const pair=(index)=>[
 {id:`r-${index}-a`,created_at:new Date(start+index*2*86_400_000).toISOString(),methodology_state:{current_stage:'descobrir'},conversation_plan:{steps:[{suggested_line:'Qual impacto esta prioridade causa na decisão atual?'}]},approach_plan:{objective:'Dimensionar o impacto antes de propor.'},feedback:{id:`f-${index}`,outcome:index%3===0?'edited':'accepted'}},
 {id:`r-${index}-b`,created_at:new Date(start+(index*2+1)*86_400_000).toISOString(),methodology_state:{current_stage:'dimensionar'}}
]

test('placar só libera benchmark após 30 observações no mesmo segmento',()=>{
 const context={calibrationRecommendations:Array.from({length:30},(_,index)=>pair(index)).flat()}
 const result=buildMessageCalibration(context,{now:Date.parse('2026-08-17T12:00:00Z'),minSample:30})
 const segment=result.segments.find(item=>item.stage==='descobrir')
 const message=result.messages[0]
 assert.equal(result.mode,'shadow')
 assert.equal(segment.sample,30)
 assert.equal(segment.status,'benchmark_ready')
 assert.equal(segment.advanced,30)
 assert.equal(segment.advanceRate,1)
 assert.equal(message.uses,30)
 assert.equal(message.advanceRate,1)
 assert.equal(message.confidence,'benchmark_ready')
 assert.equal(result.readySegments,1)
 assert.equal(result.policy.automaticPromptChange,false)
 assert.equal(result.policy.productionRanking,false)
 assert.equal(result.policy.causalClaims,false)
})

test('frase e abordagem vêm dos campos estruturados, não de notas livres',()=>{
 const result=buildMessageCalibration({calibrationRecommendations:[
  {id:'r1',created_at:'2026-08-10T12:00:00Z',methodology_state:{current_stage:'alinhar'},conversation_plan:{steps:[{suggested_line:'Qual resultado tornaria esta conversa útil?'}]},approach_plan:{objective:'Alinhar objetivo e tempo.'},feedback:{outcome:'executed',notes:'Texto livre que não pode virar feature.'}},
  {id:'r2',created_at:'2026-08-11T12:00:00Z',methodology_state:{current_stage:'descobrir'}}
 ]},{now:Date.parse('2026-08-17T12:00:00Z')})
 assert.equal(result.messages[0].line,'Qual resultado tornaria esta conversa útil?')
 assert.equal(result.messages[0].approach,'Alinhar objetivo e tempo.')
 assert.equal(result.messages[0].executed,1)
 assert.doesNotMatch(JSON.stringify(result),/Texto livre que não pode virar feature/)
 assert.equal(result.policy.freeNotesExcluded,true)
})

test('ausência de interação seguinte não é contada como rejeição nem avanço',()=>{
 const result=buildMessageCalibration({calibrationRecommendations:[{id:'r1',created_at:'2026-08-16T12:00:00Z',methodology_state:{current_stage:'propor'},next_question:{question:'Podemos revisar a proposta com todos os decisores?'}}]},{now:Date.parse('2026-08-17T12:00:00Z')})
 assert.equal(result.summary.nextInteractionsObserved,0)
 assert.equal(result.summary.advanced,0)
 assert.equal(result.summary.rejected,0)
 assert.match(result.interpretation,/Ainda não existem interações seguintes suficientes/)
})

test('consulta de calibração limita retenção, volume e exclui notes do feedback',()=>{
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(bootstrap,/NOW\(\)-INTERVAL '365 days'/)
 assert.match(bootstrap,/LIMIT 120/)
 assert.match(bootstrap,/generated_content->'approach_plan'/)
 assert.match(bootstrap,/generated_content->'conversation_plan'/)
 assert.doesNotMatch(bootstrap,/feedback\.notes/)
 assert.match(bootstrap,/messageCalibration:buildMessageCalibration/)
})

test('Estúdio exibe shadow mode, amostra e proibição de autoalteração',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/MessageCalibrationPanel.jsx',import.meta.url),'utf8')
 assert.match(studio,/MessageCalibrationPanel/)
 assert.match(panel,/PLACAR DE MENSAGENS • SHADOW MODE/)
 assert.match(panel,/O que coincidiu com avanço na conversa seguinte/)
 assert.match(panel,/Nenhuma autoalteração/)
 assert.match(panel,/Notas livres excluídas/)
})
