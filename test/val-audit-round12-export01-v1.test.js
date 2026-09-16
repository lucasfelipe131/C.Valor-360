import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{after,before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {createManagementService} from '../server/management-service.js'

// EXPORT-01. O painel de gestao corta a lista de produtores em 5.000 linhas (teto deliberado) e
// marcava como "arquivado" todo produtor com visita no periodo que nao estivesse nessa pagina. O
// criterio era ausencia da pagina, nao o status do cadastro. Medido com 5001 produtores ativos: o
// ultimo da ordenacao alfabetica saia com archived:true carregando status 'active' no mesmo objeto,
// a tela mostrava a tarja "Produtor arquivado" e o aviso afirmava que ele "nao entra na contagem da
// carteira" - entrava, porque o total vem de count(*) sobre status='active' e exibia 5001.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(100)
const admin={id:id(1),tenantId,role:'admin'}
const viewer={id:id(2),tenantId,role:'bi_viewer'}
const consultant=id(3)
const period={start:'2026-09-01',end:'2026-09-12'}
const beyondPage=id(900001)
const archived=id(900002)
let pg,service

before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 service=createManagementService({db,tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 for(const [key,role] of [[admin.id,'admin'],[viewer.id,'bi_viewer'],[consultant,'consultant']]){
  await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[key,`TEST user ${key}`,`${key}@example.test`])
  await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,key,role])
 }
 const unit=(await service.createUnit(admin,{name:'TEST unit'})).unit
 for(const userId of [viewer.id,consultant])await service.assignUnit(admin,{userId,unitId:unit.id})
 // 5.000 produtores ativos com nome "TEST producer 00001..05000": preenchem a pagina inteira.
 await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,status)
  SELECT ('00000000-0000-4000-8000-'||lpad(serie::text,12,'0'))::uuid,$1,serie::text,$2,'TEST producer '||lpad(serie::text,5,'0'),'TEST Town','Soja','manual','active'
  FROM generate_series(1,5000) serie`,[tenantId,consultant])
 // Ordenacao e por nome: "ZZZ" fica depois da linha 5000 e cai fora da pagina, ativo.
 await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,status)
  VALUES($1::uuid,$2,$1::text,$3,'ZZZ TEST produtor fora da pagina','TEST Town','Soja','manual','active')`,[beyondPage,tenantId,consultant])
 await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,status)
  VALUES($1::uuid,$2,$1::text,$3,'ZZZ TEST produtor arquivado','TEST Town','Soja','manual','archived')`,[archived,tenantId,consultant])
 for(const [key,producer] of [[id(800001),beyondPage],[id(800002),archived]])await pg.query(`INSERT INTO visits(id,tenant_id,client_id,consultant_id,scheduled_at,lifecycle_status,objective)
  VALUES($1,$2,$3::uuid,$4,'2026-09-12T15:00Z','COMPLETED','TEST objective')`,[key,tenantId,producer,consultant])
})
after(async()=>{await pg?.close()})

test('EXPORT-01 — produtor ativo fora da pagina nao e apresentado como arquivado',async()=>{
 const result=await service.overview(viewer,period)
 assert.equal(result.truncated.producers,true,'pré-requisito: a lista precisa ter sido cortada')
 assert.equal(result.producers.length,5000)
 assert.equal(result.summary.producers,5001,'a carteira conta os ativos, inclusive o que ficou fora da página')
 const fora=result.archivedProducers.find(item=>item.id===beyondPage)
 assert.ok(fora,'ele viaja junto para o gestor saber de quem é a visita')
 assert.equal(fora.status,'active')
 assert.equal(fora.archived,false,'ausência da página não é arquivamento')
})

test('EXPORT-01 — produtor de fato arquivado continua marcado e contado à parte',async()=>{
 const result=await service.overview(viewer,period)
 const item=result.archivedProducers.find(entry=>entry.id===archived)
 assert.ok(item)
 assert.equal(item.archived,true)
 assert.equal(item.status,'archived')
 // O total da carteira ignora arquivado: 5000 da página + 1 ativo fora dela.
 assert.equal(result.summary.producers,5001)
})

test('EXPORT-01 — o aviso deixa de afirmar que o ativo fora da pagina nao conta na carteira',async()=>{
 const notices=(await service.overview(viewer,period)).notices.join(' ')
 assert.match(notices,/Um produtor arquivado tem visita neste período/)
 assert.match(notices,/Um produtor ativo tem visita neste período e ficou fora das primeiras 5000 linhas da lista; ele continua contado na carteira/)
})
