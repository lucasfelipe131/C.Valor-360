import React,{useState} from 'react'
import clients from './data/clients.json'
import Sidebar from './components/Sidebar'
import MobileNav from './components/MobileNav'
import Topbar from './components/Topbar'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Client360 from './pages/Client360'
import Agro from './pages/Agro'
import Questionnaire from './pages/Questionnaire'
import ValPanel from './components/ValPanel'
import SimplePage from './pages/SimplePage'

const meta={
 dashboard:['Dashboard','Visão geral do seu desempenho'],
 clients:['Clientes','Conheça o produtor antes de oferecer uma solução'],
 client360:['Cliente 360','Perfil, relacionamento, contexto técnico e oportunidades'],
 visits:['Visitas','Planejamento, roteiro e próximos compromissos'],
 opportunities:['Oportunidades','Transforme necessidade em proposta de valor'],
 val:['Inteligência (VAL)','Value Agriculture Intelligence'],
 agro:['Inteligência Agronômica','Motor técnico integrado ao Manual do Agrônomo'],
 questionnaire:['Produtor 360','Perfil e preferências do produtor'],
 reports:['Relatórios','Indicadores, NPS, IRT e execução comercial'],
 settings:['Configurações','Usuários, unidades e parâmetros']
}
export default function App(){
 const [page,setPage]=useState('dashboard')
 const [selected,setSelected]=useState(null)
 const openClient=c=>{setSelected(c);setPage('client360')}
 const [title,subtitle]=meta[page]||['VALOR 360','']
 return <div className="app-shell">
  <Sidebar page={page} setPage={p=>{setPage(p); if(p!=='client360') setSelected(null)}}/>
  <main className="main">
   <Topbar title={title} subtitle={subtitle}/>
   <div className="content">
    {page==='dashboard'&&<Dashboard clients={clients} setPage={setPage} onClient={openClient}/>}
    {page==='clients'&&<Clients clients={clients} onClient={openClient}/>}
    {page==='client360'&&selected&&<Client360 client={selected} onBack={()=>setPage('clients')} setPage={setPage}/>}
    {page==='val'&&<ValPanel clients={clients} onSelect={openClient}/>}
    {page==='agro'&&<Agro/>}
    {page==='questionnaire'&&<Questionnaire/>}
    {page==='visits'&&<SimplePage title="Visitas" subtitle="Roteiro inteligente, preparação, registro e próximo compromisso."/>}
    {page==='opportunities'&&<SimplePage title="Oportunidades" subtitle="Pipeline de valor por cliente, cultura e solução."/>}
    {page==='reports'&&<SimplePage title="Relatórios" subtitle="NPS, IRT, perfil, conversão, potencial e execução."/>}
    {page==='settings'&&<SimplePage title="Configurações" subtitle="Administração e parâmetros do sistema."/>}
   </div>
  </main>
  <MobileNav page={page} setPage={setPage}/>
 </div>
}
