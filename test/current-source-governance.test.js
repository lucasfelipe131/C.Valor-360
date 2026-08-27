import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {CURRENT_SOURCE_GOVERNANCE,CURRENT_SOURCE_GOVERNANCE_VERSION,currentSourceGovernance} from '../server/current-source-governance.js'

const read=relative=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8')

test('fontes atuais — contrato registra todos os campos de governança e os três domínios',()=>{
 assert.equal(CURRENT_SOURCE_GOVERNANCE_VERSION,'CurrentSourceGovernance.v1')
 assert.deepEqual([...new Set(CURRENT_SOURCE_GOVERNANCE.map(item=>item.domain))].sort(),['BULAS','CLIMA','MERCADO'])
 const required=['provider','source','freshness','timestamp','failure_behavior','cache','authority','tenant_implications','cost','integration_status','external_blocker']
 for(const record of CURRENT_SOURCE_GOVERNANCE){
  for(const field of required)assert.ok(String(record[field]||'').trim(),`${record.id}.${field}`)
  assert.equal(typeof record.current_claim_allowed,'boolean',record.id)
 }
 assert.equal(currentSourceGovernance({domain:'mercado',consumer:'copilot'}).length,1)
})

test('clima — provider existente mantém timestamp/cache/falha e não ganha autorização fictícia',()=>{
 const weather=read('manual/app/api/weather/route.ts')
 const governance=currentSourceGovernance({domain:'CLIMA',consumer:'MANUAL'})[0]
 assert.match(weather,/https:\/\/api\.open-meteo\.com\/v1\/forecast/)
 assert.match(weather,/source: "open-meteo"/)
 assert.match(weather,/updatedAt: new Date\(\)\.toISOString\(\)/)
 assert.match(weather,/s-maxage=900, stale-while-revalidate=1800/)
 assert.match(weather,/status: 502/)
 assert.equal(governance.current_claim_allowed,false)
 assert.match(governance.integration_status,/AUTHORIZATION_BLOCKED/)
})

test('mercado — Copilot exige origem/data e consulta PostgreSQL por tenant + owner',()=>{
 const router=read('server/decision-copilot/capability-router.js')
 const repository=read('server/grain-repository.js')
 const governance=currentSourceGovernance({domain:'MERCADO',consumer:'COPILOT'})[0]
 assert.match(router,/sourceName/)
 assert.match(router,/observedAt/)
 assert.match(router,/CURRENT/)
 assert.match(router,/STALE/)
 assert.match(repository,/WHERE tenant_id=\$1 AND owner_user_id=\$2 AND status='active'/)
 assert.equal(governance.current_claim_allowed,true)
 assert.equal(governance.integration_status,'GOVERNED_INPUT_AVAILABLE')
})

test('bulas — catálogo sem data nunca substitui fonte atual e Copilot falha fechado',()=>{
 const productIntelligence=read('server/product-intelligence.js')
 const targets=read('manual/app/api/agro/targets/route.ts')
 const server=read('server.js')
 const catalog=JSON.parse(read('manual/app/agrofit-products.json'))
 const governance=currentSourceGovernance({domain:'BULAS',consumer:'MANUAL'})[0]
 assert.equal(catalog.length,1632)
 assert.match(productIntelligence,/observed_at:'unknown'/)
 assert.match(targets,/CACHE_MS = 6 \* 60 \* 60 \* 1000/)
 assert.match(targets,/consultedAt: new Date\(\)\.toISOString\(\)/)
 assert.match(targets,/status: 502/)
 assert.match(server,/code:'val_current_source_unavailable'/)
 assert.equal(governance.current_claim_allowed,false)
 assert.match(governance.external_blocker,/versioned Agrofit\/MAPA feed|dated export/)
})

test('governança não adiciona segredo, conta ou provider pago fictício',()=>{
 const source=read('server/current-source-governance.js')
 assert.doesNotMatch(source,/(?:api[_-]?key|bearer|password|secret)\s*[:=]\s*['"][^'"]+/i)
 assert.doesNotMatch(source,/sk-[A-Za-z0-9]/)
})
