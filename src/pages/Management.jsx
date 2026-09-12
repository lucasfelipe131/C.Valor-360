import React,{useEffect,useMemo,useState} from 'react'
import {BarChart3,CalendarCheck2,Download,FileText,LogOut,MapPin,RefreshCw,Route,ShieldCheck,Users} from 'lucide-react'
import {fetchJsonResource} from '../hooks/useAsyncResource'
import {managementCsv,managementStatusLabels} from '../lib/management-data'
import '../val-management.css'

const format=value=>value==null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})
const date=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Não informado'
const initialFilters=()=>{const end=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());const start=new Date(`${end}T12:00:00Z`);start.setUTCDate(start.getUTCDate()-29);return {start:start.toISOString().slice(0,10),end,consultantId:'',municipality:'',status:''}}
const exports={
 producers:[['unitId','Unidade'],['id','Produtor ID'],['name','Produtor'],['consultantId','Consultor ID'],['consultant','Consultor'],['municipality','Município'],['areaHa','Área (ha)'],['cultures','Culturas'],['updatedAt','Atualizado em'],['dataStatus','Origem']],
 visits:[['unitId','Unidade'],['id','Visita ID'],['clientId','Produtor ID'],['producer','Produtor'],['consultantId','Consultor ID'],['consultant','Consultor'],['scheduledAt','Agendada'],['occurredAt','Realizada'],['lifecycleStatus','Situação'],['objective','Objetivo'],['reportId','Relatório ID'],['reportSummary','Relato confirmado'],['reportNotes','Notas do consultor'],['reportConfirmedAt','Confirmado em'],['dataStatus','Origem']],
 routes:[['unitId','Unidade'],['consultantId','Consultor ID'],['consultant','Consultor'],['date','Data'],['distanceKm','Distância GPS (km)'],['recordedSeconds','Tempo com GPS (s)'],['segments','Trechos GPS'],['timeZone','Fuso'],['dataStatus','Origem']]
}

