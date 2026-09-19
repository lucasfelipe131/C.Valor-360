import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {AccessRepository} from '../server/access-repository.js'
import {hashPassword} from '../server/auth.js'

// SENHA-01. A senha temporaria e entregue por fora do produto - WhatsApp, e-mail, papel - e a tela
// de Primeiro Acesso promete, em texto: "A senha temporaria sera invalidada assim que a troca for
// concluida". Repetir a mesma string nos dois campos era aceito. Medido em Postgres real: a
// credencial que circulou no grupo do escritorio continuava valendo, e os dois lugares que deveriam
// avisar diziam o contrario - a tela dava a troca por concluida e o painel de Acessos parava de
// marcar primeiro acesso pendente.
const tenantId='00000000-0000-4000-8000-000000000001'
const actorId='00000000-0000-4000-8000-000000000101'

const repositorioCom=async senhaAtual=>{
 const hash=await hashPassword(senhaAtual)
 const registro=[]
 const db={configured:true,query:async(sql,params)=>{
  registro.push({sql,params})
  if(sql.startsWith('SELECT password_hash FROM users'))return {rowCount:1,rows:[{password_hash:hash}]}
  if(sql.startsWith('UPDATE users SET password_hash'))return {rowCount:1,rows:[{id:actorId,name:'Dora',email:'dora@valor360.local',status:'active',must_change_password:false,session_version:1}]}
  return {rowCount:1,rows:[]}
 }}
 return {repositorio:new AccessRepository({db,tenantId,runtimeConfig:{}}),registro}
}

test('SENHA-01 — trocar a senha temporaria por ela mesma e recusado',async()=>{
 const temporaria='2W2s9ABY5LTK'
 const {repositorio,registro}=await repositorioCom(temporaria)
 await assert.rejects(
  ()=>repositorio.changePassword({id:actorId,role:'consultant'},temporaria,temporaria),
  /diferente da senha atual/i,
  'repetir a temporaria deixava a credencial que circulou por fora valendo para sempre')
 assert.equal(registro.filter(chamada=>chamada.sql.startsWith('UPDATE users SET password_hash')).length,0,
  'nao pode gravar nada: a troca tem de falhar antes do UPDATE')
})

test('SENHA-01 — trocar por uma senha nova de verdade continua funcionando',async()=>{
 // O outro lado: a recusa nao pode atrapalhar a troca legitima, que e o caminho normal.
 const {repositorio,registro}=await repositorioCom('2W2s9ABY5LTK')
 const conta=await repositorio.changePassword({id:actorId,role:'consultant'},'2W2s9ABY5LTK','Sementeira2026')
 assert.equal(conta.mustChangePassword,false)
 const update=registro.find(chamada=>chamada.sql.startsWith('UPDATE users SET password_hash'))
 assert.ok(update,'a troca legitima tem de gravar')
 assert.match(update.sql,/session_version=session_version\+1/,'a troca continua derrubando as sessoes antigas')
})

test('SENHA-01 — a recusa e do servidor, nao so da tela',()=>{
 // A promessa esta escrita na tela de Primeiro Acesso; a garantia tem de estar no servidor, porque
 // a rota aceita qualquer cliente.
 const fonte=readFileSync(new URL('../server/access-repository.js',import.meta.url),'utf8')
 const trecho=fonte.slice(fonte.indexOf('async changePassword('),fonte.indexOf('async changePassword(')+1600)
 assert.match(trecho,/verifyPassword\(newPassword,current\.rows\[0\]\.password_hash\)/,
  'a comparacao tem de ser contra o hash guardado, nao contra a string recebida do cliente')
})

// SENHA-02 e SENHA-03. O botao "Limpar dados locais" promete limpar "rascunhos e dados locais deste
// dispositivo" e deixava no aparelho as duas coisas mais sensiveis que a VAL guarda: a conversa
// inteira do copiloto e o rascunho do questionario do produtor. E a tela de Configuracoes afirmava
// "Produtores 0 / Visitas 0" quando a carteira apenas nao tinha carregado, entregando em seguida um
// backup de cinco linhas com a mensagem "gerado com sucesso".
test('SENHA-02 — limpar dados locais tambem apaga a conversa do copiloto e o rascunho do questionario',()=>{
 const fonte=readFileSync(new URL('../src/pages/Settings.jsx',import.meta.url),'utf8')
 const clear=fonte.slice(fonte.indexOf('const clear=()=>'),fonte.indexOf('const clear=()=>')+1400)
 assert.match(clear,/clearCopilotSessionStorage\(sessionStorage/,'a conversa do copiloto ficava no aparelho')
 assert.match(clear,/clearSurveyDraft\(/,'o rascunho do questionario do produtor ficava no aparelho')
 // Marcador de saida pendente precisa sobreviver a limpeza, senao a saida pendente se perde.
 assert.doesNotMatch(clear,/valor360-pending-logout/,'o marcador de saida pendente nao pode ser apagado aqui')
})

test('SENHA-03 — com a carteira sem carregar, Configuracoes nao afirma zero nem gera backup',()=>{
 const fonte=readFileSync(new URL('../src/pages/Settings.jsx',import.meta.url),'utf8')
 assert.match(fonte,/export default function Settings\(\{[^}]*loadError/,'a tela precisa receber o erro de carga')
 assert.match(fonte,/loadError\?'—':clients\.length/,'zero afirmado e pior que numero ausente')
 assert.match(fonte,/loadError\?'—':visits\.length/)
 assert.match(fonte,/onClick=\{backup\} disabled=\{Boolean\(loadError\)\}/,'o backup tem de ficar indisponivel')
 const backup=fonte.slice(fonte.indexOf('const backup=()=>'),fonte.indexOf('const backup=()=>')+900)
 assert.match(backup,/if\(loadError\)/,'o backup tambem se recusa por dentro, para qualquer outro caminho')
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
 assert.match(app,/page==='settings'&&<Settings[^>]*loadError=\{portfolioError\}/,'App tem de repassar o erro que ja tem')
})
