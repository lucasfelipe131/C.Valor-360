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
 const dia=page.indexOf('home-day-strip')
 const operacional=page.indexOf('home-operational')
 const insights=page.indexOf('home-insights')
 const copiloto=page.indexOf('home-copilot-banner')
 const acoes=page.indexOf('home-quick-actions')
 const carteira=page.indexOf('home-analytics')
 const perguntar=page.indexOf('copilot-talk')
 const aprofundar=page.indexOf('copilot-advanced-content')
 assert.ok(dia>0,'o resumo do dia sumiu da Home')
 assert.ok(operacional>dia,'a linha operacional vem depois do resumo do dia')
 assert.ok(insights>operacional,'os insights vivem dentro da linha operacional')
 assert.ok(copiloto>insights,'a faixa do Copiloto vem depois da linha operacional')
 assert.ok(acoes>copiloto,'as ações rápidas fecham o primeiro nível')
 assert.ok(carteira>acoes,'os números de carteira vêm depois de tudo que é decisão do dia')
 assert.ok(perguntar>carteira&&aprofundar>perguntar,'o segundo nível é: números, pergunta, radar')
 // A saudação é o cabeçalho, não um cartão dentro do corpo.
 assert.ok(!page.includes('copilot-welcome'),'a saudação voltou a ser um cartão sobre o cabeçalho')
 // Sem chamada nova: o resumo do dia usa o que a sessão já carregou.
 assert.ok(!/fetch\([^)]*briefing/.test(page))
})

test('dois níveis em qualquer tela: o segundo plano nasce recolhido e lembra a escolha',()=>{
 const page=readFileSync('src/pages/Dashboard.jsx','utf8')
 // Os três blocos de segundo plano usam o mesmo recolhível, com chave própria.
 for(const id of ['home-numbers','home-ask','home-deep-dive'])assert.match(page,new RegExp(`<Disclosure id="${id}"`),`o recolhível "${id}" sumiu da Home`)
 // O recolhível decide por si: nada de viewport, nada de estado local na página.
 assert.ok(!page.includes('matchMedia'),'a Home voltou a decidir pelo viewport o que fica aberto')
 assert.ok(!page.includes('className="home-deep"'),'o recolhível antigo, só de celular, voltou')
 assert.ok(!page.includes('home-rail-summary'),'"Resumo do dia" voltou a repetir os contadores do topo')

 const disclosure=readFileSync('src/components/Disclosure.jsx','utf8')
 assert.match(disclosure,/defaultOpen=false/)
 assert.match(disclosure,/localStorage\.(getItem|setItem)\(STORAGE_PREFIX\+id/)
 assert.match(disclosure,/<details className=\{`val-disclosure/)

 const css=readFileSync('src/val-workspace-shell.css','utf8')
 // Um único resumo visível nas duas telas: nada de esconder o summary no desktop.
 assert.ok(!/\.val-disclosure>summary\{display:none\}/.test(css))
 assert.match(css,/\.val-disclosure\[open\]>summary>svg\{transform:rotate\(90deg\)\}/)
 // Cartão dentro de cartão não: o que já era cartão perde a moldura ali dentro.
 assert.match(css,/\.val-disclosure \.copilot-talk\{[^}]*border:0/)
})

test('o celular manda na cascata: as regras de densidade não vazam para 375px',()=>{
 const css=readFileSync('src/val-workspace-shell.css','utf8')
 // As regras de desktop foram acrescentadas depois dos breakpoints e chegaram
 // a sobrescrevê-los; o bloco final de mobile existe para ter a última palavra.
 const ultimoMobile=css.lastIndexOf('@media(max-width:860px)')
 const duasColunas=css.lastIndexOf('.home-analytics{grid-template-columns:repeat(2')
 assert.ok(ultimoMobile>duasColunas,'a densidade de desktop voltou a vencer o breakpoint de celular')
 assert.match(css,/MOBILE — FINAL/)
})

test('no celular a VAL vem primeiro e a fala é o gesto principal',()=>{
 const page=readFileSync('src/pages/Dashboard.jsx','utf8')
 // Dois gestos na faixa da VAL: falar (principal) e escrever.
 assert.match(page,/className="is-voice" onClick=\{\(\)=>onOpenCopilot\?\.\(\{conversation:true\}\)\}><Mic/)
 assert.match(page,/onOpenCopilot\?\.\(\{capture:'text'\}\)/)
 assert.ok(!page.includes('Abrir Copiloto<'),'o botão genérico voltou no lugar dos dois gestos')

 // O pedido atravessa o resolvedor e chega ao modo conversa, que começa sozinho.
 const resolver=readFileSync('src/lib/copilot-context.js','utf8')
 assert.match(resolver,/conversation:!rejectedClient&&requested\.conversation===true/)
 const copilot=readFileSync('src/components/GlobalValCopilot.jsx','utf8')
 assert.match(copilot,/setConversationAutoStartKey\(seed\.conversation\?String\(seed\.nonce\):''\)/)
 assert.match(copilot,/autoStartKey=\{conversationAutoStartKey\}/)
 const realtime=readFileSync('src/components/copilot/ValRealtimeConversation.jsx','utf8')
 assert.match(realtime,/useEffect\(\(\)=>\{if\(autoStartKey&&inactive&&!disabled\)start\(\)\},\[autoStartKey\]\)/)

 // No celular a faixa sobe para o topo e o botão de voz é o maior da tela.
 const css=readFileSync('src/val-workspace-shell.css','utf8')
 const mobile=css.slice(css.indexOf('MOBILE — FINAL'))
 assert.match(mobile,/\.home-copilot-banner\{order:-1/)
 assert.match(mobile,/\.home-copilot-actions \.is-voice\{min-height:62px/)
 const realtimeCss=readFileSync('src/val-realtime-conversation.css','utf8')
 assert.match(realtimeCss,/@media\(max-width:760px\)\{\s*\.val-fs-conversation>\.val-conversation-opt-in\{[^}]*min-height:64px/)
})
