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

test('SPIN, OPC e EPA funcionam como abas exclusivas, acessíveis e responsivas',()=>{
 const panel=read('src/components/ValPanel.jsx')
 const styles=read('src/styles.css')
 const playbook=read('server/sales-playbook.js')
 const methodology=read('server/val-methodology.js')
 const methodSources=playbook+'\n'+methodology
 const methodsIndex=panel.indexOf('<section className="val-sales-methods"')
 const collapsedIndex=panel.indexOf('<details className="val-plan-details"')

 assert.ok(methodsIndex>0&&methodsIndex<collapsedIndex)
 assert.match(panel,/SPIN DA ABORDAGEM/)
 assert.match(panel,/Objetivo, Processo e Compromisso/)
 assert.match(panel,/Educar, Personalizar e Assumir a condução/)
 assert.match(panel,/methodApplication\.spin\.map/)
 assert.match(panel,/const \[activeMethod,setActiveMethod\]=useState\('spin'\)/)
 assert.match(panel,/className="val-method-tabs" role="tablist" aria-label="Escolher método da abordagem"/)
 assert.match(panel,/role="tab" aria-selected=\{activeMethod===item\.key\} aria-controls="val-method-panel"/)
 assert.match(panel,/onClick=\{\(\)=>setActiveMethod\(item\.key\)\}/)
 assert.match(panel,/onKeyDown=\{event=>moveMethodFocus\(event,item\.key\)\}/)
 assert.match(panel,/const moveMethodFocus=[\s\S]*?\['ArrowLeft','ArrowRight','Home','End'\]/)
 assert.match(panel,/id="val-method-panel" role="tabpanel" aria-labelledby=\{`val-method-tab-\$\{activeMethod\}`\}/)
 assert.match(panel,/activeMethod==='spin'&&<article className="val-spin-method">/)
 assert.match(panel,/activeMethod==='opc'&&<article className="val-opc-method">/)
 assert.match(panel,/activeMethod==='epa'&&<article className="val-epa-method">/)
 assert.match(styles,/\.val-method-tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
 assert.match(styles,/\.val-method-tabs>button\.is-active\{/)
 assert.match(styles,/\.val-sales-method-panel\{[^}]*animation:val-rise/)
 assert.match(styles,/@media\(max-width:760px\)[\s\S]*?\.val-method-tabs\{grid-template-columns:1fr\}/)
 assert.match(styles,/@media\(max-width:460px\)[^}]*[\s\S]*?\.val-spin-method>ol\{grid-template-columns:1fr\}/)
 assert.match(methodSources,/painel [“"]Método da abordagem[”"]/)
 assert.match(methodSources,/nunca um exemplo genérico/)
})

test('sequência consultiva separa etapa aberta, sugestão da VAL e etapa de trabalho',()=>{
 const panel=read('src/components/ValPanel.jsx')
 const styles=read('src/styles.css')
 const server=read('server.js')

 assert.match(panel,/const \[sequenceControl,setSequenceControl\]=useState\(\(\)=>createSequenceControl\(\)\)/)
 assert.match(panel,/const activeSequenceStage=sequenceControl\.openStage/)
 assert.match(panel,/const workingSequenceStage=sequenceControl\.workingStage/)
 assert.match(panel,/Etapa aberta: \{methodLabels\[activeSequenceStage\]\}/)
 assert.match(panel,/Sugestão da VAL: <b>\{methodLabels\[methodology\.current\]\}<\/b>/)
 assert.match(panel,/className="val-sequence-tabs" role="tablist" aria-label="Abrir etapas da sequência consultiva"/)
 assert.match(panel,/role="tab" aria-label=\{`Abrir etapa \$\{methodLabels\[stage\]\|\|stage\}`\} aria-selected=\{activeSequenceStage===stage\} aria-controls="val-sequence-panel"/)
 assert.match(panel,/tabIndex=\{activeSequenceStage===stage\?0:-1\}/)
 assert.match(panel,/onClick=\{\(\)=>openSequenceStage\(stage\)\}/)
 assert.match(panel,/onKeyDown=\{event=>moveSequenceFocus\(event,stage\)\}/)
 assert.match(panel,/const moveSequenceFocus=[\s\S]*?\['ArrowLeft','ArrowRight','Home','End'\]/)
 assert.match(panel,/id="val-sequence-panel" role="tabpanel" aria-labelledby=\{`val-sequence-tab-\$\{activeSequenceStage\}`\} tabIndex="0"/)
 assert.match(panel,/className="val-sequence-status" aria-live="polite"/)
 assert.match(panel,/const openSequenceStage=stage=>setSequenceControl/)
 assert.match(panel,/const workSequenceStage=stage=>setSequenceControl/)
 assert.match(panel,/const followValSequence=\(\)=>setSequenceControl/)
 assert.match(panel,/>Trabalhar nesta etapa<\/button>/)
 assert.match(panel,/>Voltar à sugestão da VAL<\/button>/)
 assert.match(panel,/className="val-working-stage-banner" aria-live="polite"/)
 assert.match(panel,/>Usar sugestão da VAL<\/button>/)
 assert.match(panel,/\.\.\.\(workingSequenceStage\?\{requestedStage:workingSequenceStage\}:\{\}\)/)
 assert.match(server,/requestedStage:clean\(payload\.requestedStage\)/)
 assert.match(panel,/onClick=\{\(\)=>browseSequence\(-1\)\} disabled=\{activeSequenceIndex<=0\}><ChevronLeft\/>Anterior<\/button>/)
 assert.match(panel,/onClick=\{\(\)=>browseSequence\(1\)\} disabled=\{activeSequenceIndex<0\|\|activeSequenceIndex>=methodology\.sequence\.length-1\}>Próxima<ChevronRight\/><\/button>/)
 assert.match(styles,/\.val-sequence-status\{/)
 assert.match(styles,/\.val-sequence-actions\{/)
 assert.match(styles,/\.val-working-stage-banner\{/)
 assert.match(styles,/\.is-working/)
})
