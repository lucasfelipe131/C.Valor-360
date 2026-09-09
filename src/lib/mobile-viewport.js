// Safari keeps the layout viewport behind the keyboard. The conversation must
// follow the visible viewport instead; never disable zoom to hide the problem.
export function mobileViewportMetrics({height,offsetTop=0,scale=1,layoutHeight,baselineHeight,editing=false}){
 const visibleHeight=Math.max(0,Number(height)||Number(layoutHeight)||0)
 const keyboardOpen=editing&&Math.abs(scale-1)<.05&&Math.max(layoutHeight||0,baselineHeight||0)-visibleHeight>120
 return {height:visibleHeight,top:Math.max(0,offsetTop),keyboardOpen}
}

export function installMobileViewport(win=window,doc=document){
 const style=doc.documentElement?.style
 if(!style)return ()=>{}
 let frame=null,baseline=win.innerHeight||0
 const update=()=>{
  frame=null
  const viewport=win.visualViewport
  const active=doc.activeElement
  const editing=Boolean(active?.matches?.('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),[contenteditable=true]'))
  if(!editing)baseline=win.innerHeight||baseline
  const metrics=mobileViewportMetrics({height:viewport?.height||win.innerHeight,offsetTop:viewport?.offsetTop,scale:viewport?.scale,layoutHeight:win.innerHeight,baselineHeight:baseline,editing})
  style.setProperty('--val-viewport-height',`${metrics.height}px`)
  style.setProperty('--val-viewport-top',`${metrics.top}px`)
  doc.body.classList.toggle('val-mobile-keyboard-open',metrics.keyboardOpen&&win.innerWidth<=820)
 }
 const schedule=()=>{if(frame===null)frame=win.requestAnimationFrame(update)}
 const rotate=()=>{baseline=win.innerHeight||0;schedule()}
 const events=[[win,'resize',schedule],[win,'orientationchange',rotate],[doc,'focusin',schedule],[doc,'focusout',schedule],[win.visualViewport,'resize',schedule],[win.visualViewport,'scroll',schedule]]
 for(const [target,event,callback] of events)target?.addEventListener(event,callback)
 update()
 return ()=>{
  for(const [target,event,callback] of events)target?.removeEventListener(event,callback)
  if(frame!==null)win.cancelAnimationFrame(frame)
  style.removeProperty('--val-viewport-height');style.removeProperty('--val-viewport-top')
  doc.body.classList.remove('val-mobile-keyboard-open')
 }
}

const locks=new WeakMap()
export function resetMobilePageScroll(doc=document){
 const lock=locks.get(doc)
 if(!lock)return
 lock.x=0;lock.y=0
 doc.body.style.top='0px';doc.body.style.left='0px'
}
export function lockMobilePage(win=window,doc=document){
 if(!doc.body?.style)return ()=>{}
 const media=win.matchMedia('(max-width: 820px)')
 let release=null
 const acquire=()=>{
  let lock=locks.get(doc)
  if(!lock){
   const body=doc.body,keys=['position','top','left','width','overflow']
   lock={count:0,x:win.scrollX||0,y:win.scrollY||0,previous:Object.fromEntries(keys.map(key=>[key,body.style[key]]))}
   locks.set(doc,lock)
   Object.assign(body.style,{position:'fixed',top:`-${lock.y}px`,left:`-${lock.x}px`,width:'100%',overflow:'hidden'})
   body.classList.add('val-mobile-overlay-open')
  }
  lock.count++
  return ()=>{
   if(--lock.count)return
   Object.assign(doc.body.style,lock.previous)
   doc.body.classList.remove('val-mobile-overlay-open')
   locks.delete(doc)
   win.scrollTo({top:lock.y,left:lock.x,behavior:'instant'})
  }
 }
 const sync=()=>{if(media.matches&&!release)release=acquire();else if(!media.matches&&release){release();release=null}}
 media.addEventListener?.('change',sync);sync()
 return ()=>{media.removeEventListener?.('change',sync);release?.()}
}
