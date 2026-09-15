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

test('sair sem sinal deixa o aparelho de fora e insiste quando a rede volta', () => {
 // Sem sinal, logout() caía no catch e o único retorno era um toast de 2,8 s: a tela continuava
 // com o menu, a carteira e as Preferências dela. A consultora entrega o tablet achando que saiu.
 //
 // Limpar só o estado local e mostrar o login seria mentira — o cookie é HttpOnly e continua
 // valendo, então recarregar entra direto na conta, sem senha.
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8').replace(/\s+/g,' ')
 // A falha sai do aparelho pelo MESMO caminho do sucesso, e marca a pendência.
 assert.match(app,/catch\{markPendingLogout\(true\);leaveDevice\(pendingLogoutNotice\)\}/)
 assert.match(app,/if\(response\.ok\)throw new Error\(\)|if\(!response\.ok\)throw new Error\(\)/)
 // localStorage de propósito: sessionStorage morreria ao fechar a aba, que é exatamente quando o
 // aparelho troca de mão.
 assert.match(app,/const pendingLogoutKey='valor360-pending-logout'/)
 assert.match(app,/localStorage\.setItem\(pendingLogoutKey/)
 // Com pendência, o bootstrap NÃO restaura a sessão mesmo que o servidor diga que ela vale.
 assert.match(app,/if\(pendingLogout\(\)\)\{ fetch\('\/api\/auth\/logout',\{method:'POST'/)
 // O aviso é honesto: não afirma que a credencial já foi revogada.
 assert.match(app,/o servidor ainda não confirmou a revogação/)
 // Entrar de novo encerra a pendência.
 assert.match(app,/markPendingLogout\(false\);rememberStorageScope\(payload\.user\)/)
})

test('falha de rede sozinha continua sem derrubar sessao', () => {
 // Contrato da rodada 8 (VAL-R8-ADM-01): sinal ruim na fazenda não pode valer logout. A pendência
 // só nasce do clique explícito no botão; os efeitos de bootstrap e revalidação seguem intactos.
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8').replace(/\s+/g,' ')
 assert.match(app,/const serverAnswered=sessionDenied\|\|Boolean\(session\)/)
 assert.match(app,/if\(serverAnswered\)clearSessionPortfolioCache\(\)/)
 assert.match(app,/nada local foi apagado/)
 // markPendingLogout(true) aparece uma única vez: no catch do botão.
 assert.equal((app.match(/markPendingLogout\(true\)/g)||[]).length,1)
})
