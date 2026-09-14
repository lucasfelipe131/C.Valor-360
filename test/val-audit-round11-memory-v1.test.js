import assert from 'node:assert/strict'
import test from 'node:test'
import {contextQueryTokens,memoryMatchesContextDomain} from '../server/decision-copilot/context-selector.js'
import {buildContextSnapshot} from '../server/memory/context-snapshot.js'
import {summarizeContextCoverage} from '../server/val-engine.js'

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

test('o dossie declara o que foi lido, nao o que existia', () => {
 const memories=Array.from({length:86},(_,index)=>({id:`m${index}`}))
 const coverage=(list,selected)=>summarizeContextCoverage({client:{id:producer},memories:list,...(selected===null?{}:{contextSnapshot:{selection:{selected_refs:list.slice(0,selected).map(item=>item.id)}}})})
 assert.equal(coverage(memories,6).memories,86)
 assert.equal(coverage(memories,6).memoriesUsed,6)
 // Sem corte não há o que declarar, e sem snapshot o número de lidas é desconhecido: um
 // `memoriesUsed:0` faria a tela dizer "0 de 86 memórias", pior que o problema original.
 assert.equal(coverage(memories.slice(0,6),6).memoriesUsed,undefined)
 assert.equal(coverage(memories,null).memoriesUsed,undefined)
})
