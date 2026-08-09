import React,{useEffect,useState} from 'react'
import {ArrowRight,BookOpen,BrainCircuit,Bug,Calculator,CloudSun,Database,FileText,FlaskConical,Leaf,Map,Satellite,ScanLine,Sparkles,TestTube2,Wheat} from 'lucide-react'

const groups=[
 {label:'DIAGNÓSTICO ASSISTIDO',tools:[['FitoScan','Ranking de doenças e danos semelhantes',ScanLine,'Visão'],['NutriScan','Deficiências nutricionais e hipóteses',FlaskConical,'Visão'],['InsetoScan','Pragas, insetos e organismos benéficos',Bug,'Visão'],['DaninhaScan','Identificação botânica e triagem',Leaf,'Visão']]},
 {label:'DECISÃO TÉCNICA',tools:[['Análise de solo','PDF, foto, CSV e histórico de fertilidade',TestTube2,'Dados'],['Calculadoras','Sementes, calda, fertilizantes e colheita',Calculator,'Cálculo'],['Bulas & AGROFIT','Consulta técnica e recomendações validadas',BookOpen,'Base'],['Cultivares & ZARC','Ciclos, GMR e janelas por município',Wheat,'Planejamento']]},
 {label:'CAMPO & GESTÃO',tools:[['Talhões & GPS','Áreas, pontos, mapas e croquis',Map,'Campo'],['NDVI','Histórico de vigor e leitura por talhão',Satellite,'Satélite'],['Clima','Previsão e alertas por localização',CloudSun,'Tempo'],['Relatórios','Laudos, recomendações e trilha técnica',FileText,'Documento']]}
]
const connectedModules=new Set(['Análise de solo','Calculadoras','Talhões & GPS','NDVI','Relatórios'])

export default function Agro(){
 const [selected,setSelected]=useState('Análise de solo')
 const [bridge,setBridge]=useState(null)
 const openWorkspace=()=>document.getElementById('agro-workspace')?.scrollIntoView({behavior:'smooth',block:'center'})
 useEffect(()=>{const controller=new AbortController();fetch('/api/val/status',{signal:controller.signal}).then(response=>response.ok?response.json():Promise.reject()).then(status=>setBridge(Boolean(status.manualIntegrationConfigured))).catch(()=>setBridge(null));return()=>controller.abort()},[])
 const connected=connectedModules.has(selected)
 return <div className="page-stack agro-os">
  <section className="agro-hero"><div><span className="eyebrow">VALOR 360 • PONTE COM O MANUAL</span><h2>O contexto técnico conectado à estratégia comercial.</h2><p>Cadastro, propriedades, talhões, análises, cálculos e relatórios salvos no Manual do Agrônomo passam a compor o dossiê do produtor consultado pela VAL. Orientações técnicas continuam dependentes de validação responsável.</p><div className="agro-hero-actions"><button onClick={openWorkspace}><Sparkles/>Ver fluxos conectados <ArrowRight/></button><span><i/>{bridge===null?'Verificando integração':bridge?'Integração assinada ativa':'Configuração do servidor pendente'}</span></div></div><div className="agro-flow"><span><Database/>CLIENTE 360</span><i/><span className="active"><Sparkles/>MANUAL</span><i/><span><BrainCircuit/>VAL</span></div></section>
  <section className="integration-status"><div><span className="eyebrow">DOSSIÊ UNIFICADO</span><h3>O Manual agora alimenta o contexto estratégico da VAL por produtor.</h3></div><div><b>5</b><span>fluxos conectados</span></div><div><b>HMAC</b><span>eventos assinados</span></div><div><b>360°</b><span>contexto por produtor</span></div></section>
  {groups.map(group=><section className="agro-group" key={group.label}><div className="agro-group-title"><span>{group.label}</span><i/></div><div className="agro-module-grid">{group.tools.map(([name,description,Icon,type])=><button key={name} className={selected===name?'active':''} onClick={()=>setSelected(name)}><div className="module-icon"><Icon/></div><span className="module-type">{type}</span><h3>{name}</h3><p>{description}</p><div className="module-link">Contexto conectado <ArrowRight/></div></button>)}</div></section>)}
  <section className="agro-context-panel" id="agro-workspace"><div className="context-orb"><Sparkles/></div><div><span className="eyebrow">{connected?'FLUXO CONECTADO':'PRÓXIMA ETAPA'}</span><h2>{selected}</h2><p>{connected?'Os registros salvos neste fluxo entram no dossiê do produtor com origem, data e conteúdo operacional. A VAL pode usá-los para preparar abordagem e oportunidade, sem transformar contexto em prescrição automática.':'Este módulo permanece no roadmap. Quando ativado, seguirá a mesma trilha assinada de produtor, propriedade, talhão, evidência e revisão técnica.'}</p></div><button type="button" disabled>{connected?'Contexto disponível para a VAL':'Integração em desenvolvimento'} <ArrowRight/></button></section>
 </div>
}
