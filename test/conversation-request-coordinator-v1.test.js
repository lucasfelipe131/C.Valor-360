import assert from 'node:assert/strict'
import test from 'node:test'
import {createConversationRequestCoordinator} from '../server/decision-copilot/conversation-request-coordinator.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'conversation-a'}

test('pergunta mais nova cancela a anterior e somente a claim atual pode concluir',()=>{
 const coordinator=createConversationRequestCoordinator()
 const firstController=new AbortController()
 const first=coordinator.begin(scope,firstController)
 assert.equal(coordinator.assertCurrent(first,firstController.signal),true)

 const secondController=new AbortController()
 const second=coordinator.begin(scope,secondController)
 assert.equal(firstController.signal.aborted,true)
 assert.equal(firstController.signal.reason?.code,'val_request_superseded')
 assert.throws(()=>coordinator.assertCurrent(first,firstController.signal),error=>error===firstController.signal.reason)
 assert.equal(coordinator.assertCurrent(second,secondController.signal),true)
 assert.equal(coordinator.release(first),false)
 assert.equal(coordinator.release(second),true)
 assert.equal(coordinator.size(),0)
})

test('conversas e tenants diferentes não se cancelam',()=>{
 const coordinator=createConversationRequestCoordinator()
 const leftController=new AbortController()
 const rightController=new AbortController()
 const left=coordinator.begin(scope,leftController)
 const right=coordinator.begin({...scope,conversationId:'conversation-b'},rightController)
 assert.equal(leftController.signal.aborted,false)
 assert.equal(rightController.signal.aborted,false)
 assert.equal(coordinator.assertCurrent(left,leftController.signal),true)
 assert.equal(coordinator.assertCurrent(right,rightController.signal),true)
})
