import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const editor=readFileSync(new URL('../src/components/ProducerProfileEditor.jsx',import.meta.url),'utf8')
const styles=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8')

test('formulário do produtor explicita reais, percentuais, hectares e dias sem mudar o contrato salvo',()=>{
 assert.match(editor,/FieldLabel unit="R\$">Compras — safra atual/)
 assert.match(editor,/FieldLabel unit="%">Share atual informado/)
 assert.match(editor,/FieldLabel unit="ha">Área cultivada/)
 assert.match(editor,/FieldLabel unit="dias \/ condição">Condição de pagamento preferida/)
 assert.match(editor,/FieldLabel unit="dias \/ período">Janela de decisão \/ compra/)
 assert.match(editor,/commercial:\{\.\.\.form\.commercial,openPotential\}/)
 for(const key of ['purchaseCurrentSeason','purchasePreviousSeason','potentialTotal','walletShare','targetShare','grossMarginPercent','creditLimit','creditUsed','paymentTerms','decisionWindow'])assert.match(editor,new RegExp(`nested\\('commercial','${key}'`),key)
})

test('exemplos orientam formato sem preencher nem impor respostas comerciais',()=>{
 for(const example of ['Ex.: 480 ha ou de 300 a 500 ha','Ex.: 125.000,00','Ex.: 40,0','Ex.: à vista, barter ou 30/60 dias','Ex.: em 15 dias, setembro ou pré-plantio'])assert.match(editor,new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),example)
 assert.match(editor,/placeholder="Ex.: 250\.000,00"/)
 assert.match(editor,/placeholder="Ex.: 12,5"/)
 assert.doesNotMatch(editor,/defaultValue=/)
})

test('sufixo percentual permanece responsivo, legível e somente visual',()=>{
 assert.match(editor,/producer-unit-input/)
 assert.match(editor,/<span aria-hidden="true">%<\/span>/)
 assert.match(editor,/min="0" max="100" step="0\.1"/)
 assert.match(styles,/\.producer-unit-input\{display:flex;align-items:center;min-height:42px/)
 assert.match(styles,/\.producer-unit-input>input\{min-width:0/)
 assert.match(styles,/font-variant-numeric:tabular-nums/)
})
