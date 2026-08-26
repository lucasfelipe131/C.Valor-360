import React,{useEffect,useMemo,useRef,useState} from 'react'
import {ArrowLeft,BookOpen,BrainCircuit,Calculator,Camera,CheckCircle2,CloudSun,FileSearch,FileText,FlaskConical,History,Image,LandPlot,Layers3,Library,LoaderCircle,Maximize2,Mic,Minimize2,Newspaper,Search,ShieldCheck,Sprout,UsersRound} from 'lucide-react'
import Logo from '../components/Logo'
import {buildAgroCopilotContext} from '../lib/copilot-context'

const groups=[
 {id:'field',eyebrow:'CAMPO E SOLO',title:'Entenda a área antes de concluir',description:'Laudos, propriedades, talhões, culturas e histórico em um fluxo conectado.',tools:[
  {id:'solo',label:'Análises de solo',description:'Importe, interprete e mantenha o vínculo sob confirmação.',icon:Layers3},
  {id:'produtores',label:'Propriedades e talhões',description:'Cadastros, mapas, safras e contexto produtivo.',icon:LandPlot}
 ]},
 {id:'diagnosis',eyebrow:'DIAGNÓSTICO',title:'Observe, compare e valide',description:'A imagem inicia hipóteses; o responsável técnico mantém a decisão.',tools:[
  {id:'diagnostico',label:'Diagnóstico por foto',description:'Nutrição, doenças, insetos e plantas daninhas.',icon:Camera},
  {id:'observacoes',page:'relatorios',label:'Observações e registros',description:'Histórico técnico, relatórios e evidências de campo.',icon:FileSearch}
 ]},
 {id:'decision',eyebrow:'DECISÃO TÉCNICA',title:'Calcule e confira na fonte',description:'Ferramentas continuam acessíveis diretamente, com rastreabilidade.',tools:[
  {id:'calculadoras',label:'Calculadoras',description:'Semeadura, aplicação, fertilidade, reposição e custos.',icon:Calculator},
  {id:'bulas',label:'Bulas e registros',description:'Consulte rótulos e fontes oficiais antes de orientar.',icon:FlaskConical}
 ]},
 {id:'context',eyebrow:'CONTEXTO',title:'Enxergue o que mudou fora da área',description:'Clima e mercado ganham data, origem e efeito sobre a decisão.',tools:[
  {id:'mercado',label:'Mercado e commodities',description:'Cotações, tendências e notícias com fonte e horário.',icon:Newspaper},
  {id:'clima',page:'inicio',label:'Clima e panorama',description:'Condições, alertas e visão integrada do trabalho técnico.',icon:CloudSun}
 ]},
 {id:'knowledge',eyebrow:'CONHECIMENTO',title:'Aprofunde sem perder governança',description:'Conhecimento apoia o raciocínio; nunca vira prescrição automática.',tools:[
  {id:'manual',page:'inicio',label:'Manual do Agrônomo',description:'Capacidades e fontes técnicas validadas do núcleo agronômico.',icon:BookOpen},
  {id:'biblioteca',page:'relatorios',label:'Biblioteca e histórico',description:'Conteúdos, registros e versões preservados para consulta.',icon:Library}
 ]}
]

const toolsById=new Map(groups.flatMap(group=>group.tools.map(tool=>[tool.id,tool])))

