from pathlib import Path

path=Path('server/val-engine.js')
source=path.read_text()
old="""const strategicPattern=/estrat[eé]g|plano de conta|risco alto|proposta complexa|diretoria|comit[eê]|milh[oõ]es|grande conta/i
const fastPattern=/classifi|extra[ií]|resum|import|normaliz|tag|categoria/i

export function selectValModel(message,mode,runtimeConfig){
  if(mode==='strategic'||strategicPattern.test(String(message)))return {model:runtimeConfig.modelStrategic,tier:'strategic',effort:'medium'}
  if(mode==='fast'||fastPattern.test(String(message)))return {model:runtimeConfig.modelFast,tier:'fast',effort:'low'}
  return {model:runtimeConfig.modelDaily,tier:'daily',effort:'medium'}
}
"""
new="""const strategicPattern=/estrat[eé]g|plano de conta|risco alto|proposta complexa|diretoria|comit[eê]|milh[oõ]es|grande conta/i
const fastPattern=/classifi|extra[ií]|resum|import|normaliz|tag|categoria/i

const routeResult=(runtimeConfig,{tier,effort,triggerId,triggerSource,triggerPattern,matchedText=''})=>({
  model:tier==='strategic'?runtimeConfig.modelStrategic:tier==='fast'?runtimeConfig.modelFast:runtimeConfig.modelDaily,
  tier,
  effort,
  triggerId,
  triggerSource,
  triggerPattern,
  matchedText:String(matchedText||'').slice(0,80)
})

export function selectValModel(message,mode='daily',runtimeConfig={}){
  const value=String(message||'')
  if(mode==='strategic')return routeResult(runtimeConfig,{tier:'strategic',effort:'medium',triggerId:'explicit_strategic_mode',triggerSource:'mode',triggerPattern:'mode=strategic'})
  if(mode==='fast')return routeResult(runtimeConfig,{tier:'fast',effort:'low',triggerId:'explicit_fast_mode',triggerSource:'mode',triggerPattern:'mode=fast'})
  const strategicMatch=value.match(strategicPattern)
  if(strategicMatch)return routeResult(runtimeConfig,{tier:'strategic',effort:'medium',triggerId:'strategic_message_pattern',triggerSource:'message',triggerPattern:strategicPattern.source,matchedText:strategicMatch[0]})
  const fastMatch=value.match(fastPattern)
  if(fastMatch)return routeResult(runtimeConfig,{tier:'fast',effort:'low',triggerId:'fast_message_pattern',triggerSource:'message',triggerPattern:fastPattern.source,matchedText:fastMatch[0]})
  return routeResult(runtimeConfig,{tier:'daily',effort:'medium',triggerId:'default_daily',triggerSource:'default',triggerPattern:'default'})
}

const isoTime=value=>{const date=value instanceof Date?value:new Date(value||Date.now());return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString()}
const messageAudit=value=>{const text=String(value||'');return {sha256:createHash('sha256').update(text).digest('hex'),characters:text.length,words:text.trim()?text.trim().split(/\\s+/).length:0}}

export function buildValRouteAudit({message='',mode='daily',route,at=new Date()}={}){
  if(!route?.tier||!route?.model)throw new Error('Rota da VAL incompleta para auditoria.')
  return {
    event:'val.model_route',
    at:isoTime(at),
    requestedMode:String(mode||'daily'),
    selected:{tier:route.tier,model:route.model,effort:route.effort},
    trigger:{id:route.triggerId,source:route.triggerSource,pattern:route.triggerPattern,matchedText:route.matchedText||''},
    message:messageAudit(message)
  }
}

export function emitValRouteAudit(logger,audit){
  try{
    if(typeof logger==='function')logger(audit)
    else if(typeof logger?.info==='function')logger.info(audit)
  }catch{}
  return audit
}
"""
if source.count(old)!=1:
    raise RuntimeError('A2: bloco selectValModel não encontrado de forma única')
source=source.replace(old,new,1)
old="""export class ValEngine{
  constructor({runtimeConfig,repository}){
    this.config=runtimeConfig;this.repository=repository
    this.client=runtimeConfig.openaiApiKey?new OpenAI({apiKey:runtimeConfig.openaiApiKey,project:runtimeConfig.openaiProject||undefined,timeout:runtimeConfig.openaiTimeoutMs,maxRetries:runtimeConfig.openaiMaxRetries}):null
  }
"""
new="""export class ValEngine{
  constructor({runtimeConfig,repository,logger=console,clock=()=>new Date()}){
    this.config=runtimeConfig;this.repository=repository;this.logger=logger;this.clock=clock
    this.client=runtimeConfig.openaiApiKey?new OpenAI({apiKey:runtimeConfig.openaiApiKey,project:runtimeConfig.openaiProject||undefined,timeout:runtimeConfig.openaiTimeoutMs,maxRetries:runtimeConfig.openaiMaxRetries}):null
  }
"""
if source.count(old)!=1:
    raise RuntimeError('A2: construtor da ValEngine não encontrado')
source=source.replace(old,new,1)
old="""    const contextCoverage=summarizeContextCoverage(context)
    const route=selectValModel(message,mode,this.config)
    const fallbackAdvice=buildFallbackAdvice({...context,message,mode:route.tier,requestedStage:selectedWorkingStage})
"""
new="""    const contextCoverage=summarizeContextCoverage(context)
    const route=selectValModel(message,mode,this.config)
    const routeAudit=emitValRouteAudit(this.logger,buildValRouteAudit({message,mode,route,at:this.clock()}))
    const fallbackAdvice=buildFallbackAdvice({...context,message,mode:route.tier,requestedStage:selectedWorkingStage})
"""
if source.count(old)!=1:
    raise RuntimeError('A2: ponto de seleção de rota não encontrado')
