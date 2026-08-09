import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync,statSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('brand mark keeps its accent centered and reuses the real logo on mobile',()=>{
 const logo=read('src/components/Logo.jsx')
 const topbar=read('src/components/Topbar.jsx')
 assert.match(logo,/rotate\(18 51 32\)/)
 assert.match(logo,/useId/)
 assert.match(topbar,/<Logo compact\/>/)
 assert.doesNotMatch(topbar,/topbar-mobile-mark|>C</)
})

test('pipeline presents discrete stages without a probability-style progress bar',()=>{
 const opportunities=read('src/pages/Opportunities.jsx')
 const rendered=opportunities.slice(opportunities.indexOf('return <div className="page-stack pipeline-page"'))
 assert.match(rendered,/pipeline-stage-progress/)
 assert.match(rendered,/Etapa \{index\+1\} de 4/)
 assert.doesNotMatch(rendered,/pipeline-probability|probabilidade/i)
})

test('navigation resets long pages and the responsive shell retains scroll clearance',()=>{
 const app=read('src/App.jsx')
 const styles=read('src/styles.css')
 assert.match(app,/window\.scrollTo\(\{top:0,left:0,behavior:'auto'\}\)/)
 assert.match(app,/document\.querySelector\('\.topbar h1'\)\?\.focus/)
 assert.match(styles,/body\{height:auto;min-height:100%;overflow-x:clip;overflow-y:auto/)
 assert.match(styles,/padding:18px max\(16px,env\(safe-area-inset-right\)\) calc\(112px \+ env\(safe-area-inset-bottom\)\)/)
 assert.match(styles,/\.pipeline-journey\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);max-width:100%;overflow:visible/)
})

test('assisted review keeps question 27 optional through the final screen',()=>{
 const surveyForm=read('src/components/SurveyForm.jsx')
 assert.match(surveyForm,/requiredQuestions=questions\.filter\(question=>question\.id!==27\)/)
 assert.match(surveyForm,/currentQuestions\.filter\(question=>question\.id!==27&&/)
 assert.match(surveyForm,/question\.id===27\?' \(opcional\)'/)
})

test('batch import has a responsive visual hierarchy and keeps the VALOR 360 PWA brand',()=>{
 const styles=read('src/styles.css')
 const app=read('src/App.jsx')
 const html=read('index.html')
 const manifest=JSON.parse(read('public/manifest.webmanifest'))
 assert.match(styles,/\.import-record-list\{display:grid/)
 assert.match(styles,/\.import-batch-progress\{padding:/)
 assert.match(styles,/@media\(max-width:700px\)[\s\S]*\.import-record-list\{grid-template-columns:1fr/)
 assert.match(app,/value!==''&&value!==null&&value!==undefined/)
 assert.match(html,/apple-mobile-web-app-title" content="VALOR 360"/)
 assert.equal(manifest.short_name,'VALOR 360')
})

test('negative optional answers use discovery labels instead of false opportunities',()=>{
 const profile=read('src/lib/profile.js')
 const client360=read('src/pages/Client360.jsx')
 const dashboard=read('src/pages/Dashboard.jsx')
 const opportunities=read('src/pages/Opportunities.jsx')
 assert.match(profile,/noAdditionalNeedPatterns/)
 assert.match(client360,/Nenhuma necessidade adicional declarada/)
 assert.match(client360,/Ainda não identificada/)
 assert.match(dashboard,/reconcilePipeline\(clients,/)
 assert.match(opportunities,/reconcilePipeline\(clients,/)
 assert.doesNotMatch(dashboard,/fallbackOpportunities|pipelineStages\[Math\.min\(index,2\)\]/)
 assert.doesNotMatch(opportunities,/clients\.map\(\(client,index\).*stage:/s)
})

test('commercial cache is scoped and technical drafts expire with the browser session',()=>{
 const app=read('src/App.jsx')
 const settings=read('src/pages/Settings.jsx')
 const client360=read('src/pages/Client360.jsx')
 const server=read('server.js')
 assert.match(app,/opportunityCacheKey\(effectiveScope\)/)
 assert.match(app,/clearSessionPortfolioCache\(currentUser\?\.storageScope\)/)
 assert.match(app,/invalidateSession=notice=>\{clearSessionPortfolioCache[\s\S]*setClientList\(\[\]\);setVisits\(\[\]\);setOpportunities\(\[\]\);setSelected\(null\)/)
 assert.match(app,/if\(session\?\.authenticated\)rememberStorageScope\(session\.user\);else clearSessionPortfolioCache\(\)/)
 assert.match(settings,/opportunityCacheKey\(currentUser\?\.storageScope\)/)
 assert.match(client360,/sessionStorage\.setItem\(storageKey/)
 assert.doesNotMatch(client360,/localStorage/)
 assert.match(server,/storageScope:auth\.storageScope\(session\)/)
})

test('production bundle receives the protected portfolio only from the server',()=>{
 const app=read('src/App.jsx')
 const dashboard=read('src/pages/Dashboard.jsx')
 assert.equal(existsSync(join(root,'src/data/clients.json')),false)
 assert.doesNotMatch(app,/data\/clients\.json|initialVisits|localStorage\.setItem\('valor360-clients'/)
 assert.match(app,/const \[clientList,setClientList\]=useState\(\[\]\)/)
 assert.match(app,/const serverClients=Array\.isArray\(data\.clients\)\?data\.clients:\[\]/)
 assert.match(dashboard,/recentVisits\.length\?recentVisits\.map/)
})

test('versioned atmospheric artwork is present and referenced by the visual system',()=>{
 const asset=join(root,'public/valor360-background-v1.webp')
 const header=readFileSync(asset).subarray(0,12)
 assert.ok(statSync(asset).size>10_000)
 assert.equal(header.subarray(0,4).toString(),'RIFF')
 assert.equal(header.subarray(8,12).toString(),'WEBP')
 const styles=read('src/styles.css')
 assert.match(styles,/url\('\/valor360-background-v1\.webp'\)/)
 assert.match(styles,/background-position:center,center,61% center/)
 assert.match(styles,/background-position:center,center,70% center/)
})

test('inteligência agronômica executa o Manual dentro da sessão do VALOR 360',()=>{
 const agro=read('src/pages/Agro.jsx')
 const app=read('src/App.jsx')
 const manualConfig=read('manual/next.config.ts')
 const manualPage=read('manual/app/page.tsx')
assert.match(agro,/src="\/tecnico\?embedded=1"/)
 assert.match(agro,/Mesmo login ativo/)
 assert.match(app,/<Agro clients=\{clientList\}\/>/)
 assert.match(manualConfig,/basePath: "\/tecnico"/)
 assert.match(manualPage,/fetch\("\/api\/technical\/bootstrap"/)
})
