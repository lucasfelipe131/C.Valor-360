import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
  BRAZIL_UFS,
  estimateRegionalHarvest,
  recommendPlantPopulation,
  regionForUf,
} from '../manual/app/agronomy-planning.ts'

const soybean={
  name:'Material teste GMR 5,9',
  cycleDays:131,
  cycleRangeDays:[124,138],
  cycleClass:'Precoce',
  gmr:5.9,
}

test('regionalização cobre as 27 UFs e deixa MS mais curto que a referência do RS',()=>{
 assert.equal(BRAZIL_UFS.length,27)
 for(const uf of BRAZIL_UFS) assert.ok(['Sul','Sudeste','Centro-Oeste','Nordeste','Norte'].includes(regionForUf(uf)))
 const rs=estimateRegionalHarvest({crop:'Soja',cultivar:soybean,plantingDate:'2026-11-15',municipality:'São Luiz Gonzaga',uf:'RS',latitude:-28.41,harvestConditionDays:7})
 const ms=estimateRegionalHarvest({crop:'Soja',cultivar:soybean,plantingDate:'2026-11-15',municipality:'Dourados',uf:'MS',latitude:-22.22,harvestConditionDays:7})
 assert.ok(rs)
 assert.ok(ms)
 assert.equal(rs.regionalAdjustmentDays,0)
 assert.ok(Number.isFinite(rs.municipalityAdjustmentDays))
 assert.ok(ms.regionalAdjustmentDays<0)
 assert.ok(ms.centralCycleDays<rs.centralCycleDays)
 assert.match(ms.warnings.join(' '),/macrorregião|fotoperíodo/i)
})

test('colheita decompõe ciclo-base, região, época e pós-maturação sem usar ZARC como ciclo',()=>{
 const corn={
  name:'Híbrido teste',cycleDays:130,cycleRangeDays:[118,142],cycleClass:'Superprecoce',
  cycleByMonth:{'9':136},
 }
 const result=estimateRegionalHarvest({crop:'Milho',cultivar:corn,plantingDate:'2026-09-10',municipality:'Dourados',uf:'MS',latitude:-22.22,harvestConditionDays:8})
 assert.ok(result)
 assert.equal(result.baseCycleDays,130)
 assert.equal(result.seasonAdjustmentDays,6)
 assert.equal(result.harvestConditionDays,8)
 assert.equal(result.centralCycleDays,result.baseCycleDays+result.regionalAdjustmentDays+result.municipalityAdjustmentDays+result.seasonAdjustmentDays+result.harvestConditionDays)
 assert.ok(result.start<result.central)
 assert.ok(result.central<result.end)
 assert.match(result.seasonBasis,/observação do material/)
})

test('população converte plantas finais em sementes por hectare e por metro pelo estabelecimento',()=>{
 const result=recommendPlantPopulation({
  crop:'Soja',cultivar:soybean,plantingDate:'2026-11-15',municipality:'São Luiz Gonzaga',uf:'RS',
  environment:'medio',yieldGapPercent:10,germinationPercent:90,emergencePercent:85,spacingCm:45,
 })
 assert.ok(result.finalMin<result.finalTarget)
 assert.ok(result.finalTarget<result.finalMax)
 assert.ok(result.seedsPerHa>result.finalTarget)
 assert.ok(Math.abs(result.seedsPerMeter-(result.seedsPerHa*.45/10000))<0.001)
 assert.equal(Math.round(result.establishmentPercent*10)/10,76.5)
 assert.match(result.warnings.join(' '),/fabricante|obtentor/i)
})

test('yield gap alto não é usado para densificar milho e explicita as limitações do cenário',()=>{
 const corn={name:'Híbrido teste',cycleDays:125,cycleRangeDays:[115,138],cycleClass:'Precoce'}
 const common={crop:'Milho',cultivar:corn,plantingDate:'2026-10-10',municipality:'Dourados',uf:'MS',environment:'alto',germinationPercent:95,emergencePercent:92,spacingCm:45}
 const lowGap=recommendPlantPopulation({...common,yieldGapPercent:5})
 const highGap=recommendPlantPopulation({...common,yieldGapPercent:40})
 assert.ok(highGap.finalTarget<lowGap.finalTarget)
 assert.match(highGap.warnings.join(' '),/fatores limitantes|não substitui/i)
})

test('interface preserva todas as calculadoras e separa pulverização dos demais grupos',()=>{
 const page=readFileSync(join(process.cwd(),'manual/app/page.tsx'),'utf8')
 const styles=readFileSync(join(process.cwd(),'manual/app/globals.css'),'utf8')
 for(const key of ['semeadora','populacao','sementes','colheita','zoneamento','pulverizacao','fertilizante','reposicao','cotacao']) {
  assert.match(page,new RegExp(`key: "${key}"`))
 }
 assert.match(page,/\["Pulverização", "Fertilizantes", "Plantabilidade", "Custos"\]/)
 assert.match(page,/role="radiogroup"/)
 assert.match(page,/type="button" role="radio" aria-checked=\{planterInputMode === "meter"\}/)
 assert.match(page,/onClick=\{\(\) => changePlanterMode\("meter"\)\}>Informar plantas por metro<\/button>/)
 assert.match(styles,/\.planter-mode-panel \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
 assert.match(page,/useState<"all" \| "agrofit" \| "commercial" \| "foliar" \| "problem">\("all"\)/)
 assert.match(page,/catalog === "all" \|\| catalog === "commercial"/)
 assert.match(page,/ZARC define janela e risco de semeadura — não o ciclo da cultivar/)
 assert.match(page,/proxy de latitude do centroide municipal/)
 assert.match(page,/não possui população oficial por cultivar/)
})