export default function Management({currentUser,standalone=false,onLogout,onConfigure}){
 const [filters,setFilters]=useState(initialFilters)
 const [draft,setDraft]=useState(filters)
 const [tab,setTab]=useState('visits')
 const [retry,setRetry]=useState(0)
 const [state,setState]=useState({key:null,data:null,error:''})
 const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value)).toString()
 const key=`${currentUser?.storageScope||currentUser?.id}:${params}:${retry}`
 const allowed=['admin','manager','bi_viewer'].includes(currentUser?.role)&&!currentUser?.demo
 const loading=allowed&&state.key!==key
 const data=state.key===key?state.data:null
 const error=state.key===key?state.error:''
 useEffect(()=>{
  if(!allowed)return
  const controller=new AbortController();let active=true
  fetchJsonResource(`/api/management/overview?${params}`,{signal:controller.signal,timeoutMs:20000,fallbackMessage:'Não foi possível carregar a visão gerencial.'}).then(payload=>{if(active)setState({key,data:payload,error:''})}).catch(exception=>{if(active&&exception.name!=='AbortError')setState({key,data:null,error:exception.message})})
  return()=>{active=false;controller.abort()}
 },[key,allowed,params])
 const producers=data?.producers||[],visits=data?.visits||[],routes=data?.routes||[],team=data?.team||[]
 const producerById=useMemo(()=>new Map(producers.map(item=>[item.id,item])),[producers])
 const memberName=id=>team.find(member=>member.id===id)?.name||'Consultor não informado'
 const rankings=team.map(member=>({...member,count:visits.filter(visit=>visit.consultantId===member.id&&visit.lifecycleStatus==='COMPLETED').length})).sort((a,b)=>b.count-a.count)
 const maxCount=Math.max(1,...rankings.map(member=>member.count))
 const download=kind=>{
  const source=kind==='producers'?producers:kind==='routes'?routes:kind==='reports'?visits.filter(visit=>visit.report):visits
  const rows=source.map(item=>({...item,unitId:data.unit.id,consultant:memberName(item.consultantId),producer:producerById.get(item.clientId)?.name||'',reportId:item.report?.id||null,reportSummary:item.report?.summary||null,reportNotes:item.report?.notes||null,reportConfirmedAt:item.report?.confirmedAt||null}))
  const blob=new Blob([managementCsv(exports[kind==='reports'?'visits':kind].map(([key,label])=>({key,label})),rows)],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`val-${kind}-${filters.start}-${filters.end}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 if(!allowed)return <div className="mg-empty"><ShieldCheck/><h2>Acesso gerencial restrito</h2><p>Solicite ao administrador o perfil e o vínculo com sua unidade.</p></div>
 return <div className={`mg-page${standalone?' mg-standalone':''}`}>
  <header className="mg-header"><div className="mg-brand">VAL <span>GESTÃO</span></div><div className="mg-header-account"><span><ShieldCheck size={15}/>Somente consulta</span>{standalone&&<button className="mg-button" onClick={onLogout}><LogOut size={17}/>Sair</button>}</div></header>
  <section className="mg-title"><div><span className="mg-eyebrow">INTELIGÊNCIA DA UNIDADE</span><h1>Uma visão da equipe em campo.</h1><p>Visitas, carteira e deslocamentos para acompanhar a execução e planejar metas.</p></div><span className="mg-unit"><MapPin size={18}/>{data?.unit?.name||'Sua unidade'}</span></section>
  <form className="mg-filters" onSubmit={event=>{event.preventDefault();setFilters({...draft});setRetry(value=>value+1)}}>
   <label>De<input type="date" required value={draft.start} max={draft.end} onChange={event=>setDraft(value=>({...value,start:event.target.value}))}/></label>
   <label>Até<input type="date" required value={draft.end} min={draft.start} onChange={event=>setDraft(value=>({...value,end:event.target.value}))}/></label>
   <label>Consultor<select value={draft.consultantId} onChange={event=>setDraft(value=>({...value,consultantId:event.target.value}))}><option value="">Toda a unidade</option>{team.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
   <label>Município<input placeholder="Nome como no cadastro" value={draft.municipality} maxLength={140} onChange={event=>setDraft(value=>({...value,municipality:event.target.value}))}/></label>
   <label>Situação<select value={draft.status} onChange={event=>setDraft(value=>({...value,status:event.target.value}))}><option value="">Todas as visitas</option>{Object.entries(managementStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <button className="mg-button mg-primary" disabled={loading}><RefreshCw size={16}/>Aplicar</button>
  </form>
  {loading?<div className="mg-skeleton" role="status" aria-label="Carregando indicadores gerenciais">{[1,2,3,4].map(item=><i key={item}/>)}</div>:error?<div className="mg-empty" role="alert"><h2>A consulta não foi concluída</h2><p>{error}</p><button className="mg-button" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></div>:data&&!data.configured?<div className="mg-empty"><ShieldCheck size={32}/><h2>Vincule este acesso a uma unidade</h2><p>O administrador precisa cadastrar a unidade e vincular os consultores e o gestor. Assim, cada gestor consulta apenas a equipe da própria unidade.</p>{currentUser.role==='admin'&&onConfigure&&<button className="mg-button mg-primary" onClick={onConfigure}>Configurar unidade</button>}</div>:data?.configured&&<>
   <div className="mg-cards">{[
    {icon:CalendarCheck2,label:'Visitas realizadas',value:data.summary.completed,hint:`${data.summary.visits} visitas no período filtrado`},
    {icon:Users,label:'Produtores atendidos',value:data.summary.reached,hint:`${data.summary.producers} produtores na carteira filtrada`},
    {icon:Route,label:'Deslocamento com GPS',value:format(data.summary.recordedKm),suffix:'km',hint:data.summary.recordedKm==null?'Nenhum percurso com GPS disponível':`${data.summary.recordedDays} registros diários com GPS`},
    {icon:FileText,label:'Relatos confirmados',value:data.summary.reports,hint:`${data.summary.pending} visitas aguardando revisão`}
   ].map(({icon:Icon,label,value,hint,suffix})=><article key={label}><span className="mg-card-icon"><Icon size={22}/></span><span>{label}</span><strong>{value}{suffix&&value!=='—'&&<small> {suffix}</small>}</strong><p>{hint}</p></article>)}</div>
   <div className="mg-overview"><section className="mg-panel"><div className="mg-panel-title"><div><span className="mg-eyebrow">EXECUÇÃO</span><h2>Visitas realizadas por consultor</h2></div><BarChart3 size={22}/></div>{data.summary.completed?<div className="mg-bars">{rankings.filter(member=>member.count).map(member=><div key={member.id}><span>{member.name}</span><div><i style={{width:`${member.count/maxCount*100}%`}}/></div><b>{member.count}</b></div>)}</div>:<p className="mg-muted">Nenhuma visita realizada neste período e filtro.</p>}</section><section className="mg-panel mg-method"><span className="mg-eyebrow">COMO LER OS INDICADORES</span><h2>Dados registrados. Origem clara.</h2><p>Carteira atual da unidade. Relatos aparecem após confirmação do consultor. Dados demonstrativos ficam fora dos indicadores.</p><p>GPS considera período e consultor; não é atribuído ao município ou à situação da visita. Intervalos sem sinal não viram quilômetros percorridos.</p><small>Período das visitas: horário de Brasília. Atualizado em {date(data.generatedAt)}.</small></section></div>
   <section className="mg-panel"><div className="mg-panel-title"><div><span className="mg-eyebrow">BASE GERENCIAL</span><h2>Explore os registros</h2></div><button className="mg-button" onClick={()=>download(tab)}><Download size={17}/>Exportar CSV</button></div>
    <div className="mg-tabs" role="tablist" aria-label="Dados gerenciais">{[['visits','Visitas'],['routes','Deslocamentos'],['producers','Produtores'],['reports','Relatórios de visitas']].map(([id,label])=><button id={`mg-tab-${id}`} key={id} role="tab" aria-selected={tab===id} aria-controls="mg-data" onClick={()=>setTab(id)}>{label}</button>)}</div>
    <div id="mg-data" role="tabpanel" aria-labelledby={`mg-tab-${tab}`}>
     {tab==='visits'&&<div className="mg-table-wrap"><table><thead><tr><th>Produtor / objetivo</th><th>Consultor</th><th>Data</th><th>Situação</th><th>Relato</th></tr></thead><tbody>{visits.map(visit=><tr key={visit.id}><td><strong>{producerById.get(visit.clientId)?.name||'Não informado'}</strong><small>{visit.objective||'Objetivo não informado'}</small></td><td>{memberName(visit.consultantId)}</td><td>{date(visit.occurredAt||visit.scheduledAt)}</td><td><span className="mg-pill">{managementStatusLabels[visit.lifecycleStatus]}</span></td><td>{visit.report?'Confirmado':'Sem relato confirmado'}</td></tr>)}</tbody></table>{!visits.length&&<p className="mg-muted">Nenhuma visita neste período e filtro.</p>}</div>}
     {tab==='producers'&&<div className="mg-table-wrap"><table><thead><tr><th>Produtor</th><th>Consultor</th><th>Município</th><th>Área cadastrada (ha)</th><th>Culturas</th></tr></thead><tbody>{producers.map(producer=><tr key={producer.id}><td><strong>{producer.name}</strong></td><td>{memberName(producer.consultantId)}</td><td>{producer.municipality||'Não informado'}</td><td>{format(producer.areaHa)}</td><td>{producer.cultures||'Não informado'}</td></tr>)}</tbody></table>{!producers.length&&<p className="mg-muted">Nenhum produtor neste filtro da unidade.</p>}</div>}
     {tab==='routes'&&<><p className="mg-muted">Somente período e consultor. Tempo com GPS representa trechos registrados; não é jornada de trabalho nem tempo de visita.</p><div className="mg-table-wrap"><table><thead><tr><th>Consultor</th><th>Dia</th><th>Distância (km)</th><th>Tempo com GPS (min)</th><th>Origem</th></tr></thead><tbody>{routes.map(route=><tr key={`${route.consultantId}:${route.date}`}><td>{memberName(route.consultantId)}</td><td>{route.date.split('-').reverse().join('/')}</td><td>{format(route.distanceKm)}</td><td>{format(route.recordedSeconds==null?null:route.recordedSeconds/60)}</td><td>{route.dataStatus==='MISSING'?'Sem percurso válido':'Calculado a partir do GPS'}</td></tr>)}</tbody></table>{!routes.length&&<p className="mg-muted">Nenhum percurso registrado neste período.</p>}</div></>}
     {tab==='reports'&&<div className="mg-reports">{visits.filter(visit=>visit.report).map(visit=><details key={visit.report.id}><summary><FileText size={20}/><span><strong>{producerById.get(visit.clientId)?.name||'Não informado'}</strong><small>{memberName(visit.consultantId)} · Confirmado em {date(visit.report.confirmedAt)}</small></span><span className="mg-pill">Confirmado</span></summary><div><h3>Relato da visita</h3><p>{visit.report.summary}</p>{visit.report.notes&&<><h3>Notas do consultor</h3><p>{visit.report.notes}</p></>}</div></details>)}{!visits.some(visit=>visit.report)&&<p className="mg-muted">Nenhum relatório confirmado neste período e filtro.</p>}</div>}
    </div><p className="mg-export-note">CSV em UTF-8 para importar no Power BI. IDs de produtor e consultor permitem relacionar as bases. A conexão direta ao Power BI ainda não está configurada.</p>
   </section>
  </>}
 </div>
}
