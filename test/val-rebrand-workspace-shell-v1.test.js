import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {
 MODULES,WORKSPACES,SETTINGS_NAV,HOME,COPILOT,
 assertModuleCoverage,contextTrail,isNavItemActive,resolveActiveWorkspace,
 settingsModules,workspaceEntryPoint,workspaceHoldsPage,workspaceModules,workspaceOf
} from '../src/lib/val-workspaces.js'
import {AGRO_GROUPS,AGRO_TOOLS,agroToolsById} from '../src/lib/agro-tools.js'

// Inventário funcional congelado antes do rebrand (R0). Esta lista é o
// contrato: existia antes, existe depois.
const MODULOS_ANTES=[
 'dashboard','clients','client360','visits','opportunities','copilot',
 'val','datahub','questionnaire','agro','reports','settings','admin'
]

const FERRAMENTAS_ANTES=[
 'solo','produtores','diagnostico','observacoes','calculadoras',
 'bulas','mercado','clima','manual','biblioteca'
]

test('nenhum módulo do inventário desapareceu na navegação por workspaces',()=>{
 for(const id of MODULOS_ANTES)assert.ok(MODULES[id],`módulo "${id}" sumiu do registro`)
 assert.equal(Object.keys(MODULES).length,MODULOS_ANTES.length,'o registro ganhou ou perdeu módulos')

 const alcancaveis=new Set(assertModuleCoverage('admin'))
 for(const id of MODULOS_ANTES){
  if(MODULES[id].contextual)continue
  assert.ok(alcancaveis.has(id),`módulo "${id}" ficou inalcançável`)
 }
})

test('a sidebar segue os grupos da Mescla 09',()=>{
 assert.deepEqual(WORKSPACES.map(space=>space.id),['comercial','produtor','inteligencia','campo','gestao'])
 const rotulos=id=>workspaceModules(id,'admin').map(entry=>entry.label)
 assert.deepEqual(rotulos('comercial'),['Visitas','Preparar Visita','Oportunidades'])
 assert.ok(rotulos('produtor').includes('Produtor 360'))
 assert.ok(rotulos('inteligencia').includes('Copiloto VAL'))
 assert.ok(rotulos('inteligencia').includes('Manual do Agrônomo'))
 assert.ok(rotulos('inteligencia').includes('Calculadoras'))
 assert.ok(rotulos('campo').includes('Mapas e talhões'))
 assert.deepEqual(settingsModules('admin').map(entry=>entry.label),['Administração','Preferências'])
})

test('cada item da subnavegação leva a um destino real',()=>{
 const todos=[...WORKSPACES.flatMap(space=>workspaceModules(space.id,'admin')),...SETTINGS_NAV]
 for(const entry of todos){
  const destino=entry.page||entry.action
  assert.ok(destino,`o item "${entry.label}" não tem destino`)
  if(entry.page)assert.ok(MODULES[entry.page],`o item "${entry.label}" aponta para a rota inexistente "${entry.page}"`)
  if(entry.tool)assert.ok(agroToolsById.get(entry.tool),`o item "${entry.label}" aponta para a ferramenta inexistente "${entry.tool}"`)
 }
 // Nenhum rótulo duplicado dentro do mesmo grupo.
 for(const space of WORKSPACES){
  const rotulos=workspaceModules(space.id,'admin').map(entry=>entry.label)
  assert.equal(new Set(rotulos).size,rotulos.length,`o workspace "${space.id}" repete rótulo`)
 }
})

test('client360 é contextual: não vira item de menu, mas continua registrado',()=>{
 assert.equal(MODULES.client360.contextual,true)
 assert.equal(MODULES.client360.workspace,'produtor')
 assert.ok(!workspaceModules('produtor','admin').some(entry=>entry.page==='client360'))
 // O gesto "Produtor 360" abre o produtor ativo, ou a carteira quando não há um.
 const producer=workspaceModules('produtor','admin').find(entry=>entry.label==='Produtor 360')
 assert.equal(producer.action,'producer')
 assert.equal(producer.page,'clients')
})

test('cada workspace tem ponto de entrada real e nenhum fica vazio',()=>{
 for(const space of WORKSPACES){
  const modules=workspaceModules(space.id,'admin')
  assert.ok(modules.length>0,`workspace "${space.id}" ficou sem módulo`)
  const entry=workspaceEntryPoint(space.id,'admin')
  assert.ok(MODULES[entry],`ponto de entrada "${entry}" não é um módulo`)
 }
})

test('a permissão de administração continua valendo na navegação',()=>{
 assert.ok(settingsModules('admin').some(entry=>entry.page==='admin'))
 assert.ok(!settingsModules('consultant').some(entry=>entry.page==='admin'))
 assert.ok(settingsModules('consultant').some(entry=>entry.page==='settings'))
 assert.ok(!assertModuleCoverage('consultant').includes('admin'))
})

test('módulos transversais herdam o workspace ativo em vez de zerá-lo',()=>{
 assert.equal(workspaceOf(HOME),null)
 assert.equal(workspaceOf(COPILOT),null)
 assert.equal(resolveActiveWorkspace(HOME,'campo'),'campo')
 assert.equal(resolveActiveWorkspace(COPILOT,'produtor'),'produtor')
 assert.equal(resolveActiveWorkspace('agro','produtor'),'campo')
})

test('a ferramenta aberta decide qual item do Campo está ativo',()=>{
 const campo=workspaceModules('campo','admin')
 const mapas=campo.find(entry=>entry.tool==='produtores')
 const solo=campo.find(entry=>entry.tool==='solo')
 assert.equal(isNavItemActive(mapas,{page:'agro',tool:'produtores'}),true)
 assert.equal(isNavItemActive(solo,{page:'agro',tool:'produtores'}),false)
 assert.equal(isNavItemActive(mapas,{page:'visits',tool:'produtores'}),false)
 const copiloto=workspaceModules('inteligencia','admin').find(entry=>entry.action==='copilot')
 assert.equal(isNavItemActive(copiloto,{page:'copilot'}),true)
})

