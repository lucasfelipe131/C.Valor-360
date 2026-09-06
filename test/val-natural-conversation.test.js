import assert from 'node:assert/strict'
import test from 'node:test'
import {
 VAL_NATURAL_COMMAND_POLICY,
 localNaturalCommandTurn,
 naturalCommandMatchesClient,
 naturalCommandNeedsSettledResponse,
 naturalCommandRequest,
 hasValOutputModePreference,
 readValOutputMode,
 resolveValNaturalCommand,
 writeValOutputMode
} from '../src/lib/val-natural-commands.js'
import {assertResponseScopeForRequest,conversationContextEpoch,lastCompletedAssistantTurn,realtimeTurnMatchesScope,safeContextTraceView,verifiedResponseScope} from '../src/lib/full-screen-conversation.js'

const scope={tenantId:'tenant-a',ownerId:'owner-a',conversationId:'thread-a',producerId:'client-a',contextEpoch:2,domain:'COMMERCIAL'}
const responseScope={contractVersion:'val.response_scope.v1',tenantId:'tenant-a',ownerId:'owner-a',producerId:scope.producerId,conversationId:scope.conversationId,contextEpoch:scope.contextEpoch,domain:'COMMERCIAL'}
const payload={responseScope,conversationState:{conversation_id:scope.conversationId,context_epoch:scope.contextEpoch,current_client:{id:scope.producerId}},advice:{answer:'Leitura curta.',ai_reasoning:{reasoning_id:'reasoning-a',organization:{id:'tenant-a'},client:{id:scope.producerId},conversation_id:scope.conversationId,premises:{context_scope:{tenant_id:'tenant-a',owner_id:'owner-a',producer_id:scope.producerId,conversation_id:scope.conversationId,context_epoch:scope.contextEpoch,domain:'COMMERCIAL',minimum_sufficient_context:true},session_context:{tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:scope.conversationId,context_epoch:scope.contextEpoch,current_domain:'COMMERCIAL',current_client:{id:scope.producerId}}},recommended_strategy:{reading:'A margem é o ponto central.',action:'Confirmar o custo por hectare.'},golden_questions:[{question:'Qual área entra?'},{question:'Qual referência de preço?'},{question:'Quem decide?'},{question:'Excedente'}]}}}
const completedTurn=(source=payload)=>({role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',payload:source})
const groundedSource=(source=payload)=>lastCompletedAssistantTurn([completedTurn(source)],scope)

test('comandos naturais reconhecem as formas autorizadas sem reiniciar contexto',()=>{
 const expected=new Map([
  ['Resume.','SUMMARIZE'],['Repete.','REPEAT'],['Explica melhor.','EXPLAIN'],['Só as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],['Só me manda as Perguntas de Ouro.','GOLDEN_QUESTIONS_ONLY'],['Agora me manda só as três perguntas de ouro.','GOLDEN_QUESTIONS_ONLY'],
  ['Agora por escrito.','OUTPUT_TEXT'],['Agora fala comigo.','OUTPUT_AUDIO'],['Agora fala elas pra mim.','OUTPUT_AUDIO'],['Me mostra os números.','SHOW_NUMBERS'],
  ['Por que você acha isso?','EXPLAIN_WHY'],['Registra.','OPEN_REGISTER'],['Não registra.','KEEP_SESSION_ONLY'],
  ['Aprofunda.','DEEPEN'],['Só o essencial.','SET_SIMPLE']
 ])
 for(const [phrase,action] of expected)assert.equal(resolveValNaturalCommand(phrase)?.action,action,phrase)
 assert.equal(resolveValNaturalCommand('Resume isso em uma linha, mantendo o mesmo produtor.')?.action,'SUMMARIZE')
 assert.equal(resolveValNaturalCommand('Me manda isso escrito.')?.action,'OUTPUT_TEXT')
 assert.equal(resolveValNaturalCommand('Fala de novo.')?.action,'OUTPUT_AUDIO')
 assert.deepEqual(VAL_NATURAL_COMMAND_POLICY,{version:'val.natural_commands.v1',persistence:'NONE',keeps_thread:true,changes_confirmed_memory:false})
})

test('registro natural com conteúdo abre revisão e nunca confirma sozinho',()=>{
 const command=resolveValNaturalCommand('Registra que o filho dele participa da decisão.')
 assert.equal(command.action,'OPEN_REGISTER')
 assert.equal(command.persistence,'CONFIRM_REQUIRED')
 assert.equal(command.candidate,'o filho dele participa da decisão')
 assert.match(localNaturalCommandTurn(command,null).text,/Nada será registrado sem sua confirmação/)
})

test('comandos locais reutilizam a resposta atual e limitam Perguntas de Ouro a três',()=>{
 assert.match(localNaturalCommandTurn(resolveValNaturalCommand('Resume'),groundedSource(),scope).text,/A margem é o ponto central/)
 const questions=localNaturalCommandTurn(resolveValNaturalCommand('Só as Perguntas de Ouro'),groundedSource(),scope).text
 assert.match(questions,/1\. Qual área entra/)
 assert.match(questions,/3\. Quem decide/)
 assert.doesNotMatch(questions,/Excedente/)
 const repeated=localNaturalCommandTurn(resolveValNaturalCommand('Repete'),groundedSource(),scope)
 assert.equal(repeated.role,'assistant_text')
 assert.equal(repeated.mode,'FAST')
 assert.equal(repeated.status,'completed')
 assert.equal(repeated.text,'A margem é o ponto central.')
 assert.equal(repeated.conversationId,'thread-a')
 assert.equal(repeated.producerId,'client-a')
 assert.equal(repeated.contextEpoch,2)
 assert.equal(repeated.serverGrounded,true)
 assert.equal(repeated.grounding,'DERIVED_FROM_SERVER_GROUNDED')
 for(const phrase of ['Resume','Repete','Só as Perguntas de Ouro','Fala de novo'])assert.equal(naturalCommandNeedsSettledResponse(resolveValNaturalCommand(phrase)),true,phrase)
 for(const phrase of ['Agora por escrito','Texto e áudio','Só o essencial'])assert.equal(naturalCommandNeedsSettledResponse(resolveValNaturalCommand(phrase)),false,phrase)
})

test('resumo local do browser devolve uma linha sem repetir a resposta ou anexar próximo passo',()=>{
 const longPayload={...payload,advice:{ai_reasoning:{...payload.advice.ai_reasoning,recommended_strategy:{reading:'Antônio prioriza nutrição nesta visita. O histórico também registra objeção de preço. A abertura deve validar o objetivo.',action:'Montar uma preparação completa.'}}}}
 const command=resolveValNaturalCommand('Resume sua resposta anterior em uma linha, mantendo Antônio como produtor atual e sem executar nova busca.')
 const turn=localNaturalCommandTurn(command,groundedSource(longPayload),scope)
 assert.equal(turn.text,'Antônio prioriza nutrição nesta visita.')
 assert.doesNotMatch(turn.text,/objeção|Próximo passo|preparação completa/i)
 assert.equal(naturalCommandMatchesClient(command,{name:'Antônio Carlos'}),true)
 assert.equal(naturalCommandMatchesClient(command,{name:'Carlos Oliveira'}),false)
})

test('resumo local respeita o limite explícito de 500 caracteres',()=>{
 const longPayload={...payload,advice:{ai_reasoning:{...payload.advice.ai_reasoning,recommended_strategy:{reading:'x'.repeat(900)}}}}
 const turn=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),groundedSource(longPayload),scope)
 assert.equal(turn.text.length,500)
})

test('follow-up falha fechado quando qualquer dimensão 6D ou a proveniência não coincide',()=>{
 for(const field of ['tenantId','ownerId','conversationId','producerId','contextEpoch','domain']){
  const changed={...scope,[field]:field==='contextEpoch'?scope.contextEpoch+1:field==='domain'?'PROFILE':`${scope[field]}-other`}
  assert.throws(()=>lastCompletedAssistantTurn([completedTurn()],changed),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField===field&&error.reason==='mismatch',field)
  assert.throws(()=>localNaturalCommandTurn(resolveValNaturalCommand('Resume'),completedTurn(),changed),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField===field,field)
 }
 const unscoped={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',payload:{advice:{ai_reasoning:{recommended_strategy:{reading:'POISON_OLD'}}}}}
 assert.throws(()=>lastCompletedAssistantTurn([unscoped],scope),error=>error.code==='val_follow_up_scope_mismatch'&&error.reason==='missing')
 for(const missing of ['tenantId','ownerId','producerId','conversationId','contextEpoch','domain']){
  const incomplete={...scope};delete incomplete[missing]
  assert.throws(()=>lastCompletedAssistantTurn([completedTurn()],incomplete),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField===missing&&error.reason==='missing_active_scope',missing)
 }
})

test('responseScope canônico rotula consulta pontual de B sem relabel pelo estado persistido de A',()=>{
 const scopedB={contractVersion:'val.response_scope.v1',tenantId:'tenant-a',ownerId:'owner-a',producerId:'client-b',conversationId:'thread-a',contextEpoch:2,domain:'PROFILE'}
 const payloadB={responseScope:scopedB,conversationState:{tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-a',context_epoch:2,current_client:{id:'client-a'}},advice:{answer:'Perfil de B.',ai_reasoning:{organization:{id:'tenant-a'},client:{id:'client-b'},conversation_id:'thread-a',premises:{context_scope:{tenant_id:'tenant-a',owner_id:'owner-a',producer_id:'client-b',conversation_id:'thread-a',context_epoch:2,domain:'PROFILE',minimum_sufficient_context:true},session_context:{tenant_id:'tenant-a',owner_id:'owner-a',conversation_id:'thread-a',context_epoch:2,current_domain:'PROFILE',current_client:{id:'client-b'}}},recommended_strategy:{reading:'Perfil de B.'}}}}
 assert.deepEqual(verifiedResponseScope(payloadB),scopedB)
 assert.equal(assertResponseScopeForRequest(payloadB,{conversationId:'thread-a',producerId:'client-b'}).producerId,'client-b')
 const responseB={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',payload:payloadB}
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),responseB],scope),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='producerId'&&error.reason==='mismatch')
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),{...responseB,producerId:'client-a'}],{...scope,producerId:'client-b'}),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='producerId'&&error.scopeSource==='turn.producerId')
})

