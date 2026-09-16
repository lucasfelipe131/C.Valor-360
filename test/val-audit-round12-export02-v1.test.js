import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{after,before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {createManagementService} from '../server/management-service.js'

// EXPORT-02. Metade do enunciado original foi REFUTADA na verificação: os totais do resumo já
// acompanham o filtro de Situação, linha a linha. O que reproduz é o AVISO: ele era contado sobre as
// visitas cruas, antes do filtro, então a tela dizia "Nenhuma visita neste período e filtro" na
// tabela e, logo acima, "um produtor arquivado tem visita neste período; ela aparece na lista" —
// sobre uma visita que a lista não mostra.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(100)
const admin={id:id(1),tenantId,role:'admin'}
const viewer={id:id(2),tenantId,role:'bi_viewer'}
const consultant=id(3)
const period={start:'2026-09-01',end:'2026-09-12'}
const ativo=id(500),arquivado=id(501)
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
 for(const [key,status,nome] of [[ativo,'active','TEST produtor ativo'],[arquivado,'archived','TEST produtor arquivado']]){
  await pg.query(`INSERT INTO clients(id,tenant_id,external_key,consultant_id,name,municipality,cultures,source,status)
   VALUES($1::uuid,$2,$1::text,$3,$4,'TEST Town','Soja','manual',$5)`,[key,tenantId,consultant,nome,status])
 }
 // A única visita do produtor arquivado é COMPLETED; com o filtro em PLANNED ela some da lista.
 await pg.query(`INSERT INTO visits(id,tenant_id,client_id,consultant_id,scheduled_at,lifecycle_status,objective)
  VALUES($1,$2,$3::uuid,$4,'2026-09-12T15:00Z','COMPLETED','TEST objective')`,[id(800),tenantId,arquivado,consultant])
 await pg.query(`INSERT INTO visits(id,tenant_id,client_id,consultant_id,scheduled_at,lifecycle_status,objective)
  VALUES($1,$2,$3::uuid,$4,'2026-09-10T15:00Z','PLANNED','TEST objective')`,[id(801),tenantId,ativo,consultant])
})
after(async()=>{await pg?.close()})

test('EXPORT-02 — sem filtro, o aviso do produtor arquivado corresponde a lista',async()=>{
 const resultado=await service.overview(viewer,period)
 assert.equal(resultado.visits.length,2)
 assert.deepEqual(resultado.archivedProducers.map(item=>item.id),[arquivado])
 assert.match(resultado.notices.join(' '),/produtor arquivado tem visita neste período/)
})

test('EXPORT-02 — com o filtro de Situacao, o aviso deixa de citar visita que a tela nao mostra',async()=>{
 const resultado=await service.overview(viewer,{...period,status:'PLANNED'})
 assert.deepEqual(resultado.visits.map(item=>item.id),[id(801)],'só a visita PLANNED aparece')
 assert.equal(resultado.visits.some(item=>item.clientId===arquivado),false)
 assert.deepEqual(resultado.archivedProducers,[],'o produtor arquivado não tem visita nesta lista')
 assert.equal(resultado.notices.some(notice=>/arquivado/.test(notice)),false,`aviso contradiz a tabela: ${resultado.notices.join(' | ')}`)
})

test('EXPORT-02 — o resumo continua acompanhando o filtro (a metade refutada do achado)',async()=>{
 const semFiltro=await service.overview(viewer,period)
 const comFiltro=await service.overview(viewer,{...period,status:'PLANNED'})
 assert.equal(semFiltro.summary.visits,2)
 assert.equal(comFiltro.summary.visits,1,'o total tem que contar o que a tabela mostra')
 assert.equal(comFiltro.summary.completed,0)
 assert.equal(comFiltro.summary.visits,comFiltro.visits.length)
})
