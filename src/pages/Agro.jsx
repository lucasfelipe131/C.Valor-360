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
  <section className="agro-hero"><div><span className="eyebrow">VALOR 360 • ROADMAP AGRONÔMICO</span><h2>O contexto técnico conectado à operação comercial.</h2><p>Relatórios estruturados do Manual, análises de solo e sinais NDVI já podem entrar na memória da VAL. Os módulos abaixo mostram a jornada planejada e exigem validação técnica antes de orientar execução.</p><div className="agro-hero-actions"><button onClick={openWorkspace}><Sparkles/>Explorar roadmap <ArrowRight/></button><span><i/>Base de dados preparada</span></div></div><div className="agro-flow"><span><Database/>CLIENTE 360</span><i/><span className="active"><Sparkles/>AGRO</span><i/><span><BrainCircuit/>VAL</span></div></section>
  <section className="integration-status"><div><span className="eyebrow">ROADMAP DO PRODUTO</span><h3>12 módulos planejados para compartilhar contexto com a VAL.</h3></div><div><b>12</b><span>módulos planejados</span></div><div><b>4</b><span>triagens por imagem planejadas</span></div><div><b>1</b><span>modelo de dados implementado</span></div></section>
  {groups.map(group=><section className="agro-group" key={group.label}><div className="agro-group-title"><span>{group.label}</span><i/></div><div className="agro-module-grid">{group.tools.map(([name,description,Icon,type])=><button key={name} className={selected===name?'active':''} onClick={()=>setSelected(name)}><div className="module-icon"><Icon/></div><span className="module-type">{type}</span><h3>{name}</h3><p>{description}</p><div className="module-link">Contexto conectado <ArrowRight/></div></button>)}</div></section>)}
  <section className="agro-context-panel" id="agro-workspace"><div className="context-orb"><Sparkles/></div><div><span className="eyebrow">MÓDULO PLANEJADO</span><h2>{selected}</h2><p>A integração ainda não executa este módulo. O desenho prevê produtor, propriedade, talhão, evidência, revisão técnica e oportunidade na mesma trilha auditável.</p></div><button type="button" disabled>Integração em desenvolvimento <ArrowRight/></button></section>
 </div>
}
