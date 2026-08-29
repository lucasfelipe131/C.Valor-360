import React,{lazy,Suspense,useCallback,useEffect,useMemo,useState} from 'react'
import {BrainCircuit} from 'lucide-react'
import Sidebar from './components/Sidebar'
import MobileNav from './components/MobileNav'
import Topbar from './components/Topbar'
import Login from './pages/Login'
import PasswordChange from './pages/PasswordChange'
import {normalizeText,reconcileOpportunityProjection} from './lib/profile'
import {opportunityCacheKey} from './lib/opportunity-pipeline'
import {resolveCopilotLaunch} from './lib/copilot-context'
import {clearCopilotSessionStorage} from './lib/copilot-session-storage'
import {createValWorkspaceContext,validateValWorkspaceAction} from './lib/val-workspace-context'

const GlobalValCopilot=lazy(()=>import('./components/GlobalValCopilot'))
const Dashboard=lazy(()=>import('./pages/Dashboard'))
const Clients=lazy(()=>import('./pages/Clients'))
const Client360=lazy(()=>import('./pages/Client360'))
const Agro=lazy(()=>import('./pages/Agro'))
const Questionnaire=lazy(()=>import('./pages/Questionnaire'))
const ValWorkspace=lazy(()=>import('./components/ValWorkspace'))
const Visits=lazy(()=>import('./pages/Visits'))
const Opportunities=lazy(()=>import('./pages/Opportunities'))
const Reports=lazy(()=>import('./pages/Reports'))
const Settings=lazy(()=>import('./pages/Settings'))
const DataHub=lazy(()=>import('./pages/DataHub'))
const Admin=lazy(()=>import('./pages/Admin'))
const PublicSurvey=lazy(()=>import('./pages/PublicSurvey'))

const activeStorageScopeKey='valor360-active-storage-scope'
const createEmptyAgroLaunch=()=>({nonce:0,client:null,property:null,field:null,analysis:null,context:{},initialTool:null,initialFiles:[]})
const clearLegacyPortfolioCache=()=>{
 for(const key of ['valor360-clients','valor360-visits','valor360-opportunities'])localStorage.removeItem(key)
 Object.keys(localStorage).filter(key=>key.startsWith('valor360-tech-')||key.startsWith('valor360-client-context:')).forEach(key=>localStorage.removeItem(key))
}
const clearSessionPortfolioCache=storageScope=>{
 clearLegacyPortfolioCache()
 const effectiveScope=storageScope||sessionStorage.getItem(activeStorageScopeKey)
 const scopedOpportunityKey=opportunityCacheKey(effectiveScope);if(scopedOpportunityKey)localStorage.removeItem(scopedOpportunityKey)
 clearCopilotSessionStorage(sessionStorage)
 Object.keys(sessionStorage).filter(key=>key.startsWith('valor360-tech-')).forEach(key=>sessionStorage.removeItem(key))
 sessionStorage.removeItem(activeStorageScopeKey)
}
const rememberStorageScope=user=>{if(user?.storageScope)sessionStorage.setItem(activeStorageScopeKey,user.storageScope)}

const resetPageViewport=()=>{
 window.scrollTo({top:0,left:0,behavior:'auto'})
 document.querySelector('.topbar h1')?.focus({preventScroll:true})
}
const RouteFallback=()=> <div className="auth-loading" role="status"><BrainCircuit/><span>Carregando ambiente…</span></div>