test('verificador do browser exige context_scope completo, epoch e domínio canônicos',()=>{
 const withoutContext={...payload,advice:{...payload.advice,ai_reasoning:{...payload.advice.ai_reasoning,premises:{session_context:payload.advice.ai_reasoning.premises.session_context}}}}
 assert.throws(()=>verifiedResponseScope(withoutContext),error=>error.scopeField==='context_scope'&&error.reason==='missing')
 const wrongDomain=structuredClone(payload);wrongDomain.advice.ai_reasoning.premises.context_scope.domain='GRAINS'
 assert.throws(()=>verifiedResponseScope(wrongDomain),error=>error.scopeField==='domain'&&error.reason==='mismatch')
 const bogusEpoch=structuredClone(payload);bogusEpoch.advice.ai_reasoning.premises.context_scope.context_epoch='bogus'
 assert.throws(()=>verifiedResponseScope(bogusEpoch),error=>error.scopeField==='contextEpoch'&&error.reason==='invalid')
 const unsafeEpoch=structuredClone(payload);unsafeEpoch.responseScope.contextEpoch=Number.MAX_SAFE_INTEGER+1;unsafeEpoch.advice.ai_reasoning.premises.context_scope.context_epoch=Number.MAX_SAFE_INTEGER+1;unsafeEpoch.advice.ai_reasoning.premises.session_context.context_epoch=Number.MAX_SAFE_INTEGER+1
 assert.throws(()=>verifiedResponseScope(unsafeEpoch),error=>error.scopeField==='responseScope'&&error.reason==='invalid')
 const factual={...payload,responseScope:{...payload.responseScope,domain:'FACTUAL'}}
 assert.throws(()=>verifiedResponseScope(factual),error=>error.scopeField==='responseScope'&&error.reason==='invalid')
})

