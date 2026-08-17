import assert from 'node:assert/strict'
import test from 'node:test'
import {createValProgressTracker,normalizeValProgressRequestId} from '../server/val-progress.js'

const requestId='9c5d8e42-05d8-4d29-bc71-8d6767cf1c49'

test('progresso é monotônico, temporário e isolado por usuário',()=>{
  let now=1_000
  const tracker=createValProgressTracker({ttlMs:1_000,clock:()=>now})
  tracker.start({requestId,ownerId:'consultor-a',clientId:'produtor-1',mode:'strategic'})
  assert.equal(tracker.get({requestId,ownerId:'consultor-b'}),null)
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'context'}).label,'Cruzando histórico e sinais')
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'products'}).order,2)
  assert.equal(tracker.update({requestId,ownerId:'consultor-a',stage:'context'}).stage,'products')
  assert.equal(tracker.complete({requestId,ownerId:'consultor-a'}).done,true)
  now=2_001
  assert.equal(tracker.get({requestId,ownerId:'consultor-a'}),null)
})

test('identificador de progresso aceita somente UUID válido',()=>{
  assert.equal(normalizeValProgressRequestId(requestId),requestId)
  assert.equal(normalizeValProgressRequestId('../outro-usuario'),'')
})
