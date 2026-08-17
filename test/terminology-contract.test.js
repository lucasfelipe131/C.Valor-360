import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const panel=read('src/components/ValPanel.jsx')
const playbook=read('server/sales-playbook.js')
const audit=read('docs/TERMINOLOGY_AUDIT.md')
const engineDocs=read('docs/VAL_ENGINE.md')

test('nomes visíveis dos métodos permanecem explícitos e estáveis',()=>{
 assert.match(panel,/label:'SPIN'/)
 assert.match(panel,/label:'OPC'/)
 assert.match(panel,/label:'EPA'/)
 assert.match(playbook,/SPIN, EPA, OPC ou Senoide/)
 assert.doesNotMatch(playbook,/Senóide/)
})

test('auditoria sinaliza divergências sem renomear silenciosamente',()=>{
 assert.match(audit,/Não renomear silenciosamente/)
 assert.match(audit,/“Produtor”, “cliente” e “conta” coexistem/)
 assert.match(audit,/SPIN tem duas expansões próximas, mas não idênticas/)
 assert.match(audit,/EPA mantém o acrônimo, mas varia a descrição/)
 assert.match(audit,/OPC está consistente/)
 assert.match(audit,/Senoide não está integrada ao painel de métodos/)
 assert.match(audit,/Pendente de decisão de produto/)
})

test('terminologia define camadas sem migrar contratos técnicos',()=>{
 assert.match(audit,/conta comercial/)
 assert.match(audit,/conta de acesso/)
 assert.match(audit,/contratos `client`, `clientId` e tabela `clients`/)
 assert.match(engineDocs,/TERMINOLOGY_AUDIT\.md/)
})
