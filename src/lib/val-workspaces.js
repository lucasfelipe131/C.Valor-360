// Workspace Contextual Híbrido — modelo único de navegação da VAL.
//
// Antes deste arquivo, Sidebar.jsx e MobileNav.jsx mantinham duas listas
// independentes de módulos que já tinham divergido: `opportunities` era
// primário no desktop e secundário no mobile, e 7 dos 13 módulos viviam
// atrás de um accordion chamado "Mais recursos".
//
// Aqui a navegação passa a responder "em qual CONTEXTO o usuário está?" e não
// só "em qual página?". Os módulos continuam exatamente os mesmos — nenhuma
// rota foi criada, renomeada ou removida. O que muda é o agrupamento.
//
// REGRA: todo módulo alcançável antes precisa continuar alcançável.
// `assertModuleCoverage()` existe para provar isso em teste.

import {
 BrainCircuit,CalendarDays,ClipboardList,DatabaseZap,FileBarChart,LayoutDashboard,
 Search,Settings,ShieldCheck,Sprout,Target,UserRound,Users
} from 'lucide-react'

// Módulos transversais: não pertencem a um workspace, atravessam todos.
export const HOME='dashboard'
export const COPILOT='copilot'

export const MODULES={
 dashboard:{label:'Hoje',icon:LayoutDashboard,workspace:null},
 clients:{label:'Clientes',icon:Users,workspace:'produtor'},
 client360:{label:'Cliente 360',icon:UserRound,workspace:'produtor',contextual:true},
 questionnaire:{label:'Coletar preferências',icon:ClipboardList,workspace:'produtor'},
 datahub:{label:'Base Inteligente',icon:DatabaseZap,workspace:'produtor'},
 visits:{label:'Visitas',icon:CalendarDays,workspace:'comercial'},
 opportunities:{label:'Oportunidades',icon:Target,workspace:'comercial'},
 copilot:{label:'Copiloto VAL',icon:BrainCircuit,workspace:null},
 val:{label:'Análise avançada',icon:Search,workspace:'inteligencia'},
 agro:{label:'Inteligência Agronômica',icon:Sprout,workspace:'campo'},
 reports:{label:'Relatórios',icon:FileBarChart,workspace:'gestao'},
 settings:{label:'Configurações',icon:Settings,workspace:'gestao'},
 admin:{label:'Administração',icon:ShieldCheck,workspace:'gestao',role:'admin'}
}

export const WORKSPACES=[
 {id:'comercial',label:'Comercial',icon:Target,hint:'Agenda, visitas e oportunidades'},
 {id:'produtor',label:'Produtor',icon:Users,hint:'Carteira, perfil e base de contexto'},
 {id:'inteligencia',label:'Inteligência',icon:Search,hint:'Análise, cenários e evidências'},
 {id:'campo',label:'Campo',icon:Sprout,hint:'Solo, diagnóstico, mapas e cálculo'},
 {id:'gestao',label:'Gestão',icon:FileBarChart,hint:'Indicadores, conta e governança'}
]

const entry=id=>({id,...MODULES[id]})
const allowed=(module,role)=>!module.role||module.role===role

// Módulos visíveis de um workspace, na ordem em que aparecem na subnavegação.
export const workspaceModules=(workspaceId,role)=>Object.keys(MODULES)
 .filter(id=>MODULES[id].workspace===workspaceId&&!MODULES[id].contextual&&allowed(MODULES[id],role))
 .map(entry)

// Qual workspace um módulo pertence. Módulos transversais herdam o workspace
// ativo em vez de zerá-lo — é isto que preserva o contexto de trabalho.
export const workspaceOf=page=>MODULES[page]?.workspace||null

export const resolveActiveWorkspace=(page,previous)=>workspaceOf(page)||previous||null

// Primeiro módulo de um workspace: o destino ao selecioná-lo na sidebar.
export const workspaceEntryPoint=(workspaceId,role)=>workspaceModules(workspaceId,role)[0]?.id||HOME

export const moduleLabel=page=>MODULES[page]?.label||'VAL'

// Trilha de contexto do cabeçalho global: workspace › módulo › entidade ativa.
export const contextTrail=({page,workspace,client})=>{
 const trail=[]
 const space=WORKSPACES.find(item=>item.id===workspace)
 if(space)trail.push({id:`workspace:${space.id}`,label:space.label,kind:'workspace'})
 if(MODULES[page]&&page!==HOME)trail.push({id:`module:${page}`,label:moduleLabel(page),kind:'module'})
 if(client?.name)trail.push({id:`client:${client.id}`,label:client.name,kind:'entity'})
 return trail
}

// Contrato anti-regressão do rebrand: todo módulo do inventário continua
// alcançável — por um workspace, pela home ou pelo atalho do Copiloto.
export const assertModuleCoverage=(role='admin')=>{
 const reachable=new Set([HOME,COPILOT])
 for(const space of WORKSPACES)for(const module of workspaceModules(space.id,role))reachable.add(module.id)
 for(const [id,module] of Object.entries(MODULES)){
  if(module.contextual||!allowed(module,role))continue
  if(!reachable.has(id))throw new Error(`Módulo "${id}" ficou inalcançável na navegação.`)
 }
 return [...reachable]
}
