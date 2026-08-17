import React,{useState} from 'react'
import {
 ArrowRight,BarChart3,BrainCircuit,CheckCircle2,ChevronRight,ClipboardList,
 DatabaseZap,Leaf,LockKeyhole,Map,MessageSquareText,ShieldCheck,Sparkles,
 Sprout,Target,Users,Wheat
} from 'lucide-react'
import Logo from '../components/Logo'

const solutions=[
 {
  eyebrow:'INTELIGÊNCIA COMERCIAL',
  title:'VAL Comercial',
  description:'Prioriza contas, prepara visitas e conduz a conversa da descoberta ao próximo compromisso verificável.',
  icon:Target,
  action:'Decisão e conversão'
 },
 {
  eyebrow:'NÚCLEO TÉCNICO',
  title:'Inteligência Agronômica',
  description:'Reúne análises, mapas, diagnósticos, cálculos e registros técnicos no mesmo ambiente da carteira.',
  icon:Sprout,
  action:'Campo e recomendação'
 },
 {
  eyebrow:'RELACIONAMENTO',
  title:'Produtor 360',
  description:'Organiza perfil, histórico, preferências, potencial em aberto e evidências que mudam a próxima conversa.',
  icon:Users,
  action:'Contexto que permanece'
 },
 {
  eyebrow:'ORIGINAÇÃO',
  title:'VAL Grãos',
  description:'Conecta intenção de negociação, momento do produtor e referências rastreáveis para orientar operações de grãos.',
  icon:Wheat,
  action:'Oportunidade e mercado'
 }
]

const journey=[
 {step:'01',title:'Antes da visita',text:'A VAL cruza carteira, histórico, campo, potencial e sinais recentes para mostrar onde agir.',icon:DatabaseZap},
 {step:'02',title:'Durante a conversa',text:'Perguntas, hipóteses e argumentos são organizados sem transformar suposição em fato.',icon:MessageSquareText},
 {step:'03',title:'Depois da decisão',text:'Compromissos, próximos passos e aprendizados voltam para a memória protegida da operação.',icon:ClipboardList}
]

const useCases=[
 {title:'Sair da zona de preço',text:'Compare agir, esperar e manter com base em risco, valor e forma de comprovação.',icon:BarChart3},
 {title:'Chegar preparado ao campo',text:'Abra a conta sabendo o que mudou, o que falta confirmar e qual pergunta vale fazer.',icon:Map},
 {title:'Transformar dado em ação',text:'Indicadores deixam de ser apenas cadastro e passam a orientar prioridade e execução.',icon:BrainCircuit}
]

