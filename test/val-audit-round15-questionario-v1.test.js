import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import test,{before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'

// Rodada 15, ataque aos consertos da rodada 14 no questionario publico e na importacao comercial.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(150),ownerId=id(16)
let pg,repository

const perfil=(nome,municipio,area)=>({
 answers:{1:nome,2:municipio},
 result:{id:nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:nome,municipality:municipio,area:`${area} hectares`,cultures:'Soja',primaryProfile:'Tecnico',secondaryProfile:'Relacional'}
})
const carteira=async()=>(await pg.query('SELECT external_key,name,municipality,total_area_ha FROM clients WHERE tenant_id=$1 ORDER BY external_key',[tenantId])).rows

before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'TEST consultora','r15@example.test'])
 await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
})

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

test('PS01-MUNICIPIO — nome de municipio ambiguo sem UF cai na comparacao literal',()=>{
 // Ha cinco "Bom Jesus" no Brasil. Sem a UF nao da para afirmar qual e, e afirmar errado fundiria
 // produtores de estados diferentes. A UF, quando vem, DISTINGUE - por isso ela nao e descartada.
 const fonte=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 assert.match(fonte,/for\(const \[name,count\] of nameCount\)if\(count>1\)byName\.delete\(name\)/,'nome ambiguo nao pode resolver sozinho')
 assert.match(fonte,/state\?byNameState\.get\(`\$\{name\}\|\$\{state\}`\):byName\.get\(name\)/,'com UF, a UF decide')
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

test('DH02-ORDINAL — tirar uma linha da planilha nao duplica a venda que sobrou',async()=>{
 // O ordinal e posicional dentro do arquivo. Com duas vendas do mesmo produto no mesmo dia, tirar
 // uma desloca a outra para o ordinal 1 enquanto a copia antiga fica no 2: R$ 25.000 viravam
 // R$ 50.000 no Cliente 360, e o consultor nao tinha como remover o evento velho pela tela.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-a',fileName:'v.csv',rowCount:2},clients:clientes,rows:[linha({Valor:'10000'}),linha({Valor:'15000'})],mapping})
 assert.equal((await eventos()).length,2,'pre-requisito: duas vendas reais sao dois eventos')
 const resultado=await repository.ingestCommercialImport({ownerId,summary:{id:'imp-b',fileName:'v.csv',rowCount:1},clients:clientes,rows:[linha({Valor:'10000'})],mapping})
 const depois=await eventos()
 assert.equal(depois.length,1,`a linha removida deixou copia orfa: ${JSON.stringify(depois)}`)
 assert.equal(Number(depois[0].value),10000)
 assert.equal(resultado.prunedEventCount,1,'a importacao tem de contar o que podou')
})

test('DH02-ORDINAL — a poda nao alcanca evento de outra chave nem de outro dono',async()=>{
 // A poda so pode tocar chaves que ESTAO neste arquivo. Um produtor que nao veio na planilha nova
 // nao pode perder o historico dele.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 const outro=[{id:'fazenda-aurora',name:'Fazenda Aurora',commercial:{}},{id:'sitio-bela-vista',name:'Sitio Bela Vista',commercial:{}}]
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-c',fileName:'v.csv',rowCount:3},clients:outro,rows:[linha({Valor:'10000'}),linha({Valor:'15000'}),linha({Cliente:'Sitio Bela Vista',Valor:'7000'})],mapping})
 assert.equal((await eventos()).length,3)
 await repository.ingestCommercialImport({ownerId,summary:{id:'imp-d',fileName:'v.csv',rowCount:1},clients:clientes,rows:[linha({Valor:'10000'})],mapping})
 const depois=await eventos()
 assert.equal(depois.length,2,'o produtor ausente da planilha nova nao pode perder o historico')
 assert.ok(depois.some(evento=>Number(evento.value)===7000),'a venda do outro produtor tem de sobreviver')
})
