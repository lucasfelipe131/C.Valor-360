import assert from 'node:assert/strict'
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