source=source.replace(old,new,1)
old="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',...responseMetadata}
"""
new="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',...responseMetadata,routing:routeAudit}
"""
if source.count(old)!=1:
    raise RuntimeError('A2: modelRun não encontrado')
source=source.replace(old,new,1)
path.write_text(source)

# Documentação
path=Path('docs/VAL_ENGINE.md')
docs=path.read_text()
marker='## Instruções modulares e cache de prompt\n'
section='''## Auditoria do roteamento de modelos\n\n`selectValModel()` devolve, além de modelo, tier e esforço, a regra que decidiu a rota. Os identificadores atuais distinguem modo explícito, padrão estratégico na mensagem, padrão rápido na mensagem e fallback diário. O texto genérico que acionou a regex, como “comitê” ou “classifique”, também fica registrado.\n\nCada decisão gera um evento estruturado `val.model_route` com:\n\n- tier, modelo e esforço escolhidos;\n- identificador, origem e expressão da regra;\n- termo genérico que casou com a regra;\n- hash SHA-256, tamanho e quantidade de palavras da mensagem.\n\nO log operacional não duplica o texto integral do produtor. A pergunta completa já pertence ao registro da recomendação; `modelRun.routing` guarda a mesma decisão de rota e o hash permite correlacionar os dois sem espalhar conteúdo comercial nos logs da infraestrutura. Não existe uma política nova de retenção nesta etapa: o evento segue a retenção já aplicada aos logs do ambiente e o registro persistido segue a recomendação.\n\nEssa estrutura permite avaliar falso positivo e falso negativo do roteador, comparar tier solicitado e tier escolhido e, no futuro, calcular uma matriz de acerto sem depender da memória de quem analisou o caso.\n\n'''
if docs.count(marker)!=1:
    raise RuntimeError('A2: marcador das instruções modulares não encontrado')
path.write_text(docs.replace(marker,section+marker,1))

Path('test/val-routing-audit.test.js').write_text("""import assert from 'node:assert/strict'\nimport {readFileSync} from 'node:fs'\nimport test from 'node:test'\nimport {buildValRouteAudit,emitValRouteAudit,selectValModel} from '../server/val-engine.js'\n\nconst models={modelDaily:'terra',modelStrategic:'sol',modelFast:'luna'}\n\ntest('roteador explica qual regra e qual padrão escolheram o modelo',()=>{\n const explicit=selectValModel('texto comum','strategic',models)\n assert.deepEqual({tier:explicit.tier,model:explicit.model,triggerId:explicit.triggerId,source:explicit.triggerSource},{tier:'strategic',model:'sol',triggerId:'explicit_strategic_mode',source:'mode'})\n\n const strategic=selectValModel('Prepare a conversa com o comitê da grande conta','daily',models)\n assert.equal(strategic.tier,'strategic')\n assert.equal(strategic.triggerId,'strategic_message_pattern')\n assert.match(strategic.triggerPattern,/comit/)\n assert.match(strategic.matchedText,/comitê/i)\n\n const fast=selectValModel('Classifique esta importação','daily',models)\n assert.equal(fast.tier,'fast')\n assert.equal(fast.model,'luna')\n assert.equal(fast.triggerId,'fast_message_pattern')\n assert.match(fast.matchedText,/classifi/i)\n\n const daily=selectValModel('Prepare a visita de amanhã','daily',models)\n assert.equal(daily.tier,'daily')\n assert.equal(daily.triggerId,'default_daily')\n})\n\ntest('auditoria é estruturada e não copia a mensagem integral para o log',()=>{\n const message='Produtor Exemplo quer discutir uma grande conta amanhã.'\n const route=selectValModel(message,'daily',models)\n const audit=buildValRouteAudit({message,mode:'daily',route,at:new Date('2026-08-17T01:00:00.000Z')})\n assert.equal(audit.event,'val.model_route')\n assert.equal(audit.at,'2026-08-17T01:00:00.000Z')\n assert.equal(audit.selected.tier,'strategic')\n assert.match(audit.message.sha256,/^[a-f0-9]{64}$/)\n assert.equal(audit.message.characters,message.length)\n assert.ok(audit.message.words>0)\n assert.doesNotMatch(JSON.stringify(audit),/Produtor Exemplo/)\n assert.match(audit.trigger.matchedText,/grande conta/i)\n})\n\ntest('logger pode ser injetado e falha de observabilidade não derruba a recomendação',()=>{\n const events=[]\n const audit=buildValRouteAudit({message:'resuma o cadastro',mode:'daily',route:selectValModel('resuma o cadastro','daily',models)})\n assert.equal(emitValRouteAudit({info:event=>events.push(event)},audit),audit)\n assert.deepEqual(events,[audit])\n assert.doesNotThrow(()=>emitValRouteAudit({info:()=>{throw new Error('logger fora')}} ,audit))\n})\n\ntest('modelRun persiste a mesma decisão de roteamento junto da recomendação',()=>{\n const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')\n assert.match(engine,/const routeAudit=emitValRouteAudit/)\n assert.match(engine,/routing:routeAudit/)\n assert.match(engine,/question:message/)\n})\n""")

Path('scripts/apply-a2.py').unlink(missing_ok=True)
Path('.github/workflows/apply-a2.yml').unlink(missing_ok=True)
print('A2 aplicado com sucesso.')