test('payload contraditório bloqueia o follow-up sem recuar para turno antigo compatível',()=>{
 const poisoned={...payload,responseScope:{...responseScope,producerId:'client-b'}}
 const latest={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',payload:poisoned}
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),latest],scope),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='producerId'&&error.reason==='mismatch'&&error.scopeSource==='reasoning.client.id')
})

test('seletor ignora turno incompleto, mas não atravessa um concluído incompatível',()=>{
 const pending={role:'assistant_text',status:'pending',text:'INCOMPLETO',...scope}
 assert.equal(lastCompletedAssistantTurn([completedTurn(),pending],scope).text,'A margem é o ponto central.')
 const poison={role:'assistant_text',status:'completed',serverGrounded:true,grounding:'DERIVED_FROM_SERVER_GROUNDED',text:'POISON_OLD',conversationId:'thread-old',producerId:scope.producerId,contextEpoch:scope.contextEpoch}
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),poison],scope),error=>error.scopeField==='sourceResponseId'&&error.reason==='missing')
})

test('conversa sem produtor: follow-up local encontra a última resposta concluída',()=>{
 const generalScope={...scope,producerId:null,domain:'GENERAL'}
 const general=structuredClone(payload)
 general.responseScope={...general.responseScope,producerId:null,domain:'GENERAL'}
 general.conversationState={...general.conversationState,current_client:null}
 general.advice.ai_reasoning.client={id:'portfolio',name:'Conversa geral'}
 general.advice.ai_reasoning.premises.context_scope={...general.advice.ai_reasoning.premises.context_scope,producer_id:'',domain:'GENERAL'}
 general.advice.ai_reasoning.premises.session_context={...general.advice.ai_reasoning.premises.session_context,current_domain:'GENERAL',current_client:null}
 const turn={role:'assistant',status:'completed',serverGrounded:true,grounding:'SERVER_RETURNED',producerId:null,conversationId:scope.conversationId,contextEpoch:scope.contextEpoch,domain:'GENERAL',payload:general}
 assert.equal(lastCompletedAssistantTurn([turn],generalScope).text,'A margem é o ponto central.')
 assert.throws(()=>lastCompletedAssistantTurn([turn],scope),error=>error.scopeField==='producerId'&&error.reason==='mismatch')
})

