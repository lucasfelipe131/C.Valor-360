import React,{useEffect,useState} from 'react'
import {
 BrainCircuit,CheckCircle2,Database,Download,KeyRound,Layers3,LoaderCircle,
 LogOut,RefreshCw,Server,ShieldCheck,Trash2,UserCog,Zap
} from 'lucide-react'
import {opportunityCacheKey,parseOpportunityCache,reconcilePipeline} from '../lib/opportunity-pipeline'
import AccessManagement from '../components/AccessManagement'

function displayValue(value,fallback='Não informado'){
 if(value===null||value===undefined||value==='')return fallback
 if(typeof value==='boolean')return value?'Ativo':'Pendente'
 if(typeof value==='string'||typeof value==='number')return String(value)
 if(Array.isArray(value))return value.length?value.join(' • '):fallback
 if(typeof value==='object'){
  const preferred=[value.label,value.name,value.provider,value.type,value.mode,value.status,value.connected===true?'Conectado':''].filter(Boolean)
  if(preferred.length)return preferred.join(' • ')
  const count=value.documents??value.records??value.items??value.files??value.chunks
  if(count!==undefined)return `${count} itens indexados`
 }
 return fallback
}

function modelEntries(models){
 if(!models)return []
 if(typeof models==='string')return [{label:'Modelo ativo',value:models}]
 if(Array.isArray(models))return models.map((value,index)=>({label:`Modelo ${index+1}`,value:displayValue(value)}))
 return Object.entries(models).map(([key,value])=>({
  label:key==='daily'?'Modo diário':key==='strategic'?'Modo estratégico':key==='fast'?'Alto volume':key.replace(/_/g,' '),
  value:displayValue(value)
 }))
}

function engineModeLabel(value){
 if(value==='openai')return 'OpenAI ativa'
 if(value==='locked')return 'Aguardando segurança/banco'
 if(value==='demonstration')return 'Modo demonstrativo'
 return displayValue(value,'Modo resiliente')
}

function databaseState(value,error){
 if(error)return {label:'Indisponível',detail:'Não foi possível consultar o armazenamento.',ready:false}
 if(!value?.configured)return {label:'Modo demonstrativo',detail:'PostgreSQL ainda não está configurado.',ready:false}
 if(value.ready)return {label:'PostgreSQL ativo',detail:'Memória persistente conectada.',ready:true}
 return {label:'PostgreSQL indisponível',detail:value.error||'Revise a conexão do banco.',ready:false}
}

