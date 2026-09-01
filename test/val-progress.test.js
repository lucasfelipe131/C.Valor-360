import assert from 'node:assert/strict'
import test from 'node:test'
import {createValProgressTracker,normalizeValProgressRequestId} from '../server/val-progress.js'

const requestId='9c5d8e42-05d8-4d29-bc71-8d6767cf1c49'

test('progresso é monotônico, temporário e isolado por usuário',()=>{
  let now=1_000
  const tracker=createValProgressTracker({ttlMs:1_000,clock:()=>now})
  tracker.start({requestId,tenantId:'tenant-a',ownerId:'consultor-a',clientId:'produtor-1',mode:'strategic'})
  assert.equal(tracker.get({requestId,tenantId:'tenant-a',ownerId:'consultor-b'}),null)
  assert.equal(tracker.get({requestId,tenantId:'tenant-b',ownerId:'consultor-a'}),null)
  assert.equal(tracker.update({requestId,tenantId:'tenant-a',ownerId:'consultor-a',stage:'context'}).label,'Cruzando histórico e sinais')
  assert.equal(tracker.update({requestId,tenantId:'tenant-a',ownerId:'consultor-a',stage:'products'}).order,2)
  assert.equal(tracker.update({requestId,tenantId:'tenant-a',ownerId:'consultor-a',stage:'context'}).stage,'products')
  assert.equal(tracker.complete({requestId,tenantId:'tenant-a',ownerId:'consultor-a'}).done,true)
  now=2_001
  assert.equal(tracker.get({requestId,tenantId:'tenant-a',ownerId:'consultor-a'}),null)
})

test('o mesmo requestId não colide entre tenants e escopo ausente falha fechado',()=>{
  const tracker=createValProgressTracker()
  tracker.start({requestId,tenantId:'tenant-a',ownerId:'owner-a',clientId:'producer-a'})
  tracker.start({requestId,tenantId:'tenant-b',ownerId:'owner-a',clientId:'producer-b'})
  assert.equal(tracker.update({requestId,tenantId:'tenant-a',ownerId:'owner-a',stage:'context'}).clientId,'producer-a')
  assert.equal(tracker.get({requestId,tenantId:'tenant-b',ownerId:'owner-a'}).clientId,'producer-b')
  assert.throws(()=>tracker.get({requestId,ownerId:'owner-a'}),error=>error.code==='val_progress_scope_required')
  assert.throws(()=>tracker.update({requestId,tenantId:'tenant-a',stage:'context'}),error=>error.code==='val_progress_scope_required')
})

test('o mesmo requestId não colide entre owners do mesmo tenant',()=>{
  const tracker=createValProgressTracker()
  tracker.start({requestId,tenantId:'tenant-a',ownerId:'owner-a',clientId:'producer-a'})
  tracker.start({requestId,tenantId:'tenant-a',ownerId:'owner-b',clientId:'producer-b'})
  assert.equal(tracker.update({requestId,tenantId:'tenant-a',ownerId:'owner-a',stage:'context'}).clientId,'producer-a')
  assert.equal(tracker.get({requestId,tenantId:'tenant-a',ownerId:'owner-b'}).clientId,'producer-b')
  assert.equal(tracker.get({requestId,tenantId:'tenant-a',ownerId:'owner-a'}).stage,'context')
  assert.equal(tracker.get({requestId,tenantId:'tenant-a',ownerId:'owner-b'}).stage,'received')
})

test('identificador de progresso aceita somente UUID válido',()=>{
  assert.equal(normalizeValProgressRequestId(requestId),requestId)
  assert.equal(normalizeValProgressRequestId('../outro-usuario'),'')
})
