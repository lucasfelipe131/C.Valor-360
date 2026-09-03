// Registro das capacidades agronômicas — fonte única.
//
// Estava embutido em pages/Agro.jsx, o que deixava as ferramentas invisíveis
// para qualquer outra superfície: a busca global não conseguia encontrar
// "calculadoras" nem "mercado" porque só existiam dentro do iframe.
//
// Aqui é só dado. Agro.jsx consome para desenhar o navegador técnico e o
// Topbar consome para indexar a busca, sem arrastar a página inteira para o
// bundle principal. Nenhuma ferramenta foi criada, renomeada ou removida.

import {BookOpen,Calculator,Camera,CloudSun,FileSearch,FlaskConical,LandPlot,Layers3,Library,Newspaper} from 'lucide-react'

export const AGRO_GROUPS=[
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

export const AGRO_TOOLS=AGRO_GROUPS.flatMap(group=>group.tools.map(tool=>({...tool,groupId:group.id,groupLabel:group.eyebrow})))
export const agroToolsById=new Map(AGRO_TOOLS.map(tool=>[tool.id,tool]))
