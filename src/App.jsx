import React,{useEffect,useState} from 'react'
import {BrainCircuit} from 'lucide-react'
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
import {normalizeText,reconcileOpportunityProjection} from './lib/profile'
import {opportunityCacheKey} from './lib/opportunity-pipeline'

const activeStorageScopeKey='valor360-active-storage-scope'
const clearLegacyPortfolioCache=()=>{
 for(const key of ['valor360-clients','valor360-visits','valor360-opportunities'])localStorage.removeItem(key)
 Object.keys(localStorage).filter(key=>key.startsWith('valor360-tech-')||key.startsWith('valor360-client-context:')).forEach(key=>localStorage.removeItem(key))
}
const clearSessionPortfolioCache=storageScope=>{
 clearLegacyPortfolioCache()
 const effectiveScope=storageScope||sessionStorage.getItem(activeStorageScopeKey)
 const scopedOpportunityKey=opportunityCacheKey(effectiveScope);if(scopedOpportunityKey)localStorage.removeItem(scopedOpportunityKey)
 Object.keys(sessionStorage).filter(key=>key.startsWith('valor360-tech-')).forEach(key=>sessionStorage.removeItem(key))
 sessionStorage.removeItem(activeStorageScopeKey)
}
const rememberStorageScope=user=>{if(user?.storageScope)sessionStorage.setItem(activeStorageScopeKey,user.storageScope)}

const resetPageViewport=()=>{
 window.scrollTo({top:0,left:0,behavior:'auto'})
 document.querySelector('.topbar h1')?.focus({preventScroll:true})
}

