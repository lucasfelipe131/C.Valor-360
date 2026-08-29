import test from 'node:test'
import assert from 'node:assert/strict'
import {extractNaturalClientReference,producerEntityResolverVersion,resolveAuthorizedClientReference} from '../server/decision-copilot/producer-entity-resolver.js'

const portfolio=[
 {id:'antonio',name:'Antônio da Silva',municipality:'Cambé',aliases:['Toninho'],properties:[{id:'p-1',name:'Fazenda Boa Vista'}]},
 {id:'joao-a',name:'João Pereira',municipality:'Londrina'},
 {id:'joao-b',name:'João Souza',municipality:'Maringá'},
]

test('ProducerEntityResolver v1 resolve nome, alias, propriedade e transcrição sem sair da carteira',()=>{
 for(const [reference,id,reason] of [
  ['Antônio da Silva','antonio','EXACT_NAME_MATCH'],
  ['Toninho','antonio','EXACT_ALIAS_MATCH'],
  ['Fazenda Boa Vista','antonio','EXACT_PROPERTY_MATCH'],
  ['Antonio da Slva','antonio','FUZZY_TRANSCRIPT_MATCH'],
 ]){
  const resolution=resolveAuthorizedClientReference({reference,authorizedClients:portfolio})
  assert.equal(resolution.status,'RESOLVED',reference)
  assert.equal(resolution.client.id,id,reference)
  assert.equal(resolution.reason_code,reason,reference)
  assert.equal(resolution.resolver_version,producerEntityResolverVersion)
 }
})

test('homônimo e fuzzy próximo nunca são escolhidos silenciosamente',()=>{
 const exact=resolveAuthorizedClientReference({reference:'João',authorizedClients:portfolio})
 assert.equal(exact.status,'AMBIGUOUS')
 assert.deepEqual(exact.options.map(item=>item.id),['joao-a','joao-b'])
 const unknown=resolveAuthorizedClientReference({reference:'Maria',authorizedClients:[{id:'marina',name:'Marina Souza'}]})
 assert.equal(unknown.status,'NOT_FOUND')
})

test('linguagem operacional extrai produtor sem capturar o módulo como entidade',()=>{
 assert.deepEqual(extractNaturalClientReference('Abra o produtor Antônio.'),{kind:'AUTHORIZED_NAME_CANDIDATE',reference:'Antônio'})
 assert.deepEqual(extractNaturalClientReference('Prepare a visita do João amanhã.'),{kind:'EXPLICIT_NAME',reference:'João'})
 const module=resolveAuthorizedClientReference({message:'Abra a análise de solo.',authorizedClients:portfolio})
 assert.equal(module.status,'NONE')
})

test('ID atual injetado fora da carteira permanece fail-closed',()=>{
 const resolution=resolveAuthorizedClientReference({message:'E o que faço com ele?',authorizedClients:portfolio,currentClientId:'tenant-estranho'})
 assert.equal(resolution.status,'NOT_FOUND')
 assert.equal(resolution.reason_code,'CURRENT_CLIENT_NOT_AUTHORIZED')
})

test('voltar ao produtor anterior usa somente histórico recente autorizado',()=>{
 const resolution=resolveAuthorizedClientReference({message:'Volta para o produtor anterior.',authorizedClients:portfolio,currentClientId:'antonio',recentClientIds:['antonio','joao-a','tenant-estranho']})
 assert.equal(resolution.status,'RESOLVED')
 assert.equal(resolution.client.id,'joao-a')
 assert.equal(resolution.reason_code,'PREVIOUS_CLIENT_RESOLVED')
})
