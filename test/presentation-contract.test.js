import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('apresentação pública da VAL expõe proposta, soluções, método e acesso seguro',()=>{
 const login=read('src/pages/Login.jsx')
 assert.match(login,/className="val-presentation"/)
 assert.match(login,/id="solucoes"/)
 assert.match(login,/id="como-funciona"/)
 assert.match(login,/id="aplicacoes"/)
 assert.match(login,/id="acesso"/)
 assert.match(login,/VAL Comercial/)
 assert.match(login,/Inteligência Agronômica/)
 assert.match(login,/Produtor 360/)
 assert.match(login,/VAL Grãos/)
 assert.match(login,/Sua senha nunca é enviada à OpenAI/)
 assert.doesNotMatch(login,/200 mil|10\.000|depoimento de cliente/i)
})

test('sistema visual institucional mantém a paleta VAL e possui experiência móvel própria',()=>{
 const css=read('src/presentation.css')
 const main=read('src/main.jsx')
 assert.match(css,/--vp-green:#00c896/)
 assert.match(css,/--vp-blue:#2d8cff/)
 assert.match(css,/\.val-public-hero/)
 assert.match(css,/\.val-solution-grid/)
 assert.match(css,/\.val-journey-list/)
 assert.match(css,/@media\(max-width:820px\)/)
 assert.match(css,/prefers-reduced-motion/)
 assert.match(main,/import '\.\/presentation\.css'/)
})

test('formulário de acesso continua integrado ao contrato de autenticação existente',()=>{
 const login=read('src/pages/Login.jsx')
 assert.match(login,/await onLogin\(\{email,password\}\)/)
 assert.match(login,/autoComplete="username"/)
 assert.match(login,/autoComplete="current-password"/)
 assert.match(login,/type="submit"/)
 assert.match(login,/role="alert"/)
})
