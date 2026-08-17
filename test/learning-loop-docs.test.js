import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const engine=read('docs/VAL_ENGINE.md')
const loop=read('docs/VAL_LEARNING_LOOP.md')
const server=read('server.js')
const plain=value=>String(value).replace(/[`*_]/g,'')
const plainLoop=plain(loop)

test('documentação liga feedback, snapshot e resultados posteriores',()=>{
 assert.match(engine,/VAL_LEARNING_LOOP\.md/)
 assert.match(loop,/POST \/api\/val\/feedback/)
 assert.match(loop,/val\.feedback\.recorded/)
 assert.match(loop,/recommendationId/)
 assert.match(loop,/business\.updated/)
 assert.match(loop,/business\.closed/)
 assert.match(loop,/business\.lost/)
 assert.match(plainLoop,/mudança confirmada de methodology_state/)
})

test('loop distingue reação, execução, progresso e resultado',()=>{
 for(const value of ['accepted','edited','rejected','scheduled','executed','won','lost'])assert.match(loop,new RegExp('`'+value+'`'))
 assert.match(loop,/Um `accepted` não deve ser convertido em `won`/)
 assert.match(plainLoop,/sem rótulo, não rejeitada/)
 assert.match(server,/const feedbackOutcomes=\{used:'executed',adapted:'edited',scheduled:'scheduled',discarded:'rejected',accepted:'accepted',edited:'edited',rejected:'rejected',executed:'executed',won:'won',lost:'lost'\}/)
})

test('métricas obrigatórias ficam explícitas e não tratam score como probabilidade',()=>{
 assert.match(loop,/taxa de aceite/)
 assert.match(loop,/taxa de edição/)
 assert.match(loop,/taxa de rejeição/)
 assert.match(loop,/Top-1 progress rate/)
 assert.match(loop,/Precision@K/)
 assert.match(loop,/NDCG@K/)
 assert.match(loop,/Conversion Score atual ordena trabalho; ele não é probabilidade/)
 assert.match(loop,/numerador, denominador, período, versão do motor e tamanho da amostra/)
})

test('ranker permanece offline, auditável, seguro e reversível',()=>{
 assert.match(loop,/shadow mode/)
 assert.match(loop,/plano de rollback/)
 assert.match(loop,/não pode[\s\S]*liberar revisão técnica/)
 assert.match(loop,/não usar como alavanca ou feature de persuasão/i)
 assert.match(loop,/atributo sensível/)
 assert.match(loop,/medo, vergonha, culpa/)
 assert.match(loop,/notas livres não entram no treino por padrão/)
})

test('thresholds, retenção e janela de atribuição permanecem decisões pendentes',()=>{
 assert.match(loop,/período de retenção do dataset/)
 assert.match(loop,/amostra mínima/)
 assert.match(loop,/janela de atribuição de conversão/)
 assert.match(loop,/valor de K/)
 assert.match(loop,/threshold de ganho/)
 assert.match(loop,/exigem decisão conjunta de Produto, Comercial, Segurança, Jurídico\/LGPD e responsável técnico/)
})