test('turno de usuário pendente bloqueia fallback para resposta antiga do mesmo thread',()=>{
 const pendingUser={role:'user',text:'Pergunta nova ainda sem resposta',...scope}
 // Pergunta que terminou em erro nao e pendencia: o follow-up volta a ler a ultima resposta concluida.
 const failedUser={role:'user',text:'Pergunta que falhou',status:'failed',...scope}
 assert.equal(lastCompletedAssistantTurn([completedTurn(),failedUser],scope).text,'A margem é o ponto central.')
 assert.equal(lastCompletedAssistantTurn([completedTurn(),failedUser,{role:'system',text:'Ainda não há um produtor ativo nesta conversa.'}],scope).text,'A margem é o ponto central.')
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),pendingUser],scope),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='turn'&&error.reason==='pending_user_turn')
 assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),pendingUser,{role:'assistant_text',status:'pending',text:'INCOMPLETO',...scope}],scope),error=>error.scopeField==='turn'&&error.reason==='pending_user_turn')
 const newPayload=structuredClone(payload)
 newPayload.advice.ai_reasoning.reasoning_id='reasoning-after-user'
 newPayload.advice.ai_reasoning.recommended_strategy.reading='RESPOSTA_APÓS_PERGUNTA.'
 assert.equal(lastCompletedAssistantTurn([completedTurn(),pendingUser,completedTurn(newPayload)],scope).text,'RESPOSTA_APÓS_PERGUNTA.')
})

