import test from 'node:test'
import assert from 'node:assert/strict'
import {
 VAL_CONSULTATIVE_SEQUENCE,
 adjacentConsultativeStage,
 createSequenceControl,
 transitionSequenceControl
} from '../src/lib/val-sequence-control.js'

test('abrir uma etapa muda somente a etapa visível',()=>{
 const initial=createSequenceControl('descobrir')
 const opened=transitionSequenceControl(initial,{type:'open',stage:'propor',suggestedStage:'descobrir'})

 assert.deepEqual(initial,{openStage:'descobrir',workingStage:null})
 assert.deepEqual(opened,{openStage:'propor',workingStage:null})
})

test('trabalhar em uma etapa registra a escolha explícita do usuário',()=>{
 const initial=createSequenceControl('descobrir')
 const working=transitionSequenceControl(initial,{type:'work',stage:'dimensionar',suggestedStage:'descobrir'})

 assert.deepEqual(working,{openStage:'dimensionar',workingStage:'dimensionar'})
})

test('sincronizar uma nova sugestão não sobrescreve a etapa escolhida para trabalho',()=>{
 const initial=createSequenceControl('descobrir')
 const working=transitionSequenceControl(initial,{type:'work',stage:'dimensionar',suggestedStage:'descobrir'})
 const synced=transitionSequenceControl(working,{type:'sync-suggestion',suggestedStage:'construir_valor'})

 assert.deepEqual(synced,{openStage:'dimensionar',workingStage:'dimensionar'})
})

test('voltar à sugestão abre a etapa sugerida e remove a escolha de trabalho',()=>{
 const initial=createSequenceControl('descobrir')
 const working=transitionSequenceControl(initial,{type:'work',stage:'propor',suggestedStage:'descobrir'})
 const reset=transitionSequenceControl(working,{type:'follow-suggestion',suggestedStage:'alinhar'})

 assert.deepEqual(reset,{openStage:'alinhar',workingStage:null})
})

test('navegação adjacente respeita o início e o fim da sequência',()=>{
 const first=VAL_CONSULTATIVE_SEQUENCE[0]
 const last=VAL_CONSULTATIVE_SEQUENCE.at(-1)

 assert.equal(adjacentConsultativeStage(first,-1),first)
 assert.equal(adjacentConsultativeStage(last,1),last)
 assert.equal(adjacentConsultativeStage('descobrir',-1),'alinhar')
 assert.equal(adjacentConsultativeStage('descobrir',1),'dimensionar')
})
