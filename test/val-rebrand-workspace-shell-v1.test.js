import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'

import {
 MODULES,WORKSPACES,HOME,COPILOT,
 assertModuleCoverage,contextTrail,resolveActiveWorkspace,
 workspaceEntryPoint,workspaceModules,workspaceOf
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

test('client360 é contextual: não vira item de menu, mas continua registrado',()=>{
 assert.equal(MODULES.client360.contextual,true)
 assert.equal(MODULES.client360.workspace,'produtor')
 const menu=workspaceModules('produtor','admin').map(item=>item.id)
 assert.ok(!menu.includes('client360'))
 assert.ok(menu.includes('clients'))
})

test('cada workspace tem ponto de entrada real e nenhum fica vazio',()=>{
 for(const space of WORKSPACES){
  const modules=workspaceModules(space.id,'admin')
  assert.ok(modules.length>0,`workspace "${space.id}" ficou sem módulo`)
  const entry=workspaceEntryPoint(space.id,'admin')
  assert.ok(MODULES[entry],`ponto de entrada "${entry}" não é um módulo`)
  assert.equal(workspaceOf(entry),space.id)
 }
})

test('a permissão de administração continua valendo na navegação',()=>{
 const admin=workspaceModules('gestao','admin').map(item=>item.id)
 const consultor=workspaceModules('gestao','consultant').map(item=>item.id)
 assert.ok(admin.includes('admin'))
 assert.ok(!consultor.includes('admin'))
 assert.ok(consultor.includes('reports')&&consultor.includes('settings'))
})

test('módulos transversais herdam o workspace ativo em vez de zerá-lo',()=>{
 // É isto que faz o usuário voltar para onde estava depois de abrir a VAL.
 assert.equal(workspaceOf(HOME),null)
 assert.equal(workspaceOf(COPILOT),null)
 assert.equal(resolveActiveWorkspace(HOME,'campo'),'campo')
 assert.equal(resolveActiveWorkspace(COPILOT,'produtor'),'produtor')
 assert.equal(resolveActiveWorkspace('agro','produtor'),'campo')
})

test('a trilha de contexto mostra workspace, módulo e produtor ativo',()=>{
 const trail=contextTrail({page:'client360',workspace:'produtor',client:{id:'c1',name:'Antônio Costa'}})
 assert.deepEqual(trail.map(step=>step.kind),['workspace','module','entity'])
 assert.deepEqual(trail.map(step=>step.label),['Produtor','Cliente 360','Antônio Costa'])
 // Na home não há módulo a repetir: o título já diz onde o usuário está.
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
 // Sem backend inventado: a busca só percorre o que a sessão já carregou.
 assert.ok(!/fetch\(/.test(source),'a busca global não deve inventar backend')
})

test('sidebar e navegação mobile leem o mesmo modelo, sem listas paralelas',()=>{
 for(const file of ['src/components/Sidebar.jsx','src/components/MobileNav.jsx']){
  const source=readFileSync(file,'utf8')
  assert.match(source,/from '\.\.\/lib\/val-workspaces'/,`${file} não usa o modelo compartilhado`)
  assert.ok(!/^const (primary|secondary)=\[/m.test(source),`${file} voltou a manter lista própria de módulos`)
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

test('nenhum token da marca antiga sobreviveu ao rebrand',()=>{
 const brand=readFileSync('src/val-brand.css','utf8')
 for(const legado of ['--val-logo-blue-','--val-logo-fold-','--val-logo-green-','--val-logo-leaf-start'])
  assert.ok(!brand.includes(legado),`token legado "${legado}" ainda está definido`)
 for(const oficial of ['--val-logo-stem-top','--val-logo-leaf-deep','--val-logo-vein'])
  assert.ok(brand.includes(oficial),`token oficial "${oficial}" não foi instalado`)

 const logo=readFileSync('src/components/Logo.jsx','utf8')
 assert.ok(!/#0757b6|#2d8cff|#082c57|val-logo-blue/i.test(logo),'a geometria antiga da marca ainda está no componente')
})

test('a migração cromática não deixou azul da marca antiga nas folhas',()=>{
 // Azul residual = matiz entre 185 e 245 com saturação relevante.
 const rgbToHsl=([r,g,b])=>{
  const R=r/255,G=g/255,B=b/255
  const max=Math.max(R,G,B),min=Math.min(R,G,B),d=max-min
  const l=(max+min)/2
  if(!d)return [0,0,l]
  const s=l>0.5?d/(2-max-min):d/(max+min)
  const h=max===R?((G-B)/d+(G<B?6:0)):max===G?(B-R)/d+2:(R-G)/d+4
  return [h*60,s,l]
 }
 const azuis=[]
 for(const name of readdirSync('src').filter(file=>file.endsWith('.css'))){
  const css=readFileSync(join('src',name),'utf8')
  for(const match of css.matchAll(/#([0-9a-fA-F]{6})\b/g)){
   const rgb=[0,2,4].map(i=>parseInt(match[1].slice(i,i+2),16))
   const [h,s]=rgbToHsl(rgb)
   if(s>=0.18&&h>=185&&h<=245)azuis.push(`${name}: ${match[0]}`)
  }
 }
 assert.deepEqual(azuis,[],`azul da identidade anterior ainda presente:\n${azuis.slice(0,12).join('\n')}`)
})