export default function Login({onLogin,notice=''}){
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const submit=async event=>{
  event.preventDefault();setLoading(true);setError('')
  try{await onLogin({email,password})}catch(exception){setError(exception.message||'Não foi possível entrar.')}finally{setLoading(false)}
 }

 return <main className="val-presentation">
  <header className="val-public-nav">
   <a className="val-public-brand" href="#inicio" aria-label="VAL — início"><Logo/></a>
   <nav aria-label="Apresentação da VAL">
    <a href="#solucoes">Soluções</a>
    <a href="#como-funciona">Como funciona</a>
    <a href="#aplicacoes">Aplicações</a>
   </nav>
   <a className="val-public-access" href="#acesso">Entrar na VAL <ArrowRight/></a>
  </header>

  <section className="val-public-hero" id="inicio">
   <div className="val-public-hero-copy">
    <span className="val-public-kicker"><Sparkles/> INTELIGÊNCIA NATIVA DO AGRO</span>
    <h1>Contexto para decidir.<br/><em>Inteligência para gerar valor.</em></h1>
    <p>A VAL reúne relacionamento, negócios, campo e evidências para orientar a próxima melhor ação — antes, durante e depois de cada conversa.</p>
    <div className="val-public-hero-actions">
     <a className="is-primary" href="#acesso">Acessar minha operação <ArrowRight/></a>
     <a href="#solucoes">Explorar o ecossistema <ChevronRight/></a>
    </div>
    <div className="val-public-principles" aria-label="Princípios da VAL">
     <span><CheckCircle2/>Dados reais primeiro</span>
     <span><ShieldCheck/>Decisão humana preservada</span>
     <span><Leaf/>Comercial e agronomia conectados</span>
    </div>
   </div>

   <div className="val-public-stage" aria-label="Visão resumida do funcionamento da VAL">
    <div className="val-stage-glow" aria-hidden="true"/>
    <article className="val-stage-card val-stage-main">
     <header><span><BrainCircuit/></span><div><small>VAL NEXO</small><b>Centro de decisão</b></div><em>ATIVO</em></header>
     <div className="val-stage-focus">
      <small>PRÓXIMA MELHOR AÇÃO</small>
      <h2>Priorize a conversa que pode mudar o resultado.</h2>
      <p>Contexto comercial, técnico e relacional lido em conjunto.</p>
     </div>
     <div className="val-stage-signals">
      <span><DatabaseZap/><small>EVIDÊNCIAS</small><b>Fontes cruzadas</b></span>
      <span><Target/><small>DECISÃO</small><b>Próximo avanço</b></span>
      <span><ShieldCheck/><small>GOVERNANÇA</small><b>Limites visíveis</b></span>
     </div>
    </article>
    <article className="val-stage-card val-stage-field"><Sprout/><span><small>CAMPO</small><b>Inteligência agronômica integrada</b></span></article>
    <article className="val-stage-card val-stage-relationship"><Users/><span><small>CARTEIRA</small><b>Memória por produtor</b></span></article>
   </div>
  </section>

  <section className="val-public-band" aria-label="Domínios conectados pela VAL">
   <p>Um único ecossistema para decisões que normalmente ficam separadas.</p>
   <div><span>Relacionamento</span><i/><span>Comercial</span><i/><span>Agronomia</span><i/><span>Grãos</span><i/><span>Governança</span></div>
  </section>

  <section className="val-public-section val-solutions" id="solucoes">
   <header className="val-public-section-head">
    <span>ECOSSISTEMA VAL</span>
    <h2>Uma inteligência. Diferentes decisões do negócio.</h2>
    <p>Cada ambiente preserva seu contexto, mas todos trabalham sobre a mesma carteira protegida e rastreável.</p>
   </header>
   <div className="val-solution-grid">
    {solutions.map(({eyebrow,title,description,icon:Icon,action},index)=><article className={`val-solution-card is-${index+1}`} key={title}>
     <div className="val-solution-icon"><Icon/></div>
     <small>{eyebrow}</small>
     <h3>{title}</h3>
     <p>{description}</p>
     <span>{action}<ArrowRight/></span>
    </article>)}
   </div>
  </section>

  <section className="val-public-section val-journey" id="como-funciona">
   <div className="val-journey-intro">
    <span>MÉTODO EM MOVIMENTO</span>
    <h2>A VAL acompanha a decisão inteira, não apenas a resposta.</h2>
    <p>O sistema organiza o trabalho ao redor do que precisa ser confirmado, conduzido e registrado.</p>
   </div>
   <div className="val-journey-list">
    {journey.map(({step,title,text,icon:Icon})=><article key={step}>
     <div><b>{step}</b><span><Icon/></span></div>
     <h3>{title}</h3>
     <p>{text}</p>
    </article>)}
   </div>
  </section>

  <section className="val-public-section val-use-cases" id="aplicacoes">
   <header className="val-public-section-head is-light">
    <span>NA PRÁTICA</span>
    <h2>O que muda quando o contexto trabalha a favor do consultor.</h2>
   </header>
   <div className="val-use-case-grid">
    {useCases.map(({title,text,icon:Icon})=><article key={title}><span><Icon/></span><h3>{title}</h3><p>{text}</p></article>)}
   </div>
   <div className="val-public-quote">
    <Sparkles/>
    <blockquote>“Não comece falando de produto. Descubra qual decisão está em risco e qual evidência pode fazer a conversa avançar.”</blockquote>
    <span>Princípio operacional da VAL</span>
   </div>
  </section>

  <section className="val-public-access-section" id="acesso">
   <div className="val-access-copy">
    <span>AMBIENTE PROTEGIDO</span>
    <h2>Sua operação começa aqui.</h2>
    <p>Acesse carteira, prioridades, inteligência consultiva e núcleo agronômico com a mesma identidade.</p>
    <ul>
     <li><CheckCircle2/>Sessão e carteira isoladas por login</li>
     <li><CheckCircle2/>Credenciais validadas somente no servidor</li>
     <li><CheckCircle2/>Evidências e premissas visíveis nas recomendações</li>
    </ul>
   </div>
   <form className="login-card val-public-login-card" onSubmit={submit}>
    <div className="login-icon"><LockKeyhole/></div>
    <span className="eyebrow">ACESSO SEGURO</span>
    <h2>Entre na VAL</h2>
    <p>Continue de onde sua equipe parou.</p>
    <label>E-mail<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required/></label>
    <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>
    {notice&&!error&&<div className="form-error" role="status">{notice}</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    <button className="login-submit" type="submit" disabled={loading}>{loading?'Verificando acesso…':'Acessar a VAL'} <ArrowRight size={18}/></button>
    <div className="demo-note"><ShieldCheck size={17}/><span>Sua senha nunca é enviada à OpenAI.</span></div>
   </form>
  </section>

  <footer className="val-public-footer"><Logo/><p>Inteligência comercial e agronômica aplicada ao negócio.</p><span>VAL • Inteligência que gera valor</span></footer>
 </main>
}
