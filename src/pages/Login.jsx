import React,{useState} from 'react'
import {ArrowRight,BarChart3,BrainCircuit,CheckCircle2,LockKeyhole,Users} from 'lucide-react'
import Logo from '../components/Logo'

export default function Login({onLogin,notice=''}){
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const submit=async e=>{e.preventDefault();setLoading(true);setError('');try{await onLogin({email,password})}catch(exception){setError(exception.message||'Não foi possível entrar.')}finally{setLoading(false)}}
 return <main className="login-shell">
  <section className="login-story">
   <Logo/>
   <div className="login-copy"><span className="login-kicker">INTELIGÊNCIA COMERCIAL PARA O AGRO</span><h1>Conhecer o cliente é o começo.<br/><em>Gerar valor é o objetivo.</em></h1><p>O VALOR 360 transforma perfil, relacionamento e contexto produtivo em uma próxima ação clara para cada visita.</p></div>
   <div className="login-benefits"><span><Users/>Cliente 360</span><span><BrainCircuit/>Recomendações da VAL</span><span><BarChart3/>Gestão por valor</span></div>
   <small className="login-version">Piloto São Luiz Gonzaga • Versão 0.4</small>
  </section>
  <section className="login-access">
   <form className="login-card" onSubmit={submit}>
    <div className="login-icon"><LockKeyhole/></div><span className="eyebrow">ACESSO AO PILOTO</span><h2>Bem-vindo ao VALOR 360</h2><p>Entre para visualizar sua carteira e as prioridades do dia.</p>
    <label>E-mail<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    {notice&&!error&&<div className="form-error" role="status">{notice}</div>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    <button className="login-submit" type="submit" disabled={loading}>{loading?'Verificando...':'Entrar no VALOR 360'} <ArrowRight size={18}/></button>
    <div className="demo-note"><CheckCircle2 size={17}/><span>A credencial é validada no servidor e nunca enviada à OpenAI.</span></div>
   </form>
  </section>
 </main>
}
