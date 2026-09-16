import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{after,before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'
import {selectScopedPriorRecommendations} from '../server/conversation-thread-context.js'

// CONV-03. O context_epoch e GRAVADO como numero JSON, mas a projecao do repositorio usava ->>, que
// devolve TEXTO. O filtro de continuidade (integerEpoch) exige Number.isSafeInteger e descartava a
// linha, entao o turno anterior nunca atravessava: priorRecommendations=0 e carriedPriorTurn=false
// mesmo na MESMA conversa, mesmo produtor, mesma epoca e mesmo dominio. A conversa perdia a
// continuidade que julgava ter. A coercao estrita do filtro e deliberada — o defeito estava na
// fronteira que trocava o tipo.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(100),ownerId=id(3),clientUuid=id(500)
const producerId='produtor-conv03'
const conversationId='11111111-2222-4333-8444-555555555555'
let pg,repository

before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'TEST consultor','consultor@example.test'])
 await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
 await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,status)
  VALUES($1::uuid,$2,$3,$4,'TEST produtor','TEST Town','Soja','manual','active')`,[clientUuid,tenantId,producerId,ownerId])
 // context_epoch entra como NUMERO JSON, que é como o servidor grava.
 const inputContext={contextSnapshot:{context_scope:{tenant_id:tenantId,owner_id:ownerId,producer_id:producerId,conversation_id:conversationId,context_epoch:0,domain:'COMMERCIAL'}}}
 await pg.query(`INSERT INTO val_recommendations(id,tenant_id,consultant_id,client_id,client_external_key,user_question,mode,model_version,input_context,generated_content)
  VALUES($1::uuid,$2,$3,$4::uuid,$5,$6,'daily','rules-v7',$7::jsonb,$8::jsonb)`,
  [id(700),tenantId,ownerId,clientUuid,producerId,'Qual a melhor estratégia de venda de NPK para esse produtor?',JSON.stringify(inputContext),JSON.stringify({next_best_action:'Apresentar a proposta.'})])
})
after(async()=>{await pg?.close()})

test('CONV-03 — o repositorio devolve o context_epoch com o tipo do contrato',async()=>{
 const contexto=await repository.getClientContext({tenantId,ownerId,clientId:producerId,client:{id:producerId},contextRequest:{objective:'general_assistance',message:'explique melhor a resposta anterior',conversationId,contextEpoch:0,contextDomain:'COMMERCIAL',actorRole:'consultant',scope:'own_portfolio'}})
 const [anterior]=contexto.priorRecommendations
 assert.ok(anterior,'a recomendação gravada precisa chegar ao contexto')
 assert.equal(typeof anterior.context_epoch,'number',`veio como ${typeof anterior.context_epoch}: ${JSON.stringify(anterior.context_epoch)}`)
 assert.equal(anterior.context_epoch,0)
})

test('CONV-03 — o turno anterior atravessa para a pergunta de continuidade',async()=>{
 const contexto=await repository.getClientContext({tenantId,ownerId,clientId:producerId,client:{id:producerId},contextRequest:{objective:'general_assistance',message:'explique melhor a resposta anterior',conversationId,contextEpoch:0,contextDomain:'COMMERCIAL',actorRole:'consultant',scope:'own_portfolio'}})
 const escolhidas=selectScopedPriorRecommendations({...contexto,priorRecommendations:contexto.priorRecommendations},'explique melhor a resposta anterior',{tenantId,ownerId,producerId,conversationId,contextEpoch:0,contextDomain:'COMMERCIAL'})
 assert.equal(escolhidas.length,1,'o turno anterior da mesma conversa tem que atravessar')
 assert.match(escolhidas[0].user_question,/estratégia de venda de NPK/)
})

test('CONV-03 — conversa diferente continua sem atravessar',async()=>{
 const contexto=await repository.getClientContext({tenantId,ownerId,clientId:producerId,client:{id:producerId},contextRequest:{objective:'general_assistance',message:'explique melhor a resposta anterior',conversationId,contextEpoch:0,contextDomain:'COMMERCIAL',actorRole:'consultant',scope:'own_portfolio'}})
 const outraConversa=selectScopedPriorRecommendations(contexto,'explique melhor a resposta anterior',{tenantId,ownerId,producerId,conversationId:'99999999-2222-4333-8444-555555555555',contextEpoch:0,contextDomain:'COMMERCIAL'})
 assert.deepEqual(outraConversa,[])
 const outraEpoca=selectScopedPriorRecommendations(contexto,'explique melhor a resposta anterior',{tenantId,ownerId,producerId,conversationId,contextEpoch:1,contextDomain:'COMMERCIAL'})
 assert.deepEqual(outraEpoca,[])
})
