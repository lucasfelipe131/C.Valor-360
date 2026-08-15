import React from 'react'
import {
 ArrowRight,
 BarChart3,
 BrainCircuit,
 CheckCircle2,
 ChevronLeft,
 Clock3,
 DatabaseZap,
 FileBarChart,
 Route,
 ShieldCheck,
 Sprout,
 Target
} from 'lucide-react'
import ValPanel from './ValPanel'

const environments=[
 {
  id:'insumos',
  eyebrow:'RELACIONAMENTO & INSUMOS',
  title:'VAL Insumos',
  description:'A inteligência comercial que cruza Cliente 360, histórico, oportunidades e contexto técnico para preparar visitas e negociações de valor.',
  status:'Disponível agora',
  action:'Entrar na VAL Insumos',
  icon:Sprout,
  features:['Venda consultiva','SPIN, OPC e EPA','Próxima melhor ação']
 },
 {
  id:'graos',
  eyebrow:'ORIGINAÇÃO & OPERAÇÕES',
  title:'VAL Grãos',
  description:'Um ambiente separado para evoluir a inteligência de compra, originação, contratos, posição e entrega de grãos.',
  status:'Estrutura preparada',
  action:'Conhecer a VAL Grãos',
  icon:BarChart3,
  features:['Originação','Oportunidades de compra','Operações de grãos']
 }
]

const grainModules=[
 {icon:Target,title:'Originação',description:'Mapa de produtores, intenção de venda, volume potencial e melhor próxima abordagem.'},
 {icon:BarChart3,title:'Oportunidades de compra',description:'Sinais comerciais, janelas de decisão e prioridades de compra organizadas por produtor.'},
 {icon:FileBarChart,title:'Contratos e posição',description:'Espaço reservado para modalidades, volumes, fixações, saldos e compromissos.'},
 {icon:Route,title:'Entregas e execução',description:'Acompanhamento futuro de programação, entrega, pendências e próximos movimentos.'}
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
    <div><small>ARQUITETURA POR DOMÍNIO</small><b>Um produtor. Duas jornadas comerciais.</b><p>O Cliente 360 poderá alimentar as duas leituras, enquanto oportunidades e operações permanecem separadas.</p></div>
   </div>
  </header>

  <div className="val-environment-grid" aria-label="Escolha um ambiente da VAL">
   {environments.map(({id,eyebrow,title,description,status,action,icon:Icon,features})=><button type="button" key={id} className={`val-environment-card is-${id}`} onClick={()=>onModeChange(id)} aria-describedby={`val-environment-description-${id}`}>
    <span className="val-environment-card-top"><span className="val-environment-icon"><Icon/></span><em className={`val-environment-status is-${id}`}>{id==='insumos'?<CheckCircle2/>:<Clock3/>}{status}</em></span>
    <span className="val-environment-card-copy"><small>{eyebrow}</small><b>{title}</b><span id={`val-environment-description-${id}`}>{description}</span></span>
    <span className="val-environment-features">{features.map(feature=><span key={feature}><i/>{feature}</span>)}</span>
    <span className="val-environment-action">{action}<ArrowRight/></span>
   </button>)}
  </div>

  <p className="val-environment-note"><DatabaseZap/>A seleção não altera nem duplica a carteira. Ela apenas define o ambiente de trabalho da VAL.</p>
 </section>
}

function ValGrainsFoundation({onModeChange}){
 return <section className="val-grains-view page-stack" aria-labelledby="val-grains-title">
  <EnvironmentSwitcher mode="graos" onModeChange={onModeChange}/>

  <header className="val-grains-hero">
   <div className="val-grains-copy">
    <span className="val-grains-kicker"><BarChart3/>VAL GRÃOS • AMBIENTE PREPARADO</span>
    <h2 id="val-grains-title">Inteligência para originar, comprar e operar grãos.</h2>
    <p>A VAL Grãos já ocupa um espaço próprio dentro do VALOR 360. Nesta etapa, a estrutura está pronta para crescer sem misturar a operação de grãos com a jornada comercial de insumos.</p>
    <div className="val-grains-actions">
     <button type="button" className="val-grains-primary" onClick={()=>onModeChange('insumos')}><Sprout/>Usar VAL Insumos agora</button>
     <button type="button" className="val-grains-secondary" onClick={()=>onModeChange(null)}>Voltar à escolha<ChevronLeft/></button>
    </div>
   </div>
   <aside className="val-grains-foundation-status">
    <span><CheckCircle2/></span>
    <div><small>ESTADO ATUAL</small><b>Fundação do ambiente ativa</b><p>Seleção, identidade e separação de domínio prontas. O painel operacional entra na próxima evolução.</p></div>
   </aside>
  </header>

  <section className="val-grains-roadmap" aria-labelledby="val-grains-roadmap-title">
   <header><div><span className="eyebrow">PAINEL FUTURO</span><h3 id="val-grains-roadmap-title">O espaço das operações já está definido</h3><p>Cada módulo será ativado somente quando houver fonte real, regra de negócio e governança para os dados.</p></div><em>Sem dados fictícios</em></header>
   <div>{grainModules.map(({icon:Icon,title,description},index)=><article key={title}><span><Icon/></span><small>{String(index+1).padStart(2,'0')} • PLANEJADO</small><h4>{title}</h4><p>{description}</p></article>)}</div>
  </section>

  <section className="val-grains-guardrails" aria-label="Princípios da VAL Grãos">
   <article><BrainCircuit/><div><small>CONTEXTO COMPARTILHADO</small><b>Mesmo produtor, nova leitura</b><p>O perfil relacional poderá apoiar a conversa de grãos sem duplicar o Cliente 360.</p></div></article>
   <article><DatabaseZap/><div><small>DADOS SEPARADOS</small><b>Operações não se confundem com insumos</b><p>Contratos, volumes, entregas e posições terão domínio e regras próprios.</p></div></article>
   <article><ShieldCheck/><div><small>CONFIANÇA PRIMEIRO</small><b>Nenhum número inventado</b><p>Cotação, saldo e posição só aparecerão após integração com uma fonte verificável.</p></div></article>
  </section>
 </section>
}

export default function ValWorkspace({mode,onModeChange,clients,selectedClient,onSelect}){
 if(mode==='insumos')return <div className="val-environment-active is-insumos"><EnvironmentSwitcher mode="insumos" onModeChange={onModeChange}/><ValPanel clients={clients} selectedClient={selectedClient} onSelect={onSelect}/></div>
 if(mode==='graos')return <ValGrainsFoundation onModeChange={onModeChange}/>
 return <ValEnvironmentSelector onModeChange={onModeChange}/>
}
