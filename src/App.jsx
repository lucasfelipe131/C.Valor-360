import React,{useEffect,useState} from 'react'
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
import Visits from './pages/Visits'
import Opportunities from './pages/Opportunities'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Login from './pages/Login'

const initialVisits=[
 {id:'v1',clientId:'genor-brum-filho',date:'2026-08-08',time:'14:00',objective:'Revisar manejo e definir área de avaliação',status:'Agendada'},
 {id:'v2',clientId:'henrique-gambin',date:'2026-08-11',time:'09:30',objective:'Mapear gargalos de estoque e logística',status:'Agendada'},
 {id:'v3',clientId:'matheus-nascimento-jaeger',date:'2026-08-13',time:'10:00',objective:'Planejamento técnico da safra de verão',status:'Agendada'}
]

const readLocal=(key,fallback)=>{
 try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}
}

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
 const [authenticated,setAuthenticated]=useState(()=>localStorage.getItem('valor360-session')!=='closed')
 const [page,setPage]=useState('dashboard')
 const [selected,setSelected]=useState(null)
 const [clientList,setClientList]=useState(()=>readLocal('valor360-clients',clients))
 const [visits,setVisits]=useState(()=>readLocal('valor360-visits',initialVisits))
 const [toast,setToast]=useState('')
 const openClient=c=>{setSelected(c);setPage('client360')}
 const notify=message=>{setToast(message);window.clearTimeout(window.__valorToast);window.__valorToast=window.setTimeout(()=>setToast(''),2800)}
 const prepareClient=c=>{setSelected(c);setPage('val')}
 const addClient=client=>{
  const next=[...clientList,client]
  setClientList(next);localStorage.setItem('valor360-clients',JSON.stringify(next));setSelected(client);notify('Perfil calculado e cliente adicionado à carteira.')
 }
 const updateVisits=next=>{setVisits(next);localStorage.setItem('valor360-visits',JSON.stringify(next))}
 const login=()=>{localStorage.setItem('valor360-session','open');setAuthenticated(true);notify('Bem-vindo ao VALOR 360.')}
 const logout=()=>{localStorage.setItem('valor360-session','closed');setAuthenticated(false);setPage('dashboard')}
 useEffect(()=>{if(!selected&&clientList.length)setSelected(clientList[0])},[clientList,selected])
 const [title,subtitle]=meta[page]||['VALOR 360','']
 if(!authenticated)return <Login onLogin={login}/>
 return <div className="app-shell">
  <Sidebar page={page} setPage={p=>{setPage(p); if(p!=='client360') setSelected(null)}}/>
  <main className="main">
   <Topbar title={title} subtitle={subtitle}/>
   <div className="content">
    {page==='dashboard'&&<Dashboard clients={clientList} visits={visits} setPage={setPage} onClient={openClient} onPrepare={prepareClient}/>}
    {page==='clients'&&<Clients clients={clientList} onClient={openClient} onNew={()=>setPage('questionnaire')}/>}
    {page==='client360'&&selected&&<Client360 key={selected.id} client={selected} onBack={()=>setPage('clients')} onPrepare={()=>prepareClient(selected)} onSaved={()=>notify('Complemento técnico salvo neste dispositivo.')}/>}
    {page==='val'&&<ValPanel clients={clientList} selectedClient={selected} onSelect={openClient}/>}
    {page==='agro'&&<Agro/>}
    {page==='questionnaire'&&<Questionnaire onCreate={addClient} onOpen={openClient}/>}
    {page==='visits'&&<Visits clients={clientList} visits={visits} setVisits={updateVisits} onPrepare={prepareClient} onSaved={()=>notify('Visita registrada na agenda.')}/>}
    {page==='opportunities'&&<Opportunities clients={clientList} onClient={openClient} onSaved={notify}/>}
    {page==='reports'&&<Reports clients={clientList} visits={visits}/>}
    {page==='settings'&&<Settings clients={clientList} visits={visits} onLogout={logout} onNotify={notify}/>}
   </div>
  </main>
  <MobileNav page={page} setPage={setPage}/>
  {toast&&<div className="toast" role="status">{toast}</div>}
 </div>
}
