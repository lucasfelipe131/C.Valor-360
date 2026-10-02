import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {registeredFactPresentation,registeredFactQuery} from '../server/registered-fact-query.js'
import {buildFastClientResponse,routeSystemCapability} from '../server/decision-copilot/capability-router.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const otherTenant='00000000-0000-4000-8000-000000000002'
const ownerId='demo@valor360.local'
const question='Qual é o nome da esposa dele?'

test('H09 consulta conjugal é literal e não descarta outra pergunta ou recomendação',()=>{
 for(const message of [question,'Como se chama a esposa dele?','Quem é o marido dela?','Qual é o nome do cônjuge deste produtor?','Qual é o nome da esposa do Produtor Alfa?'])assert.deepEqual(registeredFactQuery(message),{kind:'spouse'},message)
 for(const message of ['Qual é o nome da esposa dele e o hobby?','Qual é o nome da esposa dele? E qual foi a última visita?','Qual é o nome da esposa dele e recomende um manejo?','Como a esposa dele participa da decisão?','Qual é o nome da esposa do Produtor Alfa e qual o perfil dele?']){
  assert.equal(registeredFactQuery(message),null,message)
  assert.notEqual(routeSystemCapability({message,hasClient:true}).data_path,'REGISTERED_DETAIL',message)
 }
 assert.deepEqual(extractNaturalClientReference('Qual é o nome da esposa do Produtor Alfa?'),{kind:'FACT_OWNER',reference:'alfa'})
 for(const relation of ['vizinho','irmão','pai','amigo']){
  const message=`Qual é o nome da esposa do ${relation} dele?`
  assert.equal(registeredFactQuery(message),null,message)
  assert.equal(extractNaturalClientReference(message).kind,'EXPLICIT_NAME',message)
 }
 const longName='José Antônio Carlos Pedro Paulo da Silva'
 assert.deepEqual(registeredFactQuery(`Qual é o nome da esposa do ${longName}?`),{kind:'spouse'})
 assert.deepEqual(extractNaturalClientReference(`Qual é o nome da esposa do ${longName}?`),{kind:'FACT_OWNER',reference:'jose antonio carlos pedro paulo da silva'})
})

test('H09 somente spouse canônico vira fato; família, relato e conversa não fornecem nome',()=>{
 const client={id:'producer-b',name:'Produtor Beta',tenant_id:tenantId,owner_id:ownerId,client_id:'producer-b',relationship:{family:'A esposa do vizinho chama-se FAMILIA_NAO_CANONICA.'}}
 const presentation=registeredFactPresentation({query:{kind:'spouse'},client,narratives:[{id:'visit-b',text:'A esposa chama-se RELATO_NAO_CANONICO.',source_type:'visit'}]})
 assert.equal(presentation.primaryFound,false)
 assert.deepEqual(presentation.factsUsed,[])
 assert.match(presentation.answer,/Informação ausente: nome do cônjuge no cadastro deste produtor/)
 assert.doesNotMatch(presentation.answer,/FAMILIA_NAO_CANONICA|RELATO_NAO_CANONICO/)
 const valid=registeredFactPresentation({query:{kind:'spouse'},client:{...client,relationship:{spouse:'Nome Literal Sintético'}}})
 assert.match(valid.answer,/Cônjuge registrado de Produtor Beta: Nome Literal Sintético/)
 const request={facts:{client},presentationOverride:valid,message:question,organizationId:tenantId,ownerId,contextDomain:'GENERAL'}
 assert.equal(buildFastClientResponse(request).advice.ai_reasoning.grounding.passed,true)
 for(const foreign of [{owner_id:'foreign-owner'},{tenant_id:otherTenant},{producer_id:'producer-a'}]){
  assert.throws(()=>buildFastClientResponse({...request,presentationOverride:{...valid,factsUsed:valid.factsUsed.map(item=>({...item,...foreign}))}}),error=>error.code==='CONTEXT_SCOPE_VIOLATION')
 }
})

