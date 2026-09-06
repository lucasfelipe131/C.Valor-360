import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {TIMELINE_KIND_LABEL,buildProducerTimeline} from '../src/lib/producer-timeline.js'

const antonio={id:'c1',name:'Antônio Costa'}
const outro={id:'c2',name:'Outro Produtor'}

test('a timeline reúne visita, oportunidade, compromisso e contexto em ordem',()=>{
 const result=buildProducerTimeline({
  client:antonio,
  visits:[{id:'v1',clientId:'c1',date:'2026-08-28',lifecycleStatus:'COMPLETED',summary:'Perda confirmada no talhão norte.'}],
  opportunities:[{candidateKey:'o1',clientId:'c1',stage:'Proposta',title:'Manejo de buva',evidence:{at:'2026-08-21T10:00:00Z',from:'Diagnóstico',to:'Proposta'}}],
  commitments:[{id:'k1',clientId:'c1',due_at:'2026-09-12',description:'Retornar com comparativo.'}],
  contextMeta:{status:'proposed',updatedAt:'2026-08-14T12:00:00Z'}
 })
 assert.equal(result.items.length,4)
 assert.deepEqual(result.items.map(item=>item.kind),['commitment','visit','opportunity','context'])
 assert.equal(result.items[1].title,'Visita realizada')
 assert.equal(result.items[2].title,'Oportunidade avançou para Proposta')
 for(const item of result.items)assert.ok(TIMELINE_KIND_LABEL[item.kind],`kind "${item.kind}" sem rótulo`)
})

test('fronteira de produtor ativo: nada de outro produtor entra na linha',()=>{
 const result=buildProducerTimeline({
  client:antonio,
  visits:[
   {id:'v1',clientId:'c1',date:'2026-08-28',status:'Realizada'},
   {id:'v2',clientId:'c2',date:'2026-08-29',status:'Realizada'}
  ],
  opportunities:[{candidateKey:'o2',clientId:'c2',stage:'Proposta',evidence:{at:'2026-08-30T10:00:00Z',to:'Proposta'}}],
  commitments:[{id:'k2',clientId:'c2',due_at:'2026-09-01',description:'Compromisso do outro.'}]
 })
 assert.equal(result.items.length,1)
 assert.equal(result.items[0].id,'visit:v1')
 // Sem produtor identificado, nada atravessa por engano.
 assert.equal(buildProducerTimeline({client:outro,visits:[{id:'v1',clientId:'c1',date:'2026-08-28'}]}).items.length,0)
})

test('a VAL não estima data: registro sem data fica fora e é contado',()=>{
 const result=buildProducerTimeline({
  client:antonio,
  visits:[{id:'v1',clientId:'c1',objective:'Sem data registrada'},{id:'v2',clientId:'c1',date:'nao-e-data'}],
  opportunities:[{candidateKey:'o1',clientId:'c1',stage:'Proposta'}]
 })
 assert.equal(result.items.length,0)
 assert.equal(result.isEmpty,true)
 assert.equal(result.undated,3)
})

test('compromisso escopado pela rota entra mesmo sem ecoar o produtor',()=>{
 // /api/v1/commitments?clientId=... já vem filtrado e nem sempre devolve o campo.
 const result=buildProducerTimeline({client:antonio,commitments:[{id:'k1',due_at:'2026-09-12',description:'Combinado.'}]})
 assert.equal(result.items.length,1)
 assert.equal(result.items[0].kind,'commitment')
})

test('eventos não duplicam e o que ainda vai acontecer é contado',()=>{
 const visita={id:'v1',clientId:'c1',date:'2026-08-28',status:'Realizada'}
 const result=buildProducerTimeline({
  client:antonio,
  visits:[visita,{...visita}],
  commitments:[{id:'k1',due_at:'2999-01-01',description:'Futuro.'}]
 })
 assert.equal(result.items.filter(item=>item.kind==='visit').length,1)
 assert.equal(result.upcoming,1)
})

test('o ciclo de vida da visita vira rótulo legível, incluindo o legado textual',()=>{
 const de=status=>buildProducerTimeline({client:antonio,visits:[{id:'v',clientId:'c1',date:'2026-08-28',status}]}).items[0].title
 assert.equal(de('Em andamento'),'Visita iniciada')
 assert.equal(de('Cancelada'),'Visita cancelada')
 assert.equal(de('Preparada'),'Visita preparada')
 assert.equal(buildProducerTimeline({client:antonio,visits:[{id:'v',clientId:'c1',date:'2026-08-28',lifecycleStatus:'COMPLETED_PENDING_REVIEW'}]}).items[0].title,'Visita aguardando revisão')
})

test('o painel contextual tem três contextos e não dispara IA ao abrir',()=>{
 const panel=readFileSync('src/components/ContextPanel.jsx','utf8')
 for(const tab of ["'timeline','Timeline'","'contexto','Contexto'","'copiloto','Copiloto'"])
  assert.ok(panel.includes(tab),`aba ${tab} ausente`)
 assert.match(panel,/role="tablist"/)
 assert.match(panel,/aria-selected=\{tab===id\}/)
 assert.match(panel,/aria-controls=\{`context-pane-\$\{id\}`\}/)
 // Nenhuma chamada de rede: abrir o produtor não pode custar token nem latência.
 assert.ok(!/fetch\(/.test(panel),'o painel contextual não deve chamar API ao abrir')
 // O estado do painel é lembrado entre sessões.
 assert.match(panel,/localStorage\.setItem\(PANEL_KEY/)
})

test('o Produtor 360 entrega o Split View e só o escopo do produtor ativo',()=>{
 const page=readFileSync('src/pages/Client360.jsx','utf8')
 assert.match(page,/<div className="producer-split">/)
 assert.match(page,/producer-split-main/)
 assert.match(page,/<ContextPanel/)
 // A carteira inteira nunca chega ao painel.
 assert.match(page,/opportunities=\{clientOpportunities\}/)
 assert.match(page,/const clientOpportunities=useMemo\(\(\)=>opportunities\.filter/)
 assert.ok(!/opportunities=\{opportunities\}/.test(page),'o painel recebeu a carteira inteira')
})

test('o perfil comportamental é camada de ênfase, não estereótipo',()=>{
 const page=readFileSync('src/pages/Client360.jsx','utf8')
 for(const perfil of ['Analítico','Relacional','Inovador','Conservador','Digital'])
  assert.ok(page.includes(`'${perfil}':`),`orientação do perfil "${perfil}" ausente`)
 const panel=readFileSync('src/components/ContextPanel.jsx','utf8')
 // Sem medição não há rótulo: a VAL não supõe perfil.
 assert.match(panel,/profile\?\.measured/)
 assert.match(panel,/Perfil ainda não medido/)
})

test('o Split View colapsa em coluna única antes do mobile',()=>{
 const css=readFileSync('src/val-workspace-shell.css','utf8')
 assert.match(css,/\.producer-split\{[^}]*grid-template-columns:minmax\(0,1fr\) 366px/)
 assert.match(css,/@media\(max-width:1180px\)/)
 assert.match(css,/\.context-panel\{[^}]*position:sticky/)
})
