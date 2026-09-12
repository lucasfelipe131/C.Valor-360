import test from 'node:test'
import assert from 'node:assert/strict'
import {summarizeVisitSuggestion} from '../src/lib/visit-suggestion-summary.js'
test('long multi-topic report exposes one complete explicit follow-up and retains original',()=>{
 const reason='Conversamos sobre a safra de milho e as condições observadas na área de soja. Também discutimos o atendimento e a organização dos registros da propriedade. Combinamos levar o comparativo de custo por hectare.'
 const result=summarizeVisitSuggestion({reason})
 assert.equal(result.reason,'Combinamos levar o comparativo de custo por hectare.')
 assert.equal(result.full,reason);assert.equal(result.nextStep,'')
})
test('short commitment preserves negation and does not invent a next step',()=>{
 const reason='Não enviar proposta antes de conferir o comparativo.'
 assert.equal(summarizeVisitSuggestion({reason}).reason,reason)
 assert.equal(summarizeVisitSuggestion({reason}).nextStep,'')
})
test('ambiguous long report and multiple commitments use a short review instruction without truncation',()=>{
 for(const reason of ['Assuntos diversos sobre a fazenda '.repeat(15),'Combinamos levar o comparativo. Ficou pendente confirmar a área. '+ 'Observações sobre diferentes assuntos da propriedade. '.repeat(5)]){
  const result=summarizeVisitSuggestion({reason})
  assert.equal(result.reason,'Confira a pendência registrada antes de preparar a visita.')
  assert.equal(result.full,reason.trim());assert.equal(result.extracted,false)
 }
})
test('explicit next step is preserved separately; long next step stays complete in details',()=>{
 const result=summarizeVisitSuggestion({reason:'Comparativo solicitado pelo produtor.',nextCommitment:'Levar o comparativo para avaliação conjunta.'})
 assert.equal(result.nextStep,'Levar o comparativo para avaliação conjunta.')
 const nextCommitment='Conferir os registros da propriedade '.repeat(8)
 const long=summarizeVisitSuggestion({nextCommitment})
 assert.equal(long.nextStep,'');assert.equal(long.nextFull,nextCommitment.trim())
})
