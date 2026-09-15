import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {readConversationWorkspace,writeConversationWorkspace} from '../src/lib/full-screen-conversation.js'

const copiloto=readFileSync(new URL('../src/components/GlobalValCopilot.jsx',import.meta.url),'utf8')

const memoria=()=>{
 const dados={}
 Object.defineProperties(dados,{
  getItem:{value:key=>dados[key]??null},
  setItem:{value:(key,value)=>{dados[key]=String(value)}},
  removeItem:{value:key=>{delete dados[key]}}
 })
 return dados
}

test('a falha da analise deixa marca no fio, nao so na faixa que some', () => {
 // A pergunta NÃO se perdia (a bolha do usuário é anexada antes do fetch e sobrevive a recarregar)
 // e havia faixa de erro imediata. O que faltava era a marca DURAR: a faixa some na pergunta
 // seguinte e o fio ficava com a pergunta sem resposta e sem nada dizendo que falhou — o
 // consultor não sabe se a VAL não respondeu ou se ele nunca enviou.
 const branco=copiloto.replace(/\s+/g,' ')
 // O ramo das políticas de serviço (404/409/422) é casado por texto-fonte literal em
 // test/val-audit-round3-contracts-v1.test.js: o ramo novo entra AO LADO, sem reescrevê-lo.
 assert.match(branco,/\[404,409,422\]\.includes\(Number\(requestError\.status\|\|0\)\)\)append\(\{role:'system',command:serviceCode/)
 assert.match(branco,/else append\(\{role:'system',command:'val_request_failed'/)
 assert.match(branco,/continua registrada nesta conversa/)
})

test('a marca de falha sobrevive ao recarregamento da aba', () => {
 const storage=memoria()
 const chave='thread:joao-pereira'
 const fio={
  [chave]:[
   {role:'user',text:'Quero um plano de abordagem para a próxima visita ao João Pereira sobre potássio.',at:'2026-09-15T12:00:00.000Z'},
   {role:'system',command:'val_request_failed',text:'Limite temporário de análises atingido. Aguarde alguns minutos. A pergunta acima continua registrada nesta conversa; envie de novo quando quiser.',persistence:'NONE',at:'2026-09-15T12:00:01.000Z'}
  ]
 }
 writeConversationWorkspace(storage,'escopo',{threads:fio,metadata:{[chave]:{clientId:'joao-pereira',updatedAt:'2026-09-15T12:00:01.000Z'}}})
 const relido=readConversationWorkspace(storage,'escopo')
 const turnos=relido.threads[chave]||[]
 assert.ok(turnos.some(turno=>turno.role==='user'&&/potássio/.test(turno.text)),'a pergunta continua no fio')
 const falha=turnos.find(turno=>turno.command==='val_request_failed')
 assert.ok(falha,'a marca de falha precisa sobreviver ao recarregamento')
 assert.match(falha.text,/Limite temporário de análises atingido/)
 assert.match(falha.text,/continua registrada nesta conversa/)
})
