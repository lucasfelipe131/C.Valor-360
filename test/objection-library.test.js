import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildObjectionLibrary,clearObjectionLibraryCache,loadPortfolioBusinessHistory} from '../server/objection-library.js'

const context={
 businessHistory:[
  {id:'loss-1',event_type:'business.lost',loss_reason:'Preço acima da alternativa',category:'Milho',product:'Programa A',occurred_at:'2026-03-10T12:00:00Z'},
  {id:'loss-2',outcome:'lost',loss_reason:'Preço e condição comercial',category:'Milho',product:'Programa B',occurred_at:'2026-04-10T12:00:00Z'},
  {id:'loss-notes',event_type:'business.lost',notes:'Concorrente mais barato',category:'Soja',occurred_at:'2026-05-10T12:00:00Z'},
  {id:'win-1',event_type:'business.closed',category:'Milho',product:'Programa A',occurred_at:'2026-06-15T12:00:00Z'}
 ],
 priorRecommendations:[
  {id:'rec-1',created_at:'2026-05-01T12:00:00Z',feedback:{outcome:'executed'},advice:{executive_brief:{action:'Comparar escopo e quantificar o ponto de equilíbrio antes de negociar condição.'}}}
 ]
}
const now=Date.parse('2026-08-17T12:00:00Z')

test('biblioteca usa somente motivo estruturado de perda e agrupa objeções semelhantes',()=>{
 const library=buildObjectionLibrary(context,{now})
 assert.equal(library.lossEventsConsidered,2)
 assert.equal(library.objections.length,1)
 const objection=library.objections[0]
 assert.equal(objection.label,'Preço ou condição comercial')
 assert.equal(objection.count,2)
 assert.ok(objection.evidenceIds.includes('business-loss:loss-1'))
 assert.ok(objection.evidenceIds.includes('business-loss:loss-2'))
 assert.equal(library.policy.structuredLossReasonOnly,true)
 assert.equal(library.policy.freeNotesExcluded,true)
})

test('movimento observado exige recomendação executada e fechamento posterior semelhante',()=>{
 const objection=buildObjectionLibrary(context,{now}).objections[0]
 assert.ok(objection.observedMove)
 assert.match(objection.observedMove.action,/Comparar escopo e quantificar/)
 assert.ok(objection.observedMove.evidenceIds.includes('recommendation:rec-1'))
 assert.ok(objection.observedMove.evidenceIds.includes('business-win:win-1'))
 assert.equal(objection.observedMove.causalClaim,false)
 assert.match(objection.guardrail,/não prova causalidade/)
})

test('sem resultado posterior a VAL pede descoberta em vez de produzir script genérico',()=>{
 const library=buildObjectionLibrary({businessHistory:[{id:'l',event_type:'business.lost',loss_reason:'Faltou prova de resultado',occurred_at:'2026-08-01T12:00:00Z'}],priorRecommendations:[]},{now})
 assert.equal(library.objections[0].observedMove,null)
 assert.match(library.objections[0].guidance,/Descubra a objeção atual/)
 assert.equal(library.policy.genericScripts,false)
 assert.equal(library.policy.causalClaims,false)
})

test('carteira inteira é filtrada pela oportunidade atual sem misturar categoria sem relação',()=>{
 const focused={client:{id:'p1',name:'João'},conversionFoundation:{selectedOpportunity:{id:'o1',title:'Programa de milho',category:'Milho',stage:'Proposta'}},opportunities:[{id:'o1',title:'Programa de milho',category:'Milho',stage:'Proposta'}],priorRecommendations:[]}
 const portfolioHistory=[
  {id:'loss-milho',outcome:'lost',lossReason:'Preço alto',category:'Milho',clientExternalKey:'p2',occurredAt:'2026-05-01T12:00:00Z'},
  {id:'loss-soja',outcome:'lost',lossReason:'Preço alto',category:'Soja',clientExternalKey:'p3',occurredAt:'2026-05-02T12:00:00Z'}
 ]
 const library=buildObjectionLibrary(focused,{now,portfolioHistory})
 assert.equal(library.lossEventsConsidered,1)
 assert.deepEqual(library.objections[0].categories,['Milho'])
 assert.ok(library.objections[0].similarityReasons.includes('mesma categoria'))
 assert.equal(library.policy.portfolioScoped,true)
 assert.equal(library.policy.personalDataUsed,false)
})

