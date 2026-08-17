import React from 'react'
import {BadgeDollarSign,BriefcaseBusiness,Building2,CircleHelp,Compass,Database,Landmark,ShieldCheck,UsersRound,Wrench} from 'lucide-react'
import '../multi-decision-map.css'

const text=(value,fallback='Não confirmado')=>String(value??fallback).replace(/\s+/g,' ').trim()||fallback
const roleIcon={technical:Wrench,financial:Landmark,commercial:BriefcaseBusiness,operational:Building2,executive:UsersRound,other:Compass,unclassified:CircleHelp}
const roleLabel={technical:'Técnico',financial:'Financeiro',commercial:'Comercial',operational:'Operacional',executive:'Executivo',other:'Outro papel',unclassified:'Papel a confirmar'}

export default function MultiDecisionMapPanel({data}){
 if(!data)return null
 const actors=Array.isArray(data.actors)?data.actors:[]
 return <section className="decision-map-panel" aria-labelledby="decision-map-title">
  <header><div><span><UsersRound/>MAPA DE DECISORES</span><h4 id="decision-map-title">Quem precisa estar alinhado para a decisão avançar</h4><p>A VAL exibe somente pessoas e papéis registrados. Interesse, influência e postura de risco não são inferidos.</p></div><b className={data.strategic?'is-strategic':''}>{data.strategic?'Conta com decisão compartilhada':actors.length===1?'Um participante confirmado':'Mapa em formação'}</b></header>

  {actors.length===0?<div className="decision-map-empty"><CircleHelp/><div><b>Nenhum decisor estruturado</b><p>{text(data.emptyReason)}</p></div></div>:<div className="decision-actor-grid">{actors.map(actor=>{
   const Icon=roleIcon[actor.roleCategory]||CircleHelp
   return <article key={actor.id}>
    <div className="decision-actor-head"><span><Icon/></span><div><small>{roleLabel[actor.roleCategory]||'Papel registrado'}</small><h5>{text(actor.name,actor.role||'Participante')}</h5><p>{text(actor.role)}</p></div></div>
    <dl><div><dt>Critério ou perspectiva</dt><dd>{text(actor.perspective)}</dd></div><div><dt>Postura de risco</dt><dd>{text(actor.riskPosture)}</dd></div><div><dt>Influência registrada</dt><dd>{text(actor.influence)}</dd></div></dl>
    {actor.missing?.length>0&&<p className="decision-actor-gaps"><CircleHelp/>Falta confirmar: {actor.missing.join(', ')}</p>}
    <span className="decision-evidence"><Database/>{actor.evidenceIds.join(' • ')}</span>
   </article>
  })}</div>}

  <div className="decision-next-alignment"><BadgeDollarSign/><div><small>PRÓXIMO ALINHAMENTO</small><h5>{text(data.nextAlignment?.action)}</h5><blockquote>“{text(data.nextAlignment?.question)}”</blockquote><p>Comprovação esperada: {text(data.nextAlignment?.evidenceNeeded)}</p></div></div>

  <footer><ShieldCheck/><p>{text(data.guardrail)}</p></footer>
 </section>
}
