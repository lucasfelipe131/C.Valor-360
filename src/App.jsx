import React,{useEffect,useState} from 'react'
import {BrainCircuit} from 'lucide-react'
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
import DataHub from './pages/DataHub'
import PublicSurvey from './pages/PublicSurvey'
import {normalizeText} from './lib/profile'

const initialVisits=[
 {id:'v1',clientId:'genor-brum-filho',date:'2026-08-08',time:'14:00',objective:'Revisar manejo e definir área de avaliação',status:'Agendada'},
 {id:'v2',clientId:'henrique-gambin',date:'2026-08-11',time:'09:30',objective:'Mapear gargalos de estoque e logística',status:'Agendada'},
 {id:'v3',clientId:'matheus-nascimento-jaeger',date:'2026-08-13',time:'10:00',objective:'Planejamento técnico da safra de verão',status:'Agendada'}
]

const readLocal=(key,fallback)=>{
 try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}
}

const meta={
 dashboard:['Hoje','Sua central de relacionamento e resultado'],
 clients:['Clientes','Conheça o produtor antes de oferecer uma solução'],
 datahub:['Base Inteligente','Importe históricos e organize contexto verificável da carteira'],
 client360:['Cliente 360','Perfil, relacionamento, contexto técnico e oportunidades'],
 visits:['Visitas','Planejamento, roteiro e próximos compromissos'],
 opportunities:['Oportunidades','Transforme necessidade em proposta de valor'],
 val:['Inteligência (VAL)','Value Agriculture Intelligence'],
 agro:['Inteligência Agronômica','Dados técnicos estruturados e roadmap de módulos'],
 questionnaire:['Produtor 360','Perfil e preferências do produtor'],
 reports:['Relatórios','Indicadores, NPS, IRT e execução comercial'],
 settings:['Configurações','Usuários, unidades e parâmetros']
}
export default function App(){
 const publicSurveyToken=new URLSearchParams(window.location.search).get('responder')
 const [authenticated,setAuthenticated]=useState(null)
 const [currentUser,setCurrentUser]=useState(null)
 const [portfolioReady,setPortfolioReady]=useState(false)
 const [authNotice,setAuthNotice]=useState('')
 const [page,setPage]=useState('dashboard')
 const [selected,setSelected]=useState(null)
 const [clientList,setClientList]=useState(()=>readLocal('valor360-clients',clients))
 const [visits,setVisits]=useState(()=>readLocal('valor360-visits',initialVisits))
 const [toast,setToast]=useState('')
 const openClient=c=>{setSelected(c);setPage('client360')}
 const notify=message=>{setToast(message);window.clearTimeout(window.__valorToast);window.__valorToast=window.setTimeout(()=>setToast(''),2800)}
 const prepareClient=c=>{setSelected(c);setPage('val')}
 const addClient=client=>{
  let saved
  const next=clientList.some(item=>normalizeText(item.name)===normalizeText(client.name))?clientList.map(item=>normalizeText(item.name)===normalizeText(client.name)?(saved={...item,...client,id:item.id,commercial:{...item.commercial,...client.commercial,potential:Math.max(Number(item.commercial?.potential||0),Number(client.commercial?.potential||0))}},saved):item):[...clientList,(saved=client)]
  setClientList(next);localStorage.setItem('valor360-clients',JSON.stringify(next));setSelected(saved);notify('Perfil compilado e incorporado à carteira.')
 }
 const importClients=imported=>{
  const map=new Map(clientList.map(client=>[normalizeText(client.name),client]))
  imported.forEach(client=>{const current=map.get(normalizeText(client.name));map.set(normalizeText(client.name),current?{...client,...current,commercial:{...client.commercial,...current.commercial,potential:Math.max(Number(client.commercial?.potential||0),Number(current.commercial?.potential||0)),score:client.commercial?.score??current.commercial?.score}}:client)})
  const next=[...map.values()];setClientList(next);localStorage.setItem('valor360-clients',JSON.stringify(next))
 }
 const updateVisits=next=>{setVisits(next);localStorage.setItem('valor360-visits',JSON.stringify(next))}
 const login=async credentials=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível autenticar.');setAuthNotice('');setCurrentUser(payload.user||null);setPortfolioReady(Boolean(payload.user?.demo));setAuthenticated(true);notify('Bem-vindo ao VALOR 360.')}
 const logout=async()=>{try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();setAuthNotice('');setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}catch{notify('Não foi possível encerrar a sessão no servidor. Tente novamente.')}}
 const expireSession=()=>{setAuthNotice('Sua sessão expirou. Entre novamente.');setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}
 useEffect(()=>{if(!selected&&clientList.length)setSelected(clientList[0])},[clientList,selected])
 useEffect(()=>{fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{setCurrentUser(session?.user||null);setPortfolioReady(Boolean(session?.user?.demo));setAuthenticated(Boolean(session?.authenticated));if(!session?.authenticated&&session?.misconfigured)setAuthNotice('O acesso seguro do servidor ainda não foi configurado.')}).catch(()=>{setAuthNotice('Não foi possível validar o servidor. O acesso permaneceu bloqueado.');setPortfolioReady(false);setAuthenticated(false)})},[])
 useEffect(()=>{window.addEventListener('valor360:unauthorized',expireSession);return()=>window.removeEventListener('valor360:unauthorized',expireSession)},[])
 useEffect(()=>{if(authenticated!==true)return;const revalidate=()=>fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(!session?.authenticated)expireSession()}).catch(()=>{setAuthNotice('Não foi possível revalidar o servidor. Entre novamente para proteger os dados.');setCurrentUser(null);setAuthenticated(false);setPage('dashboard')});window.addEventListener('focus',revalidate);const timer=window.setInterval(revalidate,300000);return()=>{window.removeEventListener('focus',revalidate);window.clearInterval(timer)}},[authenticated])
 useEffect(()=>{if(authenticated!==true)return;fetch('/api/intelligence',{signal:AbortSignal.timeout(12000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'A carteira protegida não pôde ser carregada.');return payload}).then(data=>{if(!data)return;if(currentUser?.demo){if(data.clients?.length)importClients(data.clients)}else{const serverClients=Array.isArray(data.clients)?data.clients:[];setClientList(serverClients);localStorage.setItem('valor360-clients',JSON.stringify(serverClients));setSelected(serverClients[0]||null)}setPortfolioReady(true)}).catch(error=>{if(currentUser?.demo){setPortfolioReady(true);return}setClientList([]);setSelected(null);setPortfolioReady(true);notify(error.name==='TimeoutError'?'A carteira demorou além do limite e permaneceu bloqueada.':error.message)})},[authenticated,currentUser?.demo])
 const [title,subtitle]=meta[page]||['VALOR 360','']
 if(publicSurveyToken)return <PublicSurvey token={publicSurveyToken}/>
 if(authenticated===null)return <main className="auth-loading" role="status"><BrainCircuit/><span>Validando acesso seguro…</span></main>
 if(!authenticated)return <Login onLogin={login} notice={authNotice}/>
 if(!portfolioReady)return <main className="auth-loading" role="status"><BrainCircuit/><span>Carregando carteira protegida…</span></main>
 return <div className="app-shell">
  <Sidebar page={page} currentUser={currentUser} setPage={p=>{setPage(p); if(p!=='client360') setSelected(null)}}/>
  <main className="main">
   <Topbar title={title} subtitle={subtitle} onNavigate={setPage}/>
   <div className="content">
    {page==='dashboard'&&<Dashboard clients={clientList} visits={visits} setPage={setPage} onClient={openClient} onPrepare={prepareClient}/>}
    {page==='clients'&&<Clients clients={clientList} onClient={openClient} onNew={()=>setPage('questionnaire')}/>}
    {page==='datahub'&&<DataHub onImport={importClients} onNotify={notify}/>}
    {page==='client360'&&selected&&<Client360 key={selected.id} client={selected} onBack={()=>setPage('clients')} onPrepare={()=>prepareClient(selected)} onSaved={()=>notify('Complemento técnico salvo na memória da VAL como entrada pendente de verificação.')}/>}
    {page==='val'&&<ValPanel clients={clientList} selectedClient={selected} onSelect={openClient}/>}
    {page==='agro'&&<Agro/>}
    {page==='questionnaire'&&<Questionnaire onCreate={addClient} onOpen={openClient} onNotify={notify}/>}
    {page==='visits'&&<Visits clients={clientList} visits={visits} setVisits={updateVisits} onPrepare={prepareClient} onSaved={()=>notify('Visita registrada na agenda.')}/>}
    {page==='opportunities'&&<Opportunities clients={clientList} onClient={openClient} onSaved={notify}/>}
    {page==='reports'&&<Reports clients={clientList} visits={visits}/>}
    {page==='settings'&&<Settings clients={clientList} visits={visits} currentUser={currentUser} onLogout={logout} onNotify={notify}/>}
   </div>
  </main>
  <MobileNav page={page} setPage={setPage}/>
  {toast&&<div className="toast" role="status">{toast}</div>}
 </div>
}
