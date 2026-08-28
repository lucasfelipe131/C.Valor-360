import test from 'node:test'
import assert from 'node:assert/strict'
import {ValRepository} from '../server/repository.js'
import {clientReferenceResolutionVersion,extractNaturalClientReference,normalizeClientReference,resolveAuthorizedClientReference} from '../server/decision-copilot/client-reference-resolver.js'

const tenantA='tenant-natural-a'
const tenantB='tenant-natural-b'
const ownerA='owner-natural-a'
const ownerB='owner-natural-b'

const fallbackRepository=store=>new ValRepository({
 db:{configured:false},tenantId:tenantA,
 readStore:()=>structuredClone(store),saveStore:()=>{},
})

test('normaliza acentos e extrai referência de frases naturais sem capturar o tempo',()=>{
 assert.equal(normalizeClientReference('  ANTÔNIO d’Ávila  '),'antonio d avila')
 assert.deepEqual(extractNaturalClientReference('VAL, amanhã vou no Antônio.'),{kind:'EXPLICIT_NAME',reference:'Antônio'})
 assert.deepEqual(extractNaturalClientReference('Vou visitar o João amanhã.'),{kind:'EXPLICIT_NAME',reference:'João'})
 assert.deepEqual(extractNaturalClientReference('Como está o João?'),{kind:'AUTHORIZED_NAME_CANDIDATE',reference:'João'})
 assert.deepEqual(extractNaturalClientReference('Como está o cliente João?'),{kind:'EXPLICIT_NAME',reference:'João'})
 assert.deepEqual(extractNaturalClientReference('Volta pro José da Silva.'),{kind:'EXPLICIT_NAME',reference:'José da Silva'})
 assert.deepEqual(extractNaturalClientReference('Qual é o preço da soja?'),{kind:'NONE',reference:null})
})

test('pergunta genérica Como está só vira referência com evidência na carteira autorizada',()=>{
 const authorizedClients=[{id:'client-joao',name:'João Lima',municipality:'Londrina'}]
 const joao=resolveAuthorizedClientReference({message:'Como está o João?',authorizedClients})
 assert.equal(joao.status,'RESOLVED')
 assert.equal(joao.client.id,'client-joao')
 assert.equal(joao.reference_kind,'AUTHORIZED_NAME_CANDIDATE')

 for(const message of ['Como está o mercado?','Como está a soja?','Como está a análise de solo?','Como está o clima hoje?']){
  const topic=resolveAuthorizedClientReference({message,authorizedClients})
  assert.equal(topic.status,'NONE',message)
  assert.equal(topic.reason_code,'AUTHORIZED_NAME_EVIDENCE_ABSENT',message)
  assert.equal(topic.client,null,message)
 }
})

test('padrão inequívoco de cliente continua pedindo correção quando o nome não existe',()=>{
 const resolution=resolveAuthorizedClientReference({
  message:'Como está o cliente Mercado?',
  authorizedClients:[{id:'client-joao',name:'João Lima'}],
 })
 assert.equal(resolution.status,'NOT_FOUND')
 assert.equal(resolution.reference_kind,'EXPLICIT_NAME')
 assert.equal(resolution.reason_code,'CLIENT_REFERENCE_NOT_FOUND')
})

test('candidato autorizado preserva desambiguação por homônimo',()=>{
 const resolution=resolveAuthorizedClientReference({
  message:'Como está o João?',
  authorizedClients:[
   {id:'joao-cambe',name:'João Silva',municipality:'Cambé'},
   {id:'joao-londrina',name:'João Souza',municipality:'Londrina'},
  ],
 })
 assert.equal(resolution.status,'AMBIGUOUS')
 assert.deepEqual(resolution.options.map(option=>option.id),['joao-cambe','joao-londrina'])
})

test('resolução 0 retorna NOT_FOUND e não inventa cliente semelhante',()=>{
 const resolution=resolveAuthorizedClientReference({
  message:'Vou visitar a Maria amanhã.',
  authorizedClients:[{id:'client-marina',name:'Marina Souza'}],
 })
 assert.equal(resolution.contract_version,clientReferenceResolutionVersion)
 assert.equal(resolution.status,'NOT_FOUND')
 assert.equal(resolution.reason_code,'CLIENT_REFERENCE_NOT_FOUND')
 assert.equal(resolution.client,null)
 assert.deepEqual(resolution.options,[])
})

test('resolução 1 ignora acento e sinaliza troca explícita de cliente',()=>{
 const resolution=resolveAuthorizedClientReference({
  message:'Troca o cliente para o Antonio Silva.',
  authorizedClients:[
   {id:'client-joao',name:'João Lima',municipality:'Londrina'},
   {id:'client-antonio',name:'Antônio Silva',municipality:'Cambé'},
  ],
  currentClientId:'client-joao',
 })
 assert.equal(resolution.status,'RESOLVED')
 assert.equal(resolution.reason_code,'EXACT_NAME_MATCH')
 assert.deepEqual(resolution.client,{id:'client-antonio',name:'Antônio Silva',municipality:'Cambé'})
 assert.equal(resolution.previous_client.id,'client-joao')
 assert.equal(resolution.changed_client,true)
})

