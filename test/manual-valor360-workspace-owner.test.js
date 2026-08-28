import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {authenticatedValor360OwnerForWorkspace} from '../manual/app/lib/valor360-workspace-owner.ts'

const adminId='00000000-0000-4000-8000-000000000101'
const testerId='00000000-0000-4000-8000-000000000202'
const embeddedOwnerId='00000000-0000-4000-8000-000000000303'
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')

test('owner da integração é derivado somente do próprio workspace autenticado',()=>{
  assert.equal(authenticatedValor360OwnerForWorkspace({user:{id:adminId}},adminId),adminId)
  assert.equal(authenticatedValor360OwnerForWorkspace({user:{id:adminId},valor360OwnerId:embeddedOwnerId},adminId),embeddedOwnerId)
})

test('admin não pode publicar workspace alheio sob a própria identidade',()=>{
  assert.equal(authenticatedValor360OwnerForWorkspace({user:{id:adminId}},testerId),null)
  assert.equal(authenticatedValor360OwnerForWorkspace({user:{id:adminId},valor360OwnerId:embeddedOwnerId},testerId),null)
  assert.equal(authenticatedValor360OwnerForWorkspace({user:{id:'inválido'}},'inválido'),null)
})

test('rotas de records, workspace e sync usam o owner validado e falham fechadas',()=>{
  for(const path of [
    '../manual/app/api/records/route.ts',
    '../manual/app/api/workspace/route.ts',
    '../manual/app/api/integrations/valor360/sync/route.ts',
  ]){
    const source=read(path)
    assert.match(source,/authenticatedValor360OwnerForWorkspace\(session,/)
    assert.match(source,/valor360_workspace_owner_not_authenticated/)
    assert.doesNotMatch(source,/publish(?:ManualRecord|Workspace)ToValor\([\s\S]{0,180}session\.valor360OwnerId \?\? session\.user\.id/)
  }
})