test('o que funcionou só aparece quando o fechamento traz registro explícito ou sequência auditável',()=>{
 const focused={client:{id:'p1'},conversionFoundation:{selectedOpportunity:{title:'Programa de milho',category:'Milho'}},priorRecommendations:[]}
 const portfolioHistory=[
  {id:'l1',outcome:'lost',lossReason:'Faltou prova de resultado',category:'Milho',clientExternalKey:'p2',occurredAt:'2026-03-01T12:00:00Z'},
  {id:'w1',outcome:'won',category:'Milho',clientExternalKey:'p2',occurredAt:'2026-04-01T12:00:00Z',payload:{whatWorked:'Validar o resultado em área delimitada com critério combinado antes da proposta.'}}
 ]
 const objection=buildObjectionLibrary(focused,{now,portfolioHistory}).objections[0]
 assert.match(objection.observedMove.action,/área delimitada/)
 assert.deepEqual(objection.observedMove.evidenceIds,['business-loss:l1','business-win:w1'])
 assert.equal(objection.observedMove.causalClaim,false)
})

test('recomendação da conta atual não é atribuída a perda de outro produtor',()=>{
 const focused={client:{id:'p1'},conversionFoundation:{selectedOpportunity:{title:'Programa de milho',category:'Milho'}},priorRecommendations:[{id:'rec-current',created_at:'2026-03-15T12:00:00Z',feedback:{outcome:'executed'},advice:{next_best_action:'Linha da conta atual'}}]}
 const portfolioHistory=[
  {id:'l-other',outcome:'lost',lossReason:'Preço alto',category:'Milho',clientExternalKey:'p2',occurredAt:'2026-03-01T12:00:00Z'},
  {id:'w-other',outcome:'won',category:'Milho',clientExternalKey:'p2',occurredAt:'2026-04-01T12:00:00Z'}
 ]
 const move=buildObjectionLibrary(focused,{now,portfolioHistory}).objections[0].observedMove
 assert.doesNotMatch(move.action,/Linha da conta atual/)
 assert.equal(move.evidenceIds.includes('recommendation:rec-current'),false)
})

test('consulta da carteira fica restrita ao tenant e ao consultor autenticado',async()=>{
 clearObjectionLibraryCache()
 let call
 const repository={tenantId:'tenant-a',db:{configured:true,query:async(sql,params)=>{call={sql,params};return {rows:[{id:'l1',outcome:'lost',occurred_at:'2026-06-01T12:00:00Z',loss_reason:'Preço',client_external_key:'p2',client_name:'Outro produtor',payload:{}}]}}}}
 const events=await loadPortfolioBusinessHistory(repository,'owner-a',{now,ttlMs:1000})
 assert.equal(events.length,1)
 assert.match(call.sql,/client\.consultant_id=\$2/)
 assert.deepEqual(call.params.slice(0,2),['tenant-a','owner-a'])
})

