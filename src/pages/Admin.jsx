import React,{useEffect,useMemo,useState} from 'react'
import {
 Activity,BarChart3,BrainCircuit,Cloud,Database,LoaderCircle,MousePointerClick,
 RefreshCw,ShieldCheck,Users,UsersRound
} from 'lucide-react'
import AccessManagement from '../components/AccessManagement'

const pageLabels={dashboard:'Hoje',clients:'Clientes',client360:'Cliente 360',datahub:'Base Inteligente',visits:'Visitas',opportunities:'Oportunidades',val:'VAL',agro:'Inteligência Agronômica',questionnaire:'Produtor 360',reports:'Relatórios',settings:'Configurações',admin:'Administração'}
const date=value=>{if(!value)return 'Nunca';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Nunca':parsed.toLocaleString('pt-BR')}

function SummaryCard({icon:Icon,label,value,detail,tone=''}){return <article className={`admin-summary-card ${tone}`}><span><Icon/></span><div><small>{label}</small><b>{Number(value||0).toLocaleString('pt-BR')}</b><em>{detail}</em></div></article>}

export default function Admin({currentUser,onNotify}){
 const [days,setDays]=useState(30)
 const [state,setState]=useState({loading:true,data:null,error:''})
 const load=()=>{
  setState(current=>({...current,loading:true,error:''}))
  fetch(`/api/admin/metrics?days=${days}`,{signal:AbortSignal.timeout(12000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível carregar as métricas.');return payload}).then(data=>setState({loading:false,data,error:''})).catch(error=>setState(current=>({...current,loading:false,error:error.name==='TimeoutError'?'As métricas demoraram além do limite.':error.message})))
 }
 useEffect(()=>{if(currentUser?.role==='admin')load()},[currentUser?.role,days])
 const summary=state.data?.summary||{}
 const daily=state.data?.daily||[]
 const maximum=useMemo(()=>Math.max(...daily.map(item=>Number(item.accesses||0)+Number(item.pageViews||0)+Number(item.interactions||0)+Number(item.valAnalyses||0)),1),[daily])
 const pages=state.data?.pages||[];const pageMaximum=Math.max(...pages.map(item=>Number(item.views||0)),1)
 if(currentUser?.role!=='admin')return <section className="panel admin-denied"><ShieldCheck/><h2>Área restrita</h2><p>Somente a administração pode visualizar métricas globais e gerenciar acessos.</p></section>
 return <div className="page-stack administration-page">
  <section className="module-hero administration-hero"><div><span className="eyebrow">ACESSO EXCLUSIVO</span><h2>Administração do VALOR 360</h2><p>Uso, interação, carteiras e liberações consolidados sem expor dados entre consultores.</p></div><span className="environment-badge is-ready"><Cloud/><i/>PostgreSQL por login</span></section>
  <section className="administration-metrics" aria-labelledby="administration-metrics-title">
   <header><div><span className="admin-section-icon"><Activity/></span><div><small>OPERAÇÃO DO SISTEMA</small><h3 id="administration-metrics-title">Acessos e interações</h3><p>Período móvel, com eventos novos e registros comerciais já persistidos.</p></div></div><div><select value={days} onChange={event=>setDays(Number(event.target.value))} aria-label="Período das métricas"><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select><button type="button" onClick={load} disabled={state.loading}>{state.loading?<LoaderCircle className="val-spinner"/>:<RefreshCw/>}Atualizar</button></div></header>
   {state.error&&<div className="form-error" role="alert">{state.error}</div>}
   <div className="admin-summary-grid">
    <SummaryCard icon={UsersRound} label="Usuários liberados" value={summary.users_active} detail={`${summary.users_blocked||0} bloqueado(s)`}/>
    <SummaryCard icon={Users} label="Usuários ativos no período" value={summary.active_users_period} detail={`de ${summary.users_total||0} acessos cadastrados`}/>
    <SummaryCard icon={MousePointerClick} label="Acessos registrados" value={summary.accesses} detail={`${summary.page_views||0} visualizações de módulos`} tone="is-blue"/>
    <SummaryCard icon={Activity} label="Ações rastreadas" value={summary.direct_interactions} detail="cadastros, memórias e retornos"/>
    <SummaryCard icon={BrainCircuit} label="Análises da VAL" value={summary.val_analyses} detail={`${summary.val_feedback||0} retorno(s) de uso`} tone="is-lime"/>
    <SummaryCard icon={Database} label="Produtores em nuvem" value={summary.producers} detail={`${summary.manual_syncs||0} sincronização(ões) do Manual`}/>
    <SummaryCard icon={BarChart3} label="Visitas registradas" value={summary.visits} detail="no período selecionado"/>
    <SummaryCard icon={BarChart3} label="Oportunidades movimentadas" value={summary.opportunities} detail="no período selecionado"/>
   </div>
   <div className="admin-chart-grid">
    <article className="admin-chart-card"><header><div><small>TENDÊNCIA DIÁRIA</small><h4>Uso e inteligência</h4></div><span>{days} dias</span></header>{state.loading&&!daily.length?<div className="access-loading"><LoaderCircle className="val-spinner"/>Consolidando…</div>:<div className="admin-daily-chart">{daily.map(item=>{const total=Number(item.accesses||0)+Number(item.pageViews||0)+Number(item.interactions||0)+Number(item.valAnalyses||0);return <div key={item.day} title={`${item.day}: ${total} eventos`}><i style={{height:`${Math.max(total?5:1,total/maximum*100)}%`}}><em style={{height:`${total?Number(item.valAnalyses||0)/total*100:0}%`}}/></i><span>{String(item.day).slice(8)}</span></div>})}</div>}</article>
    <article className="admin-chart-card"><header><div><small>MÓDULOS MAIS ACESSADOS</small><h4>Distribuição das visualizações</h4></div></header>{pages.length?<div className="admin-page-ranking">{pages.map(item=><div key={item.page}><span><b>{pageLabels[item.page]||item.page}</b><small>{item.views} visualizações • {item.users} usuário(s)</small></span><i><em style={{width:`${Math.max(4,item.views/pageMaximum*100)}%`}}/></i></div>)}</div>:<div className="business-chart-empty"><MousePointerClick/><span>As visualizações começarão a compor este gráfico após o deploy.</span></div>}</article>
   </div>
   <article className="admin-user-metrics"><header><div><small>USO POR LOGIN</small><h4>Carteira e atividade individual</h4></div><span>Dados isolados; apenas totais administrativos</span></header><div className="admin-user-table" role="table" aria-label="Métricas por usuário"><div role="row" className="admin-user-table-head"><span>Usuário</span><span>Produtores</span><span>Acessos</span><span>Páginas</span><span>VAL</span><span>Interações</span><span>Última atividade</span></div>{(state.data?.users||[]).map(user=><div role="row" key={user.id}><span><b>{user.name}</b><small>{user.email} • {user.role}</small></span><span>{user.producerCount}</span><span>{user.accesses}</span><span>{user.pageViews}</span><span>{user.valAnalyses}</span><span>{Number(user.directInteractions||0)}</span><span>{date(user.lastActivityAt||user.lastLoginAt)}</span></div>)}</div></article>
  </section>
  <AccessManagement currentUser={currentUser} onNotify={onNotify}/>
 </div>
}
