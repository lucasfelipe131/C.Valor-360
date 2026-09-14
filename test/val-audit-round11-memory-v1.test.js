import assert from 'node:assert/strict'
import test from 'node:test'
import {contextQueryTokens,memoryMatchesContextDomain} from '../server/decision-copilot/context-selector.js'
import {buildContextSnapshot,scopeContextSnapshotForModel} from '../server/memory/context-snapshot.js'
import {scopeValContextForModel,summarizeContextCoverage} from '../server/val-engine.js'

const tenant='00000000-0000-4000-8000-000000000001'
const owner='00000000-0000-4000-8000-000000000010'
const producer='producer-matheus'
const now=new Date('2026-08-30T12:00:00.000Z')

const memory=(id,key,statement,when)=>({
 id,
 tenant_id:tenant,
 client_id:producer,
 context_owner_id:owner,
 subject_type:'client',
 subject_id:producer,
 memory_type:'PRODUCER',
 memory_state:'FACT',
 memory_domain:'PRODUCER',
 key,
 value:{statement},
 content:{statement},
 status:'verified',
 source:'producer_360',
 source_ref:`producer_360:${id}`,
 source_type:'producer_360',
 confidence:85,
 valid_from:when,
 created_at:when,
 updated_at:when,
 observed_at:when,
 acl:{scope:'own_portfolio'}
})

const snapshotOf=(memories,{message,memoryLimit,requestId='00000000-0000-4000-8000-000000000971'}={})=>buildContextSnapshot({
 client:{id:producer,name:'Matheus'},
 memoryHistory:memories,
 businessHistory:[],
 visits:[],
 interactions:[],
 commitments:[],
 opportunities:[],
 properties:[],
 fieldReports:[],
 soilAnalyses:[],
 ndviObservations:[]
},{
 organizationId:tenant,
 subjectType:'client',
 subjectId:producer,
 actorId:owner,
 role:'consultant',
 scope:'own_portfolio',
 objective:'general_assistance',
 contextDomain:'GENERAL',
 message,
 ...(memoryLimit?{memoryLimit}:{}),
 requestId,
 now
})

const note=memory('voz-1','voice.fact','O produtor disse que so decide a compra de irrigacao depois de ver o resultado do vizinho.','2026-06-01T12:00:00.000Z')

test('a interrogacao no fim da pergunta nao esconde mais a memoria que responde', () => {
 const record={memory_type:'PRODUCER',key:'voice.fact',source_type:'producer_360',content:{statement:'O produtor so decide a compra de irrigacao depois de ver o vizinho.'}}
 for(const question of ['O que ele pensa sobre irrigacao?','O que ele pensa sobre irrigação?','O que ele pensa sobre irrigacao','Irrigação, o que ele acha?'])
  assert.equal(memoryMatchesContextDomain(record,'GENERAL',question),true,`a pergunta ${JSON.stringify(question)} precisa alcançar a memória que a responde`)
})

test('numero puro e palavra-funcao nao viram termo de busca', () => {
 assert.deepEqual(contextQueryTokens('Como foi a safra 2026-2027?'),['safra'])
 const neutra=index=>({memory_type:'PRODUCER',key:'voice.fact',source_type:'producer_360',content:{statement:`Registro ${index} de 2026 sem assunto em comum com a pergunta.`}})
 // Sem a disciplina de números o "2026" da pergunta casaria com todo registro datado
 // e o portão de domínio deixaria de filtrar qualquer coisa.
 const casaram=Array.from({length:40},(_,index)=>neutra(index)).filter(record=>memoryMatchesContextDomain(record,'GENERAL','Como foi a safra 2026-2027?'))
 assert.equal(casaram.length,0)
 assert.equal(memoryMatchesContextDomain({memory_type:'PRODUCER',key:'voice.fact',source_type:'producer_360',content:{statement:'A safra passada rendeu 62 sacas por hectare.'}},'GENERAL','Como foi a safra 2026-2027?'),true)
})

test('memoria admitida pelo conteudo nao derruba o snapshot na revalidacao de dominio', () => {
 // O validador reconstrói uma pergunta sintética a partir dos domínios pedidos, e para
 // GENERAL essa reconstrução é a palavra "geral". Enquanto ela era usada no casamento por
 // token, toda memória admitida pelo conteúdo reprovava aqui e o snapshot inteiro estourava.
 const snapshot=snapshotOf([note],{message:'O que ele pensa sobre irrigação?'})
 assert.equal(snapshot.selection.selected_refs.length,1)
 assert.ok(snapshot.facts.some(item=>item.key==='voice.fact'))
})

