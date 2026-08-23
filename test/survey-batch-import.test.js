import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import questions from '../src/data/questions.json' with {type:'json'}
import matrix from '../src/data/profile-matrix.json' with {type:'json'}
import {buildSurveyOptions} from '../server/survey-validation.js'
import {compileSurveyImportBatch} from '../server/survey-import.js'

const optionFor=id=>matrix.find(item=>item.Pergunta===id)?.Alternativa
const answersFor=(name,servicePreference=optionFor(11))=>Object.fromEntries(questions.map(question=>{
 if(question.id===1)return [question.id,name]
 if(question.id===2)return [question.id,'São Luiz Gonzaga']
 if(question.id===3)return [question.id,'De 101 a 300 hectares']
 if(question.id===4)return [question.id,'Soja, Milho']
 if(question.id===5)return [question.id,'De 8 a 15 anos']
 if(question.id===6)return [question.id,'Eu mesmo']
 if(question.id===11)return [question.id,servicePreference]
 if(question.id>=7&&question.id<=18)return [question.id,optionFor(question.id)]
 if(question.id>=19&&question.id<=24)return [question.id,9]
 if(question.id===25)return [question.id,'Conhecimento técnico']
 if(question.id===26)return [question.id,'Manter o acompanhamento']
 return [question.id,null]
}))

test('lote do Produtor 360 valida tudo antes de persistir e usa a resposta mais recente por produtor',()=>{
 const first=answersFor('Produtor Teste Analítico')
 const latest=answersFor(' Produtor Teste Analítico ',matrix.filter(item=>item.Pergunta===11)[1].Alternativa)
 const batch=compileSurveyImportBatch({records:[{answers:first},{answers:latest}]},{profileMatrix:matrix,surveyOptions:buildSurveyOptions(matrix)})
 assert.equal(batch.receivedCount,2)
 assert.equal(batch.duplicateCount,1)
 assert.equal(batch.profiles.length,1)
 assert.equal(batch.profiles[0].result.id,'produtor-teste-analitico')
 assert.equal(batch.profiles[0].result.servicePreference,latest[11])
 assert.equal(batch.profiles[0].result.profileSource,undefined)
 assert.equal(batch.profiles[0].answers[28],null)
})

test('lote incompleto é rejeitado com a posição da resposta e sem compilação parcial',()=>{
 assert.throws(()=>compileSurveyImportBatch({records:[{answers:{1:'Produtor Incompleto'}}]},{profileMatrix:matrix,surveyOptions:buildSurveyOptions(matrix)}),error=>error.statusCode===400&&/Resposta 1:/.test(error.message))
})

test('rota em lote permanece protegida e as duas telas usam o importador de preferências',()=>{
 const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const dataHub=readFileSync(new URL('../src/pages/DataHub.jsx',import.meta.url),'utf8')
 const questionnaire=readFileSync(new URL('../src/components/QuestionnaireImport.jsx',import.meta.url),'utf8')
 assert.match(server,/startsWith\('\/api\/clients\/from-survey'\)/)
 assert.match(server,/\/api\/clients\/from-survey\/batch/)
 assert.match(dataHub,/looksLikeQuestionnaire\(recognized\)/)
 assert.match(dataHub,/Atualizar preferências de/)
 assert.match(questionnaire,/Atualizar .*perfis|Atualizar preferências/)
})
