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
 constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();this.sessionId=null
  socket.addEventListener('message',event=>{
   const message=JSON.parse(event.data)
   const resolve=this.pending.get(message.id)
   if(resolve){this.pending.delete(message.id);resolve(message.result||{})}
  })}
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
 const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
 if(!b)return 'sem botao: '+${JSON.stringify(label)};
 b.click();return 'ok';
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
 for(const screen of SCREENS){
  await cdp.send('Emulation.setDeviceMetricsOverride',{
   width:screen.width,height:screen.height,deviceScaleFactor:1,
   mobile:Boolean(screen.mobile),screenWidth:screen.width,screenHeight:screen.height
  })
  await cdp.send('Page.navigate',{url:BASE})
  await sleep(2600)
  for(const step of screen.steps){
   if(step.wait){await sleep(step.wait);continue}
   const expression=step.nav?clickNav(step.nav):step.click?clickSelector(step.click):step.tab?clickTab(step.tab):step.tap?tapText(step.tap):openMore
   const result=await cdp.evaluate(expression)
   const value=result?.result?.value
   if(value&&value!=='ok')console.warn(`  aviso em ${screen.file}: ${value}`)
   await sleep(1100)
  }
  const height=(await cdp.evaluate('document.documentElement.scrollHeight'))?.result?.value
  const width=(await cdp.evaluate('document.documentElement.scrollWidth'))?.result?.value
  if(width>screen.width)console.warn(`  aviso em ${screen.file}: rolagem horizontal (${width}px > ${screen.width}px)`)
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
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
