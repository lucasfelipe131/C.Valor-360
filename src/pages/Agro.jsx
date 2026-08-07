import React from 'react'
import { ScanLine, FlaskConical, Bug, Leaf, TestTube2, Map, Calculator, BookOpen, CloudSun, FileText, Wheat, Satellite } from 'lucide-react'
const tools=[
 ['FitoScan','Diagnóstico de doenças por imagem',ScanLine],['NutriScan','Deficiências nutricionais e recomendações',FlaskConical],
 ['Insetos','Identificação de pragas e insetos',Bug],['Daninhas','Identificação e manejo de plantas daninhas',Leaf],
 ['Análise de solo','Importação PDF/foto e interpretação',TestTube2],['Talhões & GPS','Cadastro de áreas, mapas e croquis',Map],
 ['Calculadoras','Sementes, pulverização, fertilizantes e colheita',Calculator],['Bulas','Pesquisa de defensivos e recomendações',BookOpen],
 ['Clima','Previsão e alertas por localização',CloudSun],['Relatórios','Laudos, recomendações e PDFs',FileText],
 ['Cultivares & ZARC','Ciclos, GMR, zoneamento e planejamento',Wheat],['NDVI','Histórico e leitura de vigor por talhão',Satellite]
]
export default function Agro(){return <div className="page-stack"><section className="module-hero"><div><span className="eyebrow">MOTOR TÉCNICO</span><h2>Inteligência Agronômica</h2><p>As ferramentas do Manual do Agrônomo conectadas diretamente ao Cliente 360 e à VAL.</p></div></section><section className="tool-grid">{tools.map(([n,d,I])=><article className="agro-card" key={n}><div><I size={22}/></div><h3>{n}</h3><p>{d}</p><button>Em desenvolvimento</button></article>)}</section></div>}