const meta={
 dashboard:['VAL','Seu copiloto comercial e agronômico para o que importa agora'],
 clients:['Clientes','Conheça o produtor antes de oferecer uma solução'],
 datahub:['Base Inteligente','Importe históricos e organize contexto verificável da carteira'],
 client360:['Cliente 360','Perfil, relacionamento, contexto técnico e oportunidades'],
 visits:['Visitas','Planejamento, roteiro e próximos compromissos'],
 opportunities:['Oportunidades','Transforme necessidade em proposta de valor'],
 val:['Análise avançada','Aprofunde cenários, evidências e inteligência quando precisar'],
 agro:['Inteligência Agronômica','Análises, mapas, cálculos e decisões técnicas no mesmo ambiente'],
 questionnaire:['Produtor 360','Perfil e preferências do produtor'],
 reports:['Relatórios','Indicadores, NPS, IRT e execução comercial'],
 settings:['Configurações','Conta, governança e parâmetros'],
 admin:['Administração','Acessos, uso e métricas globais do sistema'],
 copilot:['VAL Copilot','Centro de conversa, decisão e orquestração do ecossistema']
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
 const [prepareVisitClientId,setPrepareVisitClientId]=useState('')
 const [clientList,setClientList]=useState([])
 const [visits,setVisits]=useState([])
 const [opportunities,setOpportunities]=useState([])
 const [toast,setToast]=useState('')
 const [copilotOpen,setCopilotOpen]=useState(false)
 const [copilotLoaded,setCopilotLoaded]=useState(false)
 const [copilotReturnPage,setCopilotReturnPage]=useState('dashboard')
 const [copilotSeed,setCopilotSeed]=useState(null)
 const [copilotPageContext,setCopilotPageContext]=useState(null)
 const [agroLaunch,setAgroLaunch]=useState(createEmptyAgroLaunch)
 const copilotOwnerScope=currentUser?.storageScope||currentUser?.id||''
 const openClient=c=>{setSelected(c);setPage('client360');if(page==='client360')window.requestAnimationFrame(resetPageViewport)}
 const notify=message=>{const text=typeof message==='string'?message:String(message?.message||'Ação concluída.');setToast(text);window.clearTimeout(window.__valorToast);window.__valorToast=window.setTimeout(()=>setToast(''),2800)}
 const prepareClient=c=>{if(!c?.id)return;setSelected(c);setPrepareVisitClientId(c.id);setPage('visits');if(page==='visits')window.requestAnimationFrame(resetPageViewport)}
 const openValClient=c=>{setSelected(c);setValMode('insumos');setPage('val');if(page==='val')window.requestAnimationFrame(resetPageViewport)}
 const updateCopilotPageContext=useCallback(input=>setCopilotPageContext(input?{...input,storageScope:copilotOwnerScope}:null),[copilotOwnerScope])
 const consumeAgroInitialFile=useCallback(file=>setAgroLaunch(current=>{let removed=false;const initialFiles=current.initialFiles.filter(item=>{const candidate=item?.file||item;const match=candidate===file||(!removed&&candidate?.name===file?.name&&candidate?.type===file?.type&&Number(candidate?.size||0)===Number(file?.size||0));if(match&&!removed){removed=true;return false}return true});return initialFiles.length===current.initialFiles.length?current:{...current,initialFiles}}),[])
 const openCopilot=(input={})=>{const launch=resolveCopilotLaunch({input,implicitContext:copilotPageContext,page,storageScope:copilotOwnerScope,clients:clientList,selectedClient:selected});setCopilotSeed({...launch,nonce:Date.now()});if(page!=='copilot')setCopilotReturnPage(page);setCopilotLoaded(true);setCopilotOpen(true);setPage('copilot')}
 const closeCopilot=()=>{setCopilotOpen(false);setPage(copilotReturnPage&&copilotReturnPage!=='copilot'?copilotReturnPage:'dashboard')}
 const navigate=target=>{
  const descriptor=target&&typeof target==='object'?target:{page:target}
  const next=String(descriptor.page||'dashboard')
  if(next==='agro'){
   const context=descriptor.context&&typeof descriptor.context==='object'?descriptor.context:{}
   const requestedClientId=String(descriptor.clientId||context.clientId||'')
   const explicitClient=requestedClientId?clientList.find(item=>String(item.id)===requestedClientId)||null:null
   const inheritedClient=!requestedClientId&&page==='client360'&&selected?.id?clientList.find(item=>String(item.id)===String(selected.id))||null:null
   const agroClient=explicitClient||inheritedClient
   const entity=(value,id,label)=>value&&typeof value==='object'?value:id?{id,label:label||id}:null
   const nextContext=requestedClientId&&!explicitClient?{}:context
   setAgroLaunch({
    nonce:Date.now(),client:agroClient,context:nextContext,
    property:entity(descriptor.property,context.propertyId,context.propertyLabel),
    field:entity(descriptor.field,context.fieldId,context.fieldLabel),
    analysis:entity(descriptor.analysis,context.analysisId,context.analysisLabel),
    initialTool:descriptor.toolDescriptor||{
     id:String(descriptor.tool||descriptor.manualPage||context.tool||context.page||''),
     tool:String(descriptor.tool||context.tool||''),
     page:String(descriptor.manualPage||descriptor.pagePath||context.page||''),
     mode:String(descriptor.mode||context.mode||''),
     diagnosisMode:String(descriptor.diagnosisMode||context.diagnosisMode||''),
     calculator:String(descriptor.calculator||context.calculator||''),
     label:String(descriptor.label||context.label||'')
    },
    initialFiles:Array.isArray(descriptor.files)?descriptor.files.slice(0,3):[]
   })
    setSelected(agroClient||null)
  }else{
   setAgroLaunch(current=>current.initialFiles.length?{...current,initialFiles:[]}:current)
   if(next!=='client360'&&next!=='copilot')setSelected(null)
  }
  if(next!=='visits')setPrepareVisitClientId('')
  if(next==='val')setValMode(null)
  if(next!=='copilot')setCopilotOpen(false)
  setPage(next);if(next===page)window.requestAnimationFrame(resetPageViewport)
 }
 const workspaceContext=useMemo(()=>createValWorkspaceContext({
  module:page,
  client:selected,
  property:page==='agro'?agroLaunch.property:null,
  field:page==='agro'?agroLaunch.field:null,
  analysis:page==='agro'?agroLaunch.analysis:null,
  conversation:copilotSeed?.nonce?{id:String(copilotSeed.nonce),label:'Conversa VAL ativa'}:null
 }),[page,selected?.id,selected?.name,agroLaunch.property,agroLaunch.field,agroLaunch.analysis,copilotSeed?.nonce])
 const executeValWorkspaceAction=value=>{
  const action=validateValWorkspaceAction(value)
  if(!action){notify('A ação solicitada não pertence ao contrato operacional autorizado da VAL.');return {status:'DENIED'}}
  if(action.requiresConfirmation){notify('Revise e confirme a alteração no módulo canônico antes de persistir.');return {status:'CONFIRM_REQUIRED'}}
  const targetClient=action.clientId?clientList.find(item=>String(item.id)===String(action.clientId))||null:null
  if(action.clientId&&!targetClient){notify('O produtor solicitado não está disponível na carteira autorizada desta sessão.');return {status:'CLIENT_SCOPE_DENIED'}}
  setCopilotOpen(false)
  if(action.type==='OPEN_CLIENT'){openClient(targetClient);return {status:'COMPLETED'}}
  if(action.type==='PREPARE_VISIT'){prepareClient(targetClient);return {status:'COMPLETED'}}
  if(action.type==='NAVIGATE'&&action.page==='visits'&&targetClient){setSelected(targetClient);setPrepareVisitClientId(targetClient.id);setPage('visits');return {status:'COMPLETED'}}
  navigate({page:action.page,clientId:targetClient?.id||'',tool:action.tool,manualPage:action.manualPage,diagnosisMode:action.diagnosisMode,label:action.label,context:{clientId:targetClient?.id||'',tool:action.tool,page:action.manualPage,diagnosisMode:action.diagnosisMode,label:action.label}})
  return {status:'COMPLETED'}
 }
 const recordAgroHeroTelemetry=useCallback(event=>{
  try{window.dispatchEvent(new CustomEvent('valor360:agro-hero-telemetry',{detail:event}))}catch{}
  fetch('/api/usage/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'agro_hero_interaction',page:'agro',entityType:event?.clientContext?'client':'',entityId:event?.clientContext?agroLaunch.client?.id||'':'',metadata:{action:event?.action,status:event?.status,phase:event?.phase,errorCode:event?.errorCode,contextTypes:event?.contextTypes}}),signal:AbortSignal.timeout(5000)}).catch(()=>null)
 },[agroLaunch.client?.id])
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
 const startVisitResult=visit=>{if(!visit)return;setVisits(current=>[visit,...current.filter(item=>item.id!==visit.id)]);notify('Visita iniciada. A captura de campo está disponível.')}
 const registerVisitResult=visit=>{if(!visit)return;setVisits(current=>[visit,...current.filter(item=>item.id!==visit.id)]);notify('Visita registrada. Sua próxima preparação já foi atualizada.')}
 const saveOpportunity=async input=>{const response=await fetch('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar a oportunidade.');setOpportunities(current=>[payload.opportunity,...current.filter(item=>!(item.clientId===payload.opportunity.clientId&&item.candidateKey===payload.opportunity.candidateKey))]);return payload.opportunity}
 const refreshPortfolio=async()=>{const response=await fetch('/api/intelligence',{signal:AbortSignal.timeout(12000)});if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'A carteira protegida não pôde ser atualizada.');const serverClients=Array.isArray(payload.clients)?payload.clients:[];setClientList(serverClients);setVisits(Array.isArray(payload.visits)?payload.visits:[]);setOpportunities(Array.isArray(payload.opportunities)?payload.opportunities:[]);setSelected(current=>serverClients.find(item=>String(item.id)===String(current?.id))||serverClients[0]||null);return payload}
 const login=async credentials=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível autenticar.');rememberStorageScope(payload.user);setAuthNotice('');setCurrentUser(payload.user||null);setPortfolioReady(Boolean(payload.user?.demo));setAuthenticated(true);notify('Bem-vindo à VAL.')}
 const changePassword=async input=>{const response=await fetch('/api/auth/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}if(!response.ok)throw new Error(payload.error||'Não foi possível trocar a senha.');rememberStorageScope(payload.user);setCurrentUser(payload.user);setPortfolioReady(false);notify('Senha definida. Sua carteira já está pronta para ser preenchida.')}
 const logout=async()=>{try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setValMode(null);setAgroLaunch(createEmptyAgroLaunch());setAuthNotice('');setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}catch{notify('Não foi possível encerrar a sessão no servidor. Tente novamente.')}}
 const invalidateSession=notice=>{clearSessionPortfolioCache(currentUser?.storageScope);setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setValMode(null);setAgroLaunch(createEmptyAgroLaunch());setAuthNotice(notice);setCurrentUser(null);setPortfolioReady(false);setAuthenticated(false);setPage('dashboard')}
 const expireSession=()=>invalidateSession('Sua sessão expirou. Entre novamente.')
 useEffect(()=>{if(!selected&&clientList.length)setSelected(clientList[0])},[clientList,selected])
 useEffect(()=>{setCopilotPageContext(null);setCopilotSeed(null);setCopilotOpen(false);setCopilotLoaded(false);setAgroLaunch(createEmptyAgroLaunch())},[copilotOwnerScope])
 useEffect(()=>{fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(session?.authenticated)rememberStorageScope(session.user);else clearSessionPortfolioCache();setCurrentUser(session?.user||null);setPortfolioReady(Boolean(session?.user?.demo));setAuthenticated(Boolean(session?.authenticated));if(!session?.authenticated&&session?.misconfigured)setAuthNotice('O acesso seguro do servidor ainda não foi configurado.')}).catch(()=>{clearSessionPortfolioCache();setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setCurrentUser(null);setAuthNotice('Não foi possível validar o servidor. O acesso permaneceu bloqueado.');setPortfolioReady(false);setAuthenticated(false)})},[])
 useEffect(()=>{window.addEventListener('valor360:unauthorized',expireSession);return()=>window.removeEventListener('valor360:unauthorized',expireSession)},[currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true)return;const revalidate=()=>fetch('/api/auth/session',{signal:AbortSignal.timeout(8000)}).then(response=>response.ok?response.json():Promise.reject()).then(session=>{if(!session?.authenticated){expireSession();return}setCurrentUser(session.user);rememberStorageScope(session.user)}).catch(()=>invalidateSession('Não foi possível revalidar o servidor. Entre novamente para proteger os dados.'));window.addEventListener('focus',revalidate);const timer=window.setInterval(revalidate,300000);return()=>{window.removeEventListener('focus',revalidate);window.clearInterval(timer)}},[authenticated,currentUser?.storageScope])
 useEffect(()=>{if(authenticated!==true||currentUser?.mustChangePassword)return;clearLegacyPortfolioCache();fetch('/api/intelligence',{signal:AbortSignal.timeout(12000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));return null}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'A carteira protegida não pôde ser carregada.');return payload}).then(data=>{if(!data)return;const serverClients=Array.isArray(data.clients)?data.clients:[];setClientList(serverClients);setVisits(Array.isArray(data.visits)?data.visits:[]);setOpportunities(Array.isArray(data.opportunities)?data.opportunities:[]);setSelected(serverClients[0]||null);setPortfolioReady(true)}).catch(error=>{if(currentUser?.demo){setPortfolioReady(true);return}setClientList([]);setVisits([]);setOpportunities([]);setSelected(null);setPortfolioReady(true);notify(error.name==='TimeoutError'?'A carteira demorou além do limite e permaneceu bloqueada.':error.message)})},[authenticated,currentUser?.demo,currentUser?.mustChangePassword])
 useEffect(()=>{if(authenticated!==true)return;const frame=window.requestAnimationFrame(resetPageViewport);return()=>window.cancelAnimationFrame(frame)},[page,valMode,authenticated])
 useEffect(()=>{if(authenticated!==true)return;const keydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openCopilot()}};window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown)},[authenticated,page,selected?.id,clientList,copilotPageContext,copilotOwnerScope])
 useEffect(()=>{
  if(authenticated!==true||!portfolioReady||currentUser?.demo||!currentUser?.id)return
  const controller=new AbortController()
  fetch('/api/usage/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,entityType:selected&&page==='client360'?'client':'',entityId:selected&&page==='client360'?selected.id:''}),signal:controller.signal}).catch(()=>null)
  return()=>controller.abort()
 },[page,selected?.id,authenticated,portfolioReady,currentUser?.id,currentUser?.demo])
 const valMeta=valMode==='insumos'?['VAL Insumos','Inteligência comercial, técnica e consultiva para gerar valor']:valMode==='graos'?['VAL Grãos','Ambiente dedicado à originação e às operações de grãos']:meta.val
 const [title,subtitle]=page==='val'?valMeta:(meta[page]||['VAL',''])
 if(publicSurveyToken)return <Suspense fallback={<RouteFallback/>}><PublicSurvey token={publicSurveyToken}/></Suspense>
 if(authenticated===null)return <main className="auth-loading" role="status"><BrainCircuit/><span>Validando acesso seguro…</span></main>
 if(!authenticated)return <Login onLogin={login} notice={authNotice}/>
 if(currentUser?.mustChangePassword)return <PasswordChange user={currentUser} onChange={changePassword} onLogout={logout}/>
 if(!portfolioReady)return <main className="auth-loading" role="status"><BrainCircuit/><span>Carregando carteira protegida…</span></main>
 return <div className="app-shell">
  <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
  <Sidebar page={page} currentUser={currentUser} setPage={navigate} onOpenVal={()=>openCopilot()}/>
  <main className="main" id="main-content" tabIndex="-1">
   {page!=='copilot'&&<Topbar title={title} subtitle={subtitle} onNavigate={navigate} onOpenVal={()=>openCopilot()}/>}
   <div className={`content ${page==='copilot'?'content-copilot-fullscreen':''}`}>
    <Suspense fallback={<RouteFallback/>}>
    {page==='dashboard'&&<Dashboard clients={clientList} visits={visits} opportunities={opportunities} currentUser={currentUser} setPage={navigate} onClient={openClient} onPrepare={prepareClient} onRefreshPortfolio={refreshPortfolio} onOpenCopilot={openCopilot}/>}
    {page==='clients'&&<Clients clients={clientList} opportunities={opportunities} onClient={openClient} onNew={()=>navigate('questionnaire')}/>}
    {page==='datahub'&&<DataHub clients={clientList} onImport={importClients} onProfileImport={addClients} onUpdate={updateClient} onDelete={deleteClient} onNotify={notify}/>}
    {page==='client360'&&selected&&<Client360
     key={selected.id} client={selected} visits={visits} opportunities={opportunities}
     storageScope={currentUser?.storageScope} onBack={()=>navigate('clients')}
     onPrepare={()=>prepareClient(selected)} onUpdate={updateClient} onRefreshPortfolio={refreshPortfolio}
     onAsk={()=>openCopilot({client:selected})}
     onSaved={message=>notify(message||'Complemento técnico salvo na memória da VAL como entrada pendente de verificação.')}
    />}
    {page==='val'&&<ValWorkspace mode={valMode} onModeChange={setValMode} clients={clientList} selectedClient={selected} onSelect={openClient} onPrepareVisit={prepareClient}/>}
    {page==='agro'&&<Agro key={agroLaunch.nonce||'agro'} onAsk={openCopilot} onCapture={openCopilot} onTelemetry={recordAgroHeroTelemetry} onContextChange={updateCopilotPageContext} onInitialFileConsumed={consumeAgroInitialFile} client={agroLaunch.client} property={agroLaunch.property} field={agroLaunch.field} analysis={agroLaunch.analysis} context={agroLaunch.context} initialTool={agroLaunch.initialTool} initialFiles={agroLaunch.initialFiles}/>}
    {page==='questionnaire'&&<Questionnaire onCreate={addClient} onCreateMany={addClients} onOpen={openClient} onNotify={notify}/>}
    {page==='visits'&&<Visits clients={clientList} visits={visits} storageScope={currentUser?.storageScope} initialClientId={prepareVisitClientId} onInitialHandled={()=>setPrepareVisitClientId('')} onSave={saveVisit} onPrepare={openValClient} onAsk={openCopilot} onContextChange={updateCopilotPageContext} onStarted={startVisitResult} onRegistered={registerVisitResult}/>}
    {page==='opportunities'&&<Opportunities clients={clientList} storageScope={currentUser?.storageScope} persistedItems={opportunities} onPersist={saveOpportunity} onClient={openClient} onAsk={openCopilot} onContextChange={updateCopilotPageContext} onSaved={notify}/>}
    {page==='reports'&&<Reports clients={clientList} visits={visits}/>}
    {page==='settings'&&<Settings clients={clientList} visits={visits} opportunities={opportunities} currentUser={currentUser} onLogout={logout} onNotify={notify}/>}
    {page==='admin'&&currentUser?.role==='admin'&&<Admin currentUser={currentUser} onNotify={notify}/>}
    {copilotLoaded&&<GlobalValCopilot key={copilotOwnerScope||'session'}
     open={page==='copilot'&&copilotOpen} onClose={closeCopilot}
     clients={clientList} seed={copilotSeed} workspaceContext={workspaceContext} storageScope={currentUser?.storageScope}
     visits={visits} opportunities={opportunities} onRefreshPortfolio={refreshPortfolio}
     onOpenClient={openClient} onPrepareVisit={prepareClient} onNavigate={navigate} onWorkspaceAction={executeValWorkspaceAction}
    />}
    </Suspense>
   </div>
  </main>
  {page!=='copilot'&&<MobileNav page={page} setPage={navigate} currentUser={currentUser} onOpenVal={()=>openCopilot()}/>}
  {toast&&<div className="toast" role="status">{toast}</div>}
 </div>
}
