import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {actionPlanVersion,commitmentVersion,insightCardVersion,prepareVisitVersion} from '../server/execution/contracts.js'
import {ValCore} from '../server/core/val-core.js'
import {routeCoreRequest} from '../server/core/router.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')

test('contratos JSON da Fase 5 permanecem alinhados ao runtime',()=>{
 const cases=[['contracts/v1/action-plan.schema.json',actionPlanVersion],['contracts/v1/commitment.schema.json',commitmentVersion],['contracts/v1/insight-card.schema.json',insightCardVersion],['contracts/v1/prepare-visit.schema.json',prepareVisitVersion]]
 for(const [path,version] of cases){const schema=JSON.parse(read(path));assert.equal(schema.properties.contract_version.const,version);assert.equal(schema.properties.version.const,version)}
})

test('OpenAPI publica apenas rotas aditivas MEX/VIS',()=>{
 const source=read('openapi/val-core-v1.yaml')
 for(const route of ['/api/v1/visits/{visitId}/preparation','/api/v1/action-plans','/api/v1/commitments','/api/v1/insights'])assert.ok(source.includes(route))
 assert.ok(source.includes('/api/val/recommendations:'))
 assert.ok(source.includes('/api/v1/val/recommendations:'))
})

test('migration da Fase 5 é expand-only e tenant-safe',()=>{
 const source=read('database/migrations/20260822_003_execution_insight_expand.sql')
 const statements=source.replace(/^\s*--.*$/gm,'')
 assert.doesNotMatch(statements,/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|ALTER|UPDATE)\b/i)
 assert.match(source,/CREATE TABLE IF NOT EXISTS val_action_plans/i)
 assert.match(source,/CREATE TABLE IF NOT EXISTS val_commitments/i)
 assert.match(source,/FOREIGN KEY \(tenant_id,context_snapshot_id\)/i)
 assert.match(source,/FOREIGN KEY \(tenant_id,action_plan_id\)/i)
 assert.match(source,/status<>'DONE'.*evidence_refs/is)
})

test('interface preserva simplicidade, limites e score experimental não vira KPI',()=>{
 const visits=read('src/pages/Visits.jsx');const preparationUi=`${visits}\n${read('src/components/visit/PrepareVisitSimple.jsx')}\n${read('src/lib/prepare-visit-presentation.js')}`;const radar=read('src/components/ConversionRadar.jsx')
 assert.match(radar,/O que merece minha atenção agora\?/)
 assert.match(radar,/item\.why_now/)
 assert.match(radar,/item\.recommended_action/)
 assert.match(preparationUi,/golden_questions/)
 assert.match(preparationUi,/priority_actions|actionPlan\.priorities/)
 assert.doesNotMatch(radar,/score \{Math\.round\(Number\(item\.priority\)/)
})

test('VAL Core planeja MEX/VIS e audita o ActionPlan sem romper os envelopes v1',async()=>{
 const tenant='00000000-0000-4000-8000-000000000001';const actor='00000000-0000-4000-8000-000000000111';const client='client-1'
 const core=new ValCore({tenantId:tenant,observeFn:()=>{},engine:{answer:async()=>({advice:{execution_modules:{modules_called:['MEX','VIS'],audit:{action_plan_id:'plan-1',action_plan_version:actionPlanVersion}},action_plan:{action_plan_id:'plan-1',version:actionPlanVersion}}})}})
 const request=core.createRequest({request_id:'00000000-0000-4000-8000-000000000555',organization_id:tenant,actor:{id:actor,role:'consultant'},subject:{type:'client',id:client},objective:'prepare_visit',context_refs:[],policy_context:{resource:'val_recommendation',operation:'execute',scope:'own_portfolio',scope_ref:actor}})
 assert.deepEqual(routeCoreRequest(request).modules.slice(-2),['MEX','VIS'])
 const response=await core.execute(request,{engineInput:{tenantId:tenant,ownerId:actor,clientId:client}})
 assert.equal(response.contract_version,'val.response.v1')
 assert.deepEqual(response.audit.execution_modules,['MEX','VIS'])
 assert.equal(response.audit.action_plan_id,'plan-1')
 assert.equal(response.audit.action_plan_version,actionPlanVersion)
})
