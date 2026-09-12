// Workspace Contextual Híbrido — modelo único de navegação da VAL.
//
// Estrutura vinda da MESCLA 09 (slide 04 da referência): uma sidebar compacta,
// hierárquica e completa, onde todas as funções permanecem e o que muda é como
// são agrupadas e encontradas. Regra da referência: reorganizar ≠ remover.
//
// Cada item aponta para um destino REAL. Onde a referência lista dois rótulos
// que, neste produto, abrem exatamente a mesma coisa, os dois viram um item só
// — um botão que não leva a lugar novo é um botão falso.
//
// Os itens de Campo e Inteligência usam deep-link para as ferramentas do
// Manual do Agrônomo (`tool`), que já são destinos distintos dentro do iframe.

import {
 BarChart3,BookOpen,BrainCircuit,Calculator,Camera,CalendarCheck2,CalendarDays,ClipboardList,CloudSun,
 DatabaseZap,FileBarChart,FlaskConical,LandPlot,Layers3,Library,LayoutDashboard,Search,
 Settings,ShieldCheck,Sprout,Target,UserRound,Users
} from 'lucide-react'

export const HOME='dashboard'
export const COPILOT='copilot'

// Registro de módulos: a rota interna do produto, inalterada.
export const MODULES={
 dashboard:{label:'Início',icon:LayoutDashboard,workspace:null},
 clients:{label:'Carteira',icon:Users,workspace:'produtor'},
 client360:{label:'Produtor 360',icon:UserRound,workspace:'produtor',contextual:true},
 questionnaire:{label:'Coletar preferências',icon:ClipboardList,workspace:'produtor'},
 datahub:{label:'Base Inteligente',icon:DatabaseZap,workspace:'produtor'},
 visits:{label:'Visitas',icon:CalendarDays,workspace:'comercial'},
 opportunities:{label:'Oportunidades',icon:Target,workspace:'comercial'},
 copilot:{label:'Copiloto VAL',icon:BrainCircuit,workspace:null},
 val:{label:'Análise avançada',icon:Search,workspace:'inteligencia'},
 agro:{label:'Inteligência Agronômica',icon:Sprout,workspace:'campo'},
 management:{label:'Visão gerencial',icon:BarChart3,workspace:'gestao',roles:['admin','manager','bi_viewer']},
 reports:{label:'Indicadores e relatórios',icon:FileBarChart,workspace:'gestao'},
 settings:{label:'Preferências',icon:Settings,workspace:'gestao'},
 admin:{label:'Administração',icon:ShieldCheck,workspace:'gestao',role:'admin'}
}

export const WORKSPACES=[
 {id:'comercial',label:'Comercial',icon:Target,hint:'Agenda, visitas e oportunidades'},
 {id:'produtor',label:'Produtor',icon:Users,hint:'Carteira, perfil e base de contexto'},
 {id:'inteligencia',label:'Inteligência',icon:BrainCircuit,hint:'Copiloto, análise e conhecimento'},
 {id:'campo',label:'Campo',icon:Sprout,hint:'Solo, diagnóstico, mapas e cálculo'},
 {id:'gestao',label:'Gestão',icon:FileBarChart,hint:'Indicadores, conta e governança'}
]

