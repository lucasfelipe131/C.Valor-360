import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test,{before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'

// PS-01. A identidade do produtor vinda do Produtor 360 era so o nome. Dois xaras - comum no campo,
// e frequente em carteira herdada - colapsavam num cadastro so: o segundo sobrescrevia o primeiro,
// com 200 {saved:true} como se fosse cadastro novo. Medido em Postgres real: o Jose da Silva de
// 1.800 ha em Sorriso virava Lucas do Rio Verde, 120 ha, hortalicas, e as 45 respostas do primeiro
// ficavam orfas em client_profiles. A consultora perdia um produtor inteiro da carteira e a VAL
// passava a preparar visita e recomendar produto com os dados da pessoa errada.
// A regra e a mesma que server/survey-import.js ja aplicava na planilha - e o teste guarda os DOIS
// lados, porque o remedio obvio (chave sempre com municipio) quebraria o reenvio do mesmo produtor.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(140),ownerId=id(14)
let pg,repository

const perfil=(nome,municipio,area,culturas)=>({
 answers:{1:nome,2:municipio,3:`${area} hectares`,4:culturas},
 result:{id:nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:nome,municipality:municipio,area:`${area} hectares`,cultures:culturas,primaryProfile:'Tecnico',secondaryProfile:'Relacional'}
})
const carteira=async()=>(await pg.query('SELECT external_key,name,municipality,total_area_ha,cultures FROM clients WHERE tenant_id=$1 ORDER BY external_key',[tenantId])).rows

before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'TEST consultora','consultora@example.test'])
 await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
})

test('PS-01 — dois produtores homonimos de municipios diferentes viram dois cadastros',async()=>{
 await repository.saveSurveyProfile(perfil('José da Silva','Sorriso',1800,'Soja e milho'),ownerId)
 await repository.saveSurveyProfile(perfil('José da Silva','Lucas do Rio Verde',120,'Hortaliças'),ownerId)
 const linhas=await carteira()
 assert.equal(linhas.length,2,`o segundo xara sobrescreveu o primeiro: ${JSON.stringify(linhas)}`)
 const sorriso=linhas.find(linha=>linha.municipality==='Sorriso')
 const lucas=linhas.find(linha=>linha.municipality==='Lucas do Rio Verde')
 assert.ok(sorriso&&lucas,'os dois municipios tem de existir na carteira')
 assert.equal(Number(sorriso.total_area_ha),1800,'o primeiro produtor nao pode herdar a area do segundo')
 assert.equal(Number(lucas.total_area_ha),120)
 // O primeiro mantem a chave historica: senao o cadastro ja gravado deixaria de casar no proximo
 // envio e viraria duplicata a cada questionario respondido.
 assert.equal(sorriso.external_key,'jose-da-silva')
 assert.equal(lucas.external_key,'jose-da-silva-lucas-do-rio-verde')
})

test('PS-01 — o MESMO produtor reenviando continua atualizando o mesmo cadastro',async()=>{
 // O outro lado da regra. O remedio obvio - por o municipio na chave sempre - duplicaria o cadastro
 // de todo produtor que respondesse o questionario duas vezes.
 const antes=(await carteira()).length
 await repository.saveSurveyProfile(perfil('José da Silva','Sorriso',1950,'Soja, milho e algodão'),ownerId)
 const linhas=await carteira()
 assert.equal(linhas.length,antes,'reenvio do mesmo produtor nao pode criar cadastro novo')
 const sorriso=linhas.find(linha=>linha.municipality==='Sorriso')
 assert.equal(Number(sorriso.total_area_ha),1950,'o reenvio tem de atualizar a area')
 assert.equal(sorriso.external_key,'jose-da-silva')
})

test('PS-01 — municipio ausente de um dos lados continua sendo a mesma pessoa',async()=>{
 // Q2 e opcional em parte dos convites antigos. Sem municipio nao ha como afirmar que sao pessoas
 // diferentes, e criar cadastro novo a cada resposta seria pior que fundir.
 await repository.saveSurveyProfile(perfil('Marina Alves','',300,'Soja'),ownerId)
 const depoisPrimeiro=(await carteira()).length
 await repository.saveSurveyProfile(perfil('Marina Alves','Rio Verde',320,'Soja e sorgo'),ownerId)
 const linhas=await carteira()
 assert.equal(linhas.length,depoisPrimeiro,'sem municipio no cadastro anterior, e a mesma pessoa')
 const marina=linhas.find(linha=>linha.name==='Marina Alves')
 assert.equal(marina.municipality,'Rio Verde','a resposta mais recente completa o cadastro')
 assert.equal(Number(marina.total_area_ha),320)
})
