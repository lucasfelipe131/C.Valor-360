import assert from 'node:assert/strict'
import test from 'node:test'
import {
 VAL_NATURAL_COMMAND_POLICY,
 localNaturalCommandTurn,
 naturalCommandMatchesClient,
 naturalCommandNeedsSettledResponse,
 naturalCommandRequest,
 hasValOutputModePreference,
 readValOutputMode,
 resolveValNaturalCommand,
 writeValOutputMode
} from '../src/lib/val-natural-commands.js'

const payload={advice:{answer:'Leitura curta.',ai_reasoning:{recommended_strategy:{reading:'A margem é o ponto central.',action:'Confirmar o custo por hectare.'},golden_questions:[{question:'Qual área entra?'},{question:'Qual referência de preço?'},{question:'Quem decide?'},{question:'Excedente'}]}}}

test('comandos naturais reconhecem as formas autorizadas sem reiniciar contexto',()=>{
 const expected=new Map([
  ['Resume.','SUMMARIZE'],['Repete.','REPEAT'],['Explica melhor.','EXPLAIN'],['Só as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],['Só me manda as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],['Agora me manda só as três perguntas de ouro.','GOLDEN_QUESTIONS_ONLY'],
  ['Agora por escrito.','OUTPUT_TEXT'],['Agora fala comigo.','OUTPUT_AUDIO'],['Agora fala elas pra mim.','OUTPUT_AUDIO'],['Me mostra os números.','SHOW_NUMBERS'],
  ['Por que você acha isso?','EXPLAIN_WHY'],['Registra.','OPEN_REGISTER'],['Não registra.','KEEP_SESSION_ONLY'],
  ['Aprofunda.','DEEPEN'],['Só o essencial.','SET_SIMPLE']
 ])
 for(const [phrase,action] of expected)assert.equal(resolveValNaturalCommand(phrase)?.action,action,phrase)
 assert.equal(resolveValNaturalCommand('Resume isso em uma linha, mantendo o mesmo produtor.')?.action,'SUMMARIZE')
 assert.equal(resolveValNaturalCommand('Me manda isso escrito.')?.action,'OUTPUT_TEXT')
 assert.equal(resolveValNaturalCommand('Fala de novo.')?.action,'OUTPUT_AUDIO')
 assert.deepEqual(VAL_NATURAL_COMMAND_POLICY,{version:'val.natural_commands.v1',persistence:'NONE',keeps_thread:true,changes_confirmed_memory:false})
})

test('registro natural com conteúdo abre revisão e nunca confirma sozinho',()=>{
 const command=resolveValNaturalCommand('Registra que o filho dele participa da decisão.')
 assert.equal(command.action,'OPEN_REGISTER')
 assert.equal(command.persistence,'CONFIRM_REQUIRED')
 assert.equal(command.candidate,'o filho dele participa da decisão')
 assert.match(localNaturalCommandTurn(command,null).text,/Nada será registrado sem sua confirmação/)
})

test('comandos locais reutilizam a resposta atual e limitam Perguntas de Ouro a três',()=>{
 assert.match(localNaturalCommandTurn(resolveValNaturalCommand('Resume'),payload).text,/A margem é o ponto central/)
 const questions=localNaturalCommandTurn(resolveValNaturalCommand('Só as Perguntas de Ouro'),payload).text
 assert.match(questions,/1\. Qual área entra/)
 assert.match(questions,/3\. Quem decide/)
 assert.doesNotMatch(questions,/Excedente/)
 assert.equal(localNaturalCommandTurn(resolveValNaturalCommand('Repete'),payload).payload,payload)
 for(const phrase of ['Resume','Repete','Só as Perguntas de Ouro','Fala de novo'])assert.equal(naturalCommandNeedsSettledResponse(resolveValNaturalCommand(phrase)),true,phrase)
 for(const phrase of ['Agora por escrito','Texto e áudio','Só o essencial'])assert.equal(naturalCommandNeedsSettledResponse(resolveValNaturalCommand(phrase)),false,phrase)
})

test('resumo local do browser devolve uma linha sem repetir a resposta ou anexar próximo passo',()=>{
 const longPayload={advice:{ai_reasoning:{recommended_strategy:{reading:'Antônio prioriza nutrição nesta visita. O histórico também registra objeção de preço. A abertura deve validar o objetivo.',action:'Montar uma preparação completa.'}}}}
 const command=resolveValNaturalCommand('Resume sua resposta anterior em uma linha, mantendo Antônio como produtor atual e sem executar nova busca.')
 const turn=localNaturalCommandTurn(command,longPayload)
 assert.equal(turn.text,'Antônio prioriza nutrição nesta visita.')
 assert.doesNotMatch(turn.text,/objeção|Próximo passo|preparação completa/i)
 assert.equal(naturalCommandMatchesClient(command,{name:'Antônio Carlos'}),true)
 assert.equal(naturalCommandMatchesClient(command,{name:'Carlos Oliveira'}),false)
})

test('resumo local respeita o limite explícito de 500 caracteres',()=>{
 const longPayload={advice:{ai_reasoning:{recommended_strategy:{reading:'x'.repeat(900)}}}}
 const turn=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),longPayload)
 assert.equal(turn.text.length,500)
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
 assert.equal(hasValOutputModePreference('tenant-a:owner-a',storage),true)
 assert.equal(readValOutputMode('tenant-a:owner-a',storage),'both')
 assert.equal(hasValOutputModePreference('tenant-b:owner-b',storage),false)
 assert.equal(readValOutputMode('tenant-b:owner-b',storage),'text')
 assert.equal(writeValOutputMode('tenant-a:owner-a','inválido',storage),'text')
})
