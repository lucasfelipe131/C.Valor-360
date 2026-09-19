import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import {createValChatIdempotencyLedger,valChatTurnFingerprint} from '../server/val-chat-idempotency.js'

// OFFLINE-03. O POST /api/val/chat nao tinha idempotencia. Com a resposta perdida na volta o
// servidor ja produziu, persistiu e contabilizou a analise; o consultor nao recebe nada, reenvia, e
// o mesmo turno vira DUAS recomendacoes e DOIS eventos de uso. Medido com proxy TCP que descarta os
// bytes de resposta: 0 -> 1 -> 2. A chave e o TURNO, nao o requestId: o cliente gera um requestId
// novo a cada envio, entao dedup por requestId so protegeria um reenvio sintetico.
const repositoryRoot=resolve(fileURLToPath(new URL('..',import.meta.url)))
const tenantId='00000000-0000-4000-8000-000000000001'
const turno=extra=>({tenantId:'t-1',ownerId:'o-1',conversationId:'c-1',clientId:'p-1',mode:'daily',message:'Monte o plano de próxima melhor ação.',...extra})

test('OFFLINE-03 — a impressao do turno ignora o requestId e reage ao que de fato muda',()=>{
 const base=valChatTurnFingerprint(turno())
 assert.ok(base)
 assert.equal(base,valChatTurnFingerprint(turno({attachmentIds:[]})),'a mesma pergunta no mesmo fio é o mesmo turno')
 assert.equal(base,valChatTurnFingerprint(turno({message:'  Monte o plano de próxima melhor ação.  '})),'espaço em branco não cria um turno novo')
 for(const [campo,valor] of [['tenantId','t-2'],['ownerId','o-2'],['conversationId','c-2'],['clientId','p-2'],['mode','strategic'],['message','Outra pergunta.']]){
  assert.notEqual(base,valChatTurnFingerprint(turno({[campo]:valor})),campo)
 }
 assert.notEqual(base,valChatTurnFingerprint(turno({attachmentIds:['anexo-1']})))
 assert.equal(valChatTurnFingerprint(turno({attachmentIds:['a','b']})),valChatTurnFingerprint(turno({attachmentIds:['b','a']})),'a ordem dos anexos não cria um turno novo')
})

test('OFFLINE-03 — sem conversa, tenant, dono ou pergunta nao ha turno para repetir',()=>{
 for(const campo of ['tenantId','ownerId','conversationId','message']){
  assert.equal(valChatTurnFingerprint(turno({[campo]:''})),'',campo)
 }
})

test('OFFLINE-03 — o registro devolve o turno concluido dentro da janela e esquece depois',()=>{
 const ledger=createValChatIdempotencyLedger({ttlMs:1_000,maxEntries:3})
 const chave=valChatTurnFingerprint(turno())
 assert.equal(ledger.replay(chave,0),null)
 ledger.remember(chave,{recommendationId:'rec-1'},0)
 assert.deepEqual(ledger.replay(chave,999),{recommendationId:'rec-1'})
 assert.equal(ledger.replay(chave,1_001),null,'passada a janela, um reenvio é uma pergunta nova')
 // Chave vazia nunca entra: sem ela cada pedido é o seu próprio.
 assert.equal(ledger.remember('',{recommendationId:'rec-2'},0),false)
 assert.equal(ledger.replay('',0),null)
})

test('OFFLINE-03 — o registro nao cresce sem limite',()=>{
 const ledger=createValChatIdempotencyLedger({ttlMs:60_000,maxEntries:3})
 for(let indice=0;indice<10;indice+=1)ledger.remember(valChatTurnFingerprint(turno({message:`Pergunta ${indice}`})),{indice},0)
 assert.equal(ledger.size,3)
 assert.deepEqual(ledger.replay(valChatTurnFingerprint(turno({message:'Pergunta 9'})),0),{indice:9},'o mais recente sobrevive')
 assert.equal(ledger.replay(valChatTurnFingerprint(turno({message:'Pergunta 0'})),0),null,'o mais antigo sai')
})

