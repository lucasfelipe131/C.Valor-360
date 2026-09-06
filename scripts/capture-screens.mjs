// Captura de telas da VAL para revisão visual.
//
// A aplicação não tem router: navegar é estado em memória, então um
// `--screenshot` do Chrome só alcançaria a Home. Este script fala CDP direto
// com um Chrome headless para clicar na navegação antes de fotografar — é o
// que permite capturar cada workspace e o mobile.
//
// Uso:
//   VAL_DEMO_MODE=true PORT=3000 node server/start.js &
//   node scripts/capture-screens.mjs [http://localhost:3000] [docs/rebrand/after]

import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const BASE=process.argv[2]||'http://localhost:3000'
const OUT=process.argv[3]||'docs/rebrand/after'
const PORT=9333
const PROFILE=join(tmpdir(),`val-capture-${Date.now()}`)

const CHROME=[
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 '/usr/bin/google-chrome','/usr/bin/chromium'
].find(existsSync)
if(!CHROME){console.error('Nenhum Chrome/Edge encontrado.');process.exit(1)}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

// O modo demo não tem carteira (sem PostgreSQL não há dono), então as telas
// de mapa usam uma carteira de demonstração injetada por interceptação de
// rede — o app renderiza os próprios componentes sobre tiles reais, mas os
// produtores são fictícios e estão nomeados como tal. Nada disso entra no
// produto: vive só neste script de captura.
//   VAL_CAPTURE_SET=property node scripts/capture-screens.mjs
const tomorrow=hour=>{const at=new Date();at.setDate(at.getDate()+1);at.setHours(hour,0,0,0);return at.toISOString()}
const FIXTURE_CLIENTS=[
 {id:'demo-fazenda-1',name:'Produtor de demonstração',municipality:'Sorriso/MT',area:'480 ha',cultures:'Soja, Milho',primaryProfile:'A classificar',secondaryProfile:'Aguardando observação',irt:0,nps:0,servicePreference:'WhatsApp',commercial:{property:'Fazenda Demonstração',phone:'',email:''},relationship:{},location:{lat:-12.465,lng:-55.689,source:'consultant_pin'}},
 {id:'demo-fazenda-2',name:'Segunda demonstração',municipality:'Sorriso/MT',area:'220 ha',cultures:'Soja',primaryProfile:'A classificar',secondaryProfile:'Aguardando observação',irt:0,nps:0,commercial:{property:'Sítio Demonstração'},relationship:{},location:{lat:-12.39,lng:-55.62,source:'consultant_pin'}},
 {id:'demo-fazenda-3',name:'Sem sede (demonstração)',municipality:'Lucas do Rio Verde/MT',area:'150 ha',cultures:'Milho',primaryProfile:'A classificar',secondaryProfile:'Aguardando observação',irt:0,nps:0,commercial:{property:''},relationship:{},location:null}
]
const FIXTURE_VISITS=[
 {id:'demo-visita-1',clientId:'demo-fazenda-1',scheduledAt:tomorrow(8),objective:'Demonstração do roteiro: talhão Norte',status:'Agendada',lifecycleStatus:'PLANNED'},
 {id:'demo-visita-2',clientId:'demo-fazenda-2',scheduledAt:tomorrow(10),objective:'Demonstração do roteiro: sítio',status:'Agendada',lifecycleStatus:'PLANNED'},
 {id:'demo-visita-3',clientId:'demo-fazenda-3',scheduledAt:tomorrow(14),objective:'Demonstração: produtor sem sede no mapa',status:'Agendada',lifecycleStatus:'PLANNED'}
]
const FIXTURE_PROPERTY={
 clientId:'demo-fazenda-1',source:'demonstracao',
 property:{id:'demo-p1',name:'Fazenda Demonstração',municipality:'Sorriso/MT',areaHa:480,location:{lat:-12.465,lng:-55.689,source:'consultant_pin'}},
 properties:[{id:'demo-p1',name:'Fazenda Demonstração'}],
 fields:[
  {id:'demo-f1',name:'Talhão Norte',areaHa:96.4,crop:'Soja',season:'2025/26',geometryStatus:'CANONICAL',points:[{lat:-12.4585,lng:-55.6975},{lat:-12.4585,lng:-55.6875},{lat:-12.4672,lng:-55.6875},{lat:-12.4672,lng:-55.6975}]},
  {id:'demo-f2',name:'Talhão Sul',areaHa:71.2,crop:'Milho',season:'2025/26',geometryStatus:'CANONICAL',points:[{lat:-12.4690,lng:-55.6960},{lat:-12.4690,lng:-55.6880},{lat:-12.4755,lng:-55.6880},{lat:-12.4755,lng:-55.6960}]},
  {id:'demo-f3',name:'Reserva',areaHa:38,crop:'',season:'',geometryStatus:'NOT_MAPPED',points:[]}
 ]
}
const fixtureBody=url=>{
 if(/\/api\/intelligence(\?|$)/.test(url))return {imports:[],clients:FIXTURE_CLIENTS,visits:FIXTURE_VISITS,opportunities:[]}
 const property=url.match(/\/api\/clients\/([^/]+)\/property/)
 if(property)return decodeURIComponent(property[1])==='demo-fazenda-1'?FIXTURE_PROPERTY:{clientId:decodeURIComponent(property[1]),property:null,properties:[],fields:[]}
 return null
}

