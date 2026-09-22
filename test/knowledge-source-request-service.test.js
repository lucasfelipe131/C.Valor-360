import test from 'node:test'
import assert from 'node:assert/strict'
import {createKnowledgeSourceRequestService} from '../server/knowledge/source-request-service.js'
import {routeShape} from '../server/observability.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const requestKey='a'.repeat(32)
const admin={id:'u1',email:'admin@val.test',role:'admin',tenantId}
const reviewer={id:'u2',email:'agronomo@val.test',role:'technical_reviewer',tenantId}
const consultant={id:'u3',email:'consultor@val.test',role:'consultant',tenantId}
const source={title:'Ficha',publisher:'MAPA/AGROFIT',url:'https://agrofit.agricultura.gov.br/x',authority:'A',excerpt:'trecho',accessed_at:'2026-09-22T12:00:00.000Z'}
const status=work=>work().then(()=>null,error=>error.statusCode)

function service({found=true}={}){
 const calls=[]
 const store={
  list:async input=>{calls.push({op:'list',...input});return []},
  transition:async input=>{calls.push({op:'transition',...input});return found?{...input,status:input.next}:null}
 }
 return {calls,api:createKnowledgeSourceRequestService({store})}
}

// Aprovar uma fonte muda o que a VAL responde para a organização inteira. Quem faz isso é quem
// responde tecnicamente por ela.
test('revisão é restrita à administração e à revisão técnica',async()=>{
 const {api}=service()
 assert.equal(await status(()=>api.list({identity:consultant})),403)
 assert.equal(await status(()=>api.approve({identity:consultant,requestKey,source})),403)
 assert.equal(await status(()=>api.list({identity:{...admin,role:'manager'}})),403)
 assert.equal(await status(()=>api.list({identity:{...admin,role:'bi_viewer'}})),403)
 assert.ok((await api.list({identity:admin})).requests)
 assert.ok((await api.list({identity:reviewer})).requests)
})

test('sem organização ou sem acesso nomeado não há a quem atribuir a resposta',async()=>{
 const {api}=service()
 assert.equal(await status(()=>api.list({identity:{...admin,tenantId:''}})),403)
 assert.equal(await status(()=>api.list({identity:{...admin,demo:true}})),403)
 assert.equal(await status(()=>api.list({identity:{...admin,email:'',id:''}})),403)
 assert.equal(await status(()=>api.list({})),403)
})

test('a aprovação grava quem aprovou e carrega tenant e chave até a loja',async()=>{
 const {api,calls}=service()
 await api.approve({identity:reviewer,requestKey,source})
 assert.deepEqual(calls.at(-1),{op:'transition',tenantId,requestKey,next:'APPROVED',source,actor:'agronomo@val.test'})
 await api.reject({identity:admin,requestKey,reason:'fora de escopo'})
 assert.equal(calls.at(-1).next,'REJECTED')
 assert.equal(calls.at(-1).rejectionReason,'fora de escopo')
 assert.equal(calls.at(-1).actor,'admin@val.test')
 await api.review({identity:admin,requestKey})
 assert.equal(calls.at(-1).next,'UNDER_REVIEW')
})

test('chave malformada não chega à loja e pedido inexistente responde 404',async()=>{
 const {api,calls}=service()
 assert.equal(await status(()=>api.review({identity:admin,requestKey:'nope'})),400)
 assert.equal(await status(()=>api.review({identity:admin,requestKey:'A'.repeat(31)})),400)
 assert.equal(calls.length,0)
 const missing=service({found:false})
 assert.equal(await status(()=>missing.api.review({identity:admin,requestKey})),404)
})

test('sem PostgreSQL a fila responde indisponível em vez de fingir vazia',async()=>{
 const api=createKnowledgeSourceRequestService({store:null})
 assert.equal(api.available,false)
 assert.equal(await status(()=>api.list({identity:admin})),503)
 assert.equal(await status(()=>api.approve({identity:admin,requestKey,source})),503)
 // O papel é verificado antes da disponibilidade: consultor não descobre a topologia do ambiente.
 assert.equal(await status(()=>api.list({identity:consultant})),403)
})

test('a rota de revisão não vaza a chave do pedido no log',()=>{
 assert.equal(routeShape(`/api/v1/knowledge/source-requests/${requestKey}`),'/api/v1/knowledge/source-requests/:id')
 assert.equal(routeShape('/api/v1/knowledge/source-requests'),'/api/v1/knowledge/source-requests')
})