async function availablePort(){
 const server=createServer()
 await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res)})
 const port=server.address().port
 await new Promise(res=>server.close(res))
 return port
}
function waitForStartup(child,timeoutMs=45_000){
 return new Promise((res,rej)=>{
  let stderr='';let complete=false
  const finish=(operation,value)=>{if(complete)return;complete=true;clearTimeout(timer);operation(value)}
  const timer=setTimeout(()=>finish(rej,new Error(`Timeout ao iniciar servidor local. ${stderr}`)),timeoutMs)
  child.stdout.on('data',chunk=>{if(String(chunk).includes('VALOR 360 disponível na porta'))finish(res)})
  child.stderr.on('data',chunk=>{stderr+=chunk})
  child.once('exit',code=>finish(rej,new Error(`Servidor encerrou antes do teste HTTP (code ${code}). ${stderr}`)))
 })
}

test('OFFLINE-03 HTTP — reenviar o mesmo turno devolve a resposta ja produzida, com requestId novo',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'val-offline03-'))
 const port=await availablePort()
 const scoped=value=>({tenantId,ownerId:'demo@valor360.local',...value})
 const store={surveys:[],imports:[scoped({id:'imp',clients:[scoped({id:'produtor-offline03',name:'Antônio Carlos',area:428.5,cultures:'Soja, Milho'})]})],visits:[],businessEvents:[],opportunities:[],val:{commitments:[],memories:[],visitReports:[]},grains:{profiles:[],intentions:[],marketSnapshots:[]}}
 await writeFile(join(dataRoot,'valor360-store.json'),JSON.stringify(store))
 const child=spawn(process.execPath,['server/start.js'],{cwd:repositoryRoot,env:{...process.env,PORT:String(port),VAL_DEMO_MODE:'true',VAL_DEFAULT_TENANT_ID:tenantId,AUTO_MIGRATE:'false',DATA_DIR:dataRoot,DATABASE_URL:'',OPENAI_API_KEY:'',VAL_ADMIN_EMAIL:'',VAL_ADMIN_PASSWORD:'',VAL_SESSION_SECRET:''},stdio:['ignore','pipe','pipe']})
 const base=`http://127.0.0.1:${port}`
 const enviar=async(message,conversationId,requestId)=>{
  const resposta=await fetch(`${base}/api/val/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,clientId:'produtor-offline03',client:{id:'produtor-offline03',name:'Antônio Carlos'},conversationId,mode:'daily',requestId})})
  return {status:resposta.status,payload:await resposta.json()}
 }
 try{
  await waitForStartup(child)
  // O cliente real gera um requestId NOVO a cada envio; o reenvio tem que ser reconhecido assim mesmo.
  const primeiro=await enviar('Monte o plano de próxima melhor ação.','fio-offline03','11111111-1111-4111-8111-111111111111')
  assert.equal(primeiro.status,200,JSON.stringify(primeiro.payload))
  assert.ok(primeiro.payload.recommendationId)
  assert.notEqual(primeiro.payload.responseMetadata?.idempotentReplay,true)

  const reenvio=await enviar('Monte o plano de próxima melhor ação.','fio-offline03','22222222-2222-4222-8222-222222222222')
  assert.equal(reenvio.status,200,JSON.stringify(reenvio.payload))
  assert.equal(reenvio.payload.recommendationId,primeiro.payload.recommendationId,'o reenvio tem que devolver a análise que o servidor já produziu')
  assert.equal(reenvio.payload.responseMetadata.idempotentReplay,true,'a repetição precisa ser declarada, não silenciosa')
  assert.equal(reenvio.payload.requestId,'22222222-2222-4222-8222-222222222222','o requestId devolvido é o do pedido atual')

  // Pergunta diferente no mesmo fio continua sendo um turno novo.
  const outra=await enviar('E qual o município dele?','fio-offline03','33333333-3333-4333-8333-333333333333')
  assert.equal(outra.status,200,JSON.stringify(outra.payload))
  assert.notEqual(outra.payload.responseMetadata?.idempotentReplay,true)
  assert.notEqual(outra.payload.recommendationId,primeiro.payload.recommendationId)

  // Mesma pergunta em outro fio também é um turno novo.
  const outroFio=await enviar('Monte o plano de próxima melhor ação.','fio-offline03-b','44444444-4444-4444-8444-444444444444')
  assert.equal(outroFio.status,200,JSON.stringify(outroFio.payload))
  assert.notEqual(outroFio.payload.responseMetadata?.idempotentReplay,true)
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM')
   await new Promise(res=>{const timer=setTimeout(()=>{child.kill('SIGKILL');res()},3_000);child.once('exit',()=>{clearTimeout(timer);res()})})
  }
  await rm(dataRoot,{recursive:true,force:true})
 }
})


test('OFFLINE-03 — a epoca da conversa entra na chave: reset nao e desfeito pelo registro',()=>{
 // A rodada 13 mediu: "Novo assunto." é comando explícito de descarte, sobe a época, e repetir a
 // pergunta devolvia a análise de ANTES do reset — fazendo a época da thread andar para trás.
 const base=turno()
 assert.notEqual(valChatTurnFingerprint({...base,contextEpoch:0}),valChatTurnFingerprint({...base,contextEpoch:1}))
 assert.equal(valChatTurnFingerprint({...base,contextEpoch:0}),valChatTurnFingerprint(base),'época ausente conta como 0')
})

test('OFFLINE-03 — registrar um fato novo apaga o verniz de reenvio do dono',()=>{
 // Medido: o consultor pergunta, registra visita e memória, pergunta de novo para ver o efeito, e
 // recebia byte a byte a análise de antes do registro. Todo endpoint de escrita chama
 // invalidateValContextScope; o registro morre no mesmo lugar.
 const ledger=createValChatIdempotencyLedger({ttlMs:60_000})
 const meu=valChatTurnFingerprint(turno())
 const deOutroDono=valChatTurnFingerprint(turno({ownerId:'o-2'}))
 ledger.remember(meu,{recommendationId:'rec-1'},0,{tenantId:'t-1',ownerId:'o-1'})
 ledger.remember(deOutroDono,{recommendationId:'rec-2'},0,{tenantId:'t-1',ownerId:'o-2'})
 assert.equal(ledger.invalidate({tenantId:'t-1',ownerId:'o-1'}),1)
 assert.equal(ledger.replay(meu,0),null,'a repetição do próprio dono tem que recalcular')
 assert.deepEqual(ledger.replay(deOutroDono,0),{recommendationId:'rec-2'},'o verniz de outro consultor não é afetado')
 // Sem dono não há escopo para invalidar.
 assert.equal(ledger.invalidate({tenantId:'t-1'}),0)
})

test('OFFLINE-03 — o servidor liga a invalidacao do registro ao mesmo lugar das escritas',()=>{
 const servidor=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const bloco=servidor.slice(servidor.indexOf('function invalidateValContextScope('),servidor.indexOf('function invalidateDerivedPortfolioCaches('))
 assert.match(bloco,/valChatIdempotency\.invalidate\(scope\)/)
 // E a repetição não pode continuar declarando que foi recalculada para este pedido.
 assert.match(servidor,/recomputed_for_request:false/)
})

// Rodada 14. Os tres defeitos abaixo conviviam com os testes acima porque todos eles reenviam o
// turno NA HORA, sem nada no meio. Bastava uma segunda pergunta, uma mudanca de assunto ou uma
// escrita sobre outro produtor para o verniz sumir - e nenhum dos tres aparecia.
test('rodada 14 — uma segunda pergunta nao pode destruir o verniz da primeira',()=>{
 // idem-01: o proprio turno do chat chamava a invalidacao de escopo depois de persistir, e ela
 // apagava TODO o registro do dono. O verniz nunca guardava mais que o ultimo turno.
 const registro=createValChatIdempotencyLedger()
 const escopo={tenantId:'t-1',ownerId:'o-1',clientId:'p-1'}
 const primeira=valChatTurnFingerprint(turno({message:'Qual o preço de venda e a margem dele?'}))
 const segunda=valChatTurnFingerprint(turno({conversationId:'c-2',message:'Como está a carteira este mês?'}))
 registro.remember(primeira,{rec:'a'},Date.now(),escopo)
 registro.remember(segunda,{rec:'b'},Date.now(),escopo)
 assert.deepEqual(registro.replay(primeira),{rec:'a'},'a segunda pergunta apagou a protecao da primeira')
 assert.deepEqual(registro.replay(segunda),{rec:'b'})
})

test('rodada 14 — escrita sobre outro produtor nao apaga o verniz do primeiro',()=>{
 // idem-03: invalidate() descartava o clientId que o chamador ja passava, entao registrar uma visita
 // do produtor B derrubava a protecao do produtor A - que aquela escrita nao podia ter mudado.
 const registro=createValChatIdempotencyLedger()
 const chave=cliente=>valChatTurnFingerprint(turno({clientId:cliente,conversationId:`c-${cliente}`}))
 registro.remember(chave('p-1'),{rec:'a'},Date.now(),{tenantId:'t-1',ownerId:'o-1',clientId:'p-1'})
 registro.remember(chave('p-2'),{rec:'b'},Date.now(),{tenantId:'t-1',ownerId:'o-1',clientId:'p-2'})
 const semProdutor=valChatTurnFingerprint(turno({clientId:'',conversationId:'c-carteira'}))
 registro.remember(semProdutor,{rec:'carteira'},Date.now(),{tenantId:'t-1',ownerId:'o-1'})

 assert.equal(registro.invalidate({tenantId:'t-1',ownerId:'o-1',clientId:'p-2'}),2)
 assert.deepEqual(registro.replay(chave('p-1')),{rec:'a'},'escrita sobre p-2 nao pode tocar em p-1')
 assert.equal(registro.replay(chave('p-2')),null,'escrita sobre p-2 tem de invalidar p-2')
 // Fecha-se em duvida: resposta de carteira nao tem produtor e pode depender de qualquer um deles.
 assert.equal(registro.replay(semProdutor),null,'resposta sem produtor tem de cair em qualquer escrita do dono')
 // E escrita de OUTRO dono nunca toca neste.
 registro.remember(chave('p-1'),{rec:'a'},Date.now(),{tenantId:'t-1',ownerId:'o-1',clientId:'p-1'})
 assert.equal(registro.invalidate({tenantId:'t-1',ownerId:'outro',clientId:'p-1'}),0)
 assert.deepEqual(registro.replay(chave('p-1')),{rec:'a'})
})

test('rodada 14 — a chave do turno usa a epoca em que o turno roda, nao a de antes dele',()=>{
 // idem-02: a chave era montada com a epoca lida do banco, de ANTES do turno, e o proprio turno sobe
 // a epoca quando o assunto muda. O remember gravava sob a epoca antiga e o reenvio, que ja le a
 // nova, procurava outra chave: mudar de assunto e reenviar recalculava e cobrava sempre.
 const antes=valChatTurnFingerprint(turno({message:'Como controlar a ferrugem asiática?',contextEpoch:0}))
 const depois=valChatTurnFingerprint(turno({message:'Como controlar a ferrugem asiática?',contextEpoch:1}))
 assert.notEqual(antes,depois,'a epoca tem de fazer parte da chave')
 const registro=createValChatIdempotencyLedger()
 registro.remember(depois,{rec:'agro'},Date.now(),{tenantId:'t-1',ownerId:'o-1',clientId:'p-1'})
 assert.deepEqual(registro.replay(depois),{rec:'agro'},'o reenvio le a epoca ja avancada e tem de casar')
 assert.equal(registro.replay(antes),null,'a epoca antiga nao pode casar')
})
