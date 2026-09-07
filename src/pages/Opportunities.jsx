import React,{lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {ArrowRight,BarChart3,Calculator,CalendarDays,Check,ChevronRight,Coins,Download,FileText,LoaderCircle,MoreHorizontal,PanelRightOpen,Plus,RefreshCw,Search,Sparkles,Target,Trophy,X} from 'lucide-react'
import OpportunityEditor,{OpportunityDialog} from '../components/opportunities/OpportunityEditor'
import {buildOpportunityCopilotContext} from '../lib/copilot-context'
import {BUSINESS_TYPES,OPPORTUNITY_STAGES,buildOpportunityWorkspace,dayKey,dueInfo,filterOpportunities,money,opportunityCsv,opportunityMetrics,opportunityValue,scenarioResult,statusLabel} from '../lib/opportunity-workspace'
import '../val-producer360-premium.css'
import '../val-opportunities.css'

const GlobalValCopilot=lazy(()=>import('../components/GlobalValCopilot'))
const hints=['Necessidade e impacto','Solução e valor','Condições e compromisso','Resultado e acompanhamento']
const initials=name=>String(name||'Produtor').trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()
const timestamp=(value,timeZone)=>value&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('pt-BR',{timeZone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):''
const defaultFilters={search:'',season:'',crop:'',type:'',clientId:'',archived:false}
const guidance={Diagnóstico:'Confirme a necessidade e o impacto antes de construir a proposta.',Proposta:'Valide os critérios de decisão e apresente o valor da solução.',Negociação:'Confirme condições e prazo antes de registrar o compromisso.',Fechado:'Registre o resultado e combine o acompanhamento com o produtor.'}
class CopilotBoundary extends React.Component{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<div className="opp-empty"><p>Não foi possível abrir a VAL.</p><button className="opp-button" onClick={this.props.onClose}>Voltar à oportunidade</button></div>:this.props.children}
}
function OpportunityCard({item,selected,onSelect,onEdit,now,timeZone}){
 const due=dueInfo(item,now,timeZone),value=opportunityValue(item),status=statusLabel(item)
 return <article className={'opp-card'+(selected?' selected':'')}>
  <button className="opp-card-open" onClick={onSelect} aria-pressed={selected} aria-label={'Selecionar '+item.title+' — '+item.client.name}>
   <span className="opp-card-person"><span className="opp-avatar">{initials(item.client.name)}</span><span><strong>{item.client.name}</strong><span className="opp-card-title">{item.title}</span></span></span>
   <span className="opp-tags">{[item.crop,item.season,item.businessType].filter(Boolean).map((tag,index)=><span key={index}>{tag}</span>)}</span>
   <span className="opp-value-row"><strong className={value===null?'unknown':''}>{value===null?'Valor a estimar':money(value)}</strong>{status&&<span className={'opp-status '+item.status}>{status}</span>}</span>
   {item.volume!=null&&<span className="opp-volume">{Number(item.volume).toLocaleString('pt-BR')} {item.volumeUnit}</span>}
   <span className={'opp-next '+due.state}><CalendarDays size={15}/><span><small>PRÓXIMA AÇÃO</small><span>{item.nextAction||'Definir próxima ação'}</span></span>{item.nextActionAt&&<b>{due.label}</b>}</span>
  </button>
  <button className="opp-card-menu" aria-label={'Editar '+item.title+' — '+item.client.name} onClick={onEdit}><MoreHorizontal size={17}/></button>
 </article>
}
export default function Opportunities({clients=[],persistedItems=[],storageScope,currentUser={},onPersist,onClient,onAsk,onContextChange,onSaved,onRefreshPortfolio,visits=[],workspaceContext=null,onNavigate,onPrepare,externalCopilotSeed,loadError='',preview=false,initialSelection='',nowOverride=null}){
 const [filters,setFilters]=useState(defaultFilters),[view,setView]=useState('board'),[mobileStage,setMobileStage]=useState('Diagnóstico')
 const [selectedId,setSelectedId]=useState(initialSelection),[panelOpen,setPanelOpen]=useState(()=>typeof window==='undefined'||window.matchMedia('(min-width:1400px)').matches),[chatOpen,setChatOpen]=useState(false)
 const [editor,setEditor]=useState(null),[reports,setReports]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('')
 const [clock,setClock]=useState(()=>new Date()),[simulationOpen,setSimulationOpen]=useState(false),[roi,setRoi]=useState({area:'',investment:'',returnPerHa:''})
 const [chatSeed,setChatSeed]=useState(null),[reportFrom,setReportFrom]=useState(''),[reportTo,setReportTo]=useState('')
 const simulator=useRef(null)
 const now=nowOverride?new Date(nowOverride):clock,timeZone=currentUser.timeZone||'America/Sao_Paulo'
 useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),60000);return()=>clearInterval(timer)},[])
 const items=useMemo(()=>buildOpportunityWorkspace(clients,persistedItems),[clients,persistedItems])
 const filtered=useMemo(()=>filterOpportunities(items,filters).filter(x=>!filters.clientId||String(x.clientId)===filters.clientId),[items,filters])
 const selected=filtered.find(x=>x.id===selectedId)||null
 const metrics=opportunityMetrics(filtered,now,timeZone)
 const columns=OPPORTUNITY_STAGES.map(stage=>({stage,items:filtered.filter(x=>x.stage===stage)}))
 const options=key=>[...new Set(items.map(x=>x[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'))
 const context=useMemo(()=>selected?buildOpportunityCopilotContext({opportunity:{...selected,id:selected.databaseId||selected.candidateKey||selected.id},client:selected.client}):null,[selected])
 useEffect(()=>{onContextChange?.(context);return()=>onContextChange?.(null)},[context,onContextChange])
 useEffect(()=>{if(!selected){setChatOpen(false);if(selectedId)setSelectedId('')}},[selected,selectedId])
 useEffect(()=>{if(!onAsk&&externalCopilotSeed?.source==='opportunities'){setPanelOpen(true);if(selected)setChatOpen(true)}},[externalCopilotSeed?.nonce])
 const pick=item=>{setSelectedId(item.id);setPanelOpen(true);setChatOpen(false);setChatSeed(null)}
 const ask=()=>{if(selected){if(onAsk){onAsk({...context,client:selected.client});setPanelOpen(false);return}setChatSeed({...context,nonce:Date.now()});setChatOpen(true)}}
 const edit=(item=null,stage='Diagnóstico',mode='edit')=>setEditor({item,stage,mode,key:crypto.randomUUID()})
 const save=async input=>{
  if(typeof onPersist!=='function')throw new Error('A gravação está indisponível neste ambiente.')
  const saved=await onPersist(input)
  if(!saved?.clientId)throw new Error('O servidor não confirmou a gravação.')
  setSelectedId(saved.databaseId?'db:'+saved.databaseId:saved.clientId+':'+(saved.candidateKey||saved.id))
  setPanelOpen(true);setChatOpen(false);setMobileStage(saved.stage)
  onSaved?.('Oportunidade salva. Histórico e próximo compromisso atualizados.')
 }
 const refresh=async()=>{setRefreshing(true);setError('');try{if(!onRefreshPortfolio)throw new Error('Atualização indisponível.');await onRefreshPortfolio()}catch(e){setError(e.message||'Não foi possível atualizar a carteira.')}finally{setRefreshing(false)}}
 const simulate=()=>{setSimulationOpen(true);requestAnimationFrame(()=>simulator.current?.scrollIntoView({behavior:'smooth',block:'center'}))}
 const result=scenarioResult(roi)
 const reportItems=filtered.filter(item=>{if(!reportFrom&&!reportTo)return true;const date=dayKey(item.updatedAt||item.createdAt,timeZone);return date&&(!reportFrom||date>=reportFrom)&&(!reportTo||date<=reportTo)})
 const downloadReport=()=>{
  const url=URL.createObjectURL(new Blob([opportunityCsv(reportItems,timeZone)],{type:'text/csv;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download='VAL-oportunidades-'+dayKey(now,timeZone)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 const setFilter=(key,value)=>setFilters(f=>({...f,[key]:value}))
 return <div className={'opp-page'+(!panelOpen?' panel-closed':'')+(chatOpen?' chat-active':'')}>
  <header className="opp-page-header">
   <div><div className="opp-breadcrumb">COMERCIAL <span>/</span> OPORTUNIDADES</div><div className="opp-heading"><h1>Oportunidades</h1>{preview&&<span className="opp-preview-label">PRÉVIA • DADOS FICTÍCIOS</span>}</div><p>Da necessidade ao compromisso com o produtor.</p></div>
   <div className="opp-header-actions"><button className="opp-button" onClick={()=>setReports(true)}><BarChart3 size={16}/>Relatórios</button><button className="opp-button primary" onClick={()=>edit()}><Plus size={18}/>Nova oportunidade</button></div>
  </header>
  {(loadError||error)&&<div className="opp-error" role="alert">{loadError||error}<button className="opp-button" disabled={refreshing} onClick={refresh}><RefreshCw size={15}/>Tentar novamente</button></div>}
  <div className="opp-workspace">
   <div className="opp-workarea">
    <div className="opp-kpis" aria-label="Indicadores da carteira">
     {[{label:'Oportunidades abertas',value:metrics.open,icon:FileText},{label:'Valor em aberto',value:money(metrics.openValue),icon:Coins,note:metrics.unknown?metrics.unknown+' negócio'+(metrics.unknown===1?'':'s')+' sem valor estimado':null},{label:'Ganhos no período',value:money(metrics.wonValue),icon:Trophy,note:metrics.wonUnknown?metrics.wonUnknown+' ganho(s) sem valor informado':null,title:'Negócios marcados como ganhos em '+metrics.month+' ('+timeZone+')'},{label:'Ações para hoje',value:metrics.due,icon:CalendarDays}].map(({label,value,icon:Icon,note,title})=><div className="opp-kpi" key={label} title={title}><span className="opp-kpi-icon"><Icon size={21}/></span><div><span>{label}</span><strong>{loadError?'—':value}</strong>{note&&<small>{note}</small>}</div></div>)}
    </div>
    <div className="opp-filters">
     <label className="opp-search"><Search size={17}/><input aria-label="Buscar produtor ou oportunidade" placeholder="Buscar produtor ou oportunidade" value={filters.search} onChange={e=>setFilter('search',e.target.value)}/></label>
     <select aria-label="Filtrar por safra" value={filters.season} onChange={e=>setFilter('season',e.target.value)}><option value="">Todas as safras</option>{options('season').map(s=><option key={s}>{s}</option>)}</select>
     <select aria-label="Filtrar por cultura" value={filters.crop} onChange={e=>setFilter('crop',e.target.value)}><option value="">Todas as culturas</option>{options('crop').map(s=><option key={s}>{s}</option>)}</select>
     <select aria-label="Filtrar carteira por produtor" value={filters.clientId} onChange={e=>setFilter('clientId',e.target.value)}><option value="">Minha carteira</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
     <div className="opp-view-switch" aria-label="Visualização"><button aria-pressed={view==='board'} onClick={()=>setView('board')}>Quadro</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}>Lista</button></div>
    </div>
    <div className="opp-filter-chips"><div>{['Todos',...BUSINESS_TYPES].map(type=><button key={type} aria-pressed={filters.type===(type==='Todos'?'':type)} onClick={()=>setFilter('type',type==='Todos'?'':type)}>{type}</button>)}</div><button className="opp-text-button" onClick={()=>setFilter('archived',!filters.archived)}>{filters.archived?'Voltar às oportunidades':'Ver perdas e arquivados'}<ArrowRight size={14}/></button></div>
    {filters.archived&&<p className="opp-notice">Perdas e arquivados da carteira. O histórico de cada negociação foi preservado.</p>}
    {view==='board'&&<>
     <label className="opp-mobile-stage">Etapa<select value={mobileStage} onChange={e=>setMobileStage(e.target.value)}>{columns.map(c=><option key={c.stage} value={c.stage}>{c.stage+' ('+c.items.length+')'}</option>)}</select></label>
     <div className="opp-board" aria-label="Fluxo de oportunidades">
      {columns.map((column,index)=>{
       const values=column.items.filter(x=>opportunityValue(x)!==null),total=values.reduce((s,x)=>s+x.value,0)
       return <section className={'opp-column stage-'+index+(mobileStage===column.stage?' mobile-active':'')} key={column.stage} aria-label={column.stage}>
        <header><div><i/><h2>{column.stage}</h2><span>{column.items.length}</span></div><p>{hints[index]}</p><strong>{column.items.length&&!values.length?'Valor a estimar':money(total)}</strong>{values.length>0&&values.length<column.items.length&&<small>{column.items.length-values.length} sem valor estimado</small>}</header>
        <div className="opp-column-cards">{column.items.map(item=><OpportunityCard key={item.id} item={item} selected={selected?.id===item.id} onSelect={()=>pick(item)} onEdit={()=>edit(item)} now={now} timeZone={timeZone}/>)}
         {!column.items.length&&<div className="opp-column-empty"><Target size={23}/><strong>{loadError?'Carteira indisponível':'Nenhuma oportunidade'}</strong><span>{loadError?'Tente atualizar a carteira.':items.length?'Ajuste os filtros ou adicione um negócio.':'Adicione uma oportunidade para começar.'}</span></div>}
         {column.stage==='Fechado'&&column.items.length>0&&<button className="opp-text-button opp-result-action" disabled={selected?.stage!=='Fechado'} title="Selecione um negócio fechado para registrar o resultado" onClick={()=>edit(selected)}><Trophy size={15}/>Registrar resultado</button>}
        </div>
        <button className="opp-add" onClick={()=>edit(null,column.stage)}><Plus size={15}/>Adicionar oportunidade</button>
       </section>
      })}
     </div>
    </>}
    {view==='list'&&<div className="opp-list" aria-label="Lista de oportunidades">
     {filtered.map(item=><div key={item.id} className="opp-list-row"><OpportunityCard item={item} selected={selected?.id===item.id} onSelect={()=>pick(item)} onEdit={()=>edit(item)} now={now} timeZone={timeZone}/><span className={'opp-list-stage stage-'+OPPORTUNITY_STAGES.indexOf(item.stage)}>{item.stage}</span><small>{currentUser.name||'Responsável da carteira'}</small></div>)}
     {!filtered.length&&<div className="opp-empty">Nenhuma oportunidade encontrada para os filtros selecionados.</div>}
    </div>}
    <div className="opp-board-footer"><button className="opp-text-button" disabled={refreshing} onClick={refresh}><RefreshCw size={13} className={refreshing?'is-spinning':''}/>{refreshing?'Atualizando…':'Atualizar carteira'}</button>{!panelOpen&&<button className="opp-text-button" onClick={()=>setPanelOpen(true)}><PanelRightOpen size={15}/>Abrir VAL Copiloto</button>}</div>
   </div>
   {panelOpen&&<aside className={'opp-copilot'+(selected?' has-selection':'')} aria-label="VAL Copiloto da oportunidade">
    {!chatOpen&&<>
     <header><Sparkles size={22}/><h2>VAL Copiloto</h2><button className="opp-icon-button" aria-label="Fechar painel VAL Copiloto" onClick={()=>setPanelOpen(false)}><X size={17}/></button></header>
     {!selected?<div className="opp-empty"><Target size={28}/><p>Selecione uma oportunidade para ver o próximo passo.</p></div>:<>
      <div className="opp-selected"><small>OPORTUNIDADE SELECIONADA</small><h3>{selected.client.name}</h3><p>{selected.title}</p><span className={'opp-stage-pill stage-'+OPPORTUNITY_STAGES.indexOf(selected.stage)}>{selected.stage}</span></div>
      <div className="opp-guidance"><h3><Target size={19}/>Próximo passo</h3><p>{guidance[selected.stage]}</p><button className="opp-button primary" onClick={ask}>Preparar conversa</button><button className="opp-button" onClick={simulate}><BarChart3 size={15}/>Simular cenário</button><button className="opp-button" onClick={()=>edit(selected,selected.stage,'return')}><FileText size={15}/>Registrar retorno</button></div>
      <div className="opp-history"><h3>Histórico</h3>
       {selected.history.length?selected.history.slice(0,5).reverse().map(event=><div className="opp-history-event" key={event.mutationId}><span><Check size={12}/></span><div><strong>{event.label}</strong><small>{timestamp(event.at,timeZone)}</small>{event.note&&<p>{event.note}</p>}</div></div>):<p className="opp-muted">{selected.stageEvidence?.at?'Etapa registrada em '+timestamp(selected.stageEvidence.at,timeZone):'Ainda não há alterações registradas para esta oportunidade.'}</p>}
       {selected.nextAction&&!selected.nextActionDone&&<div className="opp-history-event pending"><span/><div><strong>{selected.nextAction}</strong><small>{dueInfo(selected,now,timeZone).label}</small></div></div>}
       {selected.history.length>5&&<details><summary>Ver histórico completo</summary>{selected.history.slice(5).map(event=><p key={event.mutationId}><b>{event.label}</b><br/>{timestamp(event.at,timeZone)}{event.note&&<><br/>{event.note}</>}</p>)}</details>}
      </div>
      <footer><button className="opp-text-button" onClick={()=>edit(selected)}><FileText size={15}/>Abrir detalhes da oportunidade</button>{onClient&&<button className="opp-text-button" onClick={()=>onClient(selected.client)}>Ver perfil do produtor<ChevronRight size={14}/></button>}</footer>
     </>}
    </>}
    {chatOpen&&selected&&!onAsk&&<div className="opp-chat">
     <CopilotBoundary key={selected.id} onClose={()=>setChatOpen(false)}><Suspense fallback={<div className="opp-empty" role="status"><LoaderCircle/>Abrindo VAL…</div>}>
      <GlobalValCopilot key={String(storageScope)+':'+selected.id} open embedded onClose={()=>setChatOpen(false)} contextClient={selected.client} clients={[selected.client]}
       seed={chatSeed||{...context,nonce:externalCopilotSeed?.nonce||1}} workspaceContext={workspaceContext} storageScope={storageScope}
       identityScope={{tenantId:currentUser.tenantId||'',ownerId:currentUser.ownerId||currentUser.id||''}}
       visits={visits.filter(v=>String(v.clientId)===String(selected.clientId))} opportunities={persistedItems.filter(o=>String(o.clientId)===String(selected.clientId))}
       onRefreshPortfolio={onRefreshPortfolio} onOpenClient={()=>{setChatOpen(false);edit(selected)}} onPrepareVisit={onPrepare} onNavigate={onNavigate}/>
     </Suspense></CopilotBoundary>
    </div>}
   </aside>}
  </div>
  <details ref={simulator} className="opp-simulator" open={simulationOpen} onToggle={e=>setSimulationOpen(e.currentTarget.open)}>
   <summary><span className="opp-kpi-icon"><BarChart3 size={21}/></span><span><b>Simulador de cenário financeiro</b><small>Compare investimento, retorno e condições.</small></span><ChevronRight size={17}/></summary>
   <div className="opp-simulator-body"><p>{selected?'Cenário para '+selected.client.name+' — '+selected.title+'. ':''}Simulação com os valores informados por você. Não altera o negócio ou o perfil do produtor.</p>
    <div className="opp-scenario-fields">{[['area','Área (ha)'],['investment','Investimento por hectare (R$)'],['returnPerHa','Retorno bruto por hectare (R$)']].map(([key,label])=><label key={key}>{label}<input type="number" min={key==='area'?'0.01':'0'} step="any" value={roi[key]} onChange={e=>setRoi(r=>({...r,[key]:e.target.value}))}/></label>)}</div>
    <div className={'opp-scenario-result'+(result?.net<0?' negative':'')}><Calculator size={22}/>{result?<div><small>RESULTADO LÍQUIDO DO CENÁRIO</small><strong>{money(result.net)}</strong><span>Retorno bruto / investimento: {result.ratio===null?'não calculável com investimento zero':result.ratio.toFixed(2)+'x'}</span></div>:<span>Informe área, investimento e retorno bruto para calcular.</span>}</div>
   </div>
  </details>
  {preview&&<p className="opp-preview-footer">Conceito visual • nomes, valores e negociações apenas demonstrativos</p>}
  {editor&&<OpportunityEditor key={editor.key} {...editor} clients={clients} onSave={save} onClose={()=>setEditor(null)}/>}
  {reports&&<OpportunityDialog title="Relatório de oportunidades" onClose={()=>setReports(false)} className="opp-report">
   <p>Exportação da carteira e dos filtros atuais. Período de atualização opcional.</p><div className="opp-report-period"><label>De<input type="date" value={reportFrom} max={reportTo||undefined} onChange={e=>setReportFrom(e.target.value)}/></label><label>Até<input type="date" value={reportTo} min={reportFrom||undefined} onChange={e=>setReportTo(e.target.value)}/></label></div>
   <p>{reportItems.length} oportunidade(s). Valores ausentes continuam identificados como não informados.</p>
   <div className="opp-report-table"><table><thead><tr><th>Produtor / oportunidade</th><th>Etapa</th><th>Valor</th><th>Próxima ação</th></tr></thead><tbody>{reportItems.map(item=><tr key={item.id}><td><b>{item.client.name}</b><br/>{item.title}</td><td>{item.stage}</td><td>{opportunityValue(item)===null?'Não informado':money(item.value)}</td><td>{item.nextAction||'Não informada'}<br/>{timestamp(item.nextActionAt,timeZone)}</td></tr>)}</tbody></table></div>
   <footer><button className="opp-button" onClick={()=>window.print()}>Imprimir / salvar PDF</button><button className="opp-button primary" onClick={downloadReport}><Download size={16}/>Exportar CSV</button></footer>
  </OpportunityDialog>}
 </div>
}