test('fallback da biblioteca rejeita eventos cross-tenant, cross-owner, sem escopo e aliases conflitantes',async()=>{
 clearObjectionLibraryCache()
 const businessEvents=[
  {id:'own',tenantId:'tenant-a',ownerId:'owner-a',outcome:'lost',lossReason:'Preço',occurredAt:'2026-08-01T12:00:00.000Z'},
  {id:'other-tenant',tenantId:'tenant-b',ownerId:'owner-a',outcome:'lost',lossReason:'Crédito',occurredAt:'2026-08-02T12:00:00.000Z'},
  {id:'other-owner',tenantId:'tenant-a',ownerId:'owner-b',outcome:'won',occurredAt:'2026-08-03T12:00:00.000Z'},
  {id:'unscoped',outcome:'lost',lossReason:'Contrato',occurredAt:'2026-08-04T12:00:00.000Z'},
  {id:'conflict',tenantId:'tenant-a',organizationId:'tenant-b',ownerId:'owner-a',outcome:'lost',lossReason:'Fertilizante',occurredAt:'2026-08-05T12:00:00.000Z'}
 ]
 const repository={tenantId:'tenant-a',db:{configured:false},readStore:()=>({businessEvents})}
 const events=await loadPortfolioBusinessHistory(repository,'owner-a')
 assert.deepEqual(events.map(item=>item.id),['own'])
 await assert.rejects(()=>loadPortfolioBusinessHistory({...repository,tenantId:''},'owner-a'),error=>error.code==='objection_history_scope_required')
 await assert.rejects(()=>loadPortfolioBusinessHistory(repository,''),error=>error.code==='objection_history_scope_required')
 clearObjectionLibraryCache()
})

test('invalidação da biblioteca remove somente o tenant e owner solicitados',async()=>{
 clearObjectionLibraryCache()
 let callsA=0;let callsB=0
 const repositoryA={tenantId:'tenant-a',db:{configured:true,query:async()=>{callsA++;return {rows:[]}}}}
 const repositoryB={tenantId:'tenant-b',db:{configured:true,query:async()=>{callsB++;return {rows:[]}}}}
 await loadPortfolioBusinessHistory(repositoryA,'owner-a')
 await loadPortfolioBusinessHistory(repositoryB,'owner-a')
 clearObjectionLibraryCache({tenantId:'tenant-a',ownerId:'owner-a'})
 await loadPortfolioBusinessHistory(repositoryA,'owner-a')
 await loadPortfolioBusinessHistory(repositoryB,'owner-a')
 assert.equal(callsA,2)
 assert.equal(callsB,1)
 assert.throws(()=>clearObjectionLibraryCache({tenantId:'tenant-a'}),error=>error.code==='objection_cache_scope_required')
})

test('consulta antiga em voo não repopula a biblioteca após invalidação do escopo',async()=>{
 clearObjectionLibraryCache()
 let releaseStale
 const staleResult=new Promise(resolve=>{releaseStale=resolve})
 let calls=0
 const repository={tenantId:'tenant-race',db:{configured:true,query:()=>{
  calls+=1
  if(calls===1)return staleResult
  return Promise.resolve({rows:[{id:'fresh-event',occurred_at:'2026-08-30T12:00:00.000Z',outcome:'won',payload:{version:'fresh'}}]})
 }}}
 const staleLoad=loadPortfolioBusinessHistory(repository,'owner-race')
 assert.equal(calls,1)
 clearObjectionLibraryCache({tenantId:'tenant-race',ownerId:'owner-race'})
 const fresh=await loadPortfolioBusinessHistory(repository,'owner-race')
 assert.equal(fresh[0].id,'fresh-event')
 releaseStale({rows:[{id:'stale-event',occurred_at:'2026-08-29T12:00:00.000Z',outcome:'lost',payload:{version:'stale'}}]})
 assert.equal((await staleLoad)[0].id,'stale-event')
 const cached=await loadPortfolioBusinessHistory(repository,'owner-race')
 assert.equal(cached[0].id,'fresh-event')
 assert.equal(calls,2)
 clearObjectionLibraryCache()
})

test('estúdio exibe objeções reais, foco, evidências e limite causal',()=>{
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/ObjectionEvidencePanel.jsx',import.meta.url),'utf8')
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(studio,/ObjectionEvidencePanel/)
 assert.match(panel,/BIBLIOTECA DE OBJEÇÕES REAIS/)
 assert.match(panel,/Evidências rastreáveis/)
 assert.match(panel,/Por que é parecido/)
 assert.match(panel,/Comparando com:/)
 assert.match(bootstrap,/loadPortfolioBusinessHistory/)
 assert.match(bootstrap,/buildObjectionLibrary\(context,\{portfolioHistory:portfolioHistory\.events\}\)/)
})
