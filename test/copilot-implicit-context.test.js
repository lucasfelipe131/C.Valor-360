import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {
 buildAgroCopilotContext,
 buildOpportunityCopilotContext,
 buildVisitCopilotContext,
 resolveCopilotLaunch,
 shouldAutoSubmitCopilotSeed
} from '../src/lib/copilot-context.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const clients=[{id:'producer-a',name:'Produtor A'},{id:'producer-b',name:'Produtor B'}]

test('contexto implícito usa apenas produtor presente na carteira autenticada',()=>{
 const context={...buildOpportunityCopilotContext({opportunity:{id:'opp-a',clientId:'producer-a',title:'Fertilizante safra 26/27',stage:'Proposta'},client:clients[0]}),storageScope:'tenant-a:owner-a'}
 const launch=resolveCopilotLaunch({implicitContext:context,page:'opportunities',storageScope:'tenant-a:owner-a',clients})
 assert.equal(launch.clientId,'producer-a')
 assert.equal(launch.context.type,'opportunity')
 assert.equal(launch.context.id,'opp-a')
 assert.match(launch.prompt,/Fertilizante safra 26\/27/)
 assert.match(launch.prompt,/não registrar como fato/)
 assert.equal(launch.persistenceMode,'NONE')
})

test('hero agronômico autoenvia texto uma única vez sem promover persistência',()=>{
 const clients=[{id:'producer-a',name:'Produtor A'}]
 const launch=resolveCopilotLaunch({input:{clientId:'producer-a',prompt:'Abra o mapeamento.',autoSubmit:true,persistenceMode:'NONE'},page:'agro',storageScope:'scope',clients})
 assert.equal(launch.autoSubmit,true)
 assert.equal(launch.prompt,'Abra o mapeamento.')
 assert.equal(launch.persistenceMode,'NONE')
 const seedText={nonce:1,prompt:launch.prompt,clientId:launch.clientId,context:launch.context}
 assert.equal(shouldAutoSubmitCopilotSeed({open:true,seedText,selectedId:'producer-a',activeContext:null}),true)
 assert.equal(shouldAutoSubmitCopilotSeed({open:false,seedText,selectedId:'producer-a',activeContext:null}),false)
 assert.equal(shouldAutoSubmitCopilotSeed({open:true,seedText,selectedId:'producer-b',activeContext:null}),false)
 assert.equal(shouldAutoSubmitCopilotSeed({open:true,seedText,selectedId:'producer-a',activeContext:null,busy:true}),false)
 const copilot=read('src/components/GlobalValCopilot.jsx')
 assert.match(copilot,/setSeedText\(autoSubmit\?/)
 assert.match(copilot,/const pending=seedText;setSeedText\(null\)/)
 assert.match(copilot,/ask\(pending\.prompt,pending\.intent\)/)
 assert.match(copilot,/if\(!open\)\{if\(seedText\)setSeedText\(null\);return\}/)
})

test('troca de tenant/owner invalida prompt, produtor e objeto do contexto anterior',()=>{
 const stale={source:'visits',clientId:'producer-a',prompt:'Segredo do tenant anterior',context:{type:'visit',id:'visit-a',label:'Segredo'},storageScope:'tenant-a:owner-a'}
 const launch=resolveCopilotLaunch({implicitContext:stale,page:'visits',storageScope:'tenant-b:owner-b',clients:[{id:'producer-b',name:'Produtor B'}]})
 assert.equal(launch.clientId,'')
 assert.equal(launch.prompt,'')
 assert.equal(launch.context,null)
 assert.doesNotMatch(JSON.stringify(launch),/Segredo/)
})

test('produtor ausente da carteira é descartado antes de abrir o Copilot',()=>{
 const launch=resolveCopilotLaunch({
  input:{source:'visits',clientId:'outside-client',prompt:'Contexto externo',capture:'photo',context:{type:'visit',id:'outside-visit'}},
  page:'visits',storageScope:'tenant-a:owner-a',clients
 })
 assert.equal(launch.clientId,'')
 assert.equal(launch.prompt,'')
 assert.equal(launch.capture,'')
 assert.equal(launch.context,null)
})

test('troca de objeto selecionado troca produtor sem reaproveitar o contexto anterior',()=>{
 const first=buildVisitCopilotContext({visit:{id:'visit-a',clientId:'producer-a',objective:'Solo'},client:clients[0]})
 const second=buildVisitCopilotContext({visit:{id:'visit-b',clientId:'producer-b',objective:'Safra'},client:clients[1],preparing:true})
 const launchA=resolveCopilotLaunch({input:first,page:'visits',storageScope:'scope',clients})
 const launchB=resolveCopilotLaunch({input:second,page:'visits',storageScope:'scope',clients})
 assert.equal(launchA.clientId,'producer-a')
 assert.equal(launchB.clientId,'producer-b')
 assert.match(launchB.prompt,/Safra/)
 assert.doesNotMatch(launchB.prompt,/Solo/)
 assert.equal(launchB.source,'prepare_visit')
})

test('agronomia leva a ferramenta ativa sem inventar produtor quando não há contexto explícito',()=>{
 const context=buildAgroCopilotContext({tool:{id:'solo',label:'Análises de solo'}})
 const launch=resolveCopilotLaunch({input:context,page:'agro',storageScope:'scope',clients,selectedClient:clients[0]})
 assert.equal(launch.clientId,'')
 assert.deepEqual(launch.context,{type:'agronomic_tool',id:'solo',label:'Análises de solo',tool:'solo'})
 assert.match(launch.prompt,/Análises de solo/)
 assert.match(launch.prompt,/hipótese em prescrição/)
})

test('agronomia preserva produtor, propriedade, talhão e análise válidos',()=>{
 const context=buildAgroCopilotContext({
  tool:{id:'mapping',page:'produtores',label:'Mapeamento'},client:clients[0],property:{id:'property-a'},field:{id:'field-a',crop:'Soja',season:'2026/27'},analysis:{id:'analysis-a'}
 })
 const launch=resolveCopilotLaunch({input:context,page:'agro',storageScope:'scope',clients})
 assert.equal(launch.clientId,'producer-a')
 assert.deepEqual(launch.context,{type:'agronomic_tool',id:'mapping',label:'Mapeamento',tool:'mapping',page:'produtores',propertyId:'property-a',fieldId:'field-a',analysisId:'analysis-a',crop:'Soja',season:'2026/27'})
 assert.equal(launch.persistenceMode,'NONE')
})

test('superfícies registram o objeto ativo e abrem Perguntar à VAL sem persistência implícita',()=>{
 const app=read('src/App.jsx')
 const opportunities=read('src/pages/Opportunities.jsx')
 const visits=read('src/pages/Visits.jsx')
 const prepare=read('src/components/visit/PrepareVisitSimple.jsx')
 const agro=read('src/pages/Agro.jsx')
 const copilot=read('src/components/GlobalValCopilot.jsx')
 const helper=read('src/lib/copilot-context.js')

 assert.match(app,/resolveCopilotLaunch\(\{input,implicitContext:copilotPageContext/)
 assert.match(app,/copilotOwnerScope=currentUser\?\.storageScope\|\|currentUser\?\.id/)
 assert.match(app,/storageScope:copilotOwnerScope/)
 assert.match(app,/GlobalValCopilot key=\{copilotOwnerScope\|\|'session'\}/)
 assert.match(opportunities,/buildOpportunityCopilotContext/)
 assert.match(opportunities,/pipeline-ask-context/)
 assert.match(visits,/buildVisitCopilotContext/)
 assert.match(visits,/onContextChange\?\.\(pageContext\)/)
 assert.match(prepare,/Perguntar à VAL/)
 assert.match(prepare,/preparing:true/)
 assert.match(agro,/buildAgroCopilotLaunchContext/)
 assert.match(agro,/createAgroHeroContext/)
 assert.match(copilot,/setMessage\(seed\.prompt\|\|''\)/)
 assert.doesNotMatch(helper,/localStorage|sessionStorage|fetch\(/)
})
