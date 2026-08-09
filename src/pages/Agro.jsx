import React,{useEffect,useState} from 'react'
import {BrainCircuit,Calculator,Camera,CheckCircle2,CloudSun,FileText,FlaskConical,Leaf,LoaderCircle,Map,Satellite,ShieldCheck,TestTube2,Wheat} from 'lucide-react'

const capabilities=[
 ['Solo',TestTube2],['Diagnóstico por foto',Camera],['Calculadoras',Calculator],
 ['Bulas',Leaf],['Talhões e GPS',Map],['NDVI',Satellite],
 ['Cultivares e ZARC',Wheat],['Clima',CloudSun],['Relatórios',FileText]
]

export default function Agro({clients=[]}){
 const [status,setStatus]=useState({loading:true,configured:false})
 const [loaded,setLoaded]=useState(false)

 useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:controller.signal})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>setStatus({loading:false,configured:Boolean(data.manualIntegrationConfigured)}))
   .catch(()=>setStatus({loading:false,configured:false}))
  return()=>controller.abort()
 },[])

 return <div className="page-stack agro-native">
  <section className="agro-native-hero">
   <div>
    <span className="eyebrow">NÚCLEO TÉCNICO NATIVO</span>
    <h2>Inteligência agronômica sem sair do VALOR 360.</h2>
    <p>Análises, diagnósticos, cálculos, mapas, bulas e relatórios agora funcionam nesta mesma plataforma e usam a carteira protegida do consultor.</p>
   </div>
   <div className="agro-native-status">
    <span className={status.configured?'is-ready':''}><CheckCircle2/>{status.loading?'Verificando serviços':'Mesmo login ativo'}</span>
    <span><ShieldCheck/>{clients.length} {clients.length===1?'produtor disponível':'produtores disponíveis'}</span>
   </div>
  </section>

  <section className="agro-capability-strip" aria-label="Funções técnicas disponíveis">
   {capabilities.map(([label,Icon])=><span key={label}><Icon/>{label}</span>)}
  </section>

  <section className="agro-native-workspace" aria-label="Ambiente técnico integrado">
   <header>
    <div><span className="workspace-orbit"><BrainCircuit/></span><div><small>VALOR 360</small><strong>Ambiente técnico completo</strong></div></div>
    <span><FlaskConical/> IA prepara • agrônomo valida</span>
   </header>
   {!loaded&&<div className="agro-frame-loading" role="status"><LoaderCircle/><b>Carregando o núcleo técnico…</b><small>Sincronizando sessão e carteira protegida.</small></div>}
   <iframe
    title="Inteligência Agronômica do VALOR 360"
    src="/tecnico?embedded=1"
    onLoad={()=>setLoaded(true)}
    allow="camera 'self'; geolocation 'self'"
   />
  </section>

  <section className="agro-native-footnote"><ShieldCheck/><span><b>Decisão técnica responsável</b><small>Triagens e cálculos ficam registrados; produto, dose, diagnóstico e execução dependem de conferência e assinatura do profissional habilitado.</small></span></section>
 </div>
}