test('a pergunta do consultor decide qual memoria entra no contexto', () => {
 const memories=[
  memory('m-irrigacao','producer.note','O pivo de irrigacao cobre 300 hectares da propriedade.','2026-05-01T12:00:00.000Z'),
  memory('m-soja','producer.culture','A cultura principal e soja e o produtor colheu 62 sacas por hectare.','2026-06-01T12:00:00.000Z'),
  memory('m-municipio','producer.municipality','O municipio da propriedade e Sorriso, Mato Grosso.','2026-07-01T12:00:00.000Z')
 ]
 // Antes, as três perguntas devolviam a MESMA memória: em GENERAL o score não olhava o
 // conteúdo, então vencia sempre a mais recente com bônus estrutural.
 const escolhida=message=>String(snapshotOf(memories,{message,memoryLimit:1}).selection.selected_refs[0]||'')
 assert.match(escolhida('Fale sobre a irrigacao dele'),/m-irrigacao/)
 assert.match(escolhida('Fale sobre a soja dele'),/m-soja/)
 assert.match(escolhida('Fale sobre o municipio dele'),/m-municipio/)
})

test('a nota que responde ganha vaga entre 85 registros estruturais mais recentes', () => {
 const fillers=Array.from({length:85},(_,index)=>memory(`filler-${index}`,'producer.area',`Area cadastrada da propriedade ${index}: ${100+index} hectares.`,`2026-08-${String(1+index%28).padStart(2,'0')}T12:00:00.000Z`))
 const snapshot=snapshotOf([...fillers,note],{message:'O que ele pensa sobre irrigação?'})
 assert.equal(snapshot.selection.considered_refs.length,86)
 const selecionadas=snapshot.selection.selected_refs.map(String)
 assert.ok(selecionadas.some(ref=>ref.includes('voz-1')),'a memória que responde precisa entrar no contexto')
 // O teto do domínio continua valendo: a afinidade reordena, não amplia o contexto.
 assert.equal(selecionadas.length,6)
 assert.ok(snapshot.selection.selection_reason_codes.find(item=>String(item.ref).includes('voz-1'))?.reason_codes.includes('question_match'))
})

test('pergunta sem termo proprio nao reordena nada', () => {
 const memories=[
  memory('m-antiga','producer.note','Registro antigo do acompanhamento.','2026-01-01T12:00:00.000Z'),
  memory('m-recente','producer.note','Registro recente do acompanhamento.','2026-08-20T12:00:00.000Z')
 ]
 // "Como ele esta?" só tem palavra-função: sem termo próprio ninguém casa, os dois grupos
 // viram um só e a ordenação volta a ser exatamente a anterior (recência).
 assert.deepEqual(contextQueryTokens('Como ele esta?'),[])
 assert.match(String(snapshotOf(memories,{message:'Como ele esta?',memoryLimit:1}).selection.selected_refs[0]||''),/m-recente/)
})

test('o dossie diz de quantas memorias autorizadas saiu o que foi lido', () => {
 const lidas=Array.from({length:6},(_,index)=>({id:`m${index}`}))
 const coverage=(authorizedMemories)=>summarizeContextCoverage({client:{id:producer},memories:lidas},authorizedMemories===undefined?undefined:{authorizedMemories})
 // No pipeline real summarizeContextCoverage roda depois de scopeValContextForModel, então
 // context.memories já é o que o modelo leu. O total autorizado só existe se for capturado
 // antes do corte e passado por parâmetro — sem isso numerador e denominador colapsam.
 assert.equal(coverage(86).memories,6)
 assert.equal(coverage(86).memoriesAuthorized,86)
 assert.equal(coverage(6).memoriesAuthorized,undefined,'sem corte não há total a declarar')
 assert.equal(coverage(undefined).memoriesAuthorized,undefined,'quem não informa o total mantém o comportamento antigo')
})

test('o total autorizado sobrevive ao corte do envelope do modelo', () => {
 const memories=Array.from({length:86},(_,index)=>memory(`m${index}`,'producer.area',`Area cadastrada da propriedade ${index}: ${100+index} hectares.`,`2026-08-${String(1+index%28).padStart(2,'0')}T12:00:00.000Z`))
 const contexto={client:{id:producer,name:'Matheus'},memories,memoryHistory:memories,businessHistory:[],visits:[],interactions:[],commitments:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[]}
 const contextSnapshot=snapshotOf(memories,{message:'Fale da area dele',requestId:'00000000-0000-4000-8000-000000000991'})
 const autorizadas=memories.length
 const escopado=scopeValContextForModel({...contexto,contextSnapshot})
 const coverage=summarizeContextCoverage(escopado,{authorizedMemories:autorizadas})
 // Sem o parâmetro a tela escreveria "6 memórias" e nada mais: scopeValContextForModel
 // reconstrói context.memories a partir do snapshot já filtrado.
 assert.equal(summarizeContextCoverage(escopado).memoriesAuthorized,undefined)
 assert.ok(coverage.memories<autorizadas)
 assert.equal(coverage.memoriesAuthorized,autorizadas)
})

