import test from 'node:test'
import assert from 'node:assert/strict'
import {compactBRL,commercialMetrics,metricValue,relationshipSummary} from '../src/lib/commercial-metrics.js'

test('métricas canônicas calculam reais, potencial aberto e share sem usar o legado',()=>{
 const metrics=commercialMetrics({commercial:{purchaseCurrentSeason:120_000,potentialTotal:300_000,openPotential:180_000,openPipeline:75_000,realizedShare:40,potential:999_999}})
 assert.equal(metrics.currentPurchases,120_000)
 assert.equal(metrics.potentialTotal,300_000)
 assert.equal(metrics.openPotential,180_000)
 assert.equal(metrics.openPipeline,75_000)
 assert.equal(metrics.realizedShare,40)
 assert.equal(compactBRL(metrics.openPotential),'R$ 180 mil')
 assert.equal(metricValue(metrics.realizedShare,metrics.shareKnown,'%'),'40%')
})

test('potencial legado continua legível sem transformar índice heurístico em reais',()=>{
 const legacy=commercialMetrics({commercial:{potential:85_000,potentialValidated:true}})
 const heuristic=commercialMetrics({commercial:{potential:85_000,potentialValidated:false,score:72}})
 assert.equal(legacy.openPotential,85_000)
 assert.equal(legacy.openPotentialKnown,true)
 assert.equal(heuristic.openPotentialKnown,false)
 assert.equal(compactBRL(heuristic.openPotential,{known:heuristic.openPotentialKnown}),'A medir')
})

test('zero conhecido difere de dado ausente e potencial total sem compras não fabrica share',()=>{
 const zero=commercialMetrics({commercial:{purchaseCurrentSeason:0,potentialTotal:0,openPotential:0,openPipeline:0,realizedShare:0}})
 const partial=commercialMetrics({commercial:{potentialTotal:250_000}})
 assert.equal(zero.openPotentialKnown,true)
 assert.match(compactBRL(zero.openPotential,{known:zero.openPotentialKnown}),/^R\$\s*0$/)
 assert.equal(partial.openPotentialKnown,false)
 assert.equal(partial.shareKnown,false)
 assert.equal(metricValue(partial.realizedShare,partial.shareKnown,'%'),'A medir')
})

test('médias de relacionamento consideram apenas perfis realmente medidos',()=>{
 const summary=relationshipSummary([
  {irt:96,nps:10,primaryProfile:'Analítico',profileUpdatedAt:'2026-08-01'},
  {irt:86,nps:9,primaryProfile:'Relacional',profileVersion:1},
  {irt:0,nps:0,primaryProfile:'A classificar'}
 ])
 assert.equal(summary.total,3)
 assert.equal(summary.profileMeasured,2)
 assert.equal(summary.irtKnown,2)
 assert.equal(summary.irtAverage,91)
 assert.equal(summary.npsKnown,2)
 assert.equal(summary.promoters,2)
 assert.equal(summary.promoterRate,100)
})