test('resolução N preserva homônimos e exige desambiguação',()=>{
 const resolution=resolveAuthorizedClientReference({
  message:'VAL, amanhã vou no Antônio.',
  authorizedClients:[
   {id:'antonio-1',name:'Antônio Silva',municipality:'Cambé'},
   {id:'antonio-2',name:'Antonio Silva',municipality:'Londrina'},
   {id:'joao-1',name:'João Santos',municipality:'Maringá'},
  ],
 })
 assert.equal(resolution.status,'AMBIGUOUS')
 assert.equal(resolution.reason_code,'AMBIGUOUS_CLIENT_REFERENCE')
 assert.equal(resolution.client,null)
 assert.deepEqual(resolution.options.map(item=>item.id),['antonio-1','antonio-2'])
 assert.deepEqual(resolution.options.map(item=>item.municipality),['Cambé','Londrina'])
})

test('pronome só reutiliza cliente atual quando o ID foi reconciliado na carteira autorizada',()=>{
 const authorizedClients=[{id:'own-client',name:'João Próprio'}]
 const accepted=resolveAuthorizedClientReference({message:'E o que você recomenda para ele?',authorizedClients,currentClientId:'own-client'})
 assert.equal(accepted.status,'RESOLVED')
 assert.equal(accepted.client.id,'own-client')
 assert.equal(accepted.reason_code,'CURRENT_CLIENT_RESOLVED')

 const rejected=resolveAuthorizedClientReference({message:'E o que você recomenda para ele?',authorizedClients,currentClientId:'browser-injected-client'})
 assert.equal(rejected.status,'NOT_FOUND')
 assert.equal(rejected.reason_code,'CURRENT_CLIENT_NOT_AUTHORIZED')
 assert.equal(rejected.client,null)
})

test('fallback lista somente referências do tenant e owner autenticados e não deduplica homônimos por nome',async()=>{
 const repository=fallbackRepository({imports:[
  {tenantId:tenantA,ownerId:ownerA,id:'import-own',clients:[
   {id:'own-1',name:'José Souza',municipality:'Cambé'},
   {id:'own-2',name:'José Souza',municipality:'Londrina'},
  ]},
  {tenantId:tenantA,ownerId:ownerB,id:'import-owner-b',clients:[{id:'owner-b',name:'José Souza'}]},
  {tenantId:tenantB,ownerId:ownerA,id:'import-tenant-b',clients:[{id:'tenant-b',name:'José Souza'}]},
  {id:'unscoped-import',clients:[{id:'unscoped',name:'José Souza'}]},
 ]})
 const references=await repository.listAuthorizedClientReferences({tenantId:tenantA,ownerId:ownerA})
 assert.deepEqual(references.map(item=>item.id),['own-1','own-2'])

 const resolution=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,message:'Vou visitar o José amanhã.'})
 assert.equal(resolution.status,'AMBIGUOUS')
 assert.deepEqual(resolution.options.map(item=>item.id),['own-1','own-2'])
})

test('fallback não aceita nome ou ID declarados pelo browser fora da carteira',async()=>{
 const repository=fallbackRepository({imports:[
  {tenantId:tenantA,ownerId:ownerA,clients:[{id:'own-client',name:'Cliente Próprio'}]},
  {tenantId:tenantB,ownerId:ownerA,clients:[{id:'foreign-client',name:'Cliente Estrangeiro'}]},
 ]})
 const byName=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,reference:'Cliente Estrangeiro'})
 assert.equal(byName.status,'NOT_FOUND')
 const byId=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,reference:'foreign-client'})
 assert.equal(byId.status,'NOT_FOUND')
 const current=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,message:'Fale dele',currentClientId:'foreign-client'})
 assert.equal(current.status,'NOT_FOUND')
})

test('candidato Como está não usa cliente homônimo de outro tenant ou owner como evidência',async()=>{
 const repository=fallbackRepository({imports:[
  {tenantId:tenantA,ownerId:ownerB,clients:[{id:'owner-b-joao',name:'João Lima'}]},
  {tenantId:tenantB,ownerId:ownerA,clients:[{id:'tenant-b-joao',name:'João Lima'}]},
 ]})
 const resolution=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,message:'Como está o João?'})
 assert.equal(resolution.status,'NONE')
 assert.equal(resolution.reason_code,'AUTHORIZED_NAME_EVIDENCE_ABSENT')
 assert.equal(resolution.client,null)
})

test('cross-tenant e ausência de owner falham fechados antes de consultar a carteira',async()=>{
 const repository=fallbackRepository({imports:[]})
 await assert.rejects(
  repository.listAuthorizedClientReferences({tenantId:tenantB,ownerId:ownerA}),
  error=>error?.statusCode===403&&error?.code==='cross_tenant_scope_denied',
 )
 await assert.rejects(
  repository.resolveAuthorizedClientReference({tenantId:tenantA,message:'Vou visitar o João.'}),
  error=>error?.statusCode===403&&error?.code==='owner_scope_required',
 )
})

test('PostgreSQL aplica tenant, owner e status ativo na consulta leve',async()=>{
 let captured
 const repository=new ValRepository({
  tenantId:tenantA,readStore:()=>({}),saveStore:()=>{},
  db:{configured:true,query:async(sql,params)=>{
   captured={sql,params}
   return {rows:[{external_key:'client-db',name:'Antônio DB',municipality:'Maringá'}]}
  }},
 })
 const resolution=await repository.resolveAuthorizedClientReference({tenantId:tenantA,ownerId:ownerA,message:'Vou visitar o Antonio DB.'})
 assert.equal(resolution.status,'RESOLVED')
 assert.equal(resolution.client.id,'client-db')
 assert.deepEqual(captured.params,[tenantA,ownerA])
 assert.match(captured.sql,/tenant_id=\$1/)
 assert.match(captured.sql,/consultant_id=\$2/)
 assert.match(captured.sql,/status='active'/)
 assert.doesNotMatch(captured.sql,/ILIKE|LOWER\(/)
})
