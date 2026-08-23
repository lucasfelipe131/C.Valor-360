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
import ValWorkspace from './components/ValWorkspace'
import Visits from './pages/Visits'
import Opportunities from './pages/Opportunities'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Login from './pages/Login'
import PasswordChange from './pages/PasswordChange'
import DataHub from './pages/DataHub'
import Admin from './pages/Admin'
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
 val:['Ambientes VAL','Escolha a inteligência certa para insumos ou operações de grãos'],
 agro:['Inteligência Agronômica','Análises, mapas, cálculos e decisões técnicas no mesmo ambiente'],
 questionnaire:['Produtor 360','Perfil e preferências do produtor'],
 reports:['Relatórios','Indicadores, NPS, IRT e execução comercial'],
 settings:['Configurações','Conta, governança e parâmetros'],
 admin:['Administração','Acessos, uso e métricas globais do sistema']
}
export default function App(){
 const publicSurveyToken=new URLSearchParams(window.location.search).get('responder')
 const [authenticated,setAuthenticated]=useState(null)
 const [currentUser,setCurrentUser]=useState(null)
 const [portfolioReady,setPortfolioReady]=useState(false)
 const [authNotice,setAuthNotice]=useState('')
 const [page,setPage]=useState('dashboard')
 const [valMode,setValMode]=useState(null)
 const [selected,setSelected]=useState(null)
 const [clientList,setClientList]=useState([])
 const [visits,setVisits]=useState([])
 const [opportunities,setOpportunities]=useState([])
 const [toast,setToast]=useState('')
 const openClient=c=>{setSelected(c);setPage('client360');if(page==='client360')window.requestAnimationFrame(resetPageViewport)}
 const notify=message=>{const text=typeof message==='string'?message:String(message?.message||'Ação concluída.');setToast(text);window.clearTimeout(window.__valorToast);window.__valorToast=window.setTimeout(()=>setToast(''),2800)}
 const prepareClient=c=>{setSelected(c);setValMode('insumos');setPage('val');if(page==='val')window.requestAnimationFrame(resetPageViewport)}
 const navigate=next=>{if(next!=='client360')setSelected(null);if(next==='val')setValMode(null);setPage(next);if(next===page)window.requestAnimationFrame(resetPageViewport)}
 const addClient=client=>{
  let saved
  const incomingCommercial=Object.fromEntries(Object.entries(client.commercial||{}).filter(([,value])=>value!==''&&value!==null&&value!==undefined))
  const next=clientList.some(item=>normalizeText(item.name)===normalizeText(client.name))?clientList.map(item=>normalizeText(item.name)===normalizeText(client.name)?(saved={...item,...client,id:item.id,commercial:{...item.commercial,...incomingCommercial,...reconcileOpportunityProjection(item,client),potential:Math.max(Number(item.commercial?.potential||0),Number(incomingCommercial.potential||0))}},saved):item):[...clientList,(saved=client)]
  setClientList(next);setSelected(saved);notify('Perfil compilado e incorporado à carteira.')
 }
 const addClients=clients=>{
  setClientList(current=>{const map=new Map(current.map(client=>[normalizeText(client.name),client]));clients.forEach(client=>{const existing=map.get(normalizeText(client.name));const incomingCommercial=Object.fromEntries(Object.entries(client.commercial||{}).filter(([,value])=>value!==''&&value!==null&&value!==undefined));map.set(normalizeText(client.name),existing?{...existing,...client,id:existing.id,commercial:{...existing.commercial,...incomingCommercial,...reconcileOpportunityProjection(existing,client),potential:Math.max(Number(existing.commercial?.potential||0),Number(incomingCommercial.potential||0))}}:client)});return [...map.values()]})
 }
 const importClients=imported=>{
  const map=new Map(clientList.map(client=>[normalizeText(client.name),client]))
  imported.forEach(client=>{const current=map.get(normalizeText(client.name));map.set(normalizeText(client.name),current?{...client,...current,commercial:{...client.commercial,...current.commercial,...reconcileOpportunityProjection(current,client),potential:Math.max(Number(client.commercial?.potential||0),Number(current.commercial?.potential||0)),score:client.commercial?.score??current.commercial?.score}}:client)})
  setClientList([...map.values()])
 }
 const updateClient=async(id,input)=>{const response=await fetch(`/api/clients/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar o produtor.');if(!payload.client)throw new Error('O servidor não retornou o produtor atualizado.');setClientList(current=>current.map(item=>item.id===id?payload.client:item));setSelected(current=>current?.id===id?payload.client:current);return payload.client}
 const deleteClient=async id=>{const response=await fetch(`/api/clients/${encodeURIComponent(id)}`,{method:'DELETE',signal:AbortSignal.timeout(15000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível excluir o produtor.');setClientList(current=>current.filter(item=>item.id!==id));setSelected(current=>current?.id===id?null:current);notify('Produtor retirado da carteira deste login.');return payload}
 const saveVisit=async input=>{const response=await fetch('/api/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível salvar a visita.');setVisits(current=>[payload.visit,...current.filter(item=>item.id!==payload.visit.id)]);notify('Visita registrada no PostgreSQL e disponível para a VAL.');return payload.visit}
 const registerVisitResult=visit=>{if(!visit)return;setVisits(current=>[visit,...current.filter(item=>item.id!==visit.id)]);notify('Visita registrada. Sua próxima preparação já foi atualizada.')}
 const saveOpportunity=async input=>{const response=await fetch('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar a oportunidade.');setOpportunities(current=>[payload.opportunity,...current.filter(item=>!(item.clientId===payload.opportunity.clientId&&item.candidateKey===payload.opportunity.candidateKey))]);return payload.opportunity}
 const login=async credentials=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível autenticar.');rememberStorageScope(payload.user);setAuthNotice('');setCurrentUser(payload.user||null);setPortfolioReady(Boolean(payload.user?.demo));setAuthenticated(true);notify('Bem-vindo à VAL.')}
 const changePassword=async input=>{const response=await fetch('/api/auth/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível trocar a senha.');rememberStorageScope(payload.user);setCurrentUser(payload.user);setPortfolioReady(false);notify('Senha definida. Sua carteira já está pronta para ser preenchida.')}
 const logout=async()=>{try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setValMode(null);setAuthNotice('');setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}catch{notify('Não foi possível encerrar a sessão no servidor. Tente novamente.')}}
 const invalidateSession=notice=>{clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setValMode(null);setAuthNotice(notice);setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}
 const expireSession=()=>invalidateSession('Sua sessão expirou. Entre novamente.')
 useEffect(()=>{if(!selected&&clientList.length)setSelected(clientList[0])},[clientList,selected])
 useEffect(()=>{fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(session?.authenticated)rememberStorageScope(session.user);else clearSessionPortfolioCache();setCurrentUser(session?.user||null);setPortfolioReady(Boolean(session?.user?.demo));setAuthenticated(Boolean(session?.authenticated));if(!session?.authenticated&&session?.misconfigured)setAuthNotice('O acesso seguro do servidor ainda não foi configurado.')}).catch(()=>{clearSessionPortfolioCache();setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setCurrentUser(null);setAuthNotice('Não foi possível validar o servidor. O acesso permaneceu bloqueado.');setPortfolioReady(false);setAuthenticated(false)})},[])
 useEffect(()=>{window.addEventListener('valor360:unauthorized',expireSession);return()=>window.removeEventListener('valor360:unauthorized',expireSession)},[currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true)return;const revalidate=()=>fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(!session?.authenticated){expireSession();return}setCurrentUser(session.user);rememberStorageScope(session.user)}).catch(()=>invalidateSession('Não foi possível revalidar o servidor. Entre novamente para proteger os dados.'));window.addEventListener('focus',revalidate);const timer=window.setInterval(revalidate,300000);return()=>{window.removeEventListener('focus',revalidate);window.clearInterval(timer)}},[authenticated,currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true||currentUser?.mustChangePassword)return;clearLegacyPortfolioCache();fetch('/api/intelligence',{signal:AbortSignal.timeout(12000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'A carteira protegida não pôde ser carregada.');return payload}).then(data=>{if(!data)return;const serverClients=Array.isArray(data.clients)?data.clients:[];setClientList(serverClients);setVisits(Array.isArray(data.visits)?data.visits:[]);setOpportunities(Array.isArray(data.opportunities)?data.opportunities:[]);setSelected(serverClients[0]||null);setPortfolioReady(true)}).catch(error=>{if(currentUser?.demo){setPortfolioReady(true);return}setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setPortfolioReady(true);notify(error.name==='TimeoutError'?'A carteira demorou além do limite e permaneceu bloqueada.':error.message)})},[authenticated,currentUser?.demo,currentUser?.mustChangePassword])
 useEffect(()=>{if(authenticated!==true)return;const frame=window.requestAnimationFrame(resetPageViewport);return()=>window.cancelAnimationFrame(frame)},[page,valMode,authenticated])
 useEffect(()=>{
  if(authenticated!==true||!portfolioReady||currentUser?.demo||!currentUser?.id)return
  const controller=new AbortController()
  fetch('/api/usage/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,entityType:selected&&page==='client360'?'client':'',entityId:selected&&page==='client360'?selected.id:''}),signal:controller.signal}).catch(()=>null)
  return()=>controller.abort()
 },[page,selected?.id,authenticated,portfolioReady,currentUser?.id,currentUser?.demo])
 const valMeta=valMode==='insumos'?['VAL Insumos','Inteligência comercial, técnica e consultiva para gerar valor']:valMode==='graos'?['VAL Grãos','Ambiente dedicado à originação e às operações de grãos']:meta.val
 const [title,subtitle]=page==='val'?valMeta:(meta[page]||['VAL',''])
 if(publicSurveyToken)return <PublicSurvey token={publicSurveyToken}/>
 if(authenticated===null)return <main className="auth-loading" role="status"><BrainCircuit/><span>Validando acesso seguro…</span></main>
 if(!authenticated)return <Login onLogin={login} notice={authNotice}/>
 if(currentUser?.mustChangePassword)return <PasswordChange user={currentUser} onChange={changePassword} onLogout={logout}/>
 if(!portfolioReady)return <main className="auth-loading" role="status"><BrainCircuit/><span>Carregando carteira protegida…</span></main>
 return <div className="app-shell">
  <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
  <Sidebar page={page} currentUser={currentUser} setPage={navigate}/>
  <main className="main" id="main-content" tabIndex="-1">
   <Topbar title={title} subtitle={subtitle} onNavigate={navigate}/>
   <div className="content">
    {page==='dashboard'&&<Dashboard clients={clientList} visits={visits} opportunities={opportunities} currentUser={currentUser} setPage={navigate} onClient={openClient} onPrepare={prepareClient}/>}
    {page==='clients'&&<Clients clients={clientList} opportunities={opportunities} onClient={openClient} onNew={()=>navigate('questionnaire')}/>}
    {page==='datahub'&&<DataHub clients={clientList} onImport={importClients} onProfileImport={addClients} onUpdate={updateClient} onDelete={deleteClient} onNotify={notify}/>}
    {page==='client360'&&selected&&<Client360 key={selected.id} client={selected} storageScope={currentUser?.storageScope} onBack={()=>navigate('clients')} onPrepare={()=>prepareClient(selected)} onUpdate={updateClient} onSaved={message=>notify(message||'Complemento técnico salvo na memória da VAL como entrada pendente de verificação.')}/>}
    {page==='val'&&<ValWorkspace mode={valMode} onModeChange={setValMode} clients={clientList} selectedClient={selected} onSelect={openClient}/>}
    {page==='agro'&&<Agro clients={clientList}/>}
    {page==='questionnaire'&&<Questionnaire onCreate={addClient} onCreateMany={addClients} onOpen={openClient} onNotify={notify}/>}
    {page==='visits'&&<Visits clients={clientList} visits={visits} onSave={saveVisit} onPrepare={prepareClient} onRegistered={registerVisitResult}/>}
    {page==='opportunities'&&<Opportunities clients={clientList} storageScope={currentUser?.storageScope} persistedItems={opportunities} onPersist={saveOpportunity} onClient={openClient} onSaved={notify}/>}
    {page==='reports'&&<Reports clients={clientList} visits={visits}/>}
    {page==='settings'&&<Settings clients={clientList} visits={visits} opportunities={opportunities} currentUser={currentUser} onLogout={logout} onNotify={notify}/>}
    {page==='admin'&&currentUser?.role==='admin'&&<Admin currentUser={currentUser} onNotify={notify}/>}
   </div>
  </main>
  <MobileNav page={page} setPage={navigate} currentUser={currentUser}/>
  {toast&&<div className="toast" role="status">{toast}</div>}
 </div>
}
