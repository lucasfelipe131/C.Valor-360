import test from 'node:test'
import assert from 'node:assert/strict'
import {advancePipelineItem,opportunityCacheKey,parseOpportunityCache,reconcilePipeline,resolveOpportunityCandidate} from '../src/lib/opportunity-pipeline.js'

const client=(id,{need=null,status='unknown',commercial={}}={})=>({id,name:`Cliente ${id}`,additionalNeed:need,additionalNeedStatus:status,commercial:{potential:0,potentialValidated:false,...commercial}})

test('pipeline inclui somente necessidade reportada ou oportunidade comercial independente',()=>{
 const clients=[
  client('unknown'),
  client('none',{need:'Não.',status:'none_declared',commercial:{opportunity:''}}),
  client('reported',{need:'Ampliar armazenagem',status:'reported',commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'}}}),
  client('commercial',{need:'Não',status:'none_declared',commercial:{opportunity:'Comparativos técnicos e condições',potential:96_000,potentialValidated:true}})
 ]
 const items=reconcilePipeline(clients,[])
 assert.deepEqual(items.map(item=>[item.clientId,item.title,item.stage]),[
  ['reported','Ampliar armazenagem','Diagnóstico'],
  ['commercial','Comparativos técnicos e condições','Diagnóstico']
 ])
 assert.equal(resolveOpportunityCandidate(clients[0]),null)
 assert.equal(resolveOpportunityCandidate(clients[1]),null)
})

test('cache nunca cria cliente, título, valor ou etapa sem evidência atual',()=>{
 const current=client('reported',{need:'Ampliar armazenagem',status:'reported',commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'}}})
 const [fresh]=reconcilePipeline([current],[])
 const [legacy]=reconcilePipeline([current],[{id:'qualquer',clientId:'reported',title:'Não.',value:999_999,stage:'Negociação'},{clientId:'outro',title:'Segredo',stage:'Fechado'}])
 assert.equal(legacy.id,'o-reported')
 assert.equal(legacy.title,'Ampliar armazenagem')
 assert.equal(legacy.value,0)
 assert.equal(legacy.stage,'Diagnóstico')

 const advanced=advancePipelineItem([fresh],fresh.id,'2026-08-08T12:00:00.000Z')[0]
 assert.equal(advanced.stage,'Proposta')
 assert.equal(reconcilePipeline([current],[advanced])[0].stage,'Proposta')

 const changed={...current,additionalNeed:'Revisar irrigação',commercial:{...current.commercial,opportunity:'Revisar irrigação'}}
 assert.equal(reconcilePipeline([changed],[advanced])[0].stage,'Diagnóstico')
})

test('cache é versionado, escopado e tolera conteúdo inválido',()=>{
 assert.equal(opportunityCacheKey('escopo-opaco'),'valor360:v2:escopo-opaco:opportunities')
 assert.equal(opportunityCacheKey(''),null)
 assert.deepEqual(parseOpportunityCache('{inválido'),[])
 assert.deepEqual(parseOpportunityCache('{"not":"an-array"}'),[])
})

test('oportunidade confirmada no relato da visita entra no pipeline como item proprio',()=>{
 const persisted={id:'o-visit-1',clientId:'sem-q27',candidateKey:'visit-report:report-1:venda-de-kcl',title:'Venda de KCl para safra 25/26',stage:'Diagnóstico',source:'visit_report',value:80000}
 const withoutQ27=client('sem-q27')
 assert.deepEqual(reconcilePipeline([withoutQ27],[persisted]).map(item=>[item.clientId,item.title,item.stage,item.candidateKey]),[['sem-q27','Venda de KCl para safra 25/26','Diagnóstico','visit-report:report-1:venda-de-kcl']])
 const withQ27=client('com-q27',{need:'Ampliar armazenagem',status:'reported',commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'}}})
 const items=reconcilePipeline([withQ27],[{...persisted,clientId:'com-q27',stage:'Proposta'}])
 assert.deepEqual(items.map(item=>[item.title,item.stage]),[['Ampliar armazenagem','Diagnóstico'],['Venda de KCl para safra 25/26','Proposta']])
 // Cache de etapa continua exigindo evidencia: item sem candidateKey de visita nao cria oportunidade.
 assert.deepEqual(reconcilePipeline([client('vazio')],[{id:'o-vazio',clientId:'vazio',title:'Inventada',stage:'Proposta'}]),[])
})