// Subnavegação de cada workspace. `page` é a rota; `tool` abre a capacidade
// agronômica correspondente dentro do ambiente técnico; `action` é um gesto do
// produto (preparar visita depende do produtor ativo).
const NAV={
 comercial:[
  {id:'visits',label:'Visitas',icon:CalendarDays,page:'visits'},
  {id:'prepare',label:'Preparar Visita',icon:CalendarCheck2,action:'prepare',page:'visits'},
  {id:'opportunities',label:'Oportunidades',icon:Target,page:'opportunities'}
 ],
 produtor:[
  {id:'producer360',label:'Produtor 360',icon:UserRound,action:'producer',page:'clients'},
  {id:'clients',label:'Carteira',icon:Users,page:'clients'},
  {id:'questionnaire',label:'Coletar preferências',icon:ClipboardList,page:'questionnaire'},
  {id:'datahub',label:'Base Inteligente',icon:DatabaseZap,page:'datahub'}
 ],
 inteligencia:[
  {id:'copilot',label:'Copiloto VAL',icon:BrainCircuit,action:'copilot'},
  {id:'val',label:'Análise avançada',icon:Search,page:'val'},
  {id:'agro',label:'Inteligência Agronômica',icon:Sprout,page:'agro'},
  {id:'manual',label:'Manual do Agrônomo',icon:BookOpen,page:'agro',tool:'manual'},
  {id:'calculadoras',label:'Calculadoras',icon:Calculator,page:'agro',tool:'calculadoras'}
 ],
 campo:[
  {id:'produtores',label:'Mapas e talhões',icon:LandPlot,page:'agro',tool:'produtores'},
  {id:'solo',label:'Análises de solo',icon:Layers3,page:'agro',tool:'solo'},
  {id:'diagnostico',label:'Diagnóstico por foto',icon:Camera,page:'agro',tool:'diagnostico'},
  {id:'bulas',label:'Bulas e registros',icon:FlaskConical,page:'agro',tool:'bulas'},
  {id:'clima',label:'Clima e mercado',icon:CloudSun,page:'agro',tool:'clima'}
 ],
 gestao:[
  {id:'management',label:'Visão gerencial',icon:BarChart3,page:'management',roles:['admin','manager','bi_viewer']},
  {id:'reports',label:'Indicadores e relatórios',icon:FileBarChart,page:'reports'},
  {id:'biblioteca',label:'Documentos',icon:Library,page:'agro',tool:'biblioteca'}
 ]
}

// Sempre visível no rodapé da navegação, fora dos workspaces.
export const SETTINGS_NAV=[
 {id:'admin',label:'Administração',icon:ShieldCheck,page:'admin',role:'admin'},
 {id:'settings',label:'Preferências',icon:Settings,page:'settings'}
]

const allowed=(item,role)=>(!item.role||item.role===role)&&(!item.roles||item.roles.includes(role))

export const workspaceModules=(workspaceId,role)=>(NAV[workspaceId]||[]).filter(item=>allowed(item,role))
export const settingsModules=role=>SETTINGS_NAV.filter(item=>allowed(item,role))

export const workspaceOf=page=>MODULES[page]?.workspace||null
export const resolveActiveWorkspace=(page,previous)=>workspaceOf(page)||previous||null
export const workspaceEntryPoint=(workspaceId,role)=>workspaceModules(workspaceId,role)[0]?.page||(workspaceModules(workspaceId,role)[0]?.action==='copilot'?COPILOT:HOME)
export const moduleLabel=page=>MODULES[page]?.label||'VAL'

// Um item da subnavegação está ativo quando a rota bate e, havendo ferramenta,
// quando a ferramenta aberta é a dele. Um item SEM ferramenta na mesma rota só
// fica ativo com nenhuma ferramenta aberta — senão "Inteligência Agronômica" e
// "Calculadoras" acenderiam juntas.
export const isNavItemActive=(item,{page,tool}={})=>{
 if(item.action==='copilot')return page==='copilot'
 if(item.page!==page)return false
 if(item.tool)return item.tool===tool
 return !tool
}

// Vários workspaces compartilham a rota `agro`, cada um com suas ferramentas.
// Enquanto o workspace atual comportar a rota aberta, ele permanece — senão
// clicar em Calculadoras dentro de Inteligência jogaria o usuário em Campo.
export const workspaceHoldsPage=(workspaceId,page,role)=>
 workspaceModules(workspaceId,role).some(item=>item.page===page)

export const contextTrail=({page,workspace,client})=>{
 const trail=[]
 const space=WORKSPACES.find(item=>item.id===workspace)
 if(space)trail.push({id:`workspace:${space.id}`,label:space.label,kind:'workspace'})
 if(MODULES[page]&&page!==HOME)trail.push({id:`module:${page}`,label:moduleLabel(page),kind:'module'})
 if(page!==HOME&&client?.name)trail.push({id:`client:${client.id}`,label:client.name,kind:'entity'})
 return trail
}

// Contrato anti-regressão: todo módulo do inventário continua alcançável.
export const assertModuleCoverage=(role='admin')=>{
 const reachable=new Set([HOME,COPILOT])
 for(const space of WORKSPACES)for(const item of workspaceModules(space.id,role))if(item.page)reachable.add(item.page)
 for(const item of settingsModules(role))reachable.add(item.page)
 for(const [id,module] of Object.entries(MODULES)){
  if(module.contextual||!allowed(module,role))continue
  if(!reachable.has(id))throw new Error(`Módulo "${id}" ficou inalcançável na navegação.`)
 }
 return [...reachable]
}