test('H09 HTTP consulta e ausência canônicas são FAST sem modelo e isoladas após agronomia',async()=>{
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
 const directory=await mkdtemp(join(tmpdir(),'val-spouse-fact-'))
 const scope=value=>({tenantId,ownerId,...value})
 const clients=[scope({id:'producer-a',name:'Produtor Alfa',relationship:{spouse:'CONJUGE_ALFA_EXCLUSIVO'},updatedAt:new Date().toISOString()}),scope({id:'producer-b',name:'Produtor Beta',relationship:{family:'Esposa: FAMILIA_B_NAO_CANONICA'},updatedAt:new Date().toISOString()}),scope({id:'producer-long-name',name:'José Antônio Carlos Pedro Paulo da Silva',relationship:{spouse:'CONJUGE_NOME_LONGO'},updatedAt:new Date().toISOString()})]
 const store={surveys:[],imports:[scope({id:'import-own',clients}),{tenantId,ownerId:'foreign-owner',id:'import-other-owner',clients:[{id:'producer-b',name:'Produtor Beta',relationship:{spouse:'CONJUGE_OUTRO_OWNER'}},{id:'foreign-producer',name:'Produtor Oculto',relationship:{spouse:'CONJUGE_OCULTO'}}]},{tenantId:otherTenant,ownerId,id:'import-other-tenant',clients:[{id:'producer-b',name:'Produtor Beta',relationship:{spouse:'CONJUGE_OUTRO_TENANT'}}]}],visits:[scope({id:'visit-b',clientId:'producer-b',status:'Realizada',occurredAt:new Date().toISOString(),summary:'Esposa: RELATO_B_NAO_CANONICO'})],val:{conversations:[],recommendations:[],feedback:[]}}
 await writeFile(join(directory,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),DATA_DIR:directory,VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'60',AUTO_MIGRATE:'false',DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',chunk=>{log+=chunk});child.stderr.on('data',chunk=>{log+=chunk})
 const turn=async(message,clientId,conversationId)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:{id:clientId,name:'UNTRUSTED_CLIENT',relationship:{spouse:'FORGED_REQUEST_NAME'}},conversationId,mode:'daily'})})
  return {status:response.status,payload:await response.json()}
 }
 const assertFast=(result,producer)=>{
  assert.equal(result.status,200,JSON.stringify(result.payload))
  const reasoning=result.payload.advice.ai_reasoning
  assert.equal(reasoning.run.path,'FAST')
  assert.equal(reasoning.run.model_call_count,0)
  assert.equal(reasoning.grounding.passed,true)
  assert.equal(result.payload.responseScope.domain,'GENERAL')
  assert.equal(result.payload.responseScope.producerId,producer)
  assert.doesNotMatch(JSON.stringify(result.payload.advice),/CONJUGE_OUTRO_OWNER|CONJUGE_OUTRO_TENANT|CONJUGE_OCULTO|FORGED_REQUEST_NAME|FAMILIA_B_NAO_CANONICA|RELATO_B_NAO_CANONICO/)
 }
 try{
  for(let attempt=0;attempt<100&&!log.includes('VALOR 360 disponível na porta');attempt++){if(child.exitCode!==null)assert.fail(log);await delay(50)}
  assert.ok(log.includes('VALOR 360 disponível na porta'),log)
  const agronomy=await turn('O que fazer diante da resistência de plantas daninhas?','producer-b','spouse-b')
  assert.equal(agronomy.status,200)
  assert.equal(agronomy.payload.responseScope.domain,'AGRONOMY')
  const absent=await turn(question,'producer-b','spouse-b');assertFast(absent,'producer-b')
  assert.match(absent.payload.advice.answer,/Informação ausente: nome do cônjuge no cadastro deste produtor/)
  assert.equal(absent.payload.conversationState.context_epoch,agronomy.payload.conversationState.context_epoch+1)
  const known=await turn(question,'producer-a','spouse-a');assertFast(known,'producer-a')
  assert.match(known.payload.advice.answer,/Cônjuge registrado de Produtor Alfa: CONJUGE_ALFA_EXCLUSIVO/)
  const absentAgain=await turn(question,'producer-b','spouse-b');assertFast(absentAgain,'producer-b')
  assert.doesNotMatch(absentAgain.payload.advice.answer,/CONJUGE_ALFA_EXCLUSIVO/)
  const named=await turn('Qual é o nome da esposa do Produtor Alfa?','producer-b','spouse-b');assertFast(named,'producer-a')
  assert.match(named.payload.advice.answer,/CONJUGE_ALFA_EXCLUSIVO/)
  assert.equal(named.payload.conversationState.current_client.id,'producer-b','consulta nominal pontual não troca o produtor ativo')
  const afterNamed=await turn(question,'producer-b','spouse-b');assertFast(afterNamed,'producer-b')
  assert.doesNotMatch(afterNamed.payload.advice.answer,/CONJUGE_ALFA_EXCLUSIVO/)
  const longName=await turn('Qual é o nome da esposa do José Antônio Carlos Pedro Paulo da Silva?','producer-b','spouse-b');assertFast(longName,'producer-long-name')
  assert.match(longName.payload.advice.answer,/CONJUGE_NOME_LONGO/)
  assert.equal(longName.payload.conversationState.current_client.id,'producer-b')
  for(const [message,clientId,conversationId] of [['Qual é o nome da esposa do Produtor Oculto?','producer-b','spouse-b'],[question,'foreign-producer','spouse-foreign'],['Qual é o nome da esposa de Ana Paula Maria Isabel da Silva Oliveira?','producer-a','spouse-a'],...['vizinho','irmão','pai','amigo'].map(relation=>[`Qual é o nome da esposa do ${relation} dele?`,'producer-a','spouse-a'])]){
   const denied=await turn(message,clientId,conversationId)
   assert.ok([404,422].includes(denied.status),JSON.stringify(denied))
   assert.doesNotMatch(JSON.stringify(denied.payload),/CONJUGE_ALFA_EXCLUSIVO|CONJUGE_OCULTO|CONJUGE_OUTRO_OWNER|CONJUGE_OUTRO_TENANT/)
  }
 }finally{
  const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve()
  child.kill('SIGTERM');await exited;await rm(directory,{recursive:true,force:true})
 }
})