export default function Agro({onAsk,onContextChange}){
 const [status,setStatus]=useState({loading:true,configured:false})
 const [loaded,setLoaded]=useState(false)
 const [expanded,setExpanded]=useState(false)
 const [tool,setTool]=useState('')
 const workspaceRef=useRef(null)
 const frameRef=useRef(null)
 const activeTool=useMemo(()=>toolsById.get(tool)||null,[tool])
 const copilotContext=useMemo(()=>buildAgroCopilotContext({tool:activeTool}),[activeTool])

 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:controller.signal})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>setStatus({loading:false,configured:Boolean(data.manualIntegrationConfigured)}))
   .catch(()=>setStatus({loading:false,configured:false}))
  return()=>controller.abort()
 },[])

 useEffect(()=>{
  const syncFullscreen=()=>setExpanded(document.fullscreenElement===workspaceRef.current)
  document.addEventListener('fullscreenchange',syncFullscreen)
  return()=>document.removeEventListener('fullscreenchange',syncFullscreen)
 },[])

 useEffect(()=>{
  if(!expanded)return undefined
  const previous=document.body.style.overflow;document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=previous}
 },[expanded])

 useEffect(()=>{
  if(!tool||!frameRef.current?.contentWindow)return
  frameRef.current.contentWindow.postMessage({type:'valor360:navigate',page:activeTool?.page||tool},window.location.origin)
 },[tool,loaded,activeTool])

 useEffect(()=>{onContextChange?.(copilotContext);return()=>onContextChange?.(null)},[copilotContext,onContextChange])

 const selectTool=id=>{setLoaded(false);setTool(id);requestAnimationFrame(()=>workspaceRef.current?.scrollIntoView({block:'start',behavior:'smooth'}))}
 const ask=input=>onAsk?.({...copilotContext,...input,mode:'ASK',source:'agro',clientId:'',persistenceMode:'NONE'})
 const toggleExpanded=async()=>{
  if(expanded&&!document.fullscreenElement){setExpanded(false);return}
  if(document.fullscreenElement){await document.exitFullscreen();return}
  try{if(workspaceRef.current?.requestFullscreen){await workspaceRef.current.requestFullscreen();return}}catch{}
  setExpanded(true)
 }

 return <div className="agro-decision-page">
  <section className="agro-decision-hero" aria-labelledby="agro-decision-title">
   <div className="agro-decision-copy"><span><Sprout/>INTELIGÊNCIA AGRONÔMICA DA VAL</span><h2 id="agro-decision-title">O que você precisa analisar?</h2><p>Converse com a VAL ou entre direto na ferramenta. O núcleo técnico continua inteiro — agora organizado como parte da mesma experiência.</p></div>
   <div className="agro-decision-inputs" aria-label="Formas de iniciar uma análise">
    <button type="button" className="is-primary" onClick={()=>ask({prompt:'Quero conversar sobre uma decisão agronômica.'})}><Mic/><span><b>Perguntar à VAL</b><small>Falar ou digitar</small></span></button>
    <button type="button" onClick={()=>ask({prompt:'Analise uma foto de campo comigo.',capture:'photo'})}><Image/><span><b>Foto</b><small>Iniciar diagnóstico</small></span></button>
    <button type="button" onClick={()=>ask({prompt:'Leia este documento técnico e me diga o que importa.',capture:'file'})}><FileText/><span><b>Documento</b><small>Laudo ou arquivo</small></span></button>
   </div>
   <div className="agro-decision-governance"><ShieldCheck/><span><b>A IA pensa. A VAL governa. O humano decide.</b><small>Dose, mistura, bula e prescrição continuam sob validação técnica.</small></span></div>
  </section>

  {!tool&&<div className="agro-capability-groups">
   {groups.map(group=><section key={group.id} className="agro-capability-group">
    <header><span>{group.eyebrow}</span><h3>{group.title}</h3><p>{group.description}</p></header>
    <div>{group.tools.map(item=>{const Icon=item.icon;return <button type="button" key={`${group.id}-${item.id}`} onClick={()=>selectTool(item.id)}><i><Icon/></i><span><b>{item.label}</b><small>{item.description}</small></span><ArrowLeft className="agro-tool-arrow"/></button>})}</div>
   </section>)}
  </div>}

  {tool&&<section ref={workspaceRef} className={`agro-native-workspace agro-tool-workspace${expanded?' is-expanded':''}`} aria-label={`Ferramenta: ${activeTool?.label||'Inteligência Agronômica'}`}>
   <header className="agro-minimal-header">
    <div className="agro-tool-title"><button type="button" onClick={()=>setTool('')} aria-label="Voltar às capacidades"><ArrowLeft/></button><Logo compact/><div><small>INTELIGÊNCIA AGRONÔMICA</small><strong>{activeTool?.label||'Ambiente técnico'}</strong></div></div>
    <div className="agro-workspace-actions">
     <button type="button" className="agro-ask-inline" onClick={()=>ask({prompt:`Quero conversar com a VAL sobre ${activeTool?.label||'esta análise'}.`})}><BrainCircuit/><b>Conversar com a VAL</b></button>
     <span className={status.configured?'is-ready':'is-unverified'}><CheckCircle2/>{status.loading?'Conectando':status.configured?'Fontes conectadas':'Fontes não verificadas'}</span>
     <button type="button" onClick={toggleExpanded} aria-pressed={expanded} title={expanded?'Reduzir ambiente técnico':'Abrir ambiente técnico em tela cheia'}>{expanded?<Minimize2/>:<Maximize2/>}<b>{expanded?'Reduzir':'Tela cheia'}</b></button>
    </div>
   </header>
   {!loaded&&<div className="agro-frame-loading" role="status"><LoaderCircle/><b>Carregando a capacidade…</b><small>Mantendo sua sessão e o mesmo contexto de acesso.</small></div>}
   <iframe ref={frameRef} key={tool} title={activeTool?.label||'Inteligência Agronômica da VAL'} src={`/tecnico?embedded=1&page=${encodeURIComponent(activeTool?.page||tool)}`} onLoad={()=>setLoaded(true)} allow="camera 'self'; microphone 'self'; geolocation 'self'"/>
  </section>}

  <section className="agro-preserved-functions"><Search/><div><b>Prefere navegar?</b><span>Todas as funções permanecem disponíveis nos grupos acima. A VAL é um atalho inteligente, não uma barreira.</span></div><UsersRound/><History/></section>
 </div>
}
