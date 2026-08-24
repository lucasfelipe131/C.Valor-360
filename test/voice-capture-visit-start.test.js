import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {phase6ActorA,phase6InitialStore,phase6Repository,phase6TenantA,phase6VisitA} from '../support/phase6-test-context.js'

const now=new Date('2026-08-23T15:00:00.000Z')

test('Voice Capture — iniciar visita torna FIELD_NOTE e POST_VISIT alcançáveis e é idempotente',async()=>{
  const {repository,read}=phase6Repository()
  const first=await repository.startVisit({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:phase6ActorA,visitId:phase6VisitA,requestId:'00000000-0000-4000-8000-000000000701',now})
  const second=await repository.startVisit({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:phase6ActorA,visitId:phase6VisitA,requestId:'00000000-0000-4000-8000-000000000702',now:new Date('2026-08-23T15:01:00.000Z')})

  assert.equal(first.visit.lifecycleStatus,'IN_PROGRESS')
  assert.equal(first.visit.occurredAt,now.toISOString())
  assert.equal(first.idempotent,false)
  assert.equal(second.visit.lifecycleStatus,'IN_PROGRESS')
  assert.equal(second.idempotent,true)
  assert.equal(read().val.visitLifecycleEvents.filter(item=>item.reasonCode==='VISIT_STARTED').length,1)
})

test('Voice Capture — iniciar visita respeita ator, tenant e estados terminais',async()=>{
  const otherActor='00000000-0000-4000-8000-000000000799'
  const completed=phase6InitialStore({visits:[{...phase6InitialStore().visits[0],lifecycleStatus:'COMPLETED',lifecycleVersion:'val.visit_lifecycle.v1',lifecycleRevision:2,status:'Realizada'}]})
  const {repository}=phase6Repository({visits:completed.visits})

  await assert.rejects(
    ()=>repository.startVisit({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:otherActor,visitId:phase6VisitA,now}),
    error=>error.statusCode===403
  )
  await assert.rejects(
    ()=>repository.startVisit({tenantId:phase6TenantA,ownerId:phase6ActorA,actorId:phase6ActorA,visitId:phase6VisitA,now}),
    error=>error.statusCode===409&&error.code==='visit_lifecycle_transition_denied'
  )
})

test('Voice Capture — UI, rota e OpenAPI ligam explicitamente Iniciar visita',()=>{
  const visits=readFileSync(new URL('../src/pages/Visits.jsx',import.meta.url),'utf8')
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
  const openapi=readFileSync(new URL('../openapi/val-core-v1.yaml',import.meta.url),'utf8')

  assert.match(visits,/startVisit=async visit/)
  assert.match(visits,/fetch\(`\/api\/v1\/visits\/\$\{visit\.id\}\/start`/)
  assert.match(visits,/Iniciar visita<\/button>/)
  assert.match(visits,/canStart&&/)
  assert.match(server,/visitStartMatch[\s\S]*repository\.startVisit\(/)
  assert.match(openapi,/\/api\/v1\/visits\/\{visitId\}\/start:[\s\S]*operationId: startVisit/)
})