test('assistant_text só é elegível por cadeia FAST até resposta canônica do mesmo escopo completo',()=>{
 const canonical=completedTurn()
 const first=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),lastCompletedAssistantTurn([canonical],scope),scope)
 const normalizedFirst=lastCompletedAssistantTurn([canonical,first],{...scope,tenantId:'tenant-a',ownerId:'owner-a',domain:'COMMERCIAL'})
 assert.equal(normalizedFirst.canonicalResponseId,'reasoning-a')
 assert.equal(normalizedFirst.sourceResponseId,'reasoning-a')
 assert.equal(normalizedFirst.tenantId,'tenant-a')
 assert.equal(normalizedFirst.ownerId,'owner-a')
 assert.equal(normalizedFirst.domain,'COMMERCIAL')
 assert.equal(normalizedFirst.provenanceDepth,1)
 const second=localNaturalCommandTurn(resolveValNaturalCommand('Repete'),normalizedFirst,scope)
 const normalizedSecond=lastCompletedAssistantTurn([canonical,first,second],{...scope,tenantId:'tenant-a',ownerId:'owner-a',domain:'COMMERCIAL'})
 assert.equal(normalizedSecond.canonicalResponseId,'reasoning-a')
 assert.equal(normalizedSecond.sourceResponseId,first.responseId)
 assert.equal(normalizedSecond.provenanceDepth,2)

 for(const poison of [
  {...first,sourceResponseId:null},
  {...first,sourceResponseId:'response-inexistente'},
  {...first,tenantId:'tenant-b'},
  {...first,ownerId:'owner-b'},
  {...first,domain:'GRAINS'},
  {...first,producerId:'client-b'},
  {...first,contextEpoch:scope.contextEpoch+1},
  {...first,contextEpoch:Number.MAX_SAFE_INTEGER+1}
 ])assert.throws(()=>lastCompletedAssistantTurn([canonical,poison],scope),error=>error.code==='val_follow_up_scope_mismatch')

 const unverifiedRoot={...canonical,serverGrounded:false,responseId:'unverified-root'}
 assert.throws(()=>lastCompletedAssistantTurn([unverifiedRoot,{...first,sourceResponseId:'unverified-root'}],scope),error=>error.scopeField==='sourceResponseId'&&error.reason==='unverified')
 const duplicateRoot={...canonical,responseId:'reasoning-a'}
 assert.throws(()=>lastCompletedAssistantTurn([canonical,duplicateRoot,first],scope),error=>error.scopeField==='sourceResponseId'&&error.reason==='ambiguous')
})

test('transcript realtime não verificado bloqueia Resume, Repete e Por quê sem fallback canônico',()=>{
 const browserTranscript={role:'assistant_text',status:'incomplete',serverGrounded:false,grounding:'UNVERIFIED_BROWSER_TRANSCRIPT',followUpEligible:false,text:'ASSISTANT_BROWSER_POISON',intent:'REALTIME_CONVERSATION',...scope}
 for(const phrase of ['Resume','Repete','Por que']){
  const command=resolveValNaturalCommand(phrase)
  assert.equal(naturalCommandNeedsSettledResponse(command),true,phrase)
  assert.throws(()=>lastCompletedAssistantTurn([completedTurn(),browserTranscript],scope),error=>error.code==='val_follow_up_scope_mismatch'&&error.scopeField==='grounding'&&error.reason==='unverified',phrase)
 }
})

test('callback realtime de epoch antigo não corresponde ao escopo renderizado atual',()=>{
 const old={conversationId:scope.conversationId,clientId:scope.producerId,contextEpoch:scope.contextEpoch,sessionId:'session-old'}
 const current={conversationId:scope.conversationId,clientId:scope.producerId,contextEpoch:scope.contextEpoch+1}
 assert.equal(realtimeTurnMatchesScope(old,current),false)
 assert.equal(realtimeTurnMatchesScope({...old,contextEpoch:current.contextEpoch},current),true)
})

test('Resume encadeia com Resume e Repete usando sempre o último assistant_text compatível',()=>{
 const firstSource=lastCompletedAssistantTurn([completedTurn()],scope)
 const first=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),firstSource,scope)
 const secondSource=lastCompletedAssistantTurn([completedTurn(),first],scope)
 const second=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),secondSource,scope)
 const repeatedSource=lastCompletedAssistantTurn([completedTurn(),first,second],scope)
 const repeated=localNaturalCommandTurn(resolveValNaturalCommand('Repete'),repeatedSource,scope)
 assert.equal(second.text,first.text)
 assert.equal(repeated.text,second.text)
 assert.equal(second.sourceResponseId,first.responseId)
 assert.equal(repeated.sourceResponseId,second.responseId)
})

