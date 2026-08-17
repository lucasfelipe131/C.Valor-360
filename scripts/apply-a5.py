from pathlib import Path

path=Path('server/val-engine.js')
source=path.read_text()

old="import {buildValueBridge,isCommercialProductComparison} from './product-intelligence.js'\n"
new="""import {buildValueBridge,isCommercialProductComparison} from './product-intelligence.js'
import {buildTechnicalSafetyAudit,emitTechnicalSafetyAudit,technicalSafetyReason} from './technical-safety-audit.js'
"""
if source.count(old)!=1:
    raise RuntimeError('A5: import de product-intelligence não encontrado')
source=source.replace(old,new,1)

marker="export function enforceValSafety(advice,context,message='',options={}){\n"
helper="""function applyHumanReviewDecision(result,audit,{signalRequiresReview=false,productRequiresReview=false,providerHumanReview=null}={}){
  const providerReason=String(providerHumanReview?.reason||'').trim()
  const reason=technicalSafetyReason(audit,{signalRequiresReview,productRequiresReview,providerReason})
  if(audit.manualReviewRequired){
    result.human_review={required:true,reason,required_role:audit.reviewRole,status:'pending'}
    if(audit.technicalReviewRequired){
      result.blocked_actions=[...new Set([...(result.blocked_actions||[]),'Converter sinal técnico em diagnóstico','Prescrever produto, dose, mistura ou aplicação sem validação técnica',...(productRequiresReview?['Tratar similaridade cadastral como equivalência de uso','Prometer superioridade, resultado ou economia sem comparação válida']:[]),...(audit.divergence?['Executar ou apresentar conteúdo técnico antes de revisar a divergência entre as barreiras']:[])])]
      result.guardrails=[...new Set([...(result.guardrails||[]),'Usar sinais técnicos somente para priorizar perguntas, visitas e validações; nunca como prescrição.',...(productRequiresReview?['Conferir registro, cultura, alvo, modalidade, formulação, concentração, restrições e fonte vigente antes de apresentar a opção como adequada.']:[]),...(audit.divergence?['Tratar a divergência de revisão como bloqueio manual; o modelo e a regex não podem liberar um ao outro.']:[])])]
    }
    if(audit.divergence)result.assumptions=[...new Set([...(result.assumptions||[]),'A necessidade de revisão humana apresentou divergência entre a barreira determinística e o campo devolvido pelo modelo.'])]
  }else result.human_review={required:false,reason:'Nenhuma revisão humana adicional foi sinalizada para esta resposta.',required_role:'none',status:'not_required'}
  return result
}

"""
if source.count(marker)!=1:
    raise RuntimeError('A5: enforceValSafety não encontrado')
source=source.replace(marker,helper+marker,1)

old="""  const requestRequiresReview=!mayTranscribeAttachment&&((explicitAgronomyRequest.test(String(message))&&!comparisonRequest)||applicationRate.test(String(message)))
  const outputRequiresReview=!mayTranscribeAttachment&&(applicationRate.test(generatedContent)||actionableAgronomy.test(generatedAction+'\\n'+generatedContent))
  if(requestRequiresReview||outputRequiresReview){
    const shell=technicalReviewShell(effectiveContext,message,signalRequiresReview||productRequiresReview)
    shell.methodology_state=applyWorkingStage(shell.methodology_state,normalizeValMethodStage(options.requestedStage))
    return shell
  }
"""
new="""  const requestRequiresReview=!mayTranscribeAttachment&&((explicitAgronomyRequest.test(String(message))&&!comparisonRequest)||applicationRate.test(String(message)))
  const outputRequiresReview=!mayTranscribeAttachment&&(applicationRate.test(generatedContent)||actionableAgronomy.test(generatedAction+'\\n'+generatedContent))
  const providerHumanReview=options.providerHumanReview&&typeof options.providerHumanReview==='object'?structuredClone(options.providerHumanReview):null
  const technicalSafetyAudit=buildTechnicalSafetyAudit({requestRequiresReview,outputRequiresReview,signalRequiresReview,productRequiresReview,providerHumanReview,at:options.at||new Date()})
  try{options.onSafetyAudit?.(technicalSafetyAudit)}catch{}
  if(technicalSafetyAudit.hardBlockRequired){
    const shell=technicalReviewShell(effectiveContext,message,signalRequiresReview||productRequiresReview)
    shell.methodology_state=applyWorkingStage(shell.methodology_state,normalizeValMethodStage(options.requestedStage))
    return applyHumanReviewDecision(shell,technicalSafetyAudit,{signalRequiresReview,productRequiresReview,providerHumanReview})
  }
"""
if source.count(old)!=1:
    raise RuntimeError('A5: bloco request/output safety não encontrado')