// Cada tela: nome do arquivo, viewport e o caminho de cliques até chegar lá.
// `nav` clica num botão da sidebar pelo texto exato; `more` abre o sheet mobile;
// `click` clica num seletor CSS; `tab` clica na barra inferior do celular pelo
// texto; `tap` clica em qualquer botão pelo texto exato.
const SCREENS=[
 {file:'home-desktop',width:1440,height:1240,steps:[]},
 {file:'workspace-produtor',width:1440,height:1100,steps:[{nav:'Produtor'}]},
 {file:'workspace-inteligencia',width:1440,height:1100,steps:[{nav:'Inteligência'}]},
 {file:'workspace-campo',width:1440,height:1240,steps:[{nav:'Campo'}]},
 {file:'workspace-campo-calculadoras',width:1440,height:1240,steps:[{nav:'Inteligência'},{nav:'Calculadoras'}]},
 {file:'workspace-gestao',width:1440,height:1100,steps:[{nav:'Gestão'}]},
 {file:'workspace-comercial-oportunidades',width:1440,height:1240,steps:[{nav:'Oportunidades'}]},
 {file:'home-mobile',width:375,height:1000,mobile:true,steps:[]},
 {file:'mobile-copilot',width:375,height:1000,mobile:true,steps:[{click:'.home-copilot-actions button:not(.is-voice)'}]},
 {file:'mobile-copilot-voice',width:375,height:1000,mobile:true,steps:[{click:'.home-copilot-actions .is-voice'},{wait:2500}]},
 {file:'mobile-produtores',width:375,height:1000,mobile:true,steps:[{tab:'Produtores'}]},
 {file:'mobile-visitas',width:375,height:1000,mobile:true,steps:[{more:true},{tap:'Visitas'}]},
 {file:'mobile-oportunidades',width:375,height:1000,mobile:true,steps:[{more:true},{tap:'Oportunidades'}]},
 {file:'mobile-campo',width:375,height:1000,mobile:true,steps:[{more:true},{tap:'Mapas e talhões'}]},
 {file:'mobile-workspaces',width:375,height:1000,mobile:true,steps:[{more:true}]}
]
const PROPERTY_SCREENS=[
 {file:'property-desktop',width:1440,height:1240,fixture:true,steps:[{nav:'Produtor'},{nav:'Produtor 360'},{click:'.client-card'},{summary:'Ver mapa, sede e talhões'},{wait:4000}],clip:'.client-drilldown[open]'},
 {file:'property-mobile',width:375,height:1000,mobile:true,fixture:true,steps:[{tab:'Produtores'},{click:'.client-card'},{summary:'Ver mapa, sede e talhões'},{wait:4000}],clip:'.client-drilldown[open]'},
 {file:'route-desktop',width:1440,height:1240,fixture:true,steps:[{nav:'Visitas'},{wait:4000}]},
 {file:'route-mobile',width:375,height:1000,mobile:true,fixture:true,steps:[{more:true},{tap:'Visitas'},{wait:4000}]}
]
const SCREEN_SET=process.env.VAL_CAPTURE_SET==='property'?PROPERTY_SCREENS:SCREENS

const chrome=spawn(CHROME,[
 '--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check',
 '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
 `--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'about:blank'
],{stdio:'ignore'})

const cdpEndpoint=async()=>{
 for(let attempt=0;attempt<40;attempt+=1){
  try{
   const response=await fetch(`http://127.0.0.1:${PORT}/json/version`)
   if(response.ok)return (await response.json()).webSocketDebuggerUrl
  }catch{}
  await sleep(250)
 }
 throw new Error('Chrome não abriu a porta de depuração.')
}

class Session{
 constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();this.sessionId=null;this.handlers=new Map()
  socket.addEventListener('message',event=>{
   const message=JSON.parse(event.data)
   const resolve=this.pending.get(message.id)
   if(resolve){this.pending.delete(message.id);resolve(message.result||{})}
   else if(message.method&&this.handlers.has(message.method))this.handlers.get(message.method)(message.params||{})
  })}
 on(method,handler){this.handlers.set(method,handler)}
 send(method,params={},useSession=true){
  const id=++this.id
  const payload={id,method,params}
  if(useSession&&this.sessionId)payload.sessionId=this.sessionId
  this.socket.send(JSON.stringify(payload))
  return new Promise(resolve=>this.pending.set(id,resolve))
 }
 evaluate(expression){return this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})}
}

const clickNav=label=>`(()=>{
 const b=[...document.querySelectorAll('.val-workspace-sidebar nav button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
 if(!b)return 'nao encontrado: '+${JSON.stringify(label)};
 b.click();return 'ok';
})()`

