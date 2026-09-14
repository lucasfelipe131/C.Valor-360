import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {AccessRepository} from '../server/access-repository.js'

const servidor=readFileSync(new URL('../server.js',import.meta.url),'utf8')

const repositorio=registro=>new AccessRepository({
 db:{configured:true,query:async(sql,params)=>{registro.push({sql,params});return {rowCount:1,rows:[]}}},
 tenantId:'00000000-0000-4000-8000-000000000001',
 runtimeConfig:{}
})

test('sair revoga a credencial, nao so o cookie do navegador', async () => {
 // "Encerrar sessão" limpava o cookie deste navegador e mais nada: o celular perdido com a VAL
 // aberta continuava lendo a carteira inteira até os 12h expirarem. A máquina de revogação já
 // existia (resolveSession compara users.session_version com o do token) e o logout era o único
 // caminho que mudava a sessão sem tocar nela.
 const registro=[]
 const revogou=await repositorio(registro).revokeSessions({id:'00000000-0000-4000-8000-000000000101'})
 assert.equal(revogou,true)
 assert.equal(registro.length,1)
 assert.match(registro[0].sql,/session_version=session_version\+1/)
 // Sem o vínculo de membership um id de outro tenant poderia derrubar a sessão alheia.
 assert.match(registro[0].sql,/EXISTS \(SELECT 1 FROM memberships WHERE tenant_id=\$2/)
 assert.deepEqual(registro[0].params,['00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001'])
})

test('identidade sem uuid nao dispara escrita', async () => {
 // O modo demo e as identidades sintéticas não têm credencial persistida para revogar.
 const registro=[]
 assert.equal(await repositorio(registro).revokeSessions({id:'demo'}),false)
 assert.equal(registro.length,0)
 await assert.rejects(repositorio(registro).revokeSessions({}),error=>error.statusCode===401)
})

test('o logout so revoga com banco e nunca deixa de deslogar', () => {
 // Contratos que o conserto não pode quebrar: em modo demo (sem PostgreSQL) a rota continua
 // respondendo 200, e uma falha na revogação não pode prender o consultor dentro do produto —
 // o cookie sai de qualquer jeito.
 const bloco=servidor.slice(servidor.indexOf("url.pathname==='/api/auth/logout'"))
 const handler=bloco.slice(0,bloco.indexOf('/api/auth/password'))
 assert.match(handler,/database\.configured/,'a revogação precisa ser condicionada ao banco')
 assert.match(handler,/try\{await accessRepository\.revokeSessions/,'falha de revogação não pode impedir a saída')
 assert.match(handler,/setHeader\('Set-Cookie',auth\.clearCookie\(request\)\)/)
 // test/val-audit-round7-contracts-v1.test.js fatia server.js entre o login e o logout: a ordem
 // das duas rotas no arquivo é contrato de outro teste.
 assert.ok(servidor.indexOf("url.pathname==='/api/auth/login'")<servidor.indexOf("url.pathname==='/api/auth/logout'"))
})
