import React from 'react'
import {
 ArrowRight,
 BarChart3,
 BrainCircuit,
 CheckCircle2,
 ChevronLeft,
 DatabaseZap,
 ShieldCheck,
 Sprout,
} from 'lucide-react'
import ValDecisionWorkspace from './ValDecisionWorkspace'
import SogWorkspace from './SogWorkspace'

const environments=[
 {
  id:'insumos',
  eyebrow:'DECISÃO COMERCIAL & INSUMOS',
  title:'VAL Insumos',
  description:'Um centro de decisão que cruza contexto, qualidade dos dados, score, evidências e próxima ação para transformar oportunidade em compromisso comercial.',
  status:'Conversion Core ativo',
  action:'Abrir Centro de Decisão',
  icon:Sprout,
  features:['Score explicável','Próxima melhor ação','IA sem respostas genéricas']
 },
 {
  id:'graos',
  eyebrow:'ORIGINAÇÃO & OPERAÇÕES',
  title:'VAL Grãos',
  description:'A SOG conecta produtores, intenções de negociação e mercado verificável para priorizar originação e conduzir negócios de grãos.',
  status:'SOG operacional',
  action:'Abrir VAL Grãos',
  icon:BarChart3,
  features:['Intenções reais','Mercado com fonte','Direção comercial']
 }
]

function EnvironmentSwitcher({mode,onModeChange}){
 return <nav className="val-environment-switcher" aria-label="Trocar ambiente da VAL">
  <button type="button" className="val-environment-back" onClick={()=>onModeChange(null)}><ChevronLeft/>Ambientes</button>
  <div role="tablist" aria-label="Ambiente ativo">
   <button type="button" role="tab" aria-selected={mode==='insumos'} className={mode==='insumos'?'is-active':''} onClick={()=>onModeChange('insumos')}><Sprout/>Insumos</button>
   <button type="button" role="tab" aria-selected={mode==='graos'} className={mode==='graos'?'is-active':''} onClick={()=>onModeChange('graos')}><BarChart3/>Grãos</button>
  </div>
 </nav>
}

function ValEnvironmentSelector({onModeChange}){
 return <section className="val-environment-selector page-stack" aria-labelledby="val-environment-title">
  <header className="val-environment-hero">
   <div className="val-environment-copy">
    <span className="val-environment-kicker"><BrainCircuit/>VAL • VALUE AGRICULTURE INTELLIGENCE</span>
    <h2 id="val-environment-title">Qual decisão você quer conduzir?</h2>
    <p>A mesma inteligência, organizada em dois ambientes de negócio. Escolha o contexto antes de começar para que dados, linguagem e próximos passos não se misturem.</p>
   </div>
   <div className="val-environment-principle">
    <ShieldCheck/>
    <div><small>DADOS E REGRAS PRIMEIRO</small><b>A IA explica. O núcleo decide. O consultor conduz.</b><p>Prioridade, score, evidências e próxima ação são calculados antes da camada de linguagem.</p></div>
   </div>
  </header>

  <div className="val-environment-grid" aria-label="Escolha um ambiente da VAL">
   {environments.map(({id,eyebrow,title,description,status,action,icon:Icon,features})=><button type="button" key={id} className={`val-environment-card is-${id}`} onClick={()=>onModeChange(id)} aria-describedby={`val-environment-description-${id}`}>
    <span className="val-environment-card-top"><span className="val-environment-icon"><Icon/></span><em className={`val-environment-status is-${id}`}><CheckCircle2/>{status}</em></span>
    <span className="val-environment-card-copy"><small>{eyebrow}</small><b>{title}</b><span id={`val-environment-description-${id}`}>{description}</span></span>
    <span className="val-environment-features">{features.map(feature=><span key={feature}><i/>{feature}</span>)}</span>
    <span className="val-environment-action">{action}<ArrowRight/></span>
   </button>)}
  </div>

  <p className="val-environment-note"><DatabaseZap/>A seleção não altera nem duplica a carteira. Ela apenas define o ambiente de trabalho da VAL.</p>
 </section>
}

export default function ValWorkspace({mode,onModeChange,clients,selectedClient,onSelect,onPrepareVisit}){
 if(mode==='insumos')return <div className="val-environment-active is-insumos"><EnvironmentSwitcher mode="insumos" onModeChange={onModeChange}/><ValDecisionWorkspace clients={clients} selectedClient={selectedClient} onSelect={onSelect} onPrepareVisit={onPrepareVisit}/></div>
 if(mode==='graos')return <div className="val-environment-active is-graos"><EnvironmentSwitcher mode="graos" onModeChange={onModeChange}/><SogWorkspace clients={clients} onSelect={onSelect}/></div>
 return <ValEnvironmentSelector onModeChange={onModeChange}/>
}
