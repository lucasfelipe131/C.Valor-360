import test from 'node:test'
import assert from 'node:assert/strict'
import {publicStorageScope} from '../server/storage-policy.js'

test('rotas públicas que persistem dados são identificadas sem exigir sessão',()=>{
  assert.equal(publicStorageScope('/api/surveys/convite_123','GET'),'public-survey')
  assert.equal(publicStorageScope('/api/surveys/convite_123/submit','POST'),'public-survey')
  assert.equal(publicStorageScope('/api/integrations/manual/events','POST'),'manual-event')
  assert.equal(publicStorageScope('/api/v1/integrations/manual/events','POST'),'manual-event')
  assert.equal(publicStorageScope('/api/surveys/invitations','GET'),null)
  assert.equal(publicStorageScope('/api/surveys/convite_123','POST'),null)
})
