import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildOpenAIRetryPolicy,normalizeOpenAIMaxRetries} from '../server/openai-retry.js'

test('maxRetries respeita a configuração como inteiro não negativo',()=>{
 assert.equal(normalizeOpenAIMaxRetries(0),0)
 assert.equal(normalizeOpenAIMaxRetries('1'),1)
 assert.equal(normalizeOpenAIMaxRetries(2.9),2)
 assert.equal(normalizeOpenAIMaxRetries(-3),0)
 assert.equal(normalizeOpenAIMaxRetries('inválido',1),1)
})

test('política explicita tentativas e backoff sem inventar conteúdo de negócio',()=>{
 assert.deepEqual(buildOpenAIRetryPolicy(2),{maxRetries:2,maxAttempts:3,backoff:'openai-sdk-exponential',retryable:'connection, timeout, 408, 409, 429 e 5xx',cancelledRequestsRetry:false})
 assert.equal(buildOpenAIRetryPolicy(0).maxAttempts,1)
 assert.doesNotMatch(JSON.stringify(buildOpenAIRetryPolicy(1)),/produtor|cliente|mensagem|resposta/i)
})

test('engine remove o zero fixo e usa a política configurada na chamada e no modelRun',()=>{
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 assert.match(engine,/this\.openaiRetryPolicy=buildOpenAIRetryPolicy\(runtimeConfig\.openaiMaxRetries\)/)
 assert.match(engine,/maxRetries:this\.openaiRetryPolicy\.maxRetries/)
 assert.doesNotMatch(engine,/maxRetries:0/)
 assert.match(engine,/retryPolicy:this\.openaiRetryPolicy/)
})

test('documentação mantém o padrão de uma repetição e descreve cancelamento sem retry',()=>{
 const docs=readFileSync(new URL('../docs/VAL_ENGINE.md',import.meta.url),'utf8')
 assert.match(docs,/OPENAI_MAX_RETRIES/)
 assert.match(docs,/valor padrão continua sendo 1/)
 assert.match(docs,/backoff exponencial/)
 assert.match(docs,/cancelamentos pelo `AbortSignal` não devem ser repetidos/)
})
