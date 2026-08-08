import React,{useState} from 'react'
import {ArrowRight,BookOpen,BrainCircuit,Bug,Calculator,CloudSun,Database,FileText,FlaskConical,Leaf,Map,Satellite,ScanLine,Sparkles,TestTube2,Wheat} from 'lucide-react'

const groups=[
 {label:'DIAGNÓSTICO ASSISTIDO',tools:[['FitoScan','Ranking de doenças e danos semelhantes',ScanLine,'Visão'],['NutriScan','Deficiências nutricionais e hipóteses',FlaskConical,'Visão'],['InsetoScan','Pragas, insetos e organismos benéficos',Bug,'Visão'],['DaninhaScan','Identificação botânica e triagem',Leaf,'Visão']]},
 {label:'DECISÃO TÉCNICA',tools:[['Análise de solo','PDF, foto, CSV e histórico de fertilidade',TestTube2,'Dados'],['Calculadoras','Sementes, calda, fertilizantes e colheita',Calculator,'Cálculo'],['Bulas & AGROFIT','Consulta técnica e recomendações validadas',BookOpen,'Base'],['Cultivares & ZARC','Ciclos, GMR e janelas por município',Wheat,'Planejamento']]},
 {label:'CAMPO & GESTÃO',tools:[['Talhões & GPS','Áreas, pontos, mapas e croquis',Map,'Campo'],['NDVI','Histórico de vigor e leitura por talhão',Satellite,'Satélite'],['Clima','Previsão e alertas por localização',CloudSun,'Tempo'],['Relatórios','Laudos, recomendações e trilha técnica',FileText,'Documento']]}
]

export default function Agro(){
 const [selected,setSelected]=useState('Análise de solo')
 const openWorkspace=()=>document.getElementById('agro-workspace')?.scrollIntoView({behavior:'smooth',block:'center'})
 return <div className="page-stack agro-os">
  <section className="agro-hero"><div><span className="eyebrow">VALOR 360 • INTELIGÊNCIA AGRONÔMICA</span><h2>Toda a decisão técnica dentro da operação comercial.</h2><p>O contexto da propriedade sai do Cliente 360, passa pelos motores agronômicos e retorna para a VAL como evidência, recomendação e oportunidade.</p><div className="agro-hero-actions"><button onClick={openWorkspace}><Sparkles/>Explorar módulos <ArrowRight/></button><span><i/>Experiência integrada</span></div></div><div className="agro-flow"><span><Database/>CLIENTE 360</span><i/><span className="active"><Sparkles/>AGRO</span><i/><span><BrainCircuit/>VAL</span></div></section>
  <section className="integration-status"><div><span className="eyebrow">PLATAFORMA COMPLETA</span><h3>12 motores na mesma jornada e no mesmo contexto.</h3></div><div><b>12</b><span>módulos agronômicos</span></div><div><b>4</b><span>diagnósticos por imagem</span></div><div><b>1</b><span>histórico compartilhado</span></div></section>
  {groups.map(group=><section className="agro-group" key={group.label}><div className="agro-group-title"><span>{group.label}</span><i/></div><div className="agro-module-grid">{group.tools.map(([name,description,Icon,type])=><button key={name} className={selected===name?'active':''} onClick={()=>setSelected(name)}><div className="module-icon"><Icon/></div><span className="module-type">{type}</span><h3>{name}</h3><p>{description}</p><div className="module-link">Contexto conectado <ArrowRight/></div></button>)}</div></section>)}
  <section className="agro-context-panel" id="agro-workspace"><div className="context-orb"><Sparkles/></div><div><span className="eyebrow">MÓDULO SELECIONADO</span><h2>{selected}</h2><p>A ferramenta será executada dentro do VALOR 360, mantendo produtor, propriedade, talhão, diagnóstico, recomendação e oportunidade no mesmo histórico.</p></div><button type="button" disabled>Integração em desenvolvimento <ArrowRight/></button></section>
 </div>
}
