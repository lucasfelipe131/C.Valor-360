import React from 'react'
export default function SimplePage({title,subtitle,children}){return <div className="page-stack"><section className="module-hero"><div><span className="eyebrow">VALOR 360</span><h2>{title}</h2><p>{subtitle}</p></div></section>{children||<article className="panel empty-state">Módulo estruturado para a próxima sprint.</article>}</div>}
