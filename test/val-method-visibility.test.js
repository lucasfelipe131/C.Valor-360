import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildValMethodApplication} from '../src/lib/val-method-application.js'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('aplicação visível preserva SPIN, OPC e EPA com conteúdo contextual',()=>{
 const method=buildValMethodApplication({
  analyzed:true,
  questions:[{stage:'problema',type:'aberta',question:'Onde a variabilidade mais afeta sua decisão hoje?'}],
  methodology:{current:'descobrir',gate:'O produtor descreve uma decisão afetada.'},
  brief:{headline:'Confirmar a prioridade da nutrição foliar',reason:'Há uma oportunidade registrada, mas a prioridade ainda não foi confirmada.',action:'Conduzir uma conversa breve antes de apresentar solução.',question:'Onde a variabilidade mais afeta sua decisão hoje?',decisionBasis:['Oportunidade em diagnóstico → confirmar a dificuldade antes de propor.']},
  conversation:{opening:'Quero entender esta decisão antes de falar em solução.'},
  valueHypothesis:{problem:'Variabilidade produtiva no talhão norte.',impact:'Quantificar sc/ha, área afetada e R$/sc.',metric:'Resultado por hectare.',proof:'Comparativo medido no talhão.'},
  profile:{adaptation:'Apresente um comparativo curto e dê tempo para análise.'},
  approachPlan:{proof:'Comparativo em tabela.'},
  commitment:{status:'',summary:''},
  opportunityReview:{title:'Nutrição foliar',stage:'Diagnóstico'},
  commercialContext:{interpretation:'Potencial em aberto cadastrado: R$ 150.000.'},
  objective:'Confirmar a dificuldade e a decisão afetada.',
  nextBestAction:'Registrar o impacto citado e combinar a próxima validação.'
 })

 assert.equal(method.current,'problema')
 assert.deepEqual(method.spin.map(item=>item.label),['Situação','Problema','Implicação','Necessidade de solução'])
 assert.equal(method.spin.find(item=>item.key==='problema').status,'current')
 assert.match(method.spin.find(item=>item.key==='situacao').reading,/Nutrição foliar/)
 assert.match(method.spin.find(item=>item.key==='problema').question.text,/variabilidade/)
 assert.match(method.spin.find(item=>item.key==='implicacao').reading,/sc\/ha/)
 assert.deepEqual(method.opc.map(item=>item.label),['Objetivo','Processo','Compromisso'])
 assert.match(method.opc.find(item=>item.key==='commitment').value,/Ainda não registrado/)
 assert.deepEqual(method.epa.map(item=>item.label),['Educar','Personalizar','Assumir a condução'])
 assert.match(method.epa.find(item=>item.key==='personalize').value,/comparativo curto/)
})

test('estado inicial mostra os métodos sem inventar abordagem para o produtor',()=>{
 const method=buildValMethodApplication()
 assert.equal(method.analyzed,false)
 assert.equal(method.spin.length,4)
 assert.ok(method.spin.every(item=>item.status==='waiting'))
 assert.ok([...method.spin,...method.opc,...method.epa].every(item=>/analisar o produtor/i.test(item.reading||item.value)))
})

test('SPIN, OPC e EPA ficam fora das áreas recolhidas e têm contrato responsivo',()=>{
 const panel=read('src/components/ValPanel.jsx')
 const styles=read('src/styles.css')
 const playbook=read('server/sales-playbook.js')
 const methodsIndex=panel.indexOf('<section className="val-sales-methods"')
 const collapsedIndex=panel.indexOf('<details className="val-plan-details"')

 assert.ok(methodsIndex>0&&methodsIndex<collapsedIndex)
 assert.match(panel,/SPIN DA ABORDAGEM/)
 assert.match(panel,/Objetivo, Processo e Compromisso/)
 assert.match(panel,/Educar, Personalizar e Assumir a condução/)
 assert.match(panel,/methodApplication\.spin\.map/)
 assert.match(styles,/\.val-sales-methods-grid\{display:grid;grid-template-columns:minmax\(0,1\.48fr\)/)
 assert.match(styles,/@media\(max-width:1180px\)[^}]*[\s\S]*?\.val-sales-methods-grid\{grid-template-columns:1fr\}/)
 assert.match(styles,/@media\(max-width:460px\)[^}]*[\s\S]*?\.val-spin-method>ol\{grid-template-columns:1fr\}/)
 assert.match(playbook,/painel [“"]Método da abordagem[”"]/)
 assert.match(playbook,/nunca um exemplo genérico/)
})
