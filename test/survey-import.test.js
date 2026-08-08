import test from 'node:test'
import assert from 'node:assert/strict'
import questions from '../src/data/questions.json' with {type:'json'}
import matrix from '../src/data/profile-matrix.json' with {type:'json'}
import {normalizeImportRows,recognizeQuestionnaire} from '../src/lib/smart-import.js'
import {calculateProfile,opportunityFromAdditionalNeed,reconcileOpportunityProjection} from '../src/lib/profile.js'
import {buildSurveyOptions,validateSurveyAnswers} from '../server/survey-validation.js'

const optionFor=id=>matrix.find(item=>item.Pergunta===id)?.Alternativa
const row=name=>questions.map(question=>{
 if(question.id===1)return name
 if(question.id===2)return 'São Luiz Gonzaga'
 if(question.id===3)return 'Acima de 1.000 hectares'
 if(question.id===4)return 'Soja, Milho'
 if(question.id===5)return 'De 8 a 15 anos'
 if(question.id===6)return 'Sócios'
 if(question.id>=7&&question.id<=18)return optionFor(question.id)
 if(question.id>=19&&question.id<=24)return question.id===24?9:8
 if(question.id===25)return 'Confiança'
 if(question.id===26)return 'Está muito bom'
 return ''
})

test('normalização de linhas nunca chama map em objetos escalares',()=>{
 assert.deepEqual(normalizeImportRows({rows:[{a:'Nome',b:'Município'},{a:'Produtor',b:'Cidade'}]}),[['Nome','Município'],['Produtor','Cidade']])
})

test('normalização escolhe a aba de respostas em uma pasta com várias abas',()=>{
 const headers=questions.map(question=>question.text)
 const workbook=[
  {sheet:'Configuração',data:[['chave','valor'],['título','Interno']]},
  {sheet:'Form Responses 1',data:[headers,row('Produtor da Pasta')]},
  {sheet:'Matriz',data:[['Pergunta','Alternativa','Perfil']]}
 ]
 const rows=normalizeImportRows(workbook)
 assert.equal(rows.length,2)
 assert.equal(rows[1][0],'Produtor da Pasta')
 const report=recognizeQuestionnaire({rows:workbook,format:'Excel'})
 assert.equal(report.recordCount,1)
 assert.equal(report.records[0].producerName,'Produtor da Pasta')
})

test('planilha com várias respostas reconhece todos os produtores e mantém questão 27 opcional',()=>{
 const headers=questions.map(question=>question.text)
 const report=recognizeQuestionnaire({rows:[headers,row('Produtor Um'),row('Produtor Dois')],format:'Excel'})
 assert.equal(report.recordCount,2)
 assert.deepEqual(report.records.map(record=>record.producerName),['Produtor Um','Produtor Dois'])
 assert.ok(report.records.every(record=>record.requiredMissing.length===0))
 assert.ok(report.records.every(record=>record.missing.some(question=>question.id===27)))
})

test('servidor aceita participante da decisão e questão 27 vazia',()=>{
 const answers=Object.fromEntries(questions.map((question,index)=>[question.id,row('Produtor Teste')[index]]))
 const validated=validateSurveyAnswers(answers,buildSurveyOptions(matrix))
 assert.equal(validated[6],'Sócios')
 assert.equal(validated[27],null)
})

test('perfil usa identificador determinístico em reimportações',()=>{
 const answers=Object.fromEntries(questions.map((question,index)=>[question.id,row('Produtor Estável')[index]]))
 const first=calculateProfile(answers,matrix)
 const second=calculateProfile(answers,matrix)
 assert.equal(first.id,'produtor-estavel')
 assert.equal(second.id,first.id)
 assert.equal(first.commercial.potentialValidated,false)
 assert.equal(first.commercial.property,'')
})

test('necessidade adicional distingue negação genérica de uma demanda real',()=>{
 for(const value of ['Não','Não.','Nenhuma no momento','Por enquanto, não','No momento não','Agora não','Sem demanda','Não há nenhuma necessidade','Nenhuma necessidade adicional','Não, obrigado','Não precisamos']){
  assert.equal(opportunityFromAdditionalNeed(value),'',value)
 }
 for(const value of ['Não tenho irrigação','Não temos armazenagem suficiente','Não consigo controlar buva']){
  assert.equal(opportunityFromAdditionalNeed(value),value)
 }

 const answers=Object.fromEntries(questions.map((question,index)=>[question.id,row('Produtor sem demanda')[index]]))
 answers[27]='Não.'
 const noneDeclared=calculateProfile(answers,matrix)
 assert.equal(noneDeclared.additionalNeed,'Não.')
 assert.equal(noneDeclared.additionalNeedStatus,'none_declared')
 assert.equal(noneDeclared.commercial.opportunity,'')

 answers[27]='Não temos armazenagem suficiente'
 const reported=calculateProfile(answers,matrix)
 assert.equal(reported.additionalNeedStatus,'reported')
 assert.equal(reported.commercial.opportunity,'Não temos armazenagem suficiente')
 assert.deepEqual(reported.commercial.opportunityProvenance,{origin:'producer_360',field:'q27',state:'reported'})
})

test('reconciliação altera somente a oportunidade que veio da questão 27',()=>{
 const previous={additionalNeed:'Ampliar armazenagem',commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'},potential:0}}
 const noneDeclared={additionalNeed:'Não.',commercial:{opportunity:'',opportunityProvenance:{origin:'producer_360',field:'q27',state:'none_declared'},potential:0}}
 assert.deepEqual(reconcileOpportunityProjection(previous,noneDeclared),{opportunity:'',opportunityProvenance:{origin:'producer_360',field:'q27',state:'none_declared'}})

 const independent={additionalNeed:'Ampliar armazenagem',commercial:{opportunity:'Comparativos técnicos e condições',opportunityProvenance:{origin:'consultant',field:'validated_opportunity',state:'reported'},potential:96_000,potentialValidated:true}}
 assert.deepEqual(reconcileOpportunityProjection(independent,noneDeclared),{opportunity:'Comparativos técnicos e condições',opportunityProvenance:{origin:'consultant',field:'validated_opportunity',state:'reported'}})

 const history={commercial:{opportunity:'Hipótese: revisar janela de decisão',opportunityProvenance:{origin:'commercial_history',field:'derived_hypothesis',state:'reported'},score:80}}
 assert.deepEqual(reconcileOpportunityProjection(previous,history),{opportunity:'Hipótese: revisar janela de decisão',opportunityProvenance:{origin:'commercial_history',field:'derived_hypothesis',state:'reported'}})
})
