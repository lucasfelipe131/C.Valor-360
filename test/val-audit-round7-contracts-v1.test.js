import assert from 'node:assert/strict'
import test from 'node:test'
import {spawn} from 'node:child_process'
import {mkdtemp as mkdtempAsync,rm as rmAsync,writeFile as writeFileAsync} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildOpportunityWorkspace,filterOpportunities} from '../src/lib/opportunity-workspace.js'
import {visitLifecycle,visitMoment} from '../src/lib/home-command-center.js'

const repositoryRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const tenantId='00000000-0000-4000-8000-000000000001'
const ownerId='demo@valor360.local'
const scoped=value=>({tenantId,ownerId,...value})
const now=Date.now()
const ago=days=>new Date(now-days*86400000).toISOString()
const ahead=days=>new Date(now+days*86400000).toISOString()
const read=relative=>readFileSync(join(repositoryRoot,relative),'utf8')

async function availablePort(){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});const {port}=probe.address();await new Promise(resolve=>probe.close(resolve));return port}
function waitForStartup(child,timeoutMs=45000){return new Promise((resolve,reject)=>{let out='',err='',done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value)};const timer=setTimeout(()=>finish(reject,new Error(`timeout ${err}`)),timeoutMs);child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('VALOR 360 disponível na porta'))finish(resolve)});child.stderr.on('data',chunk=>{err+=chunk});child.once('exit',code=>finish(reject,new Error(`exit ${code} ${err}`)))})}
async function withServer(store,fn,extraEnv={}){
 const dataRoot=await mkdtempAsync(join(tmpdir(),'val-r7-'))
 await writeFileAsync(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const port=await availablePort()
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:'',...extraEnv},stdio:['ignore','pipe','pipe']})
 try{await waitForStartup(child);return await fn({base:`http://127.0.0.1:${port}`})}
 finally{
  child.kill('SIGTERM')
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})
  await rmAsync(dataRoot,{recursive:true,force:true})
 }
}
const askVal=base=>async(message,open={},conversationId)=>{
 const response=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:conversationId||`r7-${Math.random().toString(36).slice(2)}`,mode:'daily',...open})})
 const payload=await response.json().catch(()=>({}))
 return {status:response.status,answer:String(payload?.advice?.answer||payload?.error||'').replace(/\s+/g,' '),client:payload?.advice?.ai_reasoning?.client?.name||''}
}

