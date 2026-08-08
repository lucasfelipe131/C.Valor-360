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