source=source.replace(old,new,1)

old="""  if(signalRequiresReview||productRequiresReview){
    result.human_review={required:true,reason:productRequiresReview?'A VAL encontrou candidatas para comparação comercial. Similaridade cadastral não prova equivalência, adequação ou superioridade; valide fonte vigente e decisão técnica antes de recomendar ou executar.':'Há sinais técnicos no contexto que podem orientar a prioridade comercial, mas qualquer interpretação agronômica ou recomendação de execução continua sujeita ao responsável técnico.',required_role:'technical_reviewer',status:'pending'}
    result.blocked_actions=[...new Set([...(result.blocked_actions||[]),'Converter sinal técnico em diagnóstico','Prescrever produto, dose, mistura ou aplicação sem validação técnica',...(productRequiresReview?['Tratar similaridade cadastral como equivalência de uso','Prometer superioridade, resultado ou economia sem comparação válida']:[])])]
    result.guardrails=[...new Set([...(result.guardrails||[]),'Usar sinais técnicos somente para priorizar perguntas, visitas e validações; nunca como prescrição.',...(productRequiresReview?['Conferir registro, cultura, alvo, modalidade, formulação, concentração, restrições e fonte vigente antes de apresentar a opção como adequada.']:[])])]
  }else result.human_review={...(result.human_review||{}),required:false,required_role:'none',status:'not_required'}
  return result
}
"""
new="""  applyHumanReviewDecision(result,technicalSafetyAudit,{signalRequiresReview,productRequiresReview,providerHumanReview})
  return result
}
"""
if source.count(old)!=1:
    raise RuntimeError('A5: decisão final antiga de human_review não encontrada')
source=source.replace(old,new,1)

old="let advice,engineMode='demonstration',warning='',responseMetadata={}\n"
new="let advice,engineMode='demonstration',warning='',responseMetadata={},providerHumanReview=null\n"
if source.count(old)!=1:
    raise RuntimeError('A5: declaração da resposta não encontrada')
source=source.replace(old,new,1)

old="advice=JSON.parse(response.output_text);engineMode='openai';responseMetadata=providerMetadata\n"
new="advice=JSON.parse(response.output_text);providerHumanReview=structuredClone(advice.human_review||null);engineMode='openai';responseMetadata=providerMetadata\n"
if source.count(old)!=1:
    raise RuntimeError('A5: parse da resposta não encontrado')
source=source.replace(old,new,1)

old="""    advice=enforceValSafety(advice,context,message,{requestedStage:selectedWorkingStage,...(selectedWorkingStage?{methodologyBaseline:fallbackAdvice.methodology_state}:{})})
    let interpretedAttachments=selectedAttachments.map(compactAttachment)
"""
new="""    let technicalSafetyAudit=null
    advice=enforceValSafety(advice,context,message,{requestedStage:selectedWorkingStage,providerHumanReview,at:this.clock(),onSafetyAudit:audit=>{technicalSafetyAudit=audit},...(selectedWorkingStage?{methodologyBaseline:fallbackAdvice.methodology_state}:{})})
    if(technicalSafetyAudit?.divergence)emitTechnicalSafetyAudit(this.logger,technicalSafetyAudit,{subjectHash:createHash('sha256').update(`${tenantId}:${clientId}`).digest('hex')})
    let interpretedAttachments=selectedAttachments.map(compactAttachment)
"""
if source.count(old)!=1:
    raise RuntimeError('A5: chamada enforceValSafety não encontrada')
source=source.replace(old,new,1)

old="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',...responseMetadata,routing:routeAudit}
    const recommendationId=await this.repository.recordRecommendation({tenantId,ownerId,clientId,question:message,mode:route.tier,model:engineMode==='openai'?route.model:'rules-v4',context,advice,responseMetadata,promptHash:createHash('sha256').update(instructions).digest('hex'),modelRun})
    return {recommendationId,engineMode,route:route.tier,model:engineMode==='openai'?route.model:'rules-v4',warning,contextCoverage,attachments:interpretedAttachments,advice}
"""
new="""    const modelRun={model:this.client?route.model:'rules-v4',promptVersion:`${VAL_INSTRUCTIONS_VERSION}:${instructionBlocks.tier}`,promptPrefixHash,instructionTier:instructionBlocks.tier,status:engineMode==='openai'?'completed':this.client?'fallback':'demonstration',...responseMetadata,routing:routeAudit,technicalSafety:technicalSafetyAudit}
    const recommendationId=await this.repository.recordRecommendation({tenantId,ownerId,clientId,question:message,mode:route.tier,model:engineMode==='openai'?route.model:'rules-v4',context,advice,responseMetadata,promptHash:createHash('sha256').update(instructions).digest('hex'),modelRun})
    return {recommendationId,engineMode,route:route.tier,model:engineMode==='openai'?route.model:'rules-v4',warning,contextCoverage,attachments:interpretedAttachments,technicalSafety:technicalSafetyAudit,advice}
