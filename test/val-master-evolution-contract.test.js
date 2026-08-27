import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
 CANONICAL_STAGES,
 loadGoldenSet,
 metricDistribution,
 nearestRankPercentile,
 normalizeBenchmarkSample,
 runStagingBenchmark,
 summarizeSamples,
} from '../scripts/val-performance-benchmark.mjs'

const root=join(import.meta.dirname,'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const golden=JSON.parse(read('evals/val-golden-performance-v1.json'))

test('GP-001–GP-016 formam um conjunto sintético, sequencial e roteável',()=>{
 assert.equal(golden.schema_version,'val.golden_performance.v1')
 assert.equal(golden.fixture_class,'SYNTHETIC_ONLY')
 assert.equal(golden.contains_real_data,false)
 assert.deepEqual(golden.measurement_contract.canonical_stages,CANONICAL_STAGES)
 assert.deepEqual(golden.measurement_contract.percentiles,[50,75,90,95])
 assert.equal(golden.cases.length,16)
 assert.deepEqual(golden.cases.map(item=>item.id),Array.from({length:16},(_,index)=>`GP-${String(index+1).padStart(3,'0')}`))
 assert.equal(new Set(golden.cases.map(item=>item.id)).size,16)
 const paths=new Set(golden.allowed_paths)
 for(const item of golden.cases){
  assert.ok(paths.has(item.path),`${item.id} possui path desconhecido`)
  assert.match(item.target,/^[A-Z][A-Z0-9_]+$/,`${item.id} precisa declarar target canônico`)
  assert.equal(typeof item.staging_probe?.enabled,'boolean')
  if(item.staging_probe.enabled){
   assert.equal(item.staging_probe.kind,'SYNTHETIC_CONTRACT_PROBE')
   assert.equal(item.staging_probe.body?.clientId,'')
   assert.equal(item.staging_probe.body?.sessionContext?.persistence_mode,'NONE')
  }else assert.ok(item.staging_probe.reason,'probe desabilitado deve explicar a fronteira de evidência')
 }
 assert.deepEqual([...new Set(golden.cases.map(item=>item.path))].sort(),['CONTEXT','DEEP','FAST','LIVE_DATA','TOOL'])
 assert.doesNotMatch(JSON.stringify(golden),/Costa Beber|Matheus Nascimento|João Pereira/i)
})

test('GP-007 preserva FitoScan e normaliza FitScan somente como alias',()=>{
 const fito=golden.cases.find(item=>item.id==='GP-007')
 assert.equal(fito.canonical_name,'FitoScan')
 assert.deepEqual(fito.accepted_aliases,['FitScan'])
 assert.equal(fito.target,'FITOSCAN')
})

test('percentis nearest-rank e TTFR são calculados sem inferir first byte',()=>{
 assert.equal(nearestRankPercentile([4,1,3,2],50),2)
 assert.equal(nearestRankPercentile([4,1,3,2],75),3)
 assert.equal(nearestRankPercentile([4,1,3,2],90),4)
 assert.deepEqual(metricDistribution([]),{count:0,min:null,max:null,mean:null,p50:null,p75:null,p90:null,p95:null})
 const report=summarizeSamples([
  {case_id:'GP-001',path:'FAST',status:'SUCCESS',ttfr_ms:10,transport_first_byte_ms:2,total_ms:50,stages_ms:{AUTH:1,INTENT:2,TOTAL:50}},
  {case_id:'GP-001',path:'FAST',status:'SUCCESS',ttfr_ms:20,transport_first_byte_ms:3,total_ms:60,stages_ms:{AUTH:2,INTENT:3,TOTAL:60}},
  {case_id:'GP-001',path:'FAST',status:'SUCCESS',ttfr_ms:30,transport_first_byte_ms:4,total_ms:70,stages_ms:{AUTH:3,INTENT:4,TOTAL:70}},
  {case_id:'GP-001',path:'FAST',status:'SUCCESS',ttfr_ms:40,transport_first_byte_ms:5,total_ms:80,stages_ms:{AUTH:4,INTENT:5,TOTAL:80}},
  {case_id:'GP-002',path:'FAST',status:'SUCCESS',transport_first_byte_ms:6,total_ms:90,stages_ms:{TOTAL:90}},
 ],{goldenSet:golden})
 assert.deepEqual(
  Object.fromEntries(['p50','p75','p90','p95'].map(key=>[key,report.overall.metrics_ms.TTFR[key]])),
  {p50:20,p75:30,p90:40,p95:40}
 )
 assert.equal(report.coverage.ttfr_observations,4)
 assert.equal(report.coverage.ttfr_not_inferred_from_transport,true)
 assert.equal(report.overall.metrics_ms.TRANSPORT_FIRST_BYTE.count,5)
 assert.equal(report.overall.metrics_ms.stages.AUTH.count,4)
 assert.ok(report.coverage.missing_cases.includes('GP-016'))
})

test('arquivo de amostras aceita apenas métricas sintéticas e não payload de produtor',()=>{
 assert.throws(()=>normalizeBenchmarkSample({case_id:'GP-001',path:'FAST',status:'SUCCESS',total_ms:10,prompt:'dado não permitido'}),/campos não métricos/)
 assert.throws(()=>normalizeBenchmarkSample({case_id:'GP-001',path:'FAST',status:'SUCCESS',total_ms:-1}),/total_ms/)
 const normalized=normalizeBenchmarkSample({case_id:'gp-001',path:'fast',status:'SUCCESS',total_ms:25,latency_breakdown:{CONTEXT_RETRIEVAL:4,MODEL_INFERENCE:8}})
 assert.equal(normalized.case_id,'GP-001')
 assert.equal(normalized.path,'FAST')
 assert.equal(normalized.stages_ms.CONTEXT,4)
 assert.equal(normalized.stages_ms.MODEL,8)
 assert.equal(normalized.stages_ms.TOTAL,25)
})

test('benchmark de rede exige opt-in e recusa host que não identifica staging',async()=>{
 const loaded=await loadGoldenSet(join(root,'evals/val-golden-performance-v1.json'))
 await assert.rejects(
  ()=>runStagingBenchmark({stagingUrl:'http://localhost:4173',goldenSet:loaded,optIn:false}),
  /exige --confirm-staging-only/
 )
 await assert.rejects(
  ()=>runStagingBenchmark({stagingUrl:'https://valor360.example.com',goldenSet:loaded,optIn:true}),
  /hostname deve identificar staging/
 )
})

test('infraestrutura de benchmark não contém URL, token ou produtor real embutido',()=>{
 const script=read('scripts/val-performance-benchmark.mjs')
 assert.match(script,/VAL_PERFORMANCE_STAGING_OPT_IN/)
 assert.match(script,/VAL_PERFORMANCE_STAGING_COOKIE/)
 assert.match(script,/VAL_PERFORMANCE_STAGING_BEARER/)
 assert.doesNotMatch(script,/railway\.app|Bearer\s+[A-Za-z0-9._-]{20,}|session=[A-Za-z0-9._-]{20,}/i)
 assert.match(script,/TTFR is accepted|ttfr_not_inferred_from_transport|reportedTtfr/)
})

test('contrato mestre preserva superfícies e não se apresenta como gate final',()=>{
 for(const path of [
  'src/pages/Dashboard.jsx','src/pages/Clients.jsx','src/pages/Client360.jsx','src/pages/Visits.jsx',
  'src/pages/Opportunities.jsx','src/pages/Agro.jsx','src/components/GlobalValCopilot.jsx',
  'src/components/voice/VoiceCapture.jsx','src/components/ProducerFieldGallery.jsx','manual/app/page.tsx',
  'server/ai-reasoning/index.js','server/decision-copilot/capability-router.js','database/schema.sql'
 ])assert.equal(existsSync(join(root,path)),true,`${path} precisa permanecer no ecossistema`)
 for(const path of [
  'VAL_MASTER_EXPERIENCE_vNEXT.md','VAL_AGRONOMIC_CAPABILITY_DIFF.md',
  'VAL_PERFORMANCE_ARCHITECTURE_v2.md','VAL_VOICE_DECISION_COPILOT_v2.md',
  'MANUAL_CURRENT_CAPABILITY_AUDIT.md','VAL_AREA_MAPPING_INTEGRATION_v1.md',
  'VAL_NUTRISCAN_INTEGRATION_v1.md','VAL_FITSCAN_INTEGRATION_v1.md','VAL_CALCULATOR_PARITY_v1.md'
 ])assert.equal(existsSync(join(root,path)),true,`${path} é evidência documental esperada`)
 const master=read('VAL_MASTER_EXPERIENCE_vNEXT.md')
 assert.match(master,/not the final gate/i)
 assert.match(master,/No merge to `main`, production deploy or Passo 07 is included/)
 assert.match(master,/Documentation presence is never sufficient evidence for a `PASS`/)
})
