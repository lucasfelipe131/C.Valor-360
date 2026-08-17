import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const playbook=read('server/sales-playbook.js')
const decision=read('src/components/ValDecisionWorkspace.jsx')
const overview=read('src/components/ProducerBusinessOverview.jsx')
const panel=read('src/components/ValPanel.jsx')
const questionnaire=read('src/pages/Questionnaire.jsx')
const readme=read('README.md')
const docs=read('docs/VAL_ENGINE.md')

test('instruções e perguntas da VAL usam português natural sem mudar o contrato',()=>{
 assert.match(playbook,/Use de duas a seis frases curtas, com uma ideia por frase/)
 assert.match(playbook,/portanto, preencha esses campos/)
 assert.match(playbook,/personalize a abordagem para o contexto real/)
 assert.match(playbook,/O que mudou recentemente em relação a /)
 assert.match(playbook,/Confirmamos o responsável, o prazo e a evidência/)
 assert.doesNotMatch(playbook,/Termo novo só quando/)
 assert.doesNotMatch(playbook,/na operação de '\+topic/)
})

test('telas não exibem plurais entre parênteses nem frases telegráficas revisadas',()=>{
 for(const source of [decision,overview,panel]){
  assert.doesNotMatch(source,/inconsistência\(s\)|lacuna\(s\)|fonte\(s\)|resultado\(s\)|ação\(ões\)|analisada\(s\)|aberta\(s\)/)
 }
 assert.match(decision,/Força das evidências, não probabilidade de fechamento/)
 assert.match(overview,/Realizado × oportunidade em aberto/)
 assert.match(panel,/A decisão permanece com o consultor e o produtor/)
 assert.match(questionnaire,/Salvar e revisar o próximo/)
})

test('README e documentação têm prosa revisada',()=>{
 assert.match(readme,/Antes de atender múltiplas empresas, são obrigatórios/)
 assert.match(readme,/Armazenamento de objetos/)
 assert.match(docs,/A assinatura HMAC comprova/)
 assert.match(docs,/A saída inclui resposta interna/)
})
