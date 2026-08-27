import assert from 'node:assert/strict'
import test from 'node:test'
import {
 VAL_NATURAL_COMMAND_POLICY,
 localNaturalCommandTurn,
 naturalCommandRequest,
 readValOutputMode,
 resolveValNaturalCommand,
 writeValOutputMode
} from '../src/lib/val-natural-commands.js'

const payload={advice:{answer:'Leitura curta.',ai_reasoning:{recommended_strategy:{reading:'A margem é o ponto central.',action:'Confirmar o custo por hectare.'},golden_questions:[{question:'Qual área entra?'},{question:'Qual referência de preço?'},{question:'Quem decide?'},{question:'Excedente'}]}}}

test('comandos naturais reconhecem as formas autorizadas sem reiniciar contexto',()=>{
 const expected=new Map([
  ['Resume.','SUMMARIZE'],['Repete.','REPEAT'],['Explica melhor.','EXPLAIN'],['Só as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],['Só me manda as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],
  ['Agora por escrito.','OUTPUT_TEXT'],['Agora fala comigo.','OUTPUT_AUDIO'],['Agora fala elas pra mim.','OUTPUT_AUDIO'],['Me mostra os números.','SHOW_NUMBERS'],
  ['Por que você acha isso?','EXPLAIN_WHY'],['Registra.','OPEN_REGISTER'],['Não registra.','KEEP_SESSION_ONLY'],
  ['Aprofunda.','DEEPEN'],['Só o essencial.','SET_SIMPLE']
 ])
 for(const [phrase,action] of expected)assert.equal(resolveValNaturalCommand(phrase)?.action,action,phrase)
 assert.deepEqual(VAL_NATURAL_COMMAND_POLICY,{version:'val.natural_commands.v1',persistence:'NONE',keeps_thread:true,changes_confirmed_memory:false})
})

test('comandos locais reutilizam a resposta atual e limitam Perguntas de Ouro a três',()=>{
 assert.match(localNaturalCommandTurn(resolveValNaturalCommand('Resume'),payload).text,/A margem é o ponto central/)
 const questions=localNaturalCommandTurn(resolveValNaturalCommand('Só as Perguntas de Ouro'),payload).text
 assert.match(questions,/1\. Qual área entra/)
 assert.match(questions,/3\. Quem decide/)
 assert.doesNotMatch(questions,/Excedente/)
 assert.equal(localNaturalCommandTurn(resolveValNaturalCommand('Repete'),payload).payload,payload)
})

test('aprofundar, explicar, números e por quê geram follow-up explícito sem mudar memória',()=>{
 for(const phrase of ['Aprofunda','Explica melhor','Me mostra os números','Por que']){
  const command=resolveValNaturalCommand(phrase)
  assert.equal(command.local,false)
  assert.equal(command.persistence,'NONE')
  assert.ok(naturalCommandRequest(command,phrase).length>20)
 }
})

test('preferência texto/áudio/ambos é escopada e persiste sem contaminar outro login',()=>{
 const values=new Map()
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}
 assert.equal(writeValOutputMode('tenant-a:owner-a','both',storage),'both')
 assert.equal(readValOutputMode('tenant-a:owner-a',storage),'both')
 assert.equal(readValOutputMode('tenant-b:owner-b',storage),'text')
 assert.equal(writeValOutputMode('tenant-a:owner-a','inválido',storage),'text')
})