const openMore=`(()=>{
 const b=[...document.querySelectorAll('.mobile-nav>button')].find(x=>(x.getAttribute('aria-label')||'').includes('workspaces'));
 if(!b)return 'sem botao mais';
 b.click();return 'ok';
})()`

const clickSelector=selector=>`(()=>{
 const b=document.querySelector(${JSON.stringify(selector)});
 if(!b)return 'nao encontrado: '+${JSON.stringify(selector)};
 b.click();return 'ok';
})()`

const tapText=label=>`(()=>{
 const all=[...document.querySelectorAll('button,[role="button"]')];
 const b=all.find(x=>x.textContent.trim()===${JSON.stringify(label)})||all.find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)}));
 if(!b)return 'sem botao: '+${JSON.stringify(label)};
 b.click();return 'ok';
})()`

const clickSummary=label=>`(()=>{
 const b=[...document.querySelectorAll('details>summary')].find(x=>x.textContent.includes(${JSON.stringify(label)}));
 if(!b)return 'sem summary: '+${JSON.stringify(label)};
 b.click();b.scrollIntoView({block:'start'});return 'ok';
})()`

const rectOf=selector=>`(()=>{
 const el=document.querySelector(${JSON.stringify(selector)});
 if(!el)return null;
 const r=el.getBoundingClientRect();
 return JSON.stringify({x:Math.max(0,r.left+window.scrollX-8),y:Math.max(0,r.top+window.scrollY-8),width:Math.ceil(r.width+16),height:Math.ceil(r.height+16)});
})()`

const clickTab=label=>`(()=>{
 const b=[...document.querySelectorAll('.mobile-nav>button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
 if(!b)return 'sem aba: '+${JSON.stringify(label)};
 b.click();return 'ok';
})()`

const run=async()=>{
 const endpoint=await cdpEndpoint()
 const socket=new WebSocket(endpoint)
 await new Promise(resolve=>socket.addEventListener('open',resolve))
 const cdp=new Session(socket)

 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'},false)
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true},false)
 cdp.sessionId=sessionId
 await cdp.send('Page.enable')
 await cdp.send('Runtime.enable')

 mkdirSync(OUT,{recursive:true})
 const saved=[]
 let fixtureActive=false
 cdp.on('Fetch.requestPaused',async params=>{
  const payload=fixtureActive?fixtureBody(params.request.url):null
  if(payload)await cdp.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json; charset=utf-8'}],body:Buffer.from(JSON.stringify(payload)).toString('base64')})
  else await cdp.send('Fetch.continueRequest',{requestId:params.requestId})
 })
 await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/api/intelligence*'},{urlPattern:'*/api/clients/*/property'}]})
 for(const screen of SCREEN_SET){
  fixtureActive=Boolean(screen.fixture)
  await cdp.send('Emulation.setDeviceMetricsOverride',{
   width:screen.width,height:screen.height,deviceScaleFactor:1,
   mobile:Boolean(screen.mobile),screenWidth:screen.width,screenHeight:screen.height
  })
  await cdp.send('Page.navigate',{url:BASE})
  await sleep(2600)
  for(const step of screen.steps){
   if(step.wait){await sleep(step.wait);continue}
   const expression=step.nav?clickNav(step.nav):step.click?clickSelector(step.click):step.tab?clickTab(step.tab):step.tap?tapText(step.tap):step.summary?clickSummary(step.summary):openMore
   const result=await cdp.evaluate(expression)
   const value=result?.result?.value
   if(value&&value!=='ok')console.warn(`  aviso em ${screen.file}: ${value}`)
   await sleep(1100)
  }
  const height=(await cdp.evaluate('document.documentElement.scrollHeight'))?.result?.value
  const width=(await cdp.evaluate('document.documentElement.scrollWidth'))?.result?.value
  if(width>screen.width)console.warn(`  aviso em ${screen.file}: rolagem horizontal (${width}px > ${screen.width}px)`)
  let clip
  if(screen.clip){
   const raw=(await cdp.evaluate(rectOf(screen.clip)))?.result?.value
   if(raw){const rect=JSON.parse(raw);clip={...rect,scale:1}}else console.warn(`  aviso em ${screen.file}: recorte não encontrado (${screen.clip})`)
  }
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,...(clip?{clip}:{})})
  if(!shot.data){console.warn(`  falhou: ${screen.file}`);continue}
  const path=join(OUT,`${screen.file}.png`)
  writeFileSync(path,Buffer.from(shot.data,'base64'))
  saved.push(path)
  console.log(`  ${path}  (${height}px de altura)`)
 }
 socket.close()
 return saved
}

try{
 console.log(`Capturando ${BASE} em ${OUT}:`)
 const saved=await run()
 console.log(`\n${saved.length} tela(s) capturada(s).`)
}catch(error){
 console.error(error.message)
 process.exitCode=1
}finally{
 chrome.kill()
 try{rmSync(PROFILE,{recursive:true,force:true})}catch{}
}
