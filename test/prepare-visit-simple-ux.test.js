import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {buildPrepareVisitPresentation} from '../src/lib/prepare-visit-presentation.js'
import {normalizeConsultantExperiencePreference} from '../src/lib/consultant-experience-preference.js'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const componentSource=read('../src/components/visit/PrepareVisitSimple.jsx')
const styles=read('../src/prepare-visit-simple.css')
const visitsSource=read('../src/pages/Visits.jsx')

const prepared={
 context_snapshot_ref:{id:'snapshot-1',version:'v1'},
 behavioral_profile:{profile:'ANALYTICAL'},
 decision_thesis:{decision_thesis_id:'thesis-1',thesis:'Construir valor antes de discutir preço.',rationale:['Pediu custo por hectare.'],risks:['Sócio ainda não participou.']},
 value_plan:{value_plan_id:'value-1',economic_case:{summary:'Comparar custo por hectare.'},proofs:['Histórico de resultado.']},
 action_plan:{action_plan_id:'action-1',priorities:Array.from({length:10},(_,index)=>({action_id:`a-${index}`,title:`Prioridade ${index+1}`,description:`Ação ${index+1}`,owner:{id:'actor-1'},due_at:'2026-08-30T12:00:00.000Z',success_criteria:'Confirmado'}))},
 preparation:{
  preparation_id:'prep-1',objective:'Construir valor para fertilizante antes de discutir preço.',why_now:'A decisão da próxima safra está próxima.',main_opportunity:{title:'Fertilizante da próxima safra.'},probable_objection:'Considerou o investimento alto.',objection_guidance:'Use custo por hectare antes de falar em desconto.',profile_approach:{guidance:'Responde melhor a números e comparativos.'},golden_questions:['O que pesa na decisão?','Qual resultado tornaria a mudança segura?','O sócio participa?','Pergunta excedente.'],commitment_target:'Decidir teste ou próxima conversa com o sócio.',proofs_to_take:['Custo por hectare.','Histórico de resultado.'],missing_information:['Participação do sócio.'],secondary_opportunities:[{description:'Manejo de buva.',guidance:'Não desvie.'}],val_thesis:'Construir valor.',priority_actions:[]
 }
}
const input={prepared,client:{name:'João Silva',municipality:'Palotina',commercial:{currentPurchases:100000,potential:250000}},visit:{id:'visit-1',clientId:'client-1',objective:'Fertilizante',lifecycleStatus:'PLANNED'}}

test('Prepare Visit Simple — SIMPLE entrega essencial em uma leitura e limita perguntas/prioridades',()=>{
 const model=buildPrepareVisitPresentation({...input,preference:'SIMPLE'})
 assert.equal(model.mode,'SIMPLE')
 assert.equal(model.essential.questions.length,3)
 assert.equal(model.analysis.priorities.length,3)
 assert.equal(model.essential.objective,prepared.preparation.objective)
 assert.equal(model.essential.commitment,prepared.preparation.commitment_target)
})

test('Prepare Visit Simple — SIMPLE, BALANCED e ANALYTICAL usam a mesma decisão',()=>{
 const models=['SIMPLE','BALANCED','ANALYTICAL'].map(preference=>buildPrepareVisitPresentation({...input,preference}))
 for(const model of models.slice(1)){
  assert.deepEqual(model.essential,models[0].essential)
  assert.deepEqual(model.analysis,models[0].analysis)
  assert.equal(model.analytical.thesis,models[0].analytical.thesis)
 }
 assert.deepEqual(models.map(model=>model.mode),['SIMPLE','BALANCED','ANALYTICAL'])
})

test('Prepare Visit Simple — preferência inválida volta ao SIMPLE e não entra nos contratos da engine',()=>{
 assert.equal(normalizeConsultantExperiencePreference('anything'),'SIMPLE')
 assert.doesNotMatch(visitsSource,/consultant_experience_preference|experiencePreference/)
 assert.match(componentSource,/writeConsultantExperiencePreference\(storageScope,value\)/)
})

test('Prepare Visit Simple — pouca informação fica curta e explícita',()=>{
 const model=buildPrepareVisitPresentation({prepared:{preparation:{objective:'Conhecer a prioridade.',missing_information:['Prioridade da safra.'],golden_questions:[]},action_plan:{}},client:{name:'Novo produtor'},visit:{}})
 assert.deepEqual(model.essential.attention,['Tenho pouco histórico deste produtor.'])
 assert.equal(model.essential.questions.length,0)
 assert.doesNotMatch(JSON.stringify(model.essential),/metodologia|motor|ContextSnapshot|JSON/i)
})

test('Prepare Visit Simple — SSR mantém essencial primeiro, voz e profundidade sob demanda',async()=>{
 const vite=await createServer({root:new URL('..',import.meta.url).pathname,logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:PrepareVisitSimple}=await vite.ssrLoadModule('/src/components/visit/PrepareVisitSimple.jsx')
  const html=renderToStaticMarkup(React.createElement(PrepareVisitSimple,{...input,storageScope:'tenant-a:actor-a'}))
  assert.match(html,/PREPARAÇÃO DA VISITA/)
  assert.match(html,/OBJETIVO/)
  assert.match(html,/PERGUNTE/)
  assert.match(html,/ESTRATÉGIA/)
  assert.match(html,/SAIA COM/)
  assert.match(html,/Falar com a VAL/)
  assert.match(html,/Estou saindo agora/)
  assert.match(html,/Resumo em 60 segundos/)
  assert.match(html,/Ver análise/)
  assert.match(html,/Ver números e evidências/)
  assert.ok(html.indexOf('OBJETIVO')<html.indexOf('Ver análise'))
 }finally{await vite.close()}
})

test('Prepare Visit Simple — mobile-first mantém uma coluna, toque e safe area',()=>{
 assert.match(styles,/@media\(max-width:760px\)/)
 assert.match(styles,/\.prepare-simple-actions\{grid-template-columns:1fr\}/)
 assert.match(styles,/max-height:94dvh/)
 assert.match(styles,/safe-area-inset-bottom/)
 assert.match(styles,/\.prepare-simple-actions>button\{min-height:52px\}/)
 assert.match(componentSource,/prepared\.decision_thesis|model\.analytical\.thesis/)
 assert.match(componentSource,/interactionType="PRE_VISIT"/)
})
