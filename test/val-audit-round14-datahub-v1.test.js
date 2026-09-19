import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import test,{before} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {ValRepository} from '../server/repository.js'

// DH-01, DH-02, DH-03, DH-05 e DH-06. A importacao comercial do DataHub tinha dois arquivos de teste
// e cinco defeitos confirmados, todos da mesma familia: a tela conta uma coisa e o banco guarda
// outra. O pior deles e o silencio - nenhum aviso, nenhum numero divergente, so o Cliente 360
// mostrando R$ 0 semanas depois.
const id=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`
const tenantId=id(141),ownerId=id(15)
let pg,repository

const linha=(extra={})=>({Cliente:'Fazenda Aurora',Data:'12/03/2026',Produto:'Ureia',Valor:'10000',Status:'Ganho',...extra})
const mapping={client:'Cliente',date:'Data',product:'Produto',value:'Valor',status:'Status'}
const resumo=(rowCount,sufixo='')=>({id:`import-${rowCount}${sufixo}`,fileName:'vendas.csv',rowCount,truncated:false})
const clientes=[{id:'fazenda-aurora',name:'Fazenda Aurora',commercial:{}}]
const eventos=async()=>(await pg.query('SELECT external_id,value,product,category FROM business_events WHERE tenant_id=$1 ORDER BY external_id',[tenantId])).rows

before(async()=>{
 pg=new PGlite()
 await pg.exec((await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''))
 for(const file of (await readdir(new URL('../database/migrations/',import.meta.url))).filter(item=>item.endsWith('.sql')).sort())await pg.exec(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'))
 const db={configured:true,query:(...args)=>pg.query(...args),transaction:work=>pg.transaction(tx=>work({query:(...args)=>tx.query(...args)}))}
 repository=new ValRepository({db,readStore:()=>({}),saveStore:()=>{},tenantId})
 await pg.query('INSERT INTO organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)',[tenantId,'TEST organization'])
 await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[ownerId,'TEST consultor','datahub@example.test'])
 await pg.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,ownerId,'consultant'])
})

test('DH-01 — planilha sem coluna de status nao vira compra nenhuma, e a importacao diz isso',async()=>{
 // Exportacao de ERP sem coluna de status e caso comum. A tela declarava "REGISTROS INCORPORADOS
 // 120" e "VOLUME INFORMADO R$ 1.500 mil" com o banco vazio; o Cliente 360 do mesmo produtor
 // mostrava "Compras globais registradas R$ 0" e a VAL respondia que ele nao tinha compras.
 const rows=Array.from({length:5},()=>({Cliente:'Fazenda Aurora',Data:'12/03/2026',Produto:'Ureia',Valor:'10000'}))
 const resultado=await repository.ingestCommercialImport({ownerId,summary:resumo(5,'-sem-status'),clients:clientes,rows,mapping:{client:'Cliente',date:'Data',product:'Produto',value:'Valor'}})
 assert.equal(resultado.persistedEventCount,0,'nenhuma linha podia virar compra sem resultado reconhecido')
 assert.equal(resultado.unrecognizedOutcomeCount,5,'a importacao tem de contar o que descartou, e por que')
 assert.equal((await eventos()).length,0)
})

test('DH-01 — data irreconhecivel tambem e contada separadamente',async()=>{
 const rows=[linha({Data:'sem data'}),linha({Data:'12/03/2026'})]
 const resultado=await repository.ingestCommercialImport({ownerId,summary:resumo(2,'-data'),clients:clientes,rows,mapping})
 assert.equal(resultado.unrecognizedDateCount,1)
 assert.equal(resultado.persistedEventCount,1,'a linha boa da mesma planilha continua entrando')
})

test('DH-02 — corrigir o valor e reimportar atualiza a compra, nao duplica',async()=>{
 // O fluxo mais comum depois de uma importacao: corrigir a linha errada na planilha e reimportar.
 // A impressao digital carregava valor, resultado e status, entao o ON CONFLICT nunca casava e a
 // venda de 10 mil virava 25 mil, com "negocios reconhecidos" = 2 para uma venda so.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 await repository.ingestCommercialImport({ownerId,summary:resumo(1,'-a'),clients:clientes,rows:[linha()],mapping})
 await repository.ingestCommercialImport({ownerId,summary:resumo(1,'-b'),clients:clientes,rows:[linha()],mapping})
 assert.equal((await eventos()).length,1,'reenviar a mesma planilha nao pode duplicar')
 await repository.ingestCommercialImport({ownerId,summary:resumo(1,'-c'),clients:clientes,rows:[linha({Valor:'15000'})],mapping})
 const depois=await eventos()
 assert.equal(depois.length,1,'corrigir o valor nao pode criar um segundo evento')
 assert.equal(Number(depois[0].value),15000,'o valor corrigido tem de valer')
})

test('DH-02 — duas vendas reais do mesmo produto no mesmo dia continuam sendo duas',async()=>{
 // O outro lado: o ordinal existe justamente para nao fundir duas vendas distintas.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 await repository.ingestCommercialImport({ownerId,summary:resumo(2,'-duas'),clients:clientes,rows:[linha({Valor:'1000'}),linha({Valor:'2000'})],mapping})
 const depois=await eventos()
 assert.equal(depois.length,2,'duas vendas reais do mesmo produto no mesmo dia sao duas')
 assert.equal(depois.reduce((soma,item)=>soma+Number(item.value),0),3000)
})

test('DH-03 — descricao de produto longa nao derruba a importacao inteira',async()=>{
 // Exportacao de ERP agro traz marca, formulacao, embalagem e lote na mesma celula. Uma linha de
 // 143 caracteres fazia a transacao inteira falhar com "A importacao nao pode ser persistida no
 // PostgreSQL configurado" - mensagem que culpa o banco e nao diz qual linha e a culpada.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 const produtoLongo='FERTILIZANTE MINERAL MISTO NPK 04-14-08 COM ZINCO E BORO ENRIQUECIDO EMBALAGEM 50 KG SAFRA 2025/2026 ARMAZEM SORRISO MT LOTE 4471 PALETIZADO XX'
 assert.ok(produtoLongo.length>140,'o caso exige passar da largura da coluna de categoria')
 const rows=[linha(),linha({Produto:produtoLongo,Valor:'20000'}),linha({Valor:'30000',Data:'13/03/2026'})]
 const resultado=await repository.ingestCommercialImport({ownerId,summary:resumo(3,'-longo'),clients:clientes,rows,mapping})
 assert.equal(resultado.persisted,true,'uma celula longa nao pode derrubar a planilha inteira')
 assert.equal(resultado.persistedEventCount,3)
 const gravado=(await eventos()).find(item=>String(item.product||'').startsWith('FERTILIZANTE'))
 assert.ok(gravado,'a linha longa tem de entrar, cortada na largura da coluna')
 assert.ok(gravado.category.length<=140)
 assert.ok(gravado.product.length<=180)
})

test('DH-05 — razao social longa nao faz as compras do produtor sumirem',async()=>{
 // A chave gravada em clients.external_key e fatiada em 180; o mapa que liga evento a produtor
 // guardava a chave inteira, entao nome longo nunca casava: o cadastro entrava e TODAS as compras
 // dele viravam orfas, com a tela declarando sucesso.
 await pg.query('DELETE FROM business_events WHERE tenant_id=$1',[tenantId])
 const nomeLongo='AGROPECUARIA SANTA TEREZINHA DO NORTE PARTICIPACOES E EMPREENDIMENTOS AGRICOLAS DO CENTRO OESTE BRASILEIRO SOCIEDADE ANONIMA DE CAPITAL FECHADO FILIAL SORRISO MATO GROSSO UNIDADE DOIS LTDA ME'
 assert.ok(nomeLongo.length>180)
 const chaveLonga=nomeLongo.toLowerCase().replace(/[^a-z0-9]+/g,'-')
 const resultado=await repository.ingestCommercialImport({
  ownerId,summary:resumo(1,'-nome'),
  clients:[{id:chaveLonga,name:nomeLongo,commercial:{}}],
  rows:[linha({Cliente:nomeLongo})],mapping})
 assert.equal(resultado.persistedEventCount,1,'a compra do produtor de razao social longa tem de ser gravada')
 assert.ok(!resultado.skippedEventCount,'nada pode ficar orfao')
 assert.equal((await eventos()).length,1)
})

test('DH-06 — o painel de resultado nao imprime um zero solto e mostra o que nao virou compra',()=>{
 const tela=readFileSync(new URL('../src/pages/DataHub.jsx',import.meta.url),'utf8')
 // `undefined>0` e `0>0` sao false; `result.archivedSkipped?.length` sozinho imprimia "0" na tela.
 assert.doesNotMatch(tela,/\|\|result\.archivedSkipped\?\.length\)&&<div className="form-error"/,'guard precisa ser booleano')
 assert.match(tela,/result\.unrecognizedOutcomeCount>0&&<li>/,'a tela precisa dizer o que nao virou compra')
 assert.match(tela,/result\.unrecognizedDateCount>0&&<li>/)
 assert.match(tela,/COMPRAS GRAVADAS/,'o destaque tem de ser o que foi gravado, nao o que foi lido')
})
