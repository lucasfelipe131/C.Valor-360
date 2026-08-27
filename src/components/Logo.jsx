import React,{useId} from 'react'

const variants=new Set(['full','compact','icon-only','monochrome'])
const surfaces=new Set(['auto','light','dark'])

export default function Logo({
 compact=false,
 variant,
 surface='auto',
 className='',
 decorative=false,
 label='VAL — inteligência que gera valor'
}){
 const uid=useId().replace(/:/g,'')
 const resolvedVariant=compact?'icon-only':variants.has(variant)?variant:'compact'
 const resolvedSurface=surfaces.has(surface)?surface:'auto'
 const iconOnly=resolvedVariant==='icon-only'
 const signalId=`val-signal-${uid}`
 const blueFoldId=`val-blue-fold-${uid}`
 const greenId=`val-green-${uid}`
 const leafId=`val-leaf-${uid}`
 const classes=[
  'brand','val-brand','val-final-brand',
  `is-${resolvedVariant}`,
  `is-surface-${resolvedSurface}`,
  compact?'compact':'',
  className
 ].filter(Boolean).join(' ')
 const accessibility=decorative?{role:'presentation','aria-label':undefined,'aria-hidden':true}:label==='VAL — inteligência que gera valor'?{}:{'aria-label':label}

 return <div className={classes} data-logo-variant={resolvedVariant} data-logo-surface={resolvedSurface} role="img" aria-label="VAL — inteligência que gera valor" {...accessibility}>
  <span className="brand-mark" aria-hidden="true">
   <svg viewBox="0 0 64 64" fill="none" focusable="false">
    <defs>
     <linearGradient id={signalId} x1="10" y1="7" x2="36" y2="53" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-blue-start)"/>
      <stop offset=".48" stopColor="var(--val-logo-blue-mid)"/>
      <stop offset="1" stopColor="var(--val-logo-blue-end)"/>
     </linearGradient>
     <linearGradient id={blueFoldId} x1="11" y1="8" x2="29" y2="39" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-fold-start)"/>
      <stop offset="1" stopColor="var(--val-logo-fold-end)"/>
     </linearGradient>
     <linearGradient id={greenId} x1="32" y1="55" x2="56" y2="24" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-green-end)"/>
      <stop offset=".54" stopColor="var(--val-logo-green-mid)"/>
      <stop offset="1" stopColor="var(--val-logo-green-start)"/>
     </linearGradient>
     <linearGradient id={leafId} x1="41" y1="29" x2="58" y2="6" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-leaf-end)"/>
      <stop offset=".55" stopColor="var(--val-logo-leaf-mid)"/>
      <stop offset="1" stopColor="var(--val-logo-leaf-start)"/>
     </linearGradient>
    </defs>
    <path d="M12.5 10.1c2.6-2.1 6.5-1.6 8.4 1.2l21.2 31.6-8.6 13.6L9.4 18.7c-1.8-2.8-1.2-6.4 1.4-8.4l1.7-.2Z" fill={`url(#${signalId})`}/>
    <path className="val-logo-fold" d="M12.5 10.1c2.6-2.1 6.5-1.6 8.4 1.2l4 6-8.9 14.1-6.6-12.7c-1.8-2.8-1.2-6.4 1.4-8.4l1.7-.2Z" fill={`url(#${blueFoldId})`} fillOpacity=".62"/>
    <path d="M33.5 56.5 49.8 29c1.8-3 5.7-4 8.8-2.3 3.1 1.8 4.1 5.8 2.1 8.8L42.4 59.1c-2.3 3.3-7.3 3.1-8.9-.4v-2.2Z" fill={`url(#${greenId})`}/>
    <path d="M40.8 28.8C41.8 17.4 48.5 8.9 58.2 6.2c.5 10.7-4.6 19.9-15.8 23.4-.9.3-1.7-.1-1.6-.8Z" fill={`url(#${leafId})`}/>
    <path className="val-logo-detail" d="M42.7 27.4c4.3-6.8 8.7-12.1 13.4-16.7" stroke="var(--val-logo-highlight)" strokeOpacity=".46" strokeWidth="1.15" strokeLinecap="round"/>
    <path className="val-logo-detail" d="M16.4 12.6 34.2 49.1" stroke="var(--val-logo-highlight)" strokeOpacity=".2" strokeWidth="1.2" strokeLinecap="round"/>
    <path className="val-logo-detail" d="M35.8 53.4 51.7 28.3" stroke="var(--val-logo-highlight)" strokeOpacity=".17" strokeWidth="1.1" strokeLinecap="round"/>
    <circle cx="31.4" cy="45.2" className="val-logo-detail" r="1.1" fill="var(--val-logo-highlight)" fillOpacity=".72"/>
   </svg>
  </span>
  {!iconOnly&&<span className="brand-word" aria-hidden="true">
   <svg className="val-wordmark" viewBox="0 0 220 72" fill="none" focusable="false">
    <path d="M4 8h20.5l26 43.5c2.2 3.7 4.8 3.7 7 0L83.5 8H104L66 68H41.8L4 8Z" fill="var(--val-logo-word)"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M89 68 125.5 8h18L180 68h-21l-24.5-40.5L110 68H89Zm33.8-10h23.4l-11.7-19.3L122.8 58Z" fill="var(--val-logo-word)"/>
    <path d="m134.5 48.8 11.6 19.2h-23.2l11.6-19.2Z" fill="var(--val-logo-accent)"/>
    <path d="M181 8h20v40c0 3.5 1.8 5 6.2 5H219v15h-21.8C186.4 68 181 62.3 181 50V8Z" fill="var(--val-logo-word)"/>
   </svg>
   {resolvedVariant==='full'&&<small className="val-brand-signature">INTELIGÊNCIA QUE GERA VALOR</small>}
  </span>}
 </div>
}
