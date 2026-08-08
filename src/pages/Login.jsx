import React,{useState} from 'react'
import {ArrowRight,BarChart3,BrainCircuit,CheckCircle2,LockKeyhole,Users} from 'lucide-react'
import Logo from '../components/Logo'

export default function Login({onLogin}){
 const [email,setEmail]=useState('lucas.felipe@cvale.com.br')
 const [password,setPassword]=useState('valor360')
 const submit=e=>{e.preventDefault();onLogin()}
 return <main className="login-shell">
  <section className="login-story">
   <Logo/>
   <div className="login-copy"><span className="login-kicker">INTELIGÊNCIA COMERCIAL PARA O AGRO</span><h1>Conhecer o cliente é o começo.<br/><em>Gerar valor é o objetivo.</em></h1><p>O VALOR 360 transforma perfil, relacionamento e contexto produtivo em uma próxima ação clara para cada visita.</p></div>
   <div className="login-benefits"><span><Users/>Cliente 360</span><span><BrainCircuit/>Recomendações da VAL</span><span><BarChart3/>Gestão por valor</span></div>
   <small className="login-version">Piloto São Luiz Gonzaga • Versão 0.3</small>
  </section>
  <section className="login-access">
   <form className="login-card" onSubmit={submit}>
    <div className="login-icon"><LockKeyhole/></div><span className="eyebrow">ACESSO AO PILOTO</span><h2>Bem-vindo, Lucas!</h2><p>Entre para visualizar sua carteira e as prioridades do dia.</p>
    <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    <button className="login-submit" type="submit">Entrar no VALOR 360 <ArrowRight size={18}/></button>
    <div className="demo-note"><CheckCircle2 size={17}/><span>Ambiente demonstrativo — os dados inseridos ficam somente neste dispositivo.</span></div>
   </form>
  </section>
 </main>
}