test('workspaces que compartilham a rota agro não roubam o usuário um do outro',()=>{
 // Calculadoras vive em Inteligência e Análises de solo em Campo; as duas
 // abrem a rota `agro`. Sem isto, clicar em Calculadoras jogava o usuário
 // em Campo, porque a rota pertence nominalmente a Campo.
 assert.equal(workspaceHoldsPage('inteligencia','agro','admin'),true)
 assert.equal(workspaceHoldsPage('campo','agro','admin'),true)
 assert.equal(workspaceHoldsPage('comercial','agro','admin'),false)

 // Só a ferramenta aberta acende, nunca as duas.
 const inteligencia=workspaceModules('inteligencia','admin')
 const agro=inteligencia.find(entry=>entry.id==='agro')
 const calc=inteligencia.find(entry=>entry.id==='calculadoras')
 assert.equal(isNavItemActive(calc,{page:'agro',tool:'calculadoras'}),true)
 assert.equal(isNavItemActive(agro,{page:'agro',tool:'calculadoras'}),false)
 assert.equal(isNavItemActive(agro,{page:'agro',tool:''}),true)
})

test('a trilha de contexto mostra workspace, módulo e produtor ativo',()=>{
 const trail=contextTrail({page:'client360',workspace:'produtor',client:{id:'c1',name:'Antônio Costa'}})
 assert.deepEqual(trail.map(step=>step.kind),['workspace','module','entity'])
 assert.deepEqual(trail.map(step=>step.label),['Produtor','Produtor 360','Antônio Costa'])
 assert.deepEqual(contextTrail({page:HOME,workspace:'comercial',client:null}).map(step=>step.kind),['workspace'])
})

test('o registro de ferramentas agronômicas preserva as dez capacidades',()=>{
 assert.deepEqual(AGRO_TOOLS.map(tool=>tool.id),FERRAMENTAS_ANTES)
 for(const id of FERRAMENTAS_ANTES)assert.ok(agroToolsById.get(id)?.label,`ferramenta "${id}" perdeu o rótulo`)
 assert.equal(AGRO_GROUPS.length,5)
})

test('Agro.jsx consome o registro compartilhado em vez de manter cópia própria',()=>{
 const source=readFileSync('src/pages/Agro.jsx','utf8')
 assert.match(source,/from '\.\.\/lib\/agro-tools'/)
 assert.match(source,/const groups=AGRO_GROUPS/)
 assert.ok(!/\{id:'calculadoras',label:'Calculadoras'/.test(source),'a lista de ferramentas voltou a ser duplicada')
})

test('a busca global indexa produtor, visita, oportunidade, módulo e ferramenta',()=>{
 const source=readFileSync('src/components/Topbar.jsx','utf8')
 for(const kind of ['Produtor','Visita','Oportunidade','Módulo','Ferramenta'])
  assert.ok(source.includes(`kind:'${kind}'`),`a busca deixou de indexar "${kind}"`)
 assert.ok(!/fetch\(/.test(source),'a busca global não deve inventar backend')
 // A referência mostra um campo de busca no cabeçalho, não um ícone.
 assert.match(source,/className="global-search-inline"/)
 assert.match(source,/placeholder="Buscar produtores, culturas, análises…"/)
})

test('sidebar e navegação mobile leem o mesmo modelo, sem listas paralelas',()=>{
 for(const file of ['src/components/Sidebar.jsx','src/components/MobileNav.jsx']){
  const source=readFileSync(file,'utf8')
  assert.match(source,/from '\.\.\/lib\/val-workspaces'/,`${file} não usa o modelo compartilhado`)
  assert.ok(!/^const (primary|secondary)=\[/m.test(source),`${file} voltou a manter lista própria de módulos`)
  assert.match(source,/isNavItemActive/,`${file} não usa a regra compartilhada de item ativo`)
 }
})

test('a barra inferior mobile declara os cinco destinos que o CSS reserva',()=>{
 const nav=readFileSync('src/components/MobileNav.jsx','utf8')
 const botoes=nav.split('<nav className="mobile-nav"')[1]
 assert.equal((botoes.match(/<button/g)||[]).length,5)
 for(const file of ['src/mobile-browser.css','src/copilot-ux.css']){
  const css=readFileSync(file,'utf8')
  const regra=css.match(/\.mobile-nav\{[^}]*grid-template-columns:repeat\((\d)/)
  assert.equal(regra?.[1],'5',`${file} ainda reserva outro número de colunas para a barra inferior`)
 }
})

test('a marca é o ativo oficial e a paleta da VAL foi preservada',()=>{
 const brand=readFileSync('src/val-brand.css','utf8')
 // A troca foi de marca, não de paleta.
 for(const token of ['--val-ink:#071b19','--val-emerald:#00c896','--val-emerald-dark:#009f78','--val-mint:#72e6c5'])
  assert.ok(brand.includes(token),`o token "${token}" da paleta VAL foi perdido`)
 // Os tokens existiam só para colorir o desenho recusado.
 assert.ok(!/--val-logo-/.test(brand),'sobraram tokens do desenho da marca')

 const logo=readFileSync('src/components/Logo.jsx','utf8')
 assert.match(logo,/val-symbol-official\.png/)
 assert.ok(!/<svg|<path\s/.test(logo),'a marca voltou a ser desenhada em vez de usar o ativo')
})