const vozGravada=(observedAt,overrides={})=>({
 id:'voz-1',
 tenant_id:tenant,
 client_id:producer,
 context_owner_id:owner,
 subject_type:'client',
 subject_id:producer,
 memory_type:'fact',
 memory_state:'FACT',
 memory_domain:'PRODUCER',
 key:'voice.fact',
 value:{statement:'O produtor esta estudando a compra de irrigacao por pivo.'},
 content:{statement:'O produtor esta estudando a compra de irrigacao por pivo.'},
 status:'verified',
 source:'confirmed_voice_interaction',
 source_ref:'confirmed_voice_interaction:v1',
 source_type:'confirmed_voice_interaction',
 confidence:88,
 observed_at:observedAt,
 valid_from:observedAt,
 created_at:observedAt,
 // O carimbo de escrita é recente de propósito: ele NÃO pode servir de data de observação.
 updated_at:'2026-08-29T12:00:00.000Z',
 valid_until:null,
 acl:{scope:'own_portfolio'},
 ...overrides
})

const noModelo=snapshot=>['facts','inferences','hypotheses','validated_knowledge'].reduce((total,key)=>total+(scopeContextSnapshotForModel(snapshot)[key]||[]).length,0)

test('memoria datada sem expiracao declarada chega ao modelo', () => {
 // Toda memória que o produto escreve (voz, relatório de visita, complemento técnico) nasce
 // com valid_until null. A política MEMORY é EXPLICIT_VALIDITY_WINDOW, então isso virava
 // UNKNOWN e o envelope do modelo, que só aceita CURRENT, apagava a memória depois de ela
 // já ter sido selecionada e entrado no snapshot.
 const snapshot=snapshotOf([vozGravada('2026-08-20T12:00:00.000Z')],{message:'O que ele pensa sobre irrigação?',requestId:'00000000-0000-4000-8000-000000000995'})
 assert.equal(snapshot.selection.selected_refs.length,1)
 assert.equal(noModelo(snapshot),1)
 assert.equal(snapshot.facts[0].freshness,'CURRENT')
 assert.equal(snapshot.facts[0].freshness_metadata.reason_code,'OBSERVED_AT_VERIFIED')
})

test('a fuga tem teto de idade e nao vale para sempre', () => {
 // A política MEMORY não tem max_age_days: sem teto, uma nota de voz de sete anos ficaria
 // vigente indefinidamente. STALE mantém o registro auditável sem entregá-lo ao modelo.
 const snapshot=snapshotOf([vozGravada('2019-08-20T12:00:00.000Z')],{message:'O que ele pensa sobre irrigação?',requestId:'00000000-0000-4000-8000-000000000996'})
 assert.equal(snapshot.facts[0]?.freshness,'STALE')
 assert.equal(snapshot.facts[0]?.freshness_metadata.reason_code,'OBSERVED_AS_OF_MAX_AGE_EXCEEDED')
 assert.equal(noModelo(snapshot),0)
})

test('carimbo de escrita nao vira data de observacao', () => {
 // A política MEMORY lista updated_at entre os date_fields. Se a fuga chaveasse por eles,
 // uma linha legada sem observação nenhuma seria promovida a vigente pela data em que foi
 // gravada — que não diz nada sobre quando o fato foi observado.
 const legada=vozGravada(null,{observed_at:null,valid_from:null,source_updated_at:null,source_type:'legacy_unattributed',updated_at:'2019-03-02T12:00:00.000Z'})
 const snapshot=snapshotOf([legada],{message:'O que ele pensa sobre irrigação?',requestId:'00000000-0000-4000-8000-000000000997'})
 assert.equal(snapshot.facts[0]?.freshness,'UNKNOWN')
 assert.equal(snapshot.facts[0]?.freshness_metadata.reason_code,'NO_EXPIRY_DECLARED')
 assert.equal(noModelo(snapshot),0)
})

test('memoria encerrada nao ressuscita pela fuga', () => {
 // EXPIRED, SUPERSEDED, REJECTED e FUTURE são decididos antes, por memoryValidity. A fuga só
 // pode tocar o caso "datado e sem expiração declarada".
 const encerrada=vozGravada('2026-08-20T12:00:00.000Z',{valid_until:'2026-08-25T12:00:00.000Z'})
 const snapshot=snapshotOf([encerrada],{message:'O que ele pensa sobre irrigação?',requestId:'00000000-0000-4000-8000-000000000998'})
 assert.equal(noModelo(snapshot),0)
 assert.equal(snapshot.selection.selected_refs.length,0)
})
