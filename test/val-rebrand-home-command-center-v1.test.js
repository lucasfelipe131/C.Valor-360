import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {buildDayBriefing,visitLifecycle,visitMoment} from '../src/lib/home-command-center.js'

const now=new Date('2026-09-02T09:00:00')
const clients=[{id:'c1',name:'Antônio Costa',municipality:'Sorriso/MT',commercial:{property:'Fazenda Santa Clara'}}]
const card=(briefing,id)=>briefing.cards.find(item=>item.id===id)

test('os quatro contadores do dia saem do ciclo de vida real da agenda',()=>{
 const briefing=buildDayBriefing({
  now,clients,
  visits:[
   {id:'v1',clientId:'c1',date:'2026-09-02',time:'14:00',lifecycleStatus:'PREPARED'},
   {id:'v2',clientId:'c1',date:'2026-09-02',time:'08:00',lifecycleStatus:'COMPLETED'},
   {id:'v3',clientId:'c1',date:'2026-09-05',time:'10:00',status:'Agendada'},
   {id:'v4',clientId:'c1',date:'2026-08-30',lifecycleStatus:'COMPLETED_PENDING_REVIEW'},
   {id:'v5',clientId:'c1',date:'2026-09-02',lifecycleStatus:'CANCELLED'}
  ],
  opportunities:[{stage:'Proposta'},{stage:'Diagnóstico'},{stage:'Fechado'},{stage:'Perdido'}]
 })
 assert.equal(card(briefing,'today').value,2)          // a cancelada não conta
 assert.equal(card(briefing,'today').hint,'1 concluída')
 assert.equal(card(briefing,'prepared').value,1)
 assert.equal(card(briefing,'opportunities').value,2)  // fechado e perdido saem
 assert.equal(card(briefing,'pending').value,1)
 for(const item of briefing.cards)assert.ok(item.page,`o contador "${item.id}" precisa levar a algum módulo`)
})

test('carteira vazia devolve zero e explica, em vez de inventar urgência',()=>{
 const briefing=buildDayBriefing({now,clients:[],visits:[],opportunities:[]})
 assert.deepEqual(briefing.cards.map(item=>item.value),[0,0,0,0])
 assert.equal(card(briefing,'today').hint,'Nenhuma na agenda de hoje')
 assert.equal(card(briefing,'pending').hint,'Nada aguardando registro')
 assert.equal(briefing.upcoming.length,0)
})

test('as próximas visitas vêm ordenadas, vinculadas ao produtor e limitadas a quatro',()=>{
 const visits=Array.from({length:6},(_,index)=>({
  id:`v${index}`,clientId:'c1',date:`2026-09-${String(10+index).padStart(2,'0')}`,time:'09:00',status:'Agendada',objective:`Objetivo ${index}`
 }))
 const briefing=buildDayBriefing({now,clients,visits,opportunities:[]})
 assert.equal(briefing.upcoming.length,4)
 assert.deepEqual(briefing.upcoming.map(item=>item.id),['v0','v1','v2','v3'])
 assert.equal(briefing.upcoming[0].clientName,'Antônio Costa')
 assert.equal(briefing.upcoming[0].place,'Fazenda Santa Clara')
 // O que já passou ou já foi fechado não é "próxima visita".
 assert.equal(buildDayBriefing({now,clients,visits:[{id:'p',clientId:'c1',date:'2026-08-01',status:'Agendada'}],opportunities:[]}).upcoming.length,0)
})

test('visita sem produtor vinculado é nomeada com honestidade',()=>{
 const briefing=buildDayBriefing({now,clients,visits:[{id:'v',clientId:'desconhecido',date:'2026-09-04',time:'09:00',status:'Agendada'}],opportunities:[]})
 assert.equal(briefing.upcoming[0].clientName,'Produtor não vinculado')
 assert.equal(briefing.upcoming[0].objective,'Objetivo ainda não registrado.')
})

test('visita sem data não entra na lista e é contada à parte',()=>{
 const briefing=buildDayBriefing({now,clients,visits:[{id:'v',clientId:'c1',status:'Agendada'}],opportunities:[]})
 assert.equal(briefing.upcoming.length,0)
 assert.equal(briefing.undatedVisits,1)
})

test('o ciclo de vida legado em texto continua sendo entendido',()=>{
 assert.equal(visitLifecycle({status:'Em andamento'}),'IN_PROGRESS')
 assert.equal(visitLifecycle({status:'Realizada'}),'COMPLETED')
 assert.equal(visitLifecycle({status:'Aguardando revisão'}),'COMPLETED_PENDING_REVIEW')
 assert.equal(visitLifecycle({lifecycleStatus:'PREPARED',status:'Realizada'}),'PREPARED')
 assert.equal(visitMoment({date:'2026-09-02',time:'14:30'})?.getHours(),14)
 assert.equal(visitMoment({}),null)
})

test('a Home mostra o dia antes dos números de carteira',()=>{
 const page=readFileSync('src/pages/Dashboard.jsx','utf8')
 assert.match(page,/buildDayBriefing/)
 const strip=page.indexOf('home-day-strip')
 const next=page.indexOf('home-next-visits')
 const priorities=page.indexOf('copilot-priorities')
 const advanced=page.indexOf('copilot-advanced')
 assert.ok(strip>0&&next>strip,'as próximas visitas vêm depois do resumo do dia')
 assert.ok(next<priorities,'o dia vem antes das prioridades')
 assert.ok(priorities<advanced,'os números de carteira continuam sendo aprofundamento')
 // Sem chamada nova: o resumo do dia usa o que a sessão já carregou.
 assert.ok(!/fetch\([^)]*briefing/.test(page))
})
