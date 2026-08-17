import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const packageJson=JSON.parse(read('package.json'))
const bootstrap=read('server/portfolio-radar-bootstrap.js')
const dashboard=read('src/pages/Dashboard.jsx')
const component=read('src/components/ValDailyRadar.jsx')
const styles=read('src/val-daily-radar.css')
const main=read('src/main.jsx')
const docs=read('docs/VAL_CONVERSION_PHASE_D.md')

test('runtime acrescenta o radar à carteira sem criar uma rota pública nova',()=>{
 assert.match(packageJson.scripts.start,/portfolio-radar-bootstrap\.js/)
 assert.match(bootstrap,/ValRepository\.prototype\.getIntelligence/)
 assert.match(bootstrap,/buildPortfolioRadar/)
 assert.match(bootstrap,/radarVersion/)
})

test('Dashboard mostra o radar e oferece ações reais sobre a conta',()=>{
 assert.match(dashboard,/import ValDailyRadar/)
 assert.match(dashboard,/<ValDailyRadar[^>]+clients=\{clients\}[^>]+visits=\{visits\}[^>]+opportunities=\{opportunities\}/)
 assert.match(component,/RADAR DE CONVERSÃO • HOJE/)
 assert.match(component,/Abrir conta/)
 assert.match(component,/Preparar conversa/)
 assert.match(component,/Nenhum motivo foi inventado/)
})

test('radar possui layout próprio, responsivo e incluído no bundle',()=>{
 assert.match(main,/\.\/val-daily-radar\.css/)
 assert.match(styles,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/)
 assert.match(styles,/@media\(max-width:620px\)/)
 assert.match(styles,/grid-template-columns:1fr/)
})

test('documentação proíbe automação e uso manipulativo de dados pessoais',()=>{
 assert.match(docs,/no máximo cinco itens/i)
 assert.match(docs,/não cria contatos, tarefas, oportunidades nem alterações no CRM/i)
 assert.match(docs,/família, hobbies, time, preferências pessoais/i)
 assert.match(docs,/score serve apenas para ordenar trabalho/i)
})
