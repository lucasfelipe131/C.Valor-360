import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import test,{before,after} from 'node:test'
import {randomUUID} from 'node:crypto'
import {createDatabase} from '../server/db.js'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'

// Rodada 15, ataque aos consertos da rodada 14 no questionario publico e na importacao comercial.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=randomUUID(),ownerId=randomUUID()
let pg,repository

const perfil=(nome,municipio,area)=>({
 answers:{1:nome,2:municipio},
 result:{id:nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:nome,municipality:municipio,area:`${area} hectares`,cultures:'Soja',primaryProfile:'Tecnico',secondaryProfile:'Relacional'}
})
const carteira=async()=>(await pg.query('SELECT external_key,name,municipality,total_area_ha FROM clients WHERE tenant_id=$1 ORDER BY external_key',[tenantId])).rows

before(async()=>{
 let db
 if(process.env.VAL_SURVEY_TEST_DATABASE_URL){
  const url=new URL(process.env.VAL_SURVEY_TEST_DATABASE_URL)
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'only disposable loopback PostgreSQL')
  db=createDatabase({databaseUrl:url.href,databaseSsl:false})
  pg=db
  assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16)
 }else{
  pg=new PGlite()
  await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
  for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
  db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 }
 repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'TEST consultora',`${ownerId}@example.test`])
 await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
})

after(async()=>{await pg?.close()})

test('PS01-MUNICIPIO — o mesmo produtor escrevendo o municipio de outro jeito continua sendo um so',async()=>{
 // A Q2 e texto livre. Com o texto na chave, "Sorriso", "Sorriso/MT" e "Zona rural de Sorriso"
 // viravam tres produtores, e cada cadastro novo nascia sem o historico do anterior - a consultora
 // via a carteira triplicar sozinha e a VAL respondia sobre o cadastro vazio.
 for(const grafia of ['Sorriso','Sorriso/MT','Sorriso - MT','Zona rural de Sorriso','Fazenda Boa Vista, Sorriso'])
  await repository.saveSurveyProfile(perfil('Antônio Prado',grafia,500),ownerId)
 const linhas=(await carteira()).filter(linha=>linha.name==='Antônio Prado')
 assert.equal(linhas.length,1,`cada grafia do municipio virou um cadastro: ${JSON.stringify(linhas.map(l=>l.external_key))}`)
})

test('PS01-MUNICIPIO — municipios de verdade diferentes continuam sendo pessoas diferentes',async()=>{
 // O fail-safe: canonizar nao pode fundir xara de municipios distintos, que e o que a rodada 14
 // acabou de consertar.
 await repository.saveSurveyProfile(perfil('Carlos Menezes','Sorriso/MT',1800),ownerId)
 await repository.saveSurveyProfile(perfil('Carlos Menezes','Lucas do Rio Verde - MT',120),ownerId)
 const linhas=(await carteira()).filter(linha=>linha.name==='Carlos Menezes')
 assert.equal(linhas.length,2,'xaras de municipios diferentes tem de ser dois cadastros')
 assert.ok(linhas.some(linha=>linha.external_key==='carlos-menezes'),'o primeiro mantem a chave historica')
})

test('PS01-MUNICIPIO — UF distingue nomes iguais e localidade desconhecida permanece literal',async()=>{
 for(const name of ['SYNTHETIC Bom Jesus','SYNTHETIC Unknown Place']){
  const place=name.endsWith('Place')?'Localidade Sintetica XYZ':'Bom Jesus'
  await repository.saveSurveyProfile(perfil(name,`${place}/RS`,120),ownerId)
  await repository.saveSurveyProfile(perfil(name,`${place}/RN`,900),ownerId)
  assert.equal((await carteira()).filter(row=>row.name===name).length,2,'a UF nao pode desaparecer no fallback')
 }
 const source=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 assert.match(source,/for\(const \[name,count\] of nameCount\)if\(count>1\)byName\.delete\(name\)/)
})