// O identificador externo do ERP/app de campo pertence ao consultor, não ao tenant: sem o dono na
// chave, o laudo e o NDVI de um consultor eram reescritos para o produtor de outro, e a venda do
// segundo era engolida — os dois casos com HTTP 202 accepted:true.
test('a chave de identificador externo da integração é escopada pelo dono',()=>{
 const schema=read('database/schema.sql')
 const migration=read('database/migrations/20260909_011_owner_scoped_external_ids_expand.sql')
 for(const table of ['business_events','field_reports','ndvi_observations']){
  assert.match(schema,new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS owner_user_id`),table)
  assert.match(schema,new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_owner_external ON ${table}\\(tenant_id,owner_user_id,source,external_id\\)`),table)
  assert.match(migration,new RegExp(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_tenant_id_source_external_id_key`),table)
  assert.match(migration,new RegExp(`UPDATE ${table} target SET owner_user_id=client\\.consultant_id`),table)
 }
 const repository=read('server/repository.js')
 // Nenhuma escrita dessas três tabelas pode continuar apontando para a chave sem dono.
 // soil_analyses fica de fora: ali a protecao ja e o prefixo `manual-soil:<ownerId>:` no external_id.
 for(const table of ['business_events','field_reports','ndvi_observations']){
  const insert=repository.slice(repository.indexOf(`INSERT INTO ${table} (`))
  assert.match(insert.slice(0,4000),/ON CONFLICT \(tenant_id,owner_user_id,source,external_id\)/,table)
 }
 assert.ok((repository.match(/ON CONFLICT \(tenant_id,owner_user_id,source,external_id\)/g)||[]).length>=4)
 // O recibo não pode mais dizer "aceito" quando a linha não entrou.
 assert.match(repository,/DO NOTHING RETURNING id/)
 assert.match(repository,/business_event_external_id_conflict/)
})

// O balde protegia conta nenhuma (bastava trocar de IP) e transformava uso normal em bloqueio
// coletivo: oito logins CERTOS trancavam a equipe inteira atrás do proxy ou de um NAT. O caminho de
// login exige PostgreSQL, então o comportamento foi medido contra um banco real e aqui fica o
// contrato das três propriedades que a correção precisa manter.
test('o freio de login cobra a tentativa que falha, não a que dá certo, e a chave inclui a conta',()=>{
 const server=read('server.js')
 // (1) a checagem acontece antes de autenticar e NAO consome cota
 assert.match(server,/function rateLimitAllows\(scope,key,limit\)/)
 assert.match(server,/if\(!rateLimitAllows\('login',loginKey,config\.loginAttemptsPerTenMinutes\)\)return json\(response,429/)
 // (2) a chave inclui a conta, nao so o endereco de origem
 assert.match(server,/const loginKey=`\$\{requestIdentity\(request\)\}\|\$\{String\(payload\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)\}`/)
 // (3) so a tentativa que falha consome, e o sucesso limpa o balde
 assert.match(server,/if\(!identity\)\{consumeRateLimit\('login',loginKey,config\.loginAttemptsPerTenMinutes\);return json\(response,401/)
 assert.match(server,/rateBuckets\.delete\(`login:\$\{loginKey\}`\)/)
 const loginBlock=server.slice(server.indexOf("url.pathname==='/api/auth/login'"),server.indexOf("url.pathname==='/api/auth/logout'"))
 assert.ok(loginBlock.indexOf('rateLimitAllows')<loginBlock.indexOf('accessRepository.authenticate'),'a checagem vem antes de autenticar')
 assert.ok(loginBlock.indexOf('accessRepository.authenticate')<loginBlock.indexOf("consumeRateLimit('login'"),'a cobranca vem depois de autenticar')
})

// Regressão da rodada 6: o padrão FACT_OWNER passou a aceitar "perfil do X" e transformou
// substantivo comum em produtor inexistente.
test('substantivo comum depois de "perfil do" não vira produtor inexistente',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja',totalAreaHa:850})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  for(const open of [{clientId:'joao',client:{id:'joao',name:'João Pereira'}},{}])
   for(const message of ['qual o perfil do solo?','qual o potencial do mercado de soja?']){
    const result=await ask(message,open)
    assert.equal(result.status,200,`${message} -> ${result.answer}`)
    assert.doesNotMatch(result.answer,/na sua carteira autorizada/,message)
   }
  // O ganho da rodada 6 continua: nome de produtor com qualificador no meio resolve.
  const named=await ask('qual o perfil do João Pereira?',{})
  assert.equal(named.status,200,named.answer)
 })
})

// Regressão da rodada 6: a ordenação aberto-primeiro era incondicional, então a pergunta neutra
// chamava de "último" um registro antigo só por estar aberto.
test('a pergunta neutra devolve o compromisso mais recente e a pendente devolve o aberto',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja'})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],visits:[],businessEvents:[],opportunities:[],
  val:{commitments:[
   scoped({id:'k-antigo',clientId:'joao',description:'Enviar cotação de trigo',status:'open',dueAt:ahead(30),createdAt:ago(40),updatedAt:ago(40)}),
   scoped({id:'k-recente',clientId:'joao',description:'Levar amostra ao laboratório',status:'COMPLETED',dueAt:ago(2),createdAt:ago(9),updatedAt:ago(1)})],memories:[],visitReports:[]},
  grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const open={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  const neutral=await ask('qual foi o último compromisso?',open)
  assert.equal(neutral.status,200,neutral.answer)
  assert.match(neutral.answer,/amostra ao laboratório/)
  const pending=await ask('qual o compromisso pendente?',open)
  assert.equal(pending.status,200,pending.answer)
  assert.match(pending.answer,/cotação de trigo/)
  assert.match(pending.answer,/compromisso em aberto/)
 })
})

// Regressão da rodada 6: a ponte de conceito geral desviava qualquer frase sem palavra contextual,
// e o follow-up curto perdia o produtor aberto.
test('follow-up curto não perde o produtor ativo, e o conceito geral continua respondendo',async()=>{
 const joao=scoped({id:'joao',name:'João Pereira',municipality:'Cascavel/PR',cultures:'Soja',
  primaryProfile:'Relacional',decisionDriver:'Decide pela confiança no consultor',
  profileUpdatedAt:ago(30),profileValidUntil:ahead(300),profileSourceRef:'p-joao',
  profileEvidence:[{id:'e1',profile_source_ref:'p-joao',source_type:'producer_questionnaire',epistemic_type:'OBSERVATION',field:'decisionDriver',statement:'Decide pela confiança no consultor',assessed_at:ago(30),valid_until:ahead(300)}]})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[joao]})],
  visits:[scoped({id:'v1',clientId:'joao',scheduledAt:ahead(4),status:'planejada',lifecycleStatus:'PLANNED',objective:'Apresentar proposta de KCl'})],
  businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await withServer(store,async({base})=>{
  const ask=askVal(base)
  const open={clientId:'joao',client:{id:'joao',name:'João Pereira'}}
  const conversationId=`seq-${Math.random().toString(36).slice(2)}`
  const first=await ask('qual a próxima visita?',open,conversationId)
  assert.equal(first.client,'João Pereira',first.answer)
  const followUp=await ask('e a objeção?',open,conversationId)
  assert.equal(followUp.status,200,followUp.answer)
  assert.equal(followUp.client,'João Pereira',`o follow-up não pode virar conversa geral: ${followUp.answer}`)
  // A ponte da rodada 6 continua valendo para conceito de verdade.
  for(const message of ['lixiviacao de potassio','o que e basis?','fala sobre ferrugem asiática']){
   const withProducer=await ask(message,open)
   const withoutProducer=await ask(message,{})
   assert.equal(withProducer.answer,withoutProducer.answer,message)
  }
 })
})

// Regressão da rodada 6: a Home trocou de fonte mas não de recorte, e passou a somar negócio
// perdido e arquivado no degrau "Fechado" do funil.
test('a Home usa o mesmo recorte do quadro, e não conta perdido nem arquivado',()=>{
 const joao={id:'joao',name:'João Pereira',commercial:{potential:0,potentialValidated:false}}
 const persisted=[
  {id:'db:1',databaseId:1,clientId:'joao',candidateKey:'manual:a',title:'Foliar soja',stage:'Negociação',value:100000,valueKnown:true,status:'open',evidence:[]},
  {id:'db:2',databaseId:2,clientId:'joao',candidateKey:'manual:b',title:'Barter milho',stage:'Fechado',value:50000,valueKnown:true,status:'won',evidence:[]},
  {id:'db:3',databaseId:3,clientId:'joao',candidateKey:'manual:c',title:'KCl safrinha',stage:'Fechado',value:80000,valueKnown:true,status:'lost',evidence:[]},
  {id:'db:4',databaseId:4,clientId:'joao',candidateKey:'manual:d',title:'Semente 2029',stage:'Fechado',value:30000,valueKnown:true,status:'archived',evidence:[]}
 ]
 const board=filterOpportunities(buildOpportunityWorkspace([joao],persisted),{archived:false})
 const closed=board.filter(item=>item.stage==='Fechado')
 assert.equal(closed.length,1)
 assert.equal(closed.reduce((total,item)=>total+Number(item.value||0),0),50000)
 const dashboard=read('src/pages/Dashboard.jsx')
 assert.match(dashboard,/filterOpportunities\(buildOpportunityWorkspace\(clients,opportunities\),\{archived:false\}\)/)
})

// O Cliente 360 lia só o array cru e dizia "Nenhuma oportunidade ativa" para o produtor que a Home,
// a tela de Clientes e o quadro contavam como 1 — a mesma divergência que a rodada 6 corrigiu na Home.
test('o Cliente 360 conta oportunidade pela mesma fonte da Home',()=>{
 const joao={id:'joao',name:'João Pereira',additionalNeed:'Ampliar armazenagem',additionalNeedStatus:'reported',
  commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'},potential:120000,potentialValidated:true}}
 const activeOf=items=>items.filter(item=>!/fechado|ganho|perdido|cancelado|closed|won|lost/i.test(String(item.stage||''))).length
 // Sem nenhuma oportunidade persistida, a projeção do cadastro é a única — e as duas telas veem 1.
 assert.equal(activeOf(buildOpportunityWorkspace([joao],[])),1)
 assert.equal(activeOf([]),0,'o array cru é justamente o que contava zero')
 const client360=read('src/pages/Client360.jsx')
 assert.match(client360,/const ownOpportunities=buildOpportunityWorkspace\(\[client\],scopedRecords\(opportunities,client\)\)/)
 // O tile de crédito não pode negar o dado que a aba Crédito da mesma tela mostra.
 assert.match(client360,/label="Sinal de crédito" value=\{knownCredit\?/)
 assert.doesNotMatch(client360,/label="Sinal de crédito" detail="Sem informação de crédito"/)
})

// finite() transformava campo vazio em 0 e o derivado ia sempre no payload: salvar o cadastro de um
// produtor sem potencial gravava "Potencial em aberto = R$ 0" e apagava o "A medir".
test('o cadastro não grava potencial em aberto quando a base é desconhecida',()=>{
 const editor=read('src/components/ProducerProfileEditor.jsx')
 assert.match(editor,/const totalPotentialKnown=String\(form\.commercial\.potentialTotal\?\?''\)\.trim\(\)!==''/)
 assert.match(editor,/const openPotential=totalPotentialKnown\?Math\.max\(0,totalPotential-currentPurchases\):null/)
 assert.match(editor,/commercial:\{\.\.\.form\.commercial,\.\.\.\(openPotential===null\?\{\}:\{openPotential\}\)\}/)
})

// O critério da agenda era próprio da Home: aceitava visita PLANNED com data no passado e só filtrava
// cancelamento por uma regex ancorada em status.
test('a agenda da Home não conta visita atrasada nem cancelada como compromisso futuro',()=>{
 const now=Date.now()
 const visits=[
  {id:'futura',scheduledAt:ahead(2),lifecycleStatus:'PLANNED',status:'Planejada'},
  {id:'atrasada',scheduledAt:ago(20),lifecycleStatus:'PLANNED',status:'Planejada'},
  {id:'cancelada',scheduledAt:ahead(1),lifecycleStatus:'CANCELLED',status:'Cancelada pelo produtor'},
  {id:'andamento',scheduledAt:ago(1),lifecycleStatus:'IN_PROGRESS',status:'Em andamento'}
 ]
 const upcoming=visits.filter(visit=>{
  const lifecycle=visitLifecycle(visit)
  if(['CANCELLED','COMPLETED','COMPLETED_PENDING_REVIEW'].includes(lifecycle))return false
  if(lifecycle==='IN_PROGRESS')return true
  const moment=visitMoment(visit)
  return Boolean(moment)&&moment.getTime()>=now
 })
 assert.deepEqual(upcoming.map(visit=>visit.id),['futura','andamento'])
 const dashboard=read('src/pages/Dashboard.jsx')
 assert.match(dashboard,/const moment=visitMoment\(visit\)/)
 assert.match(dashboard,/\['CANCELLED','COMPLETED','COMPLETED_PENDING_REVIEW'\]\.includes\(lifecycle\)\)return false/)
})

// Cotação com mais de 24 h derrubava a conversa com HTTP 400: o texto da resposta é também o
// statement da evidência, e a ressalva de atualidade começava com o pronome "Ela", que o guardião de
// evidência global lia como afirmação sobre um indivíduo. Além disso o rótulo prometia "esta semana"
// (168 h) enquanto o contrato de evidência aceita 72 h — a faixa entre as duas sempre virava 400.
test('cotação de ontem responde com a ressalva de atualidade, sem quebrar a conversa',async()=>{
 const {buildFastMarketResponse}=await import('../server/decision-copilot/capability-router.js')
 const {evaluateResponseGrounding}=await import('../server/decision-copilot/response-grounding.js')
 const tenant='00000000-0000-4000-8000-000000000001'
 const owner='demo@valor360.local'
 const reference=new Date('2026-09-09T12:00:00.000Z')
 const snapshotAged=hours=>[{id:'ms-1',commodity:'soja',marketKind:'spot',region:'Cascavel/PR',price:128,priceUnit:'BRL/sc',sourceName:'Cepea',sourceType:'public_index',confidence:.9,observedAt:new Date(reference.getTime()-hours*3600000).toISOString(),status:'active',tenantId:tenant,contextOwnerId:owner,scope:'MARKET'}]
 const answerFor=hours=>buildFastMarketResponse({workspace:{marketSnapshots:snapshotAged(hours)},message:'qual o preço da soja hoje?',organizationId:tenant,ownerId:owner,clientId:'joao',clientName:'João Pereira',conversationId:'c1',contextEpoch:1,now:reference})
 // Dentro da janela que o contrato de evidência aceita, a conversa não pode quebrar.
 for(const hours of [1,23,25,48,71]){
  const result=answerFor(hours)
  assert.ok(['CURRENT','DATED'].includes(result.responseMetadata?.currentDataStatus),`${hours}h -> ${result.responseMetadata?.currentDataStatus}`)
  assert.match(result.advice.answer,/R\$\s*128,00/,`${hours}h -> ${result.advice.answer}`)
 }
 // A ressalva continua sendo lida pelo consultor, agora sem o pronome solto.
 const dated=answerFor(25)
 assert.match(dated.advice.answer,/confirme uma atualização antes de tratá-la como preço de hoje/)
 assert.doesNotMatch(dated.advice.answer,/\bEla é\b/)
 // E o guardião de evidência global aceita esse texto como fato de mercado.
 const grounding=evaluateResponseGrounding({question:'qual o preço da soja hoje?',answer:dated.advice.answer,
  evidence:[{id:'ms-1',source_type:'market_snapshot',epistemic_type:'FACT',scope:'MARKET',producer_id:null,tenant_id:tenant,context_owner_id:owner,observed_at:new Date(reference.getTime()-25*3600000).toISOString(),confidence:.7,statement:dated.advice.answer}],
  activeProducerId:'',tenantId:tenant,ownerId:owner,checkQuestionRelevance:false,now:reference})
 assert.equal(grounding.provenance_violations.length,0,JSON.stringify(grounding.provenance_violations))
 // A janela do rótulo é a mesma do contrato de evidência: nada promete "esta semana".
 const router=read('server/decision-copilot/capability-router.js')
 assert.match(router,/if\(hours<=72\)return \{state:'DATED'/)
 assert.doesNotMatch(router,/label:'registrada nesta semana'/)
 assert.match(router,/label:'dos últimos três dias'/)
})

// A forma mais comum da fala de campo ("o antonio tem ...") não tinha padrão nenhum: a referência
// saía NONE, o produtor aberto permanecia e a VAL respondia com os dados DELE, sem dizer de quem eram.
test('pergunta que nomeia outro produtor não é respondida com o produtor aberto',async()=>{
 const {extractNaturalClientReference}=await import('../server/decision-copilot/producer-entity-resolver.js')
 for(const question of ['o antonio tem oportunidade aberta?','a maria comprou adubo?','tem oportunidade aberta pro antonio?','manda a proposta pra maria']){
  const reference=extractNaturalClientReference(question)
  assert.equal(reference.kind,'AUTHORIZED_NAME_CANDIDATE',question)
  assert.ok(reference.reference,question)
 }
 // O pronome continua sendo o produtor aberto, e a troca explícita continua sendo nome afirmado.
 for(const question of ['ele tem oportunidade aberta?','E a última visita dele?','Essa cotação da soja muda a negociação com ele?'])
  assert.equal(extractNaturalClientReference(question).kind,'CURRENT_CLIENT',question)
 for(const question of ['muda para o João','troca pro Antônio','muda a conta para o João'])
  assert.equal(extractNaturalClientReference(question).kind,'EXPLICIT_NAME',question)
 // Interrogativo e substantivo de agenda nunca são nome: viravam a busca por um produtor
 // inexistente e a conversa travava com 422.
 for(const question of ['quem eu tenho que visitar hoje?','quero ver a agenda','vou ver a rota de amanha'])
  assert.equal(extractNaturalClientReference(question).kind,'NONE',question)
 // O resumo nomeia o produtor: sem isso, nada na tela denunciava uma troca.
 assert.match(read('server/decision-intelligence.js'),/\$\{opportunityOwner\?` de \$\{opportunityOwner\}`:''\}/)
})

// Uma letra trocada, um marcador de fala ou uma cortesia tiravam a pergunta da allowlist e a VAL
// passava a NEGAR ter o dado que ela entrega na redação exata.
test('erro de digitação e marcador de fala não derrubam o fato estruturado',async()=>{
 const {classifyStructuredClientFact}=await import('../server/decision-copilot/capability-router.js')
 const {repairFacetTypos,stripMessagePreamble}=await import('../server/message-preamble.js')
 for(const [typo,canonical] of [
  ['qual a proxma visita?','qual a próxima visita?'],
  ['qual a obejcao dele?','qual a objeção dele?'],
  ['qual o comprimisso pendente?','qual o compromisso pendente?'],
  ['qual o pefil dele?','qual o perfil dele?']
 ]){
  const expected=classifyStructuredClientFact(canonical)
  assert.ok(expected,canonical)
  assert.equal(classifyStructuredClientFact(typo),expected,typo)
 }
 for(const [spoken,plain] of [
  ['entao, qual a ultima compra dele?','qual a ultima compra dele?'],
  ['e... o que ele comprou?','o que ele comprou?'],
  ['olha, qual a proxima visita?','qual a proxima visita?']
 ])assert.equal(classifyStructuredClientFact(spoken),classifyStructuredClientFact(plain),spoken)
 // Palavra real do domínio não pode ser "corrigida" para uma faceta.
 for(const kept of ['pagamento a vista','qual o custo por hectare','qual a conta dele','o que ele perdeu'])
  assert.equal(repairFacetTypos(kept),kept,kept)
 // "e a objeção?" é continuação do produtor, não marcador de fala: não pode ser removida.
 assert.equal(stripMessagePreamble('e a objecao?'),'e a objecao?')
})

// A confirmação e a escolha perguntam o mesmo registro que "qual o perfil dele?" já entrega; fora da
// allowlist, a VAL negava a evidência comportamental uma frase depois de descrevê-la.
test('perfil aceita confirmação e escolha, sem virar gaveta para qualquer pergunta',async()=>{
 const {classifyStructuredClientFact}=await import('../server/decision-copilot/capability-router.js')
 for(const question of ['ele é analítico?','ela é relacional?','ele é mais analítico ou relacional?','analítico ou relacional?','qual a melhor abordagem para ele?'])
  assert.equal(classifyStructuredClientFact(question),'BEHAVIORAL_PROFILE',question)
 for(const question of ['ele é bom pagador?','ele é o dono da fazenda?','ele é grande?'])
  assert.notEqual(classifyStructuredClientFact(question),'BEHAVIORAL_PROFILE',question)
})

// A Biblioteca não sabe quantos produtores o consultor tem; quem sabe é a carteira. A pergunta se
// reduzia a um token e casava com o título de um item qualquer.
test('pergunta sobre a própria carteira não é respondida pela Biblioteca',async()=>{
 const {selectKnowledge}=await import('../server/knowledge/selection.js')
 const count=query=>selectKnowledge({query}).items.length
 for(const question of ['quantos produtores eu tenho?','quais os produtores da minha carteira','quantas visitas eu fiz','quem sao meus clientes'])
  assert.equal(count(question),0,question)
 for(const question of ['o que e basis?','o que e breakeven','lixiviacao de potassio','janela de plantio da soja'])
  assert.ok(count(question)>0,question)
})

// "Quem decide?" e "quem decide a compra?" são a mesma pergunta: a palavra "compra" movia o domínio
// e a faceta, e a VAL bloqueava o decisor que acabara de recuperar.
test('quem decide é faceta própria, qualquer que seja o domínio da frase',async()=>{
 const grounding=await import('../server/decision-copilot/response-grounding.js')
 const source=read('server/decision-copilot/response-grounding.js')
 assert.match(source,/if\(\/\\b\(\?:decisor\|quem decide\|quem manda\|quem assina\|quem autoriza\|quem toma a decisao\)\\b\/\.test\(source\)\)return 'DECISION_MAKER'/)
 // A checagem de faceta acontece antes do bloco por domínio.
 const facetStart=source.indexOf("function contextFacet")
 const decisionMaker=source.indexOf("return 'DECISION_MAKER'",facetStart)
 const domainBlock=source.indexOf("if(domain==='GENERAL')",facetStart)
 assert.ok(decisionMaker<domainBlock,'a faceta do decisor precisa vir antes do bloco por domínio')
 assert.ok(grounding.evaluateResponseGrounding)
})

// A próxima ação é campo de primeira classe do quadro, mas só era alcançável se o consultor citasse
// o nome do módulo.
test('a próxima ação é alcançável sem citar "oportunidade"',async()=>{
 const {routeValIntent}=await import('../server/ai-reasoning/intent-router.js')
 for(const question of ['qual a proxima acao?','qual o proximo passo?','o que eu faco agora?','como eu avanco?'])
  assert.equal(routeValIntent({message:question,hasClient:true}).intent,'CHECK_OPPORTUNITY',question)
 // "próxima visita" não pode ser sequestrada pelo novo gatilho.
 assert.notEqual(routeValIntent({message:'qual a proxima visita?',hasClient:true}).intent,'CHECK_OPPORTUNITY')
})

// Limpar "Tipo de negócio" era aceito, mas o cartão, o chip de filtro e o CSV continuavam mostrando
// o tipo antigo, ressuscitado a partir de `category`.
test('limpar o tipo de negócio limpa de verdade',()=>{
 const joao={id:'joao',name:'João Pereira',commercial:{}}
 const cleared=buildOpportunityWorkspace([joao],[{id:'db:1',databaseId:1,clientId:'joao',candidateKey:'manual:a',title:'Barter milho 26',stage:'Proposta',status:'open',value:90000,category:'Barter',
  evidence:[{type:'opportunity_workspace_v1',businessType:'',status:'open'}]}])
 assert.equal(cleared.find(item=>item.title==='Barter milho 26')?.businessType,'')
 // Sem escolha registrada, o category ainda serve de origem.
 const inherited=buildOpportunityWorkspace([joao],[{id:'db:2',databaseId:2,clientId:'joao',candidateKey:'manual:b',title:'Insumo soja',stage:'Proposta',status:'open',value:1000,category:'Insumos',evidence:[]}])
 assert.equal(inherited.find(item=>item.title==='Insumo soja')?.businessType,'Insumos')
 assert.match(read('server/opportunity-workspace.js'),/category:businessType\|\|text\(BUSINESS_TYPES\.includes\(input\.category\?\?current\?\.category\)\?'':/)
})

// O candidato projetado do cadastro vale a carteira em aberto INTEIRA: somado ao negócio que o
// consultor registrou, "Valor em aberto" contava o mesmo dinheiro duas vezes.
test('"Valor em aberto" não conta a carteira do produtor duas vezes',()=>{
 const joao={id:'joao',name:'João Pereira',additionalNeed:'Ampliar armazenagem',additionalNeedStatus:'reported',
  commercial:{opportunity:'Ampliar armazenagem',opportunityProvenance:{origin:'producer_360',field:'q27',state:'reported'},potential:120000,potentialValidated:true}}
 // Sem oportunidade registrada, o candidato do cadastro continua valendo a carteira em aberto.
 const onlyProjected=buildOpportunityWorkspace([joao],[])
 assert.equal(onlyProjected.length,1)
 assert.ok(Number(onlyProjected[0].value)>0)
 // Com uma oportunidade registrada, o cartão da necessidade permanece, mas sem somar de novo.
 const withSaved=buildOpportunityWorkspace([joao],[{id:'db:1',databaseId:1,clientId:'joao',candidateKey:'manual:a',title:'Barter milho 26',stage:'Proposta',status:'open',value:90000,evidence:[]}])
 assert.equal(withSaved.length,2)
 const projected=withSaved.find(item=>item.title==='Ampliar armazenagem')
 assert.equal(projected.value,null)
 assert.equal(projected.valueKnown,false)
 assert.equal(withSaved.reduce((total,item)=>total+Number(item.value||0),0),90000)
})

// A coluna não tinha ordem própria: era a ordem de chegada do estado, e o cartão editado subia ao
// topo ao salvar e descia ao fim no refresh.
test('as colunas do quadro têm ordem própria, estável entre um refresh e outro',()=>{
 const source=read('src/pages/Opportunities.jsx')
 assert.match(source,/const columns=OPPORTUNITY_STAGES\.map\(stage=>\(\{stage,items:filtered\.filter\(x=>x\.stage===stage\)\.slice\(\)\.sort\(/)
 assert.match(source,/dayKey\(a\.nextActionAt,timeZone\)\|\|'9999-99-99'/)
})

// O texto de recusa era um por intenção e ignorava o objeto da frase: "fecha a oportunidade" mandava
// o consultor para o Cliente 360, onde oportunidade não se edita.
test('a recusa de escrita aponta o módulo onde a alteração é feita',()=>{
 const server=read('server.js')
 assert.match(server,/const writeTarget=\/\\b\(\?:oportunidade\|neg\[oó\]cio\|negocia\[c\ç\]\[a\ã\]o\|proposta\|pipeline\)\\b\/i\.test\(message\)\?'Oportunidades'/)
 assert.match(server,/canonicalModule:writeTarget\|\|null/)
 assert.doesNotMatch(server,/UPDATE:'A VAL não altera cadastro ou registros por conversa\. Abra o produtor no Cliente 360/)
})
