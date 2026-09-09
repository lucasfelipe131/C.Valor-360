import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mobileViewportMetrics,installMobileViewport,lockMobilePage,resetMobilePageScroll} from '../src/lib/mobile-viewport.js'
import {routeValIntent} from '../server/ai-reasoning/intent-router.js'

test('iPhone keyboard follows visual viewport, without treating browser chrome or pinch zoom as keyboard',()=>{
 assert.deepEqual(mobileViewportMetrics({height:360,offsetTop:42,layoutHeight:844,editing:true}),{height:360,top:42,keyboardOpen:true})
 assert.equal(mobileViewportMetrics({height:744,layoutHeight:844,editing:true}).keyboardOpen,false)
 assert.equal(mobileViewportMetrics({height:360,layoutHeight:844,editing:false}).keyboardOpen,false)
 assert.equal(mobileViewportMetrics({height:360,layoutHeight:844,scale:2,editing:true}).keyboardOpen,false)
 assert.equal(mobileViewportMetrics({height:360,layoutHeight:360,baselineHeight:844,editing:true}).keyboardOpen,true)
})

const events=()=>{const listeners=new Map();return {listeners,addEventListener(type,fn){const set=listeners.get(type)||new Set();set.add(fn);listeners.set(type,set)},removeEventListener(type,fn){listeners.get(type)?.delete(fn)},emit(type){listeners.get(type)?.forEach(fn=>fn())}}}
function domFixture(){
 const properties=new Map(),classes=new Set(),frames=new Map(),scrolls=[],media={...events(),matches:true}
 let seq=0
 const win={...events(),innerHeight:844,innerWidth:390,scrollX:0,scrollY:320,visualViewport:{...events(),height:844,offsetTop:0,scale:1},matchMedia:()=>media,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id),scrollTo:position=>scrolls.push(position)}
 const doc={...events(),activeElement:{matches:()=>false},documentElement:{style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}},body:{style:{position:'',top:'',left:'',width:'',overflow:''},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,value)=>value?classes.add(name):classes.delete(name)}}}
 const flush=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn())}
 return {win,doc,properties,classes,frames,flush,scrolls,media}
}

test('viewport tracks focus/keyboard dismissal/orientation and cleans every listener',()=>{
 const fixture=domFixture(),{win,doc,properties,classes,flush}=fixture
 const stop=installMobileViewport(win,doc)
 assert.equal(properties.get('--val-viewport-height'),'844px')
 doc.activeElement.matches=()=>true;doc.emit('focusin');win.visualViewport.height=350;win.visualViewport.offsetTop=20;win.visualViewport.emit('resize');flush()
 assert.equal(properties.get('--val-viewport-height'),'350px');assert.equal(properties.get('--val-viewport-top'),'20px');assert.ok(classes.has('val-mobile-keyboard-open'))
 doc.activeElement.matches=()=>false;doc.emit('focusout');flush();assert.ok(!classes.has('val-mobile-keyboard-open'))
 win.innerHeight=390;win.visualViewport.height=390;win.visualViewport.offsetTop=0;win.emit('orientationchange');flush();assert.equal(properties.get('--val-viewport-height'),'390px')
 stop();assert.equal(properties.size,0)
 for(const target of [win,doc,win.visualViewport])for(const callbacks of target.listeners.values())assert.equal(callbacks.size,0)
})

test('nested mobile menu over chat locks background once and restores scroll only on final release',()=>{
 const {win,doc,scrolls,media}=domFixture()
 const first=lockMobilePage(win,doc),second=lockMobilePage(win,doc)
 assert.equal(doc.body.style.position,'fixed');assert.equal(doc.body.style.top,'-320px')
 second();assert.equal(scrolls.length,0);assert.equal(doc.body.style.position,'fixed')
 first();assert.equal(doc.body.style.position,'');assert.equal(scrolls[0].top,320)
 media.matches=false;const desktop=lockMobilePage(win,doc);assert.equal(doc.body.style.position,'')
 media.matches=true;media.emit('change');assert.equal(doc.body.style.position,'fixed')
 media.matches=false;media.emit('change');assert.equal(doc.body.style.position,'');desktop()
})

test('mobile layout preserves chat clearance, touch controls, producer selection and single-column menus',()=>{
 const css=readFileSync(new URL('../src/val-mobile-navigation.css',import.meta.url),'utf8')
 const nav=readFileSync(new URL('../src/components/MobileNav.jsx',import.meta.url),'utf8')
 assert.match(css,/height:calc\(var\(--val-viewport-height,100dvh\) - var\(--val-mobile-nav-space\)\)!important/)
 assert.match(css,/body\.val-mobile-keyboard-open \.mobile-nav\{display:none!important\}/)
 assert.match(css,/\.val-fs-client\{display:grid!important/)
 assert.match(css,/min-height:44px/)
 assert.match(css,/mobile-workspace-list[\s\S]*flex-direction:column!important/)
 assert.match(nav,/go\(\{id:'clients',page:'clients'\}\)/)
 assert.match(nav,/copilotActive\|\|page==='copilot'/)
})

test('changing page while chat is locked does not restore the previous page scroll',()=>{
 const {win,doc,scrolls}=domFixture()
 const release=lockMobilePage(win,doc)
 resetMobilePageScroll(doc);assert.equal(doc.body.style.top,'0px')
 release();assert.equal(scrolls[0].top,0)
})

test('general questions use AI-capable general routing with or without a producer; private facts and live data do not',()=>{
 for(const hasClient of [false,true]){
  for(const message of ['Por que o céu é azul?','Quem inventou o telefone?','Como funciona um motor elétrico?','Me ajude a escrever uma mensagem de agradecimento']){
   const route=routeValIntent({message,hasClient,intentHint:hasClient?'ASK_CLIENT':''})
   assert.equal(route.intent,'ASK_GENERAL',message);assert.equal(route.client_context_required,false)
  }
 }
 for(const message of ['Qual o perfil dele?','Qual a área total?','Quais culturas ele planta?','Quem decide nesta conta?'])assert.notEqual(routeValIntent({message,hasClient:true}).intent,'ASK_GENERAL',message)
 assert.equal(routeValIntent({message:'Qual a cotação da soja hoje?',hasClient:true}).intent,'ASK_COMMODITY')
 assert.equal(routeValIntent({message:'Como estará o clima amanhã?',hasClient:true}).intent,'CHECK_WEATHER')
})