test('PS01-CHAVE180 — razao social longa nao come o sufixo de municipio',async()=>{
 // O slice cortava o sufixo fora quando o nome ja ocupava os 180, e os xaras colapsavam de novo.
 const nomeLongo='AGROPECUARIA SANTA TEREZINHA DO NORTE PARTICIPACOES E EMPREENDIMENTOS AGRICOLAS DO CENTRO OESTE BRASILEIRO SOCIEDADE ANONIMA DE CAPITAL FECHADO FILIAL UNIDADE DOIS LIMITADA ME EIRELI'
 assert.ok(nomeLongo.length>=180)
 await repository.saveSurveyProfile(perfil(nomeLongo,'Sorriso/MT',4800),ownerId)
 await repository.saveSurveyProfile(perfil(nomeLongo,'Lucas do Rio Verde/MT',300),ownerId)
 const linhas=(await carteira()).filter(linha=>linha.name.startsWith('AGROPECUARIA SANTA'))
 assert.equal(linhas.length,2,'o sufixo de municipio nao pode ser comido pelo corte em 180')
 for(const linha of linhas)assert.ok(linha.external_key.length<=180,'a chave tem de caber na coluna')
 assert.equal(new Set(linhas.map(linha=>linha.external_key)).size,2,'as duas chaves precisam ser distintas')
})

test('PS01-ESCOPO — canonizacao e lock nao cruzam tenant ou owner',async()=>{
 const db=repository.db,otherTenant=randomUUID(),otherOwner=randomUUID()
 await db.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)',[otherTenant,'SYNTHETIC other organization',otherTenant])
 await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[otherOwner,'SYNTHETIC other consultant',`${otherOwner}@example.test`])
 for(const [t,o] of [[tenantId,otherOwner],[otherTenant,ownerId]])await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[t,o,'consultant'])
 const name='SYNTHETIC Scoped Homonym',foreign=new ValRepository({db,tenantId:otherTenant,readStore:()=>({}),saveStore:()=>{}})
 await Promise.all([
  repository.saveSurveyProfile(perfil(name,'Sorriso/MT',100),ownerId),
  repository.saveSurveyProfile(perfil(name,'Sorriso/MT',200),otherOwner),
  foreign.saveSurveyProfile(perfil(name,'Sorriso/MT',300),ownerId)
 ])
 const rows=(await db.query('SELECT tenant_id,consultant_id,total_area_ha FROM clients WHERE name=$1 AND tenant_id=ANY($2::uuid[])',[name,[tenantId,otherTenant]])).rows
 assert.equal(rows.length,3)
 for(const [t,o,area] of [[tenantId,ownerId,100],[tenantId,otherOwner,200],[otherTenant,ownerId,300]])assert.equal(Number(rows.find(row=>row.tenant_id===t&&row.consultant_id===o)?.total_area_ha),area)
})

test('PS01-CONCORRENCIA — duas respostas simultaneas de xaras nao colapsam',async()=>{
 // O SELECT ... FOR UPDATE nao trava nada quando ainda nao existe linha com aquele nome: as duas
 // transacoes leem vazio, escolhem a mesma chave e a segunda sobrescreve a primeira.
 const fonte=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 const resolvedor=fonte.slice(fonte.indexOf('const resolveSurveyExternalKey='),fonte.indexOf('const resolveSurveyExternalKey=')+900)
 assert.match(resolvedor,/pg_advisory_xact_lock[\s\S]{0,200}survey-name/,'a trava tem de ser pelo nome normalizado, antes do SELECT')
 // E o efeito continua correto em sequencia, que e o caminho comum.
 await Promise.all([
  repository.saveSurveyProfile(perfil('Joana Prado','Sinop/MT',900),ownerId),
  repository.saveSurveyProfile(perfil('Joana Prado','Sinop/MT',900),ownerId)
 ])
 const linhas=(await carteira()).filter(linha=>linha.name==='Joana Prado')
 assert.equal(linhas.length,1,'mesma pessoa, mesmo municipio: um cadastro so')
 // In the native PostgreSQL gate these are separate concurrent transactions,
 // with no pre-existing row for the name. PGlite is explicitly local coverage.
 for(let i=0;i<10;i++){
  const name=`SYNTHETIC Concurrent Homonym ${i}`
  await Promise.all([
   repository.saveSurveyProfile(perfil(name,'Sorriso/MT',120),ownerId),
   repository.saveSurveyProfile(perfil(name,'Lucas do Rio Verde/MT',900),ownerId)
  ])
  const pair=(await carteira()).filter(row=>row.name===name)
  assert.equal(pair.length,2,'concurrent homonyms must preserve both producers')
  assert.deepEqual(pair.map(row=>Number(row.total_area_ha)).sort((a,b)=>a-b),[120,900])
 }

})

