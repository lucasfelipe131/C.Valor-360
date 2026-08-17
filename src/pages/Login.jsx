import React,{useState} from 'react'
import {ArrowRight,BrainCircuit,CheckCircle2,LockKeyhole,Sparkles,Sprout,Target} from 'lucide-react'
import Logo from '../components/Logo'

export default function Login({onLogin,notice=''}){
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const submit=async event=>{
  event.preventDefault();setLoading(true);setError('')
  try{await onLogin({email,password})}catch(exception){setError(exception.message||'Não foi possível entrar.')}finally{setLoading(false)}
 }
 return <main className="login-shell val-login-shell">
  <section className="login-story">
   <Logo/>
   <div className="login-signal-map" aria-hidden="true">
    <span className="signal-ring signal-ring-one"/>
    <span className="signal-ring signal-ring-two"/>
    <span className="signal-line signal-line-one"/>
    <span className="signal-line signal-line-two"/>
    <span className="signal-node signal-node-field"><Sprout/></span>
    <span className="signal-node signal-node-ai"><BrainCircuit/></span>
    <span className="signal-node signal-node-result"><Target/></span>
    <div className="signal-core"><Logo compact/><b>VAL</b><small>CONTEXTO CONECTADO</small></div>
   </div>
   <div className="login-copy">
    <span className="login-kicker"><Sparkles/> INTELIGÊNCIA COMERCIAL E AGRONÔMICA</span>
    <h1>O contexto certo muda a conversa.<br/><em>A decisão certa muda o resultado.</em></h1>
    <p>A VAL conecta relacionamento, histórico, campo e potencial para orientar a próxima melhor ação de cada consultor.</p>
   </div>
   <div className="login-benefits"><span><Sprout/>Contexto do campo</span><span><BrainCircuit/>Inteligência aplicada</span><span><Target/>Ação com propósito</span></div>
   <small className="login-version">VAL • Inteligência que gera valor</small>
  </section>
  <section className="login-access">
   <form className="login-card" onSubmit={submit}>
    <div className="login-icon"><LockKeyhole/></div>
    <span className="eyebrow">ACESSO SEGURO</span>
    <h2>Entre na VAL</h2>
    <p>Acesse sua carteira, suas prioridades e a inteligência consultiva da operação.</p>
    <label>E-mail<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required/></label>
    <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label>
    {notice&&!error&&<div className="form-error" role="status">{notice}</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    <button className="login-submit" type="submit" disabled={loading}>{loading?'Verificando acesso…':'Acessar a VAL'} <ArrowRight size={18}/></button>
    <div className="demo-note"><CheckCircle2 size={17}/><span>Sua credencial é validada no servidor e nunca enviada à OpenAI.</span></div>
   </form>
  </section>
 </main>
}