test('áudio local usa exatamente o mesmo texto do último turno concluído',()=>{
 const summary=localNaturalCommandTurn(resolveValNaturalCommand('Resume'),lastCompletedAssistantTurn([completedTurn()],scope),scope)
 const audio=localNaturalCommandTurn(resolveValNaturalCommand('Fala de novo'),lastCompletedAssistantTurn([completedTurn(),summary],scope),scope)
 assert.equal(audio.command,'OUTPUT_AUDIO')
 assert.equal(audio.text,summary.text)
 assert.equal(audio.answer,summary.text)
 assert.equal(audio.sourceResponseId,summary.responseId)
})

test('Perguntas de Ouro antigas nunca substituem uma resposta concluída mais recente',()=>{
 const golden=localNaturalCommandTurn(resolveValNaturalCommand('Só as Perguntas de Ouro'),lastCompletedAssistantTurn([completedTurn()],scope),scope)
 const newPayload={...payload,advice:{ai_reasoning:{...payload.advice.ai_reasoning,reasoning_id:'reasoning-new',recommended_strategy:{reading:'RESPOSTA_NOVA.',action:'Agir.'},golden_questions:[]}}}
 const latest=lastCompletedAssistantTurn([completedTurn(),golden,completedTurn(newPayload)],scope)
 const repeated=localNaturalCommandTurn(resolveValNaturalCommand('Repete'),latest,scope)
 const audio=localNaturalCommandTurn(resolveValNaturalCommand('Fala de novo'),latest,scope)
 assert.equal(repeated.text,'RESPOSTA_NOVA.')
 assert.equal(audio.text,'RESPOSTA_NOVA.')
 assert.doesNotMatch(`${repeated.text} ${audio.text}`,/Qual área entra/)
})

test('epoch ativo vem da última resposta de backend compatível, não de assistant_text stale',()=>{
 const stale={role:'assistant_text',status:'completed',text:'stale',conversationId:scope.conversationId,producerId:scope.producerId,contextEpoch:99}
 assert.equal(conversationContextEpoch([completedTurn(),stale],scope),scope.contextEpoch)
})

test('Context Trace só é exposto com safe=true e remove IDs e conteúdo livre',()=>{
 const unsafe=safeContextTraceView({context_trace:{safe:false,domain:'PROFILE',selected:[{sourceType:'visit',sourceId:'CPF 123'}]}})
 assert.equal(unsafe,null)
 const view=safeContextTraceView({premises:{context_scope:{domain:'PROFILE'}},context_trace:{safe:true,selected:[{sourceType:'behavioral_profile',sourceId:'CPF 123',reasonSelected:'BEHAVIORAL_EVIDENCE',statement:'texto livre'},{sourceType:'cpf_123',reasonSelected:'CLIENT_MATHEUS'}],rejected:[{sourceType:'val_memory',sourceId:'contrato',reasonSelected:'DOMAIN_MISMATCH'}]}})
 assert.deepEqual(view,{domain:'PROFILE',selected:[{sourceType:'behavioral_profile',reasonSelected:'BEHAVIORAL_EVIDENCE'}],rejected:[{sourceType:'val_memory',reasonSelected:'DOMAIN_MISMATCH'}]})
 assert.doesNotMatch(JSON.stringify(view),/CPF|contrato|texto livre/)
})

test('aprofundar, explicar, números e por quê geram follow-up explícito sem mudar memória',()=>{
 for(const phrase of ['Aprofunda','Explica melhor','Me mostra os números','Por que']){
  const command=resolveValNaturalCommand(phrase)
  assert.equal(command.local,false)
  assert.equal(command.persistence,'NONE')
  assert.ok(naturalCommandRequest(command,phrase).length>20)
 }
})

test('preferência texto/áudio/ambos é escopada e persiste sem contaminar outro login',()=>{
 const values=new Map()
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}
 assert.equal(writeValOutputMode('tenant-a:owner-a','both',storage),'both')
 assert.equal(hasValOutputModePreference('tenant-a:owner-a',storage),true)
 assert.equal(readValOutputMode('tenant-a:owner-a',storage),'both')
 assert.equal(hasValOutputModePreference('tenant-b:owner-b',storage),false)
 assert.equal(readValOutputMode('tenant-b:owner-b',storage),'text')
 assert.equal(writeValOutputMode('tenant-a:owner-a','inválido',storage),'text')
})