const meta={
 dashboard:['Hoje','Sua central de relacionamento e resultado'],
 clients:['Clientes','Conheça o produtor antes de oferecer uma solução'],
 datahub:['Base Inteligente','Importe históricos e organize contexto verificável da carteira'],
 client360:['Cliente 360','Perfil, relacionamento, contexto técnico e oportunidades'],
 visits:['Visitas','Planejamento, roteiro e próximos compromissos'],
 opportunities:['Oportunidades','Transforme necessidade em proposta de valor'],
 val:['Inteligência (VAL)','Value Agriculture Intelligence'],
 agro:['Inteligência Agronômica','Análises, mapas, cálculos e decisões técnicas no mesmo ambiente'],
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
 const [clientList,setClientList]=useState([])
 const [visits,setVisits]=useState([])
 const [opportunities,setOpportunities]=useState([])
 const [toast,setToast]=useState('')
 const openClient=c=>{setSelected(c);setPage('client360');if(page==='client360')window.requestAnimationFrame(resetPageViewport)}
 const notify=message=>{setToast(message);window.clearTimeout(window.__valorToast);window.__valorToast=window.setTimeout(()=>setToast(''),2800)}
 const prepareClient=c=>{setSelected(c);setPage('val');if(page==='val')window.requestAnimationFrame(resetPageViewport)}
 const navigate=next=>{if(next!=='client360')setSelected(null);setPage(next);if(next===page)window.requestAnimationFrame(resetPageViewport)}
 const addClient=client=>{
  let saved
  const incomingCommercial=Object.fromEntries(Object.entries(client.commercial||{}).filter(([,value])=>value!==''&&value!==null&&value!==undefined))
  const next=clientList.some(item=>normalizeText(item.name)===normalizeText(client.name))?clientList.map(item=>normalizeText(item.name)===normalizeText(client.name)?(saved={...item,...client,id:item.id,commercial:{...item.commercial,...incomingCommercial,...reconcileOpportunityProjection(item,client),potential:Math.max(Number(item.commercial?.potential||0),Number(incomingCommercial.potential||0))}},saved):item):[...clientList,(saved=client)]
  setClientList(next);setSelected(saved);notify('Perfil compilado e incorporado à carteira.')
 }
 const importClients=imported=>{
  const map=new Map(clientList.map(client=>[normalizeText(client.name),client]))
  imported.forEach(client=>{const current=map.get(normalizeText(client.name));map.set(normalizeText(client.name),current?{...client,...current,commercial:{...client.commercial,...current.commercial,...reconcileOpportunityProjection(current,client),potential:Math.max(Number(client.commercial?.potential||0),Number(current.commercial?.potential||0)),score:client.commercial?.score??current.commercial?.score}}:client)})
  setClientList([...map.values()])
 }
 const saveVisit=async input=>{const response=await fetch('/api/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível salvar a visita.');setVisits(current=>[payload.visit,...current.filter(item=>item.id!==payload.visit.id)]);notify('Visita registrada no PostgreSQL e disponível para a VAL.');return payload.visit}
 const saveOpportunity=async input=>{const response=await fetch('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar a oportunidade.');setOpportunities(current=>[payload.opportunity,...current.filter(item=>!(item.clientId===payload.opportunity.clientId&&item.candidateKey===payload.opportunity.candidateKey))]);return payload.opportunity}
 const login=async credentials=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível autenticar.');rememberStorageScope(payload.user);setAuthNotice('');setCurrentUser(payload.user||null);setPortfolioReady(Boolean(payload.user?.demo));setAuthenticated(true);notify('Bem-vindo ao VALOR 360.')}
 const logout=async()=>{try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setAuthNotice('');setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}catch{notify('Não foi possível encerrar a sessão no servidor. Tente novamente.')}}
 const invalidateSession=notice=>{clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setAuthNotice(notice);setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}
 const expireSession=()=>invalidateSession('Sua sessão expirou. Entre novamente.')
 useEffect(()=>{if(!selected&&clientList.length)setSelected(clientList[0])},[clientList,selected])
 useEffect(()=>{fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(session?.authenticated)rememberStorageScope(session.user);else clearSessionPortfolioCache();setCurrentUser(session?.user||null);setPortfolioReady(Boolean(session?.user?.demo));setAuthenticated(Boolean(session?.authenticated));if(!session?.authenticated&&session?.misconfigured)setAuthNotice('O acesso seguro do servidor ainda não foi configurado.')}).catch(()=>{clearSessionPortfolioCache();setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setCurrentUser(null);setAuthNotice('Não foi possível validar o servidor. O acesso permaneceu bloqueado.');setPortfolioReady(false);setAuthenticated(false)})},[])
 useEffect(()=>{window.addEventListener('valor360:unauthorized',expireSession);return()=>window.removeEventListener('valor360:unauthorized',expireSession)},[currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true)return;const revalidate=()=>fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(!session?.authenticated)expireSession()}).catch(()=>invalidateSession('Não foi possível revalidar o servidor. Entre novamente para proteger os dados.'));window.addEventListener('focus',revalidate);const timer=window.setInterval(revalidate,300000);return()=>{window.removeEventListener('focus',revalidate);window.clearInterval(timer)}},[authenticated,currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true)return;clearLegacyPortfolioCache();fetch('/api/intelligence',{signal:AbortSignal.timeout(12000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'A carteira protegida não pôde ser carregada.');return payload}).then(data=>{if(!data)return;const serverClients=Array.isArray(data.clients)?data.clients:[];setClientList(serverClients);setVisits(Array.isArray(data.visits)?data.visits:[]);setOpportunities(Array.isArray(data.opportunities)?data.opportunities:[]);setSelected(serverClients[0]||null);setPortfolioReady(true)}).catch(error=>{if(currentUser?.demo){setPortfolioReady(true);return}setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setPortfolioReady(true);notify(error.name==='TimeoutError'?'A carteira demorou além do limite e permaneceu bloqueada.':error.message)})},[authenticated,currentUser?.demo])
 useEffect(()=>{if(authenticated!==true)return;const frame=window.requestAnimationFrame(resetPageViewport);return()=>window.cancelAnimationFrame(frame)},[page,authenticated])
 const [title,subtitle]=meta[page]||['VALOR 360','']
 if(publicSurveyToken)return <PublicSurvey token={publicSurveyToken}/>
 if(authenticated===null)return <main className="auth-loading" role="status"><BrainCircuit/><span>Validando acesso seguro…</span></main>
 if(!authenticated)return <Login onLogin={login} notice={authNotice}/>
 if(!portfolioReady)return <main className="auth-loading" role="status"><BrainCircuit/><span>Carregando carteira protegida…</span></main>
 return <div className="app-shell">
  <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
  <Sidebar page={page} currentUser={currentUser} setPage={navigate}/>
  <main className="main" id="main-content" tabIndex="-1">
   <Topbar title={title} subtitle={subtitle} onNavigate={navigate}/>
   <div className="content">
    {page==='dashboard'&&<Dashboard clients={clientList} visits={visits} currentUser={currentUser} setPage={navigate} onClient={openClient} onPrepare={prepareClient}/>}
    {page==='clients'&&<Clients clients={clientList} onClient={openClient} onNew={()=>navigate('questionnaire')}/>}
    {page==='datahub'&&<DataHub onImport={importClients} onNotify={notify}/>}
    {page==='client360'&&selected&&<Client360 key={selected.id} client={selected} storageScope={currentUser?.storageScope} onBack={()=>navigate('clients')} onPrepare={()=>prepareClient(selected)} onSaved={()=>notify('Complemento técnico salvo na memória da VAL como entrada pendente de verificação.')}/>}
    {page==='val'&&<ValPanel clients={clientList} selectedClient={selected} onSelect={openClient}/>}
    {page==='agro'&&<Agro clients={clientList}/>}
    {page==='questionnaire'&&<Questionnaire onCreate={addClient} onOpen={openClient} onNotify={notify}/>}
    {page==='visits'&&<Visits clients={clientList} visits={visits} onSave={saveVisit} onPrepare={prepareClient}/>}
    {page==='opportunities'&&<Opportunities clients={clientList} storageScope={currentUser?.storageScope} persistedItems={opportunities} onPersist={saveOpportunity} onClient={openClient} onSaved={notify}/>}
    {page==='reports'&&<Reports clients={clientList} visits={visits}/>}
    {page==='settings'&&<Settings clients={clientList} visits={visits} currentUser={currentUser} onLogout={logout} onNotify={notify}/>}
   </div>
  </main>
  <MobileNav page={page} setPage={navigate}/>
  {toast&&<div className="toast" role="status">{toast}</div>}
 </div>
}
