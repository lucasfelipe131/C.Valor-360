import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildDecisionIntelligence} from '../server/decision-intelligence.js'
import {buildConversionFoundation} from '../server/conversion-engine.js'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {evaluateResponseGrounding,factMatchesQuestionFacet} from '../server/decision-copilot/response-grounding.js'
import {classifyStructuredClientFact} from '../server/decision-copilot/capability-router.js'
import {classifyValContextDomain,collectionMatchesContextDomain} from '../server/decision-copilot/context-selector.js'
import {extractNaturalClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {ValRepository} from '../server/repository.js'
import {resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'
import {canTransitionVisit} from '../server/visit-loop/lifecycle.js'
import {opportunityFromAdditionalNeed} from '../src/lib/profile.js'
import {buildCommercialIntelligence} from '../src/lib/commercial-intelligence.js'
import {buildInsightFeed} from '../server/execution/insight-card.js'
import {buildLocalHomePriorities} from '../src/lib/copilot-view-model.js'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=path=>readFileSync(join(repositoryRoot,path),'utf8')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const now=Date.now()
const ago=(days,hours=0)=>new Date(now-days*86400000-hours*3600000).toISOString()
const ahead=days=>new Date(now+days*86400000).toISOString()

test('evidência determinística lê registros camelCase (repositório) e nomeia a entidade perguntada',()=>{
 const at=ago(5)
 const intelligence=buildDecisionIntelligence({
  client:{id:'joao',name:'João Pereira',commercial:{}},profile:{},
  opportunities:[{id:'opp-1',clientId:'joao',title:'Venda de KCl',value:80000,stage:'Proposta',nextAction:'Enviar proposta',nextActionAt:ahead(3),updatedAt:at}],
  visits:[{id:'visit-done',clientId:'joao',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:at,summary:'Discutimos adubação.',nextCommitment:'Enviar proposta até sexta',updatedAt:at}],
  interactions:[],businessHistory:[],properties:[]
 })
 const opportunity=intelligence.evidence.find(item=>item.id==='selected-opportunity')
 const visit=intelligence.evidence.find(item=>item.id==='latest-visit')
 assert.equal(opportunity.observed_at,new Date(at).toISOString())
 assert.match(opportunity.claim_supported,/^Oportunidade aberta “Venda de KCl” está em Proposta; valor registrado R\$ 80 mil; próxima ação: Enviar proposta; prazo/)
 assert.equal(visit.observed_at,new Date(at).toISOString())
 assert.match(visit.claim_supported,/^Visita Realizada em \d{2}\/\d{2}\/\d{4}; resumo: Discutimos adubação\.; compromisso: Enviar proposta até sexta\./)
 assert.ok(!intelligence.evidence.some(item=>item.observed_at==='unknown'&&['selected-opportunity','latest-visit'].includes(item.id)))
})

test('motor de conversão não afirma ausência de região, área ou cultura que o contexto recortado não carrega',()=>{
 const foundation=buildConversionFoundation({client:{id:'joao',name:'João Pereira'},opportunities:[],visits:[],interactions:[]},{now:new Date(now)})
 const producer=(foundation.evidence||[]).find(item=>item.id==='conversion-producer-context')
 assert.equal(producer,undefined)
 const withRegion=buildConversionFoundation({client:{id:'joao',name:'João Pereira',municipality:'Cascavel/PR'},opportunities:[],visits:[],interactions:[]},{now:new Date(now)})
 const context=(withRegion.evidence||[]).find(item=>item.id==='conversion-producer-context')
 assert.equal(context.claim_supported,'João Pereira: Cascavel/PR.')
 assert.doesNotMatch(context.claim_supported,/não registrad/)
})

test('escritas por chat são imperativo anafórico com objeto explícito; troca de produtor exige destino',()=>{
 const client={id:'joao',name:'João Pereira'}
 const intent=message=>routeGlobalIntent({message,client})
 assert.equal(intent('Marque o compromisso como concluído.').intent,'MARK_COMPLETE')
 assert.equal(intent('Cria uma visita para amanhã.').intent,'CREATE')
 assert.equal(intent('Atualiza o telefone dele').intent,'UPDATE')
 assert.equal(intent('Muda o telefone dele').intent,'UPDATE')
 assert.equal(intent('Fecha a oportunidade de KCl').intent,'UPDATE')
 assert.equal(intent('registra que ele quer KCl').intent,'REGISTER')
 for(const message of ['quando foi a nova visita?','Atualize-me sobre o João','o que ele comprou?']){
  const route=intent(message)
  assert.equal(route.intent,'ASK',message)
  assert.equal(route.requires_confirmation,false,message)
 }
 for(const message of ['Troca pro Antônio','Muda para o Bruno','Volta pro produtor anterior']){
  const route=intent(message)
  assert.equal(route.reason,'SWITCH_RESOLVED_CLIENT',message)
  assert.equal(route.workspace_action.type,'OPEN_CLIENT',message)
  assert.match(route.summary,/Agora falando de João Pereira/)
 }
})

test('comandos naturais de registro no browser espelham o roteador de sessão do servidor',()=>{
 for(const message of ['registra isso','Registra isso pra mim','salva isso','anote','Registra'])assert.equal(resolveValNaturalCommand(message)?.action,'OPEN_REGISTER',message)
 assert.equal(resolveValNaturalCommand('registra que ele prefere pagamento na safra')?.candidate,'ele prefere pagamento na safra')
 assert.equal(resolveValNaturalCommand('registra a visita de amanhã'),null)
})

test('frase fixa da especificação para resultado insuficiente passa no grounding como lacuna declarada',()=>{
 for(const domain of ['GENERAL','OPPORTUNITY','MULTI_DOMAIN']){
  const grounding=evaluateResponseGrounding({question:'ele tem oportunidade aberta?',answer:'Tenho pouca informação para te orientar com precisão.',domain,evidence:[],activeProducerId:'joao',tenantId,ownerId,field:'recommended_strategy.reading',checkQuestionRelevance:false})
  assert.equal(grounding.passed,true,domain)
 }
 const literal=evaluateResponseGrounding({question:'o que discutimos na última visita?',answer:'Visita Realizada em 26/08/2026; resumo: Discutimos adubação de base.',domain:'VISIT',field:'recommended_strategy.reading',activeProducerId:'joao',tenantId,ownerId,checkQuestionRelevance:false,evidence:[{id:'latest-visit',source_type:'visit',source_ref:'visit:visit-done',epistemic_type:'FACT',statement:'Visita Realizada em 26/08/2026; resumo: Discutimos adubação de base.',observed_at:ago(10),producer_id:'joao',tenant_id:tenantId,owner_id:ownerId}]})
 assert.equal(literal.passed,true,JSON.stringify(literal.claim_ledger))
})

test('oportunidade derivada de relato/voz no PostgreSQL não colide com a oportunidade principal do produtor',async()=>{
 const rows={
  opportunities:[
   {id:11,client_external_key:'joao',external_key:'pipeline:abc',title:'Venda de KCl',estimated_value:80000,stage:'Proposta',next_action:null,next_action_at:null,updated_at:ago(2),evidence:[]},
   {id:12,client_external_key:'joao',external_key:'visit-report:def',title:'Inoculante',estimated_value:0,stage:'Diagnóstico',next_action:null,next_action_at:null,updated_at:ago(1),evidence:[]}
  ]
 }
 const db={configured:true,query:async sql=>{
  if(/FROM opportunities opportunity JOIN clients/.test(sql))return {rows:rows.opportunities,rowCount:rows.opportunities.length}
  if(/FROM import_jobs/.test(sql))return {rows:[],rowCount:0}
  if(/FROM clients c/.test(sql))return {rows:[{external_key:'joao',name:'João Pereira',municipality:'Cascavel/PR',total_area_ha:850,area_band:null,cultures:'Soja',preferred_channel:null,commercial_profile:{},relationship_profile:{},profile_snapshot:{},purchase_total:0,purchase_count:0,last_purchase_at:null,open_pipeline:0}],rowCount:1}
  return {rows:[],rowCount:0}
 }}
 const repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 const intelligence=await repository.getIntelligence('owner-1')
 const ids=intelligence.opportunities.map(item=>item.id)
 assert.deepEqual(ids,['o-joao','o-joao:visit-report:def'])
 assert.equal(new Set(ids).size,2)
})

test('copiloto: orientação geral sem card de ferramenta, seletor de produtor foca a conversa e política do serviço entra no fio',()=>{
 const copilot=read('src/components/GlobalValCopilot.jsx')
 const cards=read('src/components/copilot/DecisionCards.jsx')
 assert.match(copilot,/const generalGuidance=toolResult\?\.tool==='general_guidance'/)
 assert.match(copilot,/\{toolResult&&!generalGuidance\?<GenericToolCard/)
 assert.match(copilot,/action=\{degraded\|\|generalGuidance\?'':strategy\.action\}/)
 assert.match(copilot,/reasoning\.grounding\?\.passed===false/)
 assert.match(copilot,/!degraded&&!toolResult&&intent==='CALCULATE'&&<CalculationCard/)
 assert.match(copilot,/intent==='PREPARE_VISIT'&&toolResult\?\.status!=='CONTEXT_REQUIRED'&&<PrepareVisitCard/)
 assert.match(copilot,/if\(moduleDescriptor\.mode==='select_client'\|\|\(moduleDescriptor\.page==='clients'&&!client\)\)\{setError\(/)
 assert.match(copilot,/\[404,409,422\]\.includes\(Number\(requestError\.status\|\|0\)\)\)append\(\{role:'system',command:serviceCode/)
 assert.match(copilot,/if\(serviceCode==='val_confirmation_required'&&client&&!turnOptions\.conversationMode\)\{setMode\('REGISTER'\)/)
 assert.match(copilot,/requestFailure\.status=response\.status/)
 assert.match(copilot,/thesis\.CURRENT_SITUATION!==answer&&<p><b>Situação:<\/b>/)
 assert.match(cards,/actionLabel=\{onOpen\?presentation\.action:null\}/)
 assert.match(cards,/label="CÁLCULO" title="Leitura do cálculo"/)
})

const ev=(id,ref,field,statement)=>({id,profile_source_ref:ref,source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field,statement,assessed_at:ago(30),valid_until:ahead(300)})
const antonio=scoped({id:'antonio',name:'Antônio Silva',municipality:'Jataí',primaryProfile:'Relacional',decisionDriver:'Decide pela confiança no consultor',technicalPresentation:'Prefere conversa presencial e exemplos de vizinhos',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-antonio',profileEvidence:[ev('pa-1','profile-antonio','decisionDriver','Decide pela confiança no consultor'),ev('pa-2','profile-antonio','technicalPresentation','Prefere conversa presencial e exemplos de vizinhos')]})
const joao=scoped({id:'joao',name:'João Pereira',cultures:'Soja, Milho',totalAreaHa:850,municipality:'Cascavel/PR',primaryProfile:'Analítico',decisionDriver:'Compara custo por hectare antes de decidir',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-joao',profileEvidence:[ev('profile-joao-q7','profile-joao','decisionDriver','Compara custo por hectare antes de decidir')]})
const genor=scoped({id:'genor',name:'Genor Brum',municipality:'Passo Fundo/RS',primaryProfile:'Conservador',profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'profile-genor',profileEvidence:[ev('pg-1','profile-genor','decisionDriver','Decide com segurança e referência de vizinhos')]})
const store={surveys:[],imports:[scoped({id:'import-a',clients:[antonio,joao,genor]})],
 visits:[scoped({id:'visit-done',clientId:'joao',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:ago(10),summary:'Discutimos adubação de base e o preço do fertilizante para a safra.',nextCommitment:'Enviar proposta de KCl até sexta',updatedAt:ago(10)}),scoped({id:'visit-next',clientId:'joao',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:ahead(5),objective:'Apresentar proposta de KCl'})],
 businessEvents:[scoped({id:'evt-won-1',clientId:'joao',outcome:'won',product:'Fertilizante NPK 04-14-08',category:'Fertilizante',quantity:20,unit:'t',value:120000,currency:'BRL',occurredAt:ago(30)})],
 opportunities:[scoped({id:'opp-1',clientId:'joao',title:'Venda de KCl para safra 25/26',category:'Fertilizante',stage:'Proposta',estimatedValue:80000,createdAt:ago(9),updatedAt:ago(5)})],
 val:{commitments:[scoped({commitment_id:'commit-1',client_id:'joao',description:'Enviar proposta de KCl até sexta',status:'open',due_at:ahead(3),created_at:ago(10),updated_at:ago(10),source_ref:'report-1',source_type:'confirmed_visit_report'})],memories:[],visitReports:[]},
 grains:{profiles:[],intentions:[],marketSnapshots:[]}}

async function availablePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
function waitForStartup(child,timeoutMs=30000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}

test('HTTP demo: caminho DEEP/CONTEXT sem modelo responde com o registro autorizado e escritas recebem 409 orientado',async()=>{
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-round3-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,VAL_AI_REQUESTS_PER_10_MINUTES:'500',AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const names={antonio:'Antônio Silva',joao:'João Pereira',genor:'Genor Brum'}
 const turn=async(message,conversationId,clientId='joao')=>{const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId,client:{id:clientId,name:names[clientId]},conversationId,mode:'daily'})});return {status:response.status,payload:await response.json().catch(()=>({}))}}
 try{
  await waitForStartup(child)
  const opportunity=await turn('ele tem oportunidade aberta?','r3-opp')
  assert.equal(opportunity.status,200)
  assert.match(opportunity.payload.advice.answer,/^Oportunidade aberta “Venda de KCl para safra 25\/26” está em Proposta; valor registrado R\$ 80 mil\./)
  assert.ok(opportunity.payload.advice.ai_reasoning.facts_used.some(item=>item.id==='selected-opportunity'),JSON.stringify(opportunity.payload.advice.ai_reasoning.facts_used.map(item=>item.id)))
  assert.equal(opportunity.payload.advice.ai_reasoning.grounding.passed,true)
  const discussed=await turn('o que discutimos na última visita?','r3-visit')
  assert.equal(discussed.status,200)
  assert.match(discussed.payload.advice.answer,/Discutimos adubação de base e o preço do fertilizante para a safra/)
  assert.doesNotMatch(discussed.payload.advice.answer,/Ainda não há visita concluída/)
  const prepare=await turn('prepara a visita dele','r3-prepare')
  assert.equal(prepare.status,200)
  assert.ok(prepare.payload.advice.ai_reasoning.facts_used.length>=1)
  assert.doesNotMatch(prepare.payload.advice.answer,/Não há evidência selecionada suficiente/)
  const changed=await turn('O que mudou desde a última conversa confirmada com este produtor?','r3-changed')
  assert.equal(changed.status,200)
  assert.doesNotMatch(changed.payload.advice.answer,/Ainda não há visita concluída/)
  assert.ok(changed.payload.advice.ai_reasoning.facts_used.length>=1)
  for(const [message,fragment] of [['Atualiza o telefone dele','Cliente 360'],['Muda o telefone dele','Cliente 360'],['Cria uma visita para amanhã.','não cria visitas'],['Marque o compromisso como concluído.','confirmação no módulo canônico']]){
   const write=await turn(message,`r3-write-${fragment.length}-${message.length}`)
   assert.equal(write.status,409,message)
   assert.equal(write.payload.code,'val_canonical_module_required',message)
   assert.match(write.payload.error,new RegExp(fragment),message)
   assert.equal(write.payload.globalIntent.requires_confirmation,true,message)
  }
  const nextVisit=await turn('qual a próxima visita?','r4-next')
  assert.equal(nextVisit.status,200)
  assert.match(nextVisit.payload.advice.answer,/^A próxima visita agendada de João Pereira está marcada para \d{2}\/\d{2}\/\d{4}/)
  const pending=await turn('o que ficou pendente da última visita?','r4-pending')
  assert.equal(pending.status,200)
  assert.match(pending.payload.advice.answer,/Enviar proposta de KCl até sexta/)
  const bought=await turn('o que ele comprou?','r4-bought')
  assert.equal(bought.status,200)
  assert.match(bought.payload.advice.answer,/Fertilizante NPK 04-14-08/)
  const prepareAgain=await turn('prepara a visita dele','r4-prepare')
  assert.equal(prepareAgain.status,200)
  assert.match(prepareAgain.payload.advice.answer,/Compromisso aberto: Enviar proposta de KCl até sexta/)
  const decides=await turn('como ele decide?','r4-decides','antonio')
  assert.equal(decides.status,200)
  assert.match(decides.payload.advice.answer,/^Perfil principal: Relacional/)
  const approach=await turn('como abordar ele na próxima visita?','r4-approach')
  assert.equal(approach.status,200)
  assert.doesNotMatch(approach.payload.advice.answer,/Ainda não há/)
  const byName=await turn('Quero falar sobre o Genor Brum','r4-byname','')
  assert.equal(byName.status,200,JSON.stringify(byName.payload).slice(0,300))
  assert.equal(byName.payload.workspaceAction?.type,'OPEN_CLIENT')
  assert.match(byName.payload.advice.answer,/Agora falando de Genor Brum/)
  const afterByName=await turn('ele tem visita agendada?','r4-byname','')
  assert.equal(afterByName.status,200)
  assert.doesNotMatch(afterByName.payload.advice.answer,/Nenhum produtor está selecionado/)
  const marked=await turn('tem visita marcada?','r4-marked')
  assert.equal(marked.status,200)
  assert.match(marked.payload.advice.answer,/está marcada para/)
  const markedNone=await turn('tem visita marcada?','r4-marked-none','antonio')
  assert.equal(markedNone.status,200)
  assert.doesNotMatch(markedNone.payload.advice.answer,/Visita Realizada/)
  const bare=await turn('Genor Brum','r4-bare','')
  assert.equal(bare.payload.workspaceAction?.type,'OPEN_CLIENT')
  const concept=await turn('quero falar sobre calagem','r4-concept','')
  assert.equal(concept.status,200)
  assert.notEqual(concept.payload.workspaceAction?.type,'OPEN_CLIENT')
  await turn('ele tem oportunidade aberta?','r3-switch')
  const switched=await turn('Troca pro Antônio','r3-switch')
  assert.equal(switched.status,200)
  assert.equal(switched.payload.workspaceAction?.type,'OPEN_CLIENT')
  assert.match(switched.payload.advice.answer,/Agora falando de Antônio Silva/)
 }finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
})

test('cumprimento colado a pergunta conceitual continua conhecimento geral com produtor selecionado',()=>{
 for(const message of ['Oi val o que é wasde?','Oi val, o que é WASDE?','Bom dia val, como funciona o hedge?','o que é basis?']){
  assert.equal(routeValIntent({message,hasClient:true}).intent,'ASK_GENERAL',message)
  assert.equal(routeValIntent({message,hasClient:false}).intent,'ASK_GENERAL',message)
 }
 assert.equal(routeValIntent({message:'Oi val, o que ele comprou?',hasClient:true}).intent,'ASK_CLIENT')
 assert.equal(routeValIntent({message:'Oi val',hasClient:true}).intent,'ASK_GENERAL')
})

test('ciclo de vida da visita: estado terminal não aceita transição para si mesmo',()=>{
 assert.equal(canTransitionVisit('COMPLETED','COMPLETED'),false)
 assert.equal(canTransitionVisit('CANCELLED','CANCELLED'),false)
 assert.equal(canTransitionVisit('PREPARED','PREPARED'),true)
 assert.equal(canTransitionVisit('COMPLETED_PENDING_REVIEW','COMPLETED_PENDING_REVIEW'),true)
 assert.equal(canTransitionVisit('COMPLETED','COMPLETED_PENDING_REVIEW'),false)
 assert.equal(canTransitionVisit('PLANNED','CANCELLED'),true)
})

test('importação: placeholder na Q27 não vira oportunidade e nome sem slug recebe id determinístico',()=>{
 for(const value of ['-','N/A','n/a','x','0','Não sei','Nada a declarar','Não há','Não no momento, obrigado','…'])assert.equal(opportunityFromAdditionalNeed(value),'',value)
 for(const value of ['Não tenho irrigação','Preciso de assistência em armazenagem'])assert.equal(opportunityFromAdditionalNeed(value),value)
 const rows=[{cliente:'***',valor:'1000',data:'2026-01-10',status:'ganho'},{cliente:'???',valor:'2000',data:'2026-01-11',status:'ganho'},{cliente:'Fazenda Boa Vista',valor:'3000',data:'2026-01-12',status:'ganho'}]
 const mapping={client:'cliente',value:'valor',date:'data',status:'status'}
 const clients=buildCommercialIntelligence(rows,mapping)
 const ids=clients.map(item=>item.id)
 assert.equal(new Set(ids).size,ids.length,JSON.stringify(ids))
 for(const id of ids)assert.ok(id.length>0,JSON.stringify(ids))
 assert.equal(ids.filter(id=>id.startsWith('produtor-')).length,2,JSON.stringify(ids))
 assert.equal(clients.length,3)
})

test('Biblioteca: itens de mercado novos chegam ao chat e gatilhos específicos não colidem com o item genérico',()=>{
 const items=read('knowledge/library/v1/knowledge_items.jsonl').split('\n').filter(Boolean).map(line=>JSON.parse(line))
 const byId=new Map(items.map(item=>[item.item_id,item]))
 for(const id of ['KI-159','KI-161','KI-162','KI-163'])assert.ok(byId.get(id).modules.includes('MDI'),id)
 assert.ok(!byId.get('KI-124').triggers.includes('vazio sanitário'))
 assert.ok(!byId.get('KI-126').triggers.includes('escleródio'))
 assert.ok(byId.get('KI-148').triggers.includes('vazio sanitário'))
 assert.ok(byId.get('KI-149').triggers.includes('escleródio'))
 assert.ok(byId.get('KI-054').triggers.includes('limiar econômico'))
 assert.ok(byId.get('KI-096').triggers.includes('excesso de informação'))
 // O README acompanha o acervo real (o loader valida o manifesto; o README não).
 const sources=JSON.parse(read('knowledge/library/v1/source_registry.json'))
 const readme=read('knowledge/library/v1/README.md')
 assert.match(readme,new RegExp('`'+items.length+'` KnowledgeItems'))
 assert.match(readme,new RegExp('`'+(Array.isArray(sources)?sources.length:Object.keys(sources.sources||sources).length)+'` fontes'))
 assert.doesNotMatch(readme,/VAL_Biblioteca_Mestre_v1\.docx/)
 assert.doesNotMatch(read('knowledge/library/v1/ingestion_manifest.json'),/VAL_Biblioteca_Mestre_v1\.docx/)
 assert.match(read('knowledge/library/v1/taxonomy.md'),/commodity_markets/)
})

test('voz contínua: erro sem áudio chega como texto, pausa não é desfeita pelo provider e reconexão espera a pausa',()=>{
 const hook=read('src/hooks/useNaturalRealtimeVoice.js')
 assert.match(hook,/callbacks\.current\.onError\?\.\(message,\{code:`realtime_response_\$\{responseStatus\}`\}\)/)
 assert.doesNotMatch(hook,/onError\?\.\(Object\.assign\(new Error\(message\)/)
 assert.match(hook,/const paused=machineRef\.current\.status===STATES\.PAUSED/)
 assert.match(hook,/if\(type==='session\.created'\|\|type==='session\.updated'\)\{if\(!paused\)update\(/)
 assert.match(hook,/if\(type==='output_audio_buffer\.stopped'\|\|type==='output_audio_buffer\.cleared'\)\{if\(!paused\)update\(/)
 assert.match(hook,/if\(\[STATES\.SPEAKING,STATES\.PAUSED\]\.includes\(machineRef\.current\.status\)\)pendingReconnect\.current=eventScope\.scopeKey/)
 assert.match(read('src/components/GlobalValCopilot.jsx'),/onError=\{message=>setError\(typeof message==='string'\?message:message\?\.message\|\|''\)\}/)
 const visits=read('src/pages/Visits.jsx')
 assert.match(visits,/const historyLifecycle=new Set\(\['COMPLETED','CANCELLED'\]\)/)
 assert.match(visits,/const open=scheduled\.filter\(visit=>!historyLifecycle\.has\(lifecycleOf\(visit\)\)\)/)
 assert.match(visits,/COMPLETED_PENDING_REVIEW:'Aguardando confirmação'/)
 assert.match(visits,/status-pill">\{lifecycleLabels\[lifecycle\]\|\|visit\.status\}</)
 const technical=read('server/technical-workspace.js')
 assert.match(technical,/function handle\(request,response,url,session,\{demoAllowed=runtimeConfig\.demoMode\}=\{\}\)/)
 assert.match(technical,/const resolvedSession=session\|\|\(demoAllowed\?\{email:'demo@valor360\.local'/)
 assert.match(technical,/json\(response,503,\{error:'O núcleo técnico exige VAL_SESSION_SECRET com 32 ou mais caracteres\.'\}\)/)
 assert.match(technical,/function scheduleRestart\(\)/)
 assert.match(read('server.js'),/technicalWorkspace\.handle\(request,response,url,await sessionIdentity\(request\),\{demoAllowed:!auth\.configured&&config\.demoMode\}\)/)
 assert.match(read('server.js'),/if\(config\.trustProxy\)\{const forwarded=String\(request\.headers\['x-forwarded-for'\]/)
})

test('visita pode ser cancelada: idempotente quando já cancelada e 409 sobre visita concluída',async()=>{
 const tenant='00000000-0000-4000-8000-000000000401',owner='00000000-0000-4000-8000-000000000403'
 const planned='00000000-0000-4000-8000-000000000601',completed='00000000-0000-4000-8000-000000000602'
 let store={surveys:[],imports:[],opportunities:[],businessEvents:[],visits:[
  {id:planned,tenantId:tenant,ownerId:owner,clientId:'producer-a',scheduledAt:ahead(3),objective:'Negociar.',status:'Agendada',lifecycleStatus:'PLANNED',createdAt:ago(1),updatedAt:ago(1)},
  {id:completed,tenantId:tenant,ownerId:owner,clientId:'producer-a',scheduledAt:ago(5),objective:'Concluída.',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:ago(5),completedAt:ago(5),createdAt:ago(6),updatedAt:ago(5)}
 ]}
 const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:value=>{store=structuredClone(value)},tenantId:tenant})
 const cancelled=await repository.cancelVisit({tenantId:tenant,ownerId:owner,actorId:owner,visitId:planned,requestId:'req-cancel-1'})
 assert.equal(cancelled.idempotent,false)
 assert.equal(cancelled.visit.lifecycleStatus,'CANCELLED')
 assert.equal(cancelled.visit.status,'Cancelada')
 assert.ok(cancelled.visit.cancelledAt)
 const again=await repository.cancelVisit({tenantId:tenant,ownerId:owner,actorId:owner,visitId:planned,requestId:'req-cancel-2'})
 assert.equal(again.idempotent,true)
 await assert.rejects(()=>repository.cancelVisit({tenantId:tenant,ownerId:owner,actorId:owner,visitId:completed,requestId:'req-cancel-3'}),error=>error.statusCode===409)
 assert.ok(store.val.visitLifecycleEvents.some(event=>event.visitId===planned&&event.toStatus==='CANCELLED'||event.to_status==='CANCELLED'))
 assert.match(read('server.js'),/const visitCancelMatch=url\.pathname\.match\(\/\^\\\/api\\\/v1\\\/visits\\\/\(/)
 assert.match(read('server.js'),/repository\.cancelVisit\(/)
 const visits=read('src/pages/Visits.jsx')
 assert.match(visits,/const canCancel=preVisitVoiceLifecycle\.has\(lifecycle\);/)
 assert.match(visits,/\{canCancel&&<button className="soft-btn is-quiet" type="button" onClick=\{\(\)=>cancelVisit\(visit\)\}/)
 assert.match(read('src/App.jsx'),/onCancelled=\{cancelVisitResult\}/)
})

test('próxima visita: em andamento com data passada continua candidata na Home e no feed do servidor',()=>{
 const now=new Date('2026-08-26T12:00:00.000Z')
 const tenant='00000000-0000-4000-8000-000000000401'
 const context={client:{id:'producer-a',name:'Ana Ribeiro'},contextSnapshot:{organization_id:tenant,context_scope:{tenant_id:tenant,producer_id:'producer-a'}},visits:[
  {id:'visit-progress',scheduledAt:'2026-08-25T12:00:00.000Z',objective:'Negociar fertilizante',status:'Em andamento',lifecycleStatus:'IN_PROGRESS'},
  {id:'visit-late',scheduledAt:'2026-08-24T12:00:00.000Z',objective:'Planejada atrasada',status:'Agendada',lifecycleStatus:'PLANNED'},
  {id:'visit-done',scheduledAt:'2026-08-27T12:00:00.000Z',objective:'Concluída',status:'Realizada',lifecycleStatus:'COMPLETED'}
 ],commitments:[],learning:{}}
 const feed=buildInsightFeed({organizationId:tenant,actor:{id:'actor',role:'consultant'},contexts:[context],now})
 const titles=(feed.items||feed.cards||feed).map?.(item=>item.title)||[]
 assert.ok(titles.some(title=>/Registrar visita em andamento com Ana Ribeiro/.test(title)),JSON.stringify(titles))
 assert.ok(titles.some(title=>/Preparar visita com Ana Ribeiro/.test(title)),JSON.stringify(titles))
 assert.ok(!JSON.stringify(feed).includes('visit:visit-done'))
 const local=buildLocalHomePriorities({upcomingVisits:[{id:'v2',clientId:'p1',scheduledAt:'2026-08-24T12:00:00.000Z',lifecycleStatus:'PLANNED'},{id:'v1',clientId:'p1',scheduledAt:'2026-08-25T12:00:00.000Z',lifecycleStatus:'IN_PROGRESS'}],clients:[{id:'p1',name:'Ana'}]})
 const first=(Array.isArray(local)?local:local.items||[])[0]
 assert.match(first.title,/Registrar visita em andamento com Ana/)
})

test('fallback em arquivo entrega o contrato de oportunidade do PostgreSQL',async()=>{
 const tenant='00000000-0000-4000-8000-000000000401',owner='owner-x'
 const store={surveys:[],imports:[{id:'imp',tenantId:tenant,ownerId:owner,clients:[{id:'c1',name:'Cliente Um',tenantId:tenant,ownerId:owner}]}],visits:[],opportunities:[{id:'o-c1',tenantId:tenant,ownerId:owner,clientId:'c1',title:'Semente',category:'Semente',stage:'Proposta',estimatedValue:5000,createdAt:ago(3)}]}
 const repository=new ValRepository({db:{configured:false},readStore:()=>store,saveStore:()=>{},tenantId:tenant})
 const intelligence=await repository.getIntelligence(owner)
 const [opportunity]=intelligence.opportunities
 assert.equal(opportunity.value,5000)
 assert.equal(opportunity.estimatedValue,5000)
 assert.equal(opportunity.category,'Semente')
 assert.equal(opportunity.candidateKey,'')
 assert.equal(opportunity.probability,null)
 assert.ok(opportunity.updatedAt)
})

test('fatos rápidos em linguagem comum: próxima visita, compromisso pendente, compra, objeção e perfil',()=>{
 assert.equal(classifyStructuredClientFact('qual a próxima visita?'),'NEXT_SCHEDULED_VISIT')
 assert.equal(classifyStructuredClientFact('quando é a próxima visita dele?'),'NEXT_SCHEDULED_VISIT')
 assert.equal(classifyStructuredClientFact('o que ficou pendente da última visita?'),'LATEST_COMMITMENT')
 assert.equal(classifyStructuredClientFact('qual o compromisso pendente?'),'LATEST_COMMITMENT')
 assert.equal(classifyStructuredClientFact('o que ele comprou?'),'LATEST_PURCHASE')
 assert.equal(classifyStructuredClientFact('ele tem alguma objeção?'),'LATEST_CONFIRMED_OBJECTION')
 assert.equal(classifyStructuredClientFact('como ele decide?'),'BEHAVIORAL_PROFILE')
 assert.equal(classifyStructuredClientFact('como lidar com ele?'),'BEHAVIORAL_PROFILE')
 assert.equal(classifyStructuredClientFact('como abordar ele na próxima visita?'),null)
 for(const message of ['como lidar com ele?','qual o estilo dele?','como ele decide?'])assert.equal(classifyValContextDomain(message),'PROFILE',message)
})

test('preparar a próxima visita usa a última visita como evidência; compromisso aberto vira evidência determinística',()=>{
 const fact={id:'latest-visit',source_type:'visit',source_ref:'visit:visit-done',epistemic_type:'FACT',statement:'Visita Realizada em 27/08/2026.',observed_at:ago(10),producer_id:'joao',tenant_id:tenantId,owner_id:ownerId}
 const prepare=evaluateResponseGrounding({question:'me prepara para a próxima visita com ele',answer:fact.statement,domain:'VISIT',evidence:[fact],activeProducerId:'joao',tenantId,ownerId,field:'facts_used.0.statement',checkQuestionRelevance:false})
 assert.equal(prepare.passed,true,JSON.stringify(prepare.claim_ledger))
 const next=evaluateResponseGrounding({question:'qual a próxima visita?',answer:fact.statement,domain:'VISIT',evidence:[fact],activeProducerId:'joao',tenantId,ownerId,field:'facts_used.0.statement',checkQuestionRelevance:false})
 assert.equal(next.passed,false)
 const intelligence=buildDecisionIntelligence({client:{id:'joao',name:'João Pereira',commercial:{}},profile:{},opportunities:[],visits:[],interactions:[],businessHistory:[],properties:[],commitments:[{commitment_id:'commit-1',description:'Enviar proposta de KCl até sexta',status:'open',dueAt:ahead(3),updatedAt:ago(10)},{commitment_id:'commit-0',description:'Antigo',status:'COMPLETED',updatedAt:ago(40)}]})
 const commitment=intelligence.evidence.find(item=>item.id==='open-commitment')
 assert.equal(commitment.source_type,'commitment')
 assert.equal(commitment.source_id,'commit-1')
 assert.match(commitment.claim_supported,/^Compromisso aberto: Enviar proposta de KCl até sexta; prazo \d{2}\/\d{2}\/\d{4}; status open\.$/)
 assert.equal(commitment.observed_at,new Date(ago(10)).toISOString())
})

test('produtor citado pelo nome sem produtor selecionado abre esse produtor (texto e voz transcrita)',()=>{
 for(const [message,expected] of [['Quero falar sobre o Genor Brum','Genor Brum'],['QUERO FALAR SOBRE O GENOR BRUM','GENOR BRUM'],['Sobre o Genor Brum.','Genor Brum'],['fala do Genor','Genor'],['Genor Brum','Genor Brum'],['val, Genor Brum','Genor Brum']]){
  const extracted=extractNaturalClientReference(message)
  assert.equal(extracted.kind,'AUTHORIZED_NAME_CANDIDATE',message)
  assert.equal(extracted.reference,expected,message)
 }
 const genorClient={id:'genor',name:'Genor Brum'}
 for(const message of ['Quero falar sobre o Genor Brum','Sobre o Genor Brum.','Genor Brum','genor','fala do Genor']){
  const route=routeGlobalIntent({message,client:genorClient})
  assert.equal(route.reason,'SWITCH_RESOLVED_CLIENT',message)
  assert.match(route.summary,/Agora falando de Genor Brum/)
 }
 for(const message of ['calagem','o que ele comprou?','quero falar sobre calagem','sobre a safra de trigo','Isso muda a abordagem?'])assert.notEqual(routeGlobalIntent({message,client:genorClient}).reason,'SWITCH_RESOLVED_CLIENT',message)
 for(const message of ['Isso muda a abordagem?','oi val','bom dia','o que é wasde','Bom dia','Obrigado'])assert.notEqual(extractNaturalClientReference(message).kind,'AUTHORIZED_NAME_CANDIDATE',message)
 const matheus={id:'matheus',name:'Matheus Nascimento Jaeger'}
 for(const message of ['e o Matheus?','E o Matheus','e o Matheus Jaeger?']){const route=routeGlobalIntent({message,client:matheus});assert.equal(route.reason,'SWITCH_RESOLVED_CLIENT',message);assert.match(route.summary,/Agora falando de Matheus Nascimento Jaeger/)}
 assert.notEqual(routeGlobalIntent({message:'e o clima hoje?',client:matheus}).reason,'SWITCH_RESOLVED_CLIENT')
 assert.equal(classifyStructuredClientFact('ele tem visita agendada?'),'NEXT_SCHEDULED_VISIT')
})

test('contexto comercial mantém compras e oportunidades que citam insumo ou cultura; objeções no plural são comerciais',()=>{
 assert.equal(collectionMatchesContextDomain({id:'evt-1',product:'Fertilizante NPK 04-14-08',category:'Fertilizante',outcome:'won',value:120000},'business_event','COMMERCIAL','o que ele comprou?'),true)
 assert.equal(collectionMatchesContextDomain({id:'opp-1',title:'Venda de KCl para safra 25/26',stage:'Proposta'},'opportunity','COMMERCIAL','qual a negociação em andamento?'),true)
 assert.equal(classifyValContextDomain('quais foram as objeções dele?'),'COMMERCIAL')
 assert.equal(classifyValContextDomain('qual foi a objeção dele?'),'COMMERCIAL')
 const at=ago(10)
 const intelligence=buildDecisionIntelligence({client:{id:'joao',name:'João Pereira',commercial:{}},profile:{},opportunities:[],interactions:[],businessHistory:[],properties:[],visits:[
  {id:'visit-next',status:'Agendada',lifecycleStatus:'PLANNED',scheduledAt:ahead(5),updatedAt:ago(1)},
  {id:'visit-done',status:'Realizada',lifecycleStatus:'COMPLETED',occurredAt:at,summary:'Discutimos adubação.',updatedAt:at}
 ]})
 const visit=intelligence.evidence.find(item=>item.id==='latest-visit')
 assert.equal(visit.source_id,'visit-done')
 assert.match(visit.claim_supported,/Discutimos adubação/)
})

test('evidência comercial nomeia a compra e o fato literal só vira leitura na faceta da pergunta',()=>{
 const intelligence=buildDecisionIntelligence({client:{id:'joao',name:'João Pereira',commercial:{}},profile:{},opportunities:[],visits:[],interactions:[],properties:[],businessHistory:[{id:'evt-1',outcome:'won',product:'Fertilizante NPK 04-14-08',category:'Fertilizante',value:120000,occurredAt:ago(30)}]})
 const purchase=intelligence.evidence.find(item=>item.id==='latest-business-event')
 assert.match(purchase.claim_supported,/^Compra registrada \(ganha\); categoria Fertilizante; item Fertilizante NPK 04-14-08; valor R\$ 120 mil\./)
 assert.equal(factMatchesQuestionFacet({domain:'VISIT',question:'tem visita marcada?',statement:'Visita Realizada em 27/08/2026.',sourceType:'visit'}),false)
 assert.equal(factMatchesQuestionFacet({domain:'VISIT',question:'o que discutimos na última visita?',statement:'Visita Realizada em 27/08/2026; compromisso: Levar orçamento na próxima semana.',sourceType:'visit'}),true)
 assert.equal(factMatchesQuestionFacet({domain:'COMMERCIAL',question:'o que ele comprou?',statement:purchase.claim_supported,sourceType:'business_history'}),true)
})
