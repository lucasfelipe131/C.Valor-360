from pathlib import Path

path=Path('server/val-engine.js')
source=path.read_text()
old="import {buildTechnicalSafetyAudit,emitTechnicalSafetyAudit,technicalSafetyReason} from './technical-safety-audit.js'\n"
new="""import {buildTechnicalSafetyAudit,emitTechnicalSafetyAudit,technicalSafetyReason} from './technical-safety-audit.js'
import {buildOpenAIRetryPolicy} from './openai-retry.js'
"""
if source.count(old)!=1: raise RuntimeError('A6: import técnico não encontrado')
source=source.replace(old,new,1)
old="""  constructor({runtimeConfig,repository,logger=console,clock=()=>new Date()}){
    this.config=runtimeConfig;this.repository=repository;this.logger=logger;this.clock=clock
    this.client=runtimeConfig.openaiApiKey?new OpenAI({apiKey:runtimeConfig.openaiApiKey,project:runtimeConfig.openaiProject||undefined,timeout:runtimeConfig.openaiTimeoutMs,maxRetries:runtimeConfig.openaiMaxRetries}):null
  }
"""
new="""  constructor({runtimeConfig,repository,logger=console,clock=()=>new Date()}){
    this.config=runtimeConfig;this.repository=repository;this.logger=logger;this.clock=clock
    this.openaiRetryPolicy=buildOpenAIRetryPolicy(runtimeConfig.openaiMaxRetries)
    this.client=runtimeConfig.openaiApiKey?new OpenAI({apiKey:runtimeConfig.openaiApiKey,project:runtimeConfig.openaiProject||undefined,timeout:runtimeConfig.openaiTimeoutMs,maxRetries:this.openaiRetryPolicy.maxRetries}):null
  }
"""
if source.count(old)!=1: raise RuntimeError('A6: construtor não encontrado')
source=source.replace(old,new,1)
old="""        },{
          maxRetries:0,
          timeout:Math.min(Math.max(Number(this.config.openaiTimeoutMs)||100_000,1_000),100_000),
"""
new="""        },{
          maxRetries:this.openaiRetryPolicy.maxRetries,
          timeout:Math.min(Math.max(Number(this.config.openaiTimeoutMs)||100_000,1_000),100_000),
"""
if source.count(old)!=1: raise RuntimeError('A6: maxRetries fixo não encontrado')
source=source.replace(old,new,1)
old="""        const providerMetadata={responseId:response.id,requestId:response._request_id||null,latencyMs:Date.now()-startedAt,inputTokens:response.usage?.input_tokens||null,outputTokens:response.usage?.output_tokens||null,status:response.status}
"""
new="""        const providerMetadata={responseId:response.id,requestId:response._request_id||null,latencyMs:Date.now()-startedAt,inputTokens:response.usage?.input_tokens||null,outputTokens:response.usage?.output_tokens||null,status:response.status,retryPolicy:this.openaiRetryPolicy}
"""
if source.count(old)!=1: raise RuntimeError('A6: providerMetadata não encontrado')
source=source.replace(old,new,1)
old="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',...responseMetadata,routing:routeAudit,technicalSafety:technicalSafetyAudit}
"""
new="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',retryPolicy:this.openaiRetryPolicy,...responseMetadata,routing:routeAudit,technicalSafety:technicalSafetyAudit}
"""
if source.count(old)!=1: raise RuntimeError('A6: modelRun não encontrado')
source=source.replace(old,new,1)
path.write_text(source)

path=Path('docs/VAL_ENGINE.md')
docs=path.read_text()
marker='## Reconciliação da revisão humana\n'
section='''## Política de retries da OpenAI\n\n`OPENAI_MAX_RETRIES` é normalizado para um inteiro não negativo e usado tanto no cliente quanto na chamada `responses.create`. O valor padrão continua sendo 1, ou seja, no máximo duas tentativas no total. `0` desativa novas tentativas; valores maiores respeitam a configuração explícita do ambiente.\n\nO SDK oficial aplica backoff exponencial aos erros recuperáveis de conexão, timeout, HTTP 408, 409, 429 e 5xx. Erros de validação, autenticação e cancelamentos pelo `AbortSignal` não devem ser repetidos. A aplicação não cria um segundo loop de retry, evitando multiplicar tentativas entre duas camadas.\n\nA política efetiva fica registrada em `modelRun.retryPolicy` e em `providerMetadata.retryPolicy`, com `maxRetries`, total máximo de tentativas e o tipo de backoff. Ela não contém mensagem, resposta ou dados do produtor.\n\n'''
if docs.count(marker)!=1: raise RuntimeError('A6: marcador de revisão humana não encontrado')
path.write_text(docs.replace(marker,section+marker,1))

Path('test/openai-retry.test.js').write_text("""import assert from 'node:assert/strict'\nimport {readFileSync} from 'node:fs'\nimport test from 'node:test'\nimport {buildOpenAIRetryPolicy,normalizeOpenAIMaxRetries} from '../server/openai-retry.js'\n\ntest('maxRetries respeita a configuração como inteiro não negativo',()=>{\n assert.equal(normalizeOpenAIMaxRetries(0),0)\n assert.equal(normalizeOpenAIMaxRetries('1'),1)\n assert.equal(normalizeOpenAIMaxRetries(2.9),2)\n assert.equal(normalizeOpenAIMaxRetries(-3),0)\n assert.equal(normalizeOpenAIMaxRetries('inválido',1),1)\n})\n\ntest('política explicita tentativas e backoff sem inventar conteúdo de negócio',()=>{\n assert.deepEqual(buildOpenAIRetryPolicy(2),{maxRetries:2,maxAttempts:3,backoff:'openai-sdk-exponential',retryable:'connection, timeout, 408, 409, 429 e 5xx',cancelledRequestsRetry:false})\n assert.equal(buildOpenAIRetryPolicy(0).maxAttempts,1)\n assert.doesNotMatch(JSON.stringify(buildOpenAIRetryPolicy(1)),/produtor|cliente|mensagem|resposta/i)\n})\n\ntest('engine remove o zero fixo e usa a política configurada na chamada e no modelRun',()=>{\n const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')\n assert.match(engine,/this\.openaiRetryPolicy=buildOpenAIRetryPolicy\(runtimeConfig\.openaiMaxRetries\)/)\n assert.match(engine,/maxRetries:this\.openaiRetryPolicy\.maxRetries/)\n assert.doesNotMatch(engine,/maxRetries:0/)\n assert.match(engine,/retryPolicy:this\.openaiRetryPolicy/)\n})\n\ntest('documentação mantém o padrão de uma repetição e descreve cancelamento sem retry',()=>{\n const docs=readFileSync(new URL('../docs/VAL_ENGINE.md',import.meta.url),'utf8')\n assert.match(docs,/OPENAI_MAX_RETRIES/)\n assert.match(docs,/valor padrão continua sendo 1/)\n assert.match(docs,/backoff exponencial/)\n assert.match(docs,/cancelamentos pelo `AbortSignal` não devem ser repetidos/)\n})\n""")

Path('scripts/apply-a6.py').unlink(missing_ok=True)
Path('.github/workflows/apply-a6.yml').unlink(missing_ok=True)
print('A6 aplicado com sucesso.')
