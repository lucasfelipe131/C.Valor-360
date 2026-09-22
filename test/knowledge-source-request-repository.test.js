import test,{after,before} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {createKnowledgeSourceRequestStore} from '../server/knowledge/source-request-repository.js'

const tenantId='00000000-0000-4000-8000-000000000001'
const otherTenant='00000000-0000-4000-8000-0000000000ff'
const ownerId='00000000-0000-4000-8000-000000000101'
const officialSource={title:'Ficha do registro',publisher:'MAPA/AGROFIT',url:'https://agrofit.agricultura.gov.br/agrofit_cons/produto',authority:'A',year:2026,excerpt:'Intervalo de segurança de 21 dias.',accessed_at:'2026-09-22T12:00:00.000Z'}
const regulated={tenantId,ownerId,question:'qual é a carência do defensivo?',domain:'AGRONOMY',reason:'REGULATED_SOURCE_REQUIRED'}
let pg,directory,store

before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'val-source-requests-'))
 pg=new PGlite(directory)
 const database={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 for(const migration of ['20260922_015_knowledge_source_requests_expand.sql','20260922_016_knowledge_source_candidates_expand.sql'])await pg.exec(await readFile(new URL(`../database/migrations/${migration}`,import.meta.url),'utf8'))
 store=createKnowledgeSourceRequestStore({database})
})
after(async()=>{await pg?.close();await rm(directory,{recursive:true,force:true})})

test('sem PostgreSQL a loja não existe e o copiloto segue exatamente como antes',()=>{
 assert.equal(createKnowledgeSourceRequestStore({database:{configured:false}}),null)
 assert.equal(createKnowledgeSourceRequestStore({}),null)
})

test('a mesma dúvida de consultores diferentes soma peso numa linha só, por tenant',async()=>{
 const first=await store.register(regulated)
 assert.equal(first.status,'DRAFT')
 assert.equal(first.asked_count,1)
 await store.register({...regulated,ownerId:'00000000-0000-4000-8000-000000000102'})
 const third=await store.register({...regulated,question:'Qual é a CARÊNCIA do defensivo'})
 assert.equal(third.request_key,first.request_key)
 assert.equal(third.asked_count,3)
 assert.deepEqual([...third.asked_by].sort(),[ownerId,'00000000-0000-4000-8000-000000000102'].sort())
 // Outro tenant é outra fila: acervo aprovado é por organização.
 const foreign=await store.register({...regulated,tenantId:otherTenant})
 assert.notEqual(foreign.request_key,first.request_key)
 assert.equal((await store.list({tenantId})).length,1)
 assert.equal(await store.get({tenantId,requestKey:foreign.request_key}),null)
})

test('a fila ordena pelo peso e filtra por estado',async()=>{
 await store.register({tenantId,ownerId,question:'o que muda no manejo com plantio direto?',domain:'AGRONOMY',reason:'LIBRARY_NO_COVERAGE'})
 const queue=await store.list({tenantId})
 assert.equal(queue.length,2)
 assert.equal(queue[0].asked_count,3)
 assert.equal(queue[0].reason,'REGULATED_SOURCE_REQUIRED')
 assert.equal((await store.list({tenantId,status:'APPROVED'})).length,0)
 assert.equal((await store.list({tenantId,status:'DRAFT'})).length,2)
})

test('aprovar grava a fonte e o responsável; resposta citada só existe depois disso',async()=>{
 const {request_key:requestKey}=(await store.list({tenantId,status:'DRAFT'}))[0]
 assert.equal(await store.findApprovedAnswer({tenantId,...regulated}),null)
 await store.transition({tenantId,requestKey,next:'UNDER_REVIEW'})
 await assert.rejects(()=>store.transition({tenantId,requestKey,next:'APPROVED',source:{...officialSource,url:'https://blog.exemplo.com/bula'},actor:'agronomo@val.test'}),error=>error.violations.includes('source.url.official_required'))
 await assert.rejects(()=>store.transition({tenantId,requestKey,next:'APPROVED',source:officialSource}),error=>error.violations.includes('actor'))
 const approved=await store.transition({tenantId,requestKey,next:'APPROVED',source:officialSource,actor:'agronomo@val.test'})
 assert.equal(approved.status,'APPROVED')
 assert.equal(approved.approved_by,'agronomo@val.test')
 const answer=await store.findApprovedAnswer({tenantId,...regulated})
 assert.equal(answer.citation.url,officialSource.url)
 assert.match(answer.excerpt,/21 dias/)
 // A mesma pergunta em outro tenant não enxerga a fonte aprovada aqui.
 assert.equal(await store.findApprovedAnswer({...regulated,tenantId:otherTenant}),null)
})