"""
if source.count(old)!=1:
    raise RuntimeError('A5: modelRun e retorno não encontrados')
source=source.replace(old,new,1)
path.write_text(source)

# Documentação
path=Path('docs/VAL_ENGINE.md')
docs=path.read_text()
marker='## Fonte única da sequência metodológica\n'
section='''## Reconciliação da revisão humana\n\nA barreira técnica usa dois sinais independentes: as regras determinísticas sobre solicitação, saída, sinais de contexto e comparação de produtos; e o campo `human_review` devolvido pelo modelo estruturado. Um sinal não pode liberar o outro.\n\n`buildTechnicalSafetyAudit()` classifica cada resposta como alinhada, sem provedor, sobrescrita pela barreira determinística, revisão pedida somente pelo modelo ou contrato inconsistente. O caminho final é sempre o mais restritivo:\n\n- pedido ou saída acionável detectados pelas regras: a orientação técnica é descartada e entra o pacote seguro de revisão;\n- regras exigem revisão, mas o modelo não: a revisão continua obrigatória e a divergência é registrada;\n- modelo pede revisão técnica que as regras não detectam: a orientação é retida para revisão manual;\n- modelo pede revisão gerencial ou do consultor, sem sinal técnico: essa revisão é preservada, em vez de ser sobrescrita como `required:false`;\n- campos contraditórios, como `required:true` com papel `none`: revisão manual obrigatória.\n\nA auditoria não contém a pergunta nem a resposta. Ela registra apenas versão, horário, fontes booleanas, papel, status e divergência. O evento `val.technical_review_divergence` usa um identificador hash da conta; a mesma auditoria é persistida em `modelRun.technicalSafety` e devolvida no topo da API para observabilidade. A justificativa visível permanece em `human_review.reason`.\n\nO schema enviado ao modelo não mudou. A reconciliação acontece depois do Structured Output e antes da persistência, portanto `additionalProperties:false` e todos os campos obrigatórios continuam intactos.\n\n'''
if docs.count(marker)!=1:
    raise RuntimeError('A5: marcador da metodologia não encontrado')
path.write_text(docs.replace(marker,section+marker,1))

Path('test/technical-safety-audit.test.js').write_text(r'''import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildFallbackAdvice} from '../server/sales-playbook.js'
import {enforceValSafety} from '../server/val-engine.js'
import {buildTechnicalSafetyAudit,emitTechnicalSafetyAudit,normalizeProviderHumanReview} from '../server/technical-safety-audit.js'

const baseContext={client:{id:'p1',name:'Produtor Teste',commercial:{}},profile:{answers:{}},opportunities:[],businessHistory:[],visits:[],interactions:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[],attachments:[],currentAttachments:[]}
const fallback=message=>buildFallbackAdvice({...baseContext,message,mode:'daily'})

test('auditoria cobre os quatro quadrantes e campos contraditórios do modelo',()=>{
 const clear=buildTechnicalSafetyAudit({providerHumanReview:{required:false,reason:'Sem revisão.',required_role:'none'}})
 assert.equal(clear.status,'aligned_clear');assert.equal(clear.manualReviewRequired,false)

 const aligned=buildTechnicalSafetyAudit({requestRequiresReview:true,providerHumanReview:{required:true,reason:'Revisão técnica.',required_role:'technical_reviewer'}})
 assert.equal(aligned.status,'aligned_review');assert.equal(aligned.hardBlockRequired,true)

 const deterministic=buildTechnicalSafetyAudit({outputRequiresReview:true,providerHumanReview:{required:false,reason:'Sem revisão.',required_role:'none'}})
 assert.equal(deterministic.status,'deterministic_override');assert.equal(deterministic.divergence,true);assert.equal(deterministic.reviewRole,'technical_reviewer')

 const provider=buildTechnicalSafetyAudit({providerHumanReview:{required:true,reason:'Conteúdo agronômico requer revisão.',required_role:'technical_reviewer'}})
 assert.equal(provider.status,'provider_only_review');assert.equal(provider.hardBlockRequired,true)

 const mismatch=buildTechnicalSafetyAudit({providerHumanReview:{required:true,reason:'Revisar antes do uso.',required_role:'none'}})
 assert.equal(mismatch.status,'provider_contract_mismatch');assert.equal(mismatch.manualReviewRequired,true);assert.equal(mismatch.reviewRole,'manager')
})

test('barreira determinística bloqueia pedido técnico mesmo quando o modelo diz que não precisa revisar',()=>{
 let audit=null
 const advice=fallback('Qual dose devo aplicar no milho?')
 const result=enforceValSafety(advice,baseContext,'Qual dose devo aplicar no milho?',{
  providerHumanReview:{required:false,reason:'Sem revisão.',required_role:'none'},
  onSafetyAudit:value=>{audit=value},
  at:new Date('2026-08-17T03:00:00.000Z')
 })
 assert.equal(audit.status,'deterministic_override')
 assert.equal(result.human_review.required,true)
 assert.equal(result.human_review.required_role,'technical_reviewer')
 assert.match(result.human_review.reason,/divergência foi encaminhada/)
 assert.match(result.answer,/reteve qualquer orientação técnica acionável/)
 assert.ok(result.blocked_actions.some(item=>/divergência/.test(item)))
})

test('revisão técnica pedida somente pelo modelo também retém a orientação',()=>{
 let audit=null
 const advice=fallback('Prepare uma visita comercial.')
 const result=enforceValSafety(advice,baseContext,'Prepare uma visita comercial.',{
  providerHumanReview:{required:true,reason:'A interpretação agronômica precisa de revisão.',required_role:'technical_reviewer'},
  onSafetyAudit:value=>{audit=value}
 })
 assert.equal(audit.status,'provider_only_review')
 assert.equal(result.human_review.required,true)
 assert.match(result.human_review.reason,/orientação foi retida/)
 assert.match(result.answer,/reteve qualquer orientação técnica acionável/)
})

test('revisão não técnica do modelo é preservada sem falso bloqueio agronômico',()=>{
 let audit=null
 const advice=fallback('Prepare a reunião com a diretoria.')
 const result=enforceValSafety(advice,baseContext,'Prepare a reunião com a diretoria.',{
  providerHumanReview:{required:true,reason:'O gestor precisa revisar a condição comercial.',required_role:'manager'},
  onSafetyAudit:value=>{audit=value}
 })
 assert.equal(audit.status,'aligned_clear')
 assert.equal(audit.technicalReviewRequired,false)
 assert.equal(result.human_review.required,true)
 assert.equal(result.human_review.required_role,'manager')
 assert.match(result.human_review.reason,/gestor precisa revisar/)
 assert.doesNotMatch(result.answer,/reteve qualquer orientação técnica acionável/)
})

test('sem provedor, a barreira continua funcionando sem criar divergência artificial',()=>{
 const audit=buildTechnicalSafetyAudit({signalRequiresReview:true,providerHumanReview:null})
 assert.equal(audit.status,'deterministic_without_provider')
 assert.equal(audit.divergence,false)
 assert.equal(audit.technicalReviewRequired,true)
 assert.equal(normalizeProviderHumanReview(null).observed,false)
})

test('evento de divergência é estruturado e não contém pergunta ou resposta',()=>{
 const events=[]
 const audit=buildTechnicalSafetyAudit({requestRequiresReview:true,providerHumanReview:{required:false,reason:'Sem revisão.',required_role:'none'},at:new Date('2026-08-17T03:00:00.000Z')})
 const event=emitTechnicalSafetyAudit({warn:value=>events.push(value)},audit,{subjectHash:'abc123'})
 assert.equal(event.event,'val.technical_review_divergence')
 assert.equal(event.subjectHash,'abc123')
 assert.deepEqual(events,[event])
 assert.doesNotMatch(JSON.stringify(event),/dose devo|Produtor Teste/)
 assert.doesNotThrow(()=>emitTechnicalSafetyAudit({warn:()=>{throw new Error('logger fora')}},audit))
})

test('engine persiste e devolve a auditoria técnica sem alterar o schema do modelo',()=>{
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 const playbook=readFileSync(new URL('../server/sales-playbook.js',import.meta.url),'utf8')
 assert.match(engine,/providerHumanReview=structuredClone\(advice\.human_review\|\|null\)/)
 assert.match(engine,/technicalSafety:technicalSafetyAudit/)
 assert.match(engine,/emitTechnicalSafetyAudit/)
 assert.match(playbook,/human_review:\{type:'object',additionalProperties:false/)
})
''')

Path('scripts/apply-a5.py').unlink(missing_ok=True)
Path('.github/workflows/apply-a5.yml').unlink(missing_ok=True)
print('A5 aplicado com sucesso.')