export default function Settings({clients,visits,currentUser,onLogout,onNotify}){
 const [valStatus,setValStatus]=useState({loading:true,data:null,error:''})
 const scopedOpportunityKey=opportunityCacheKey(currentUser?.storageScope)

 const loadValStatus=()=>{
  setValStatus(current=>({...current,loading:true,error:''}))
  fetch('/api/val/status',{signal:AbortSignal.timeout(8000)})
   .then(async response=>{
    if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
    if(!response.ok)throw new Error('A engine não respondeu ao diagnóstico.')
    return response.json()
   })
   .then(data=>setValStatus({loading:false,data,error:''}))
   .catch(error=>setValStatus({loading:false,data:null,error:error.message}))
 }

 useEffect(()=>{loadValStatus()},[])

 const backup=()=>{
  const cached=scopedOpportunityKey?parseOpportunityCache(localStorage.getItem(scopedOpportunityKey)):[]
  const payload={version:'0.4.0',exportedAt:new Date().toISOString(),clients,visits,opportunities:reconcilePipeline(clients,cached)}
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='valor360-backup.json';a.click();URL.revokeObjectURL(url);onNotify?.('Backup do piloto gerado com sucesso.')
 }
 const clear=()=>{if(window.confirm('Limpar rascunhos e dados locais deste dispositivo? Os registros do PostgreSQL não serão apagados.')){for(const key of ['valor360-clients','valor360-visits','valor360-opportunities',scopedOpportunityKey])if(key)localStorage.removeItem(key);Object.keys(localStorage).filter(key=>key.startsWith('valor360-tech-')||key.startsWith('valor360-client-context:')).forEach(key=>localStorage.removeItem(key));Object.keys(sessionStorage).filter(key=>key.startsWith('valor360-tech-')).forEach(key=>sessionStorage.removeItem(key));window.location.reload()}}

 const statusKnown=Boolean(valStatus.data)&&!valStatus.error
 const keyConfigured=statusKnown?Boolean(valStatus.data?.keyConfigured??valStatus.data?.aiConfigured):null
 const securityReady=statusKnown?Boolean(valStatus.data?.securityReady??valStatus.data?.securityConfigured):null
 const configured=statusKnown?Boolean(valStatus.data?.configured):false
 const models=modelEntries(valStatus.data?.models)
 const database=databaseState(valStatus.data?.database,valStatus.error)
 const environmentReady=configured&&database.ready
 const aiPrerequisitesReady=keyConfigured&&securityReady
 const knowledge=!statusKnown?'Estado desconhecido':valStatus.data?.knowledgeBase?'ID da base cadastrado':'Não sincronizada'
 const accountLabel=currentUser?.email||'Ambiente de demonstração'
 const accountInitials=currentUser?.email?currentUser.email.split('@')[0].split(/[._-]/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'VA'
 const callout=!statusKnown?{title:'O estado da chave não pôde ser confirmado.',text:'Não altere segredos com base neste diagnóstico; restabeleça o servidor e verifique novamente.',ready:false,unknown:true}:!keyConfigured?{title:'Adicione OPENAI_API_KEY no ambiente seguro do servidor.',text:'Não cole a chave em campos da aplicação ou no frontend. Configure primeiro o banco e o acesso do piloto.',ready:false}:!securityReady?{title:'A chave foi cadastrada; falta proteger o acesso.',text:'Configure VAL_ADMIN_EMAIL, VAL_ADMIN_PASSWORD e VAL_SESSION_SECRET antes de liberar chamadas à IA.',ready:false}:{title:'Chave cadastrada no servidor.',text:'O segredo nunca é enviado ao navegador. A validade e a cota são confirmadas na primeira chamada real.',ready:true}

 return <div className="page-stack settings-page">
  <section className="module-hero settings-hero"><div><span className="eyebrow">CONTROLE DA INTELIGÊNCIA</span><h2>Configurações e governança</h2><p>Saúde da VAL, proteção do conhecimento comercial e controle dos dados da operação.</p></div><span className={`environment-badge ${environmentReady?'is-ready':''}`} role="status"><i/>{valStatus.loading?'Verificando ambiente':!statusKnown?'Estado indisponível':environmentReady?'Ambiente persistente pronto':aiPrerequisitesReady?'IA protegida • banco pendente':'Configuração pendente'}</span></section>

  <section className="val-engine-panel" aria-labelledby="val-engine-title">
   <div className="val-engine-head">
    <div><span className="val-engine-mark"><BrainCircuit/></span><div><span>ENGINE DA VAL</span><h3 id="val-engine-title">Inteligência conectada ao negócio</h3><p>O painel verifica IA, armazenamento e base de conhecimento sem expor credenciais no navegador.</p></div></div>
    <button type="button" onClick={loadValStatus} disabled={valStatus.loading} aria-label="Verificar agora o estado da engine da VAL">{valStatus.loading?<LoaderCircle className="val-spinner"/>:<RefreshCw/>}<span>Verificar agora</span></button>
   </div>

   {valStatus.error&&<div className="val-engine-alert" role="alert"><ShieldCheck/><div><b>Diagnóstico temporariamente indisponível</b><span>{valStatus.error} Não use este painel para concluir que uma configuração está ausente.</span></div></div>}

   <div className="val-engine-metrics">
    <article><span className="val-engine-metric-icon"><KeyRound/></span><div><small>OPENAI</small><b>{valStatus.loading?'Verificando…':keyConfigured===null?'Estado desconhecido':keyConfigured?'Chave cadastrada':'Aguardando chave'}</b><span>{keyConfigured===null?'Consulte novamente quando o servidor responder':keyConfigured?'Mantida somente no servidor':'Necessária para respostas generativas'}</span></div></article>
    <article><span className="val-engine-metric-icon"><Zap/></span><div><small>EXECUÇÃO</small><b>{valStatus.loading?'Verificando…':statusKnown?engineModeLabel(valStatus.data?.mode):'Estado desconhecido'}</b><span>{statusKnown?'Roteamento diário, estratégico e de alto volume definido pela engine':'Disponibilidade ainda não confirmada'}</span></div></article>
    <article><span className="val-engine-metric-icon"><Database/></span><div><small>BANCO DE DADOS</small><b>{valStatus.loading?'Verificando…':database.label}</b><span>{valStatus.loading?'Consultando conexão e persistência…':database.detail}</span></div></article>
    <article><span className="val-engine-metric-icon"><Layers3/></span><div><small>CONHECIMENTO</small><b>{valStatus.loading?'Verificando…':knowledge}</b><span>O acesso é confirmado durante cada consulta</span></div></article>
   </div>

   <div className="val-engine-config">
    <div className={`val-key-callout ${callout.ready?'is-ready':''}`}><span><KeyRound/></span><div><small>{callout.ready?'SEGREDO NO SERVIDOR':callout.unknown?'DIAGNÓSTICO INDISPONÍVEL':'AÇÃO NECESSÁRIA'}</small><b>{callout.title}</b><p>{callout.text} {!callout.unknown&&'Depois de configurar, use “Verificar agora”.'}</p></div>{callout.ready&&<CheckCircle2/>}</div>
    <div className="val-models"><div><Server/><span><small>ROTEAMENTO DE MODELOS</small><b>{!statusKnown?'Estado desconhecido':models.length?'Modelos definidos pela engine':'Aguardando configuração da engine'}</b></span></div>{statusKnown&&models.length>0&&<ul>{models.map(model=><li key={`${model.label}-${model.value}`}><span>{model.label}</span><b>{model.value}</b></li>)}</ul>}</div>
   </div>
  </section>

  <AccessManagement currentUser={currentUser} onNotify={onNotify}/>

  <section className="settings-grid">
   <article className="panel setting-card"><div className="setting-icon"><UserCog/></div><h3>Acesso atual</h3><div className="user-setting"><div className="user-avatar">{accountInitials}</div><div><b>{accountLabel}</b><span>{currentUser?.demo?'Modo demonstrativo sem credencial configurada':'Acesso protegido do piloto'}</span></div></div><button className="soft-btn danger-text" onClick={onLogout}><LogOut size={16}/>Encerrar sessão</button></article>
   <article className="panel setting-card"><div className="setting-icon green-icon"><Database/></div><h3>Dados da operação</h3><dl className="setting-list"><div><dt>Produtores</dt><dd>{clients.length}</dd></div><div><dt>Visitas</dt><dd>{visits.length}</dd></div><div><dt>Backup local</dt><dd>JSON não criptografado</dd></div></dl><button className="soft-btn" onClick={backup}><Download size={16}/>Baixar backup JSON</button></article>
   <article className="panel setting-card"><div className="setting-icon cyan-icon"><ShieldCheck/></div><h3>Governança da VAL</h3><ul className="guardrail-list"><li><CheckCircle2/>Premissas e confiança visíveis</li><li><CheckCircle2/>Evidências rastreáveis</li><li><CheckCircle2/>Decisão final do consultor</li><li><CheckCircle2/>Sem inventar dado agronômico</li></ul><span className="version-chip">VAL Engine • ambiente controlado</span></article>
  </section>

  <article className="panel admin-panel"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h3>Portabilidade e controle</h3><p>Exporte os dados antes de limpar este dispositivo. A remoção local não apaga registros mantidos no PostgreSQL ou por integrações corporativas.</p></div><div className="admin-actions"><button className="soft-btn danger-text" onClick={clear}><Trash2 size={16}/>Limpar dados locais</button></div></article>
 </div>
}