test('duas revisões simultâneas não se sobrescrevem em silêncio',async()=>{
 const pending=(await store.list({tenantId,status:'DRAFT'}))[0]
 await store.transition({tenantId,requestKey:pending.request_key,next:'REJECTED',rejectionReason:'Assunto coberto pelo acervo atual.'})
 await assert.rejects(()=>store.transition({tenantId,requestKey:pending.request_key,next:'REJECTED',rejectionReason:'outro motivo'}),error=>error.violations?.includes('transition.REJECTED_to_REJECTED'))
 assert.equal(await store.transition({tenantId,requestKey:'ffffffffffffffffffffffffffffffff',next:'UNDER_REVIEW'}),null)
})

// O banco é a última fronteira: nenhum caminho de escrita futuro pode criar afirmação sem dono.
test('o banco recusa aprovação sem fonte e sem responsável',async()=>{
 const {request_key:requestKey}=(await store.list({tenantId,status:'APPROVED'}))[0]
 await assert.rejects(()=>pg.query(`UPDATE val_knowledge_source_requests SET status='APPROVED',source=NULL,approved_by=NULL,approved_at=NULL WHERE tenant_id=$1 AND request_key=$2`,[tenantId,requestKey]),/val_knowledge_source_requests_approved_has_owner/)
 await assert.rejects(()=>pg.query(`UPDATE val_knowledge_source_requests SET status='REJECTED',rejection_reason=NULL WHERE tenant_id=$1 AND request_key=$2`,[tenantId,requestKey]),/val_knowledge_source_requests_rejected_has_reason/)
})

// A pesquisa só sugere onde procurar. Guarda endereço oficial e título — nenhum texto do modelo — e
// não mexe num pedido que já tem fonte escolhida.
test('candidatas guardam só endereço oficial e título, e não tocam pedido já aprovado',async()=>{
 const open=await store.register({tenantId,ownerId,question:'qual o intervalo de reentrada do produto na soja?',domain:'AGRONOMY',reason:'REGULATED_SOURCE_REQUIRED'})
 const saved=await store.saveCandidates({tenantId,requestKey:open.request_key,actor:'agronomo@val.test',now:new Date('2026-09-22T14:00:00.000Z'),citations:[
  {url:'https://agrofit.agricultura.gov.br/agrofit_cons/produto',title:'Ficha AGROFIT',summary:'texto escrito pelo modelo'},
  {url:'https://blog-agro.exemplo.com/bula',title:'Blog'},
  {url:'http://www.embrapa.br/x',title:'sem https'},
  {url:'https://agrofit.agricultura.gov.br/agrofit_cons/produto',title:'repetida'}
 ]})
 assert.deepEqual(saved.candidates.map(item=>({...item})),[{url:'https://agrofit.agricultura.gov.br/agrofit_cons/produto',title:'Ficha AGROFIT',host:'agrofit.agricultura.gov.br'}])
 assert.equal(saved.candidates_researched_by,'agronomo@val.test')
 assert.equal(saved.candidates_researched_at,'2026-09-22T14:00:00.000Z')
 assert.doesNotMatch(JSON.stringify(saved),/texto escrito pelo modelo/)
 // Novas perguntas iguais somam peso sem apagar as candidatas já pagas.
 const again=await store.register({tenantId,ownerId,question:'qual o intervalo de reentrada do produto na soja?',domain:'AGRONOMY',reason:'REGULATED_SOURCE_REQUIRED'})
 assert.equal(again.candidates.length,1)
 const approved=(await store.list({tenantId,status:'APPROVED'}))[0]
 assert.equal(await store.saveCandidates({tenantId,requestKey:approved.request_key,citations:[{url:'https://www.gov.br/x',title:'x'}]}),null)
 assert.equal((await store.get({tenantId,requestKey:approved.request_key})).candidates.length,0)
})

test('o banco recusa candidatas que não sejam lista',async()=>{
 const {request_key:requestKey}=(await store.list({tenantId,status:'DRAFT'}))[0]
 await assert.rejects(()=>pg.query(`UPDATE val_knowledge_source_requests SET candidates='{"url":"x"}'::jsonb WHERE tenant_id=$1 AND request_key=$2`,[tenantId,requestKey]),/candidates_is_array/)
})
