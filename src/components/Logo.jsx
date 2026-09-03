import React,{useId} from 'react'

// Marca oficial da VAL: o V em marfim/floresta e a folha em verde-oliva.
// A geometria abaixo é o ativo aprovado. Não reinterpretar, não substituir.
// As variantes (full, compact, icon-only, monochrome) derivam deste mesmo desenho;
// a superfície controla apenas o contraste, nunca a forma.

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
 const stemId=`val-stem-${uid}`
 const leafId=`val-leaf-${uid}`
 const leafShadeId=`val-leaf-shade-${uid}`
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
     <linearGradient id={stemId} x1="6" y1="4" x2="30" y2="60" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-stem-top)"/>
      <stop offset="1" stopColor="var(--val-logo-stem-bottom)"/>
     </linearGradient>
     <linearGradient id={leafId} x1="52" y1="4" x2="32" y2="59" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-leaf-top)"/>
      <stop offset=".52" stopColor="var(--val-logo-leaf-mid)"/>
      <stop offset="1" stopColor="var(--val-logo-leaf-deep)"/>
     </linearGradient>
     <linearGradient id={leafShadeId} x1="56" y1="10" x2="36" y2="56" gradientUnits="userSpaceOnUse">
      <stop stopColor="var(--val-logo-leaf-shade-top)"/>
      <stop offset="1" stopColor="var(--val-logo-leaf-shade-bottom)"/>
     </linearGradient>
    </defs>
    {/* Braço esquerdo do V */}
    <path d="M3.6 5.2H17.8L33.4 53.6L30.2 61.2Z" fill={`url(#${stemId})`}/>
    {/* Folha — braço direito do V */}
    <path d="M30.6 61C32.8 45.6 39.4 24.4 52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61Z" fill={`url(#${leafId})`}/>
    {/* Meia-folha em sombra: o dobramento que a marca oficial mostra */}
    <path className="val-logo-fold" d="M52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61C36.9 44.4 44.6 22.9 52.4 3Z" fill={`url(#${leafShadeId})`}/>
    {/* Nervura central */}
    <path className="val-logo-detail" d="M31.4 59.4C37.5 43.2 45 22.2 52.2 3.9" stroke="var(--val-logo-vein)" strokeOpacity=".5" strokeWidth="1.05" strokeLinecap="round"/>
   </svg>
  </span>
  {!iconOnly&&<span className="brand-word" aria-hidden="true">
   <svg className="val-wordmark" viewBox="0 0 220 72" fill="none" focusable="false">
    <path d="M2 8H12.5L29 50L45.5 8H56L33.5 64H24.5Z" fill="var(--val-logo-word)"/>
    <path d="M76 64L101.5 8H108.5L134 64H123.5L105 26L86.5 64Z" fill="var(--val-logo-word)"/>
    <path d="M88 48H122V57H88Z" fill="var(--val-logo-word)"/>
    <path d="M154 8H164.5V53.5H212V64H154Z" fill="var(--val-logo-word)"/>
   </svg>
   {resolvedVariant==='full'&&<small className="val-brand-signature">INTELIGÊNCIA QUE GERA VALOR</small>}
  </span>}
 </div>
}