test('PS02 — o balde do envio e por par token+endereco, e token fora do formato e recusado antes',()=>{
 const servidor=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const envio=servidor.slice(servidor.indexOf('const submitMatch=url.pathname.match'))
 assert.match(envio,/String\(submitMatch\[1\]\)\.length>64/,'token fora do formato emitido nao pode ocupar o balde')
 assert.match(envio,/consumeRateLimit\('survey-submit',`\$\{submitMatch\[1\]\}\|\$\{requestIdentity\(request\)\}`,20\)/)
 assert.match(envio,/consumeRateLimit\('survey-miss',requestIdentity\(request\),60\)/,'token inexistente volta a gastar o balde por endereco')
})

const linha=(extra={})=>({Cliente:'Fazenda Aurora',Data:'12/03/2026',Produto:'Ureia',Valor:'10000',Status:'Ganho',...extra})
const mapping={client:'Cliente',date:'Data',product:'Produto',value:'Valor',status:'Status'}
const clientes=[{id:'fazenda-aurora',name:'Fazenda Aurora',commercial:{}}]
const eventos=async()=>(await pg.query('SELECT external_id,value FROM business_events WHERE tenant_id=$1 ORDER BY external_id',[tenantId])).rows

test('DH02-ORDINAL / LEG — subconjunto nao autoriza apagar venda historica',async()=>{
 // Authorized reconciliation: missing rows are not cancellation instructions.
 // Keep the original two-sale scenario from e0a7d1e and preserve both historical IDs.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-a',fileName:'v.csv',rowCount:2},clients:clientes,rows:[linha({Valor:'10000'}),linha({Valor:'15000'})],mapping})
 assert.equal((await eventos()).length,2,'pre-requisito: duas vendas reais sao dois eventos')
 const antes=await eventos()
 const resultado=await repository.ingestCommercialImport({ownerId,summary:{id:'imp-b',fileName:'v.csv',rowCount:1},clients:clientes,rows:[linha({Valor:'10000'})],mapping})
 const depois=await eventos()
 assert.deepEqual(depois,antes,'a venda ausente e o external_id historico precisam permanecer')
 assert.equal(depois.reduce((sum,row)=>sum+Number(row.value),0),25000)
 assert.equal(resultado.ignoredEventCount,1)
 assert.equal(resultado.prunedEventCount??0,0)
 assert.equal(resultado.acceptedClients[0].commercial.revenue,25000)
})

test('DH02-ORDINAL / LEG — subconjunto preserva eventos do mesmo e de outro produtor',async()=>{
 // The updated LEG contract preserves both absent producers AND absent rows of a present producer.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 const outro=[{id:'fazenda-aurora',name:'Fazenda Aurora',commercial:{}},{id:'sitio-bela-vista',name:'Sitio Bela Vista',commercial:{}}]
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-c',fileName:'v.csv',rowCount:3},clients:outro,rows:[linha({Valor:'10000'}),linha({Valor:'15000'}),linha({Cliente:'Sitio Bela Vista',Valor:'7000'})],mapping})
 assert.equal((await eventos()).length,3)
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-d',fileName:'v.csv',rowCount:1},clients:clientes,rows:[linha({Valor:'10000'})],mapping})
 const depois=await eventos()
 assert.equal(depois.length,3,'nenhuma venda ausente da planilha pode ser apagada')
 assert.equal(depois.reduce((sum,row)=>sum+Number(row.value),0),32000)
 assert.ok(depois.some(evento=>Number(evento.value)===7000),'a venda do outro produtor tem de sobreviver')
})
