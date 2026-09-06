import React from 'react'

// Marca oficial da VAL — ATIVO ORIGINAL, não reprodução.
//
// A logo é raster: o V tem textura de pedra, a folha são duas lâminas
// sobrepostas e o wordmark tem contorno próprio. Qualquer redesenho em SVG é
// aproximação, e o briefing proíbe: "NÃO redesenhar, NÃO reinterpretar, NÃO
// aproximar por CSS, NÃO recriar com fonte semelhante. Usar o asset oficial."
//
// As peças em public/brand/*-official.png são recortes do arquivo entregue,
// gerados por scripts/extract-brand-asset.mjs. Para trocar a marca, troque o
// arquivo de origem e rode o script — não edite os recortes à mão.
//
// Na variante completa a assinatura vai ABAIXO do conjunto, como no ativo
// oficial e na referência — não espremida ao lado do wordmark, onde ficaria
// pequena demais para ser lida.

const SYMBOL='/brand/val-symbol-official.png'
const WORDMARK='/brand/val-wordmark-only-official.png'
const SIGNATURE='/brand/val-signature-official.png'

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
 const resolvedVariant=compact?'icon-only':variants.has(variant)?variant:'compact'
 const resolvedSurface=surfaces.has(surface)?surface:'auto'
 const iconOnly=resolvedVariant==='icon-only'
 const withSignature=resolvedVariant==='full'
 const classes=[
  'brand','val-brand','val-final-brand',
  `is-${resolvedVariant}`,
  `is-surface-${resolvedSurface}`,
  compact?'compact':'',
  className
 ].filter(Boolean).join(' ')
 const accessibility=decorative
  ?{role:'presentation','aria-label':undefined,'aria-hidden':true}
  :{role:'img','aria-label':label}

 return <div className={classes} data-logo-variant={resolvedVariant} data-logo-surface={resolvedSurface} {...accessibility}>
  <span className="brand-lockup">
   <span className="brand-mark">
    <img src={SYMBOL} alt="" aria-hidden="true" draggable="false"/>
   </span>
   {!iconOnly&&<span className="brand-word">
    <img src={WORDMARK} alt="" aria-hidden="true" draggable="false"/>
   </span>}
  </span>
  {withSignature&&<span className="brand-signature">
   <img src={SIGNATURE} alt="" aria-hidden="true" draggable="false"/>
  </span>}
 </div>
}
