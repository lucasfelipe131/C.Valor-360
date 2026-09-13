import test from 'node:test'
import assert from 'node:assert/strict'
import {dailyVisitSuggestions,narrativeFollowups} from '../src/lib/daily-visit-suggestions.js'
const now=new Date('2026-09-12T15:00:00Z')
const record=(id,extra={})=>({clientId:id,clientName:id,sourceId:id,description:`Retomar comparação ${id}`,updatedAt:now.toISOString(),origin:'COMMITMENT',...extra})
test('daily suggestions need no scheduled visits and distinguish past, today, future and undated',()=>{
 const rows=dailyVisitSuggestions({now,records:[record('past',{dueAt:'2026-09-09T15:00:00Z'}),record('today',{dueAt:now}),record('future',{dueAt:'2026-09-15T15:00:00Z'}),record('undated'),record('done',{status:'DONE'}),record('cancelled',{status:'CANCELLED'})]})
 assert.deepEqual(rows.map(r=>[r.clientId,r.classification]),[['today','DUE_TODAY'],['past','OVERDUE'],['undated','SUGGESTED']])
 assert.ok(rows.every(r=>r.confirmed===false));assert.match(rows[1].focus,/Confirmar se foi resolvido/)
 assert.ok(rows.every(r=>r.attested===true))
})
// Leitura do relato não é pendência registrada: o consultor chegou a relatar que NÃO havia retorno a
// fazer e o extrator gravou "Realizar o retorno combinado." como se fosse combinado.
test('leitura não confirmada do relato chega rotulada como tal',()=>{
 const rows=dailyVisitSuggestions({now,records:[record('relato',{origin:'VISIT_REPORT',dueAt:'2026-09-09T15:00:00Z'}),record('firmado',{dueAt:now})]})
 const relato=rows.find(r=>r.clientId==='relato')
 assert.equal(relato.attested,false)
 assert.match(relato.label,/não confirmada/)
 assert.match(relato.focus,/Confirmar com o produtor se isto procede/)
 const firmado=rows.find(r=>r.clientId==='firmado')
 assert.equal(firmado.attested,true)
 assert.doesNotMatch(firmado.label,/não confirmada/)
})
test('latest update removes resolved commitment, one producer is never duplicated',()=>{
 const rows=dailyVisitSuggestions({now,records:[record('a',{updatedAt:'2026-09-10'}),record('a',{status:'DONE'}),record('b'),record('b',{sourceId:'other',description:'Outra pendência'})]})
 assert.deepEqual(rows.map(r=>r.clientId),['b'])
})
test('narrative dates are explicit and completed narratives never become a visit',()=>{
 const records=narrativeFollowups({...record('a'),summary:'Combinamos retomar o comparativo em 12/09/2026. Compromisso cancelado pelo produtor.'})
 assert.equal(records[0].dueAt,'2026-09-12T12:00:00-03:00');assert.equal(records[1].status,'DONE')
 const undated=narrativeFollowups({...record('b'),summary:'Combinamos retomar o comparativo na próxima semana.'})
 assert.equal(undated[0].dueAt,null)
})

// SDV-02: o driver do Postgres devolve updated_at como Date; String(Date) começa pelo nome do dia
// da semana, e o localeCompare ordenava a lista do dia por "Fri, Mon, Sat, Sun, Thu, Tue, Wed".
test('a lista do dia é ordenada por horário de atualização, não pelo nome do dia da semana',()=>{
 const dias=['07','08','09','10','11','12']
 const rows=dailyVisitSuggestions({now,records:dias.map(dia=>record('c'+dia,{updatedAt:new Date(`2026-09-${dia}T10:00:00Z`)}))})
 assert.deepEqual(rows.map(r=>r.clientId),['c12','c11','c10','c09','c08','c07'])
})

test('o corte da lista do dia não é silencioso',()=>{
 const rows=dailyVisitSuggestions({now,records:Array.from({length:11},(_,index)=>record('c'+index,{updatedAt:new Date(2026,8,index+1)}))})
 assert.equal(rows.length,8)
 assert.equal(rows.limit,8)
 assert.equal(rows.total,11)
 assert.equal(rows.omitted,3)
})

// SDV-03: "não pretende retomar o plantio" casava com 'retomar' e chegava à tela do dia como
// pendência a cumprir — a frase que diz que NÃO há o que fazer virava tarefa.
test('frase de negação não vira compromisso',()=>{
 for(const frase of ['O produtor não pretende retomar o plantio de milho.','Não combinamos nenhum retorno.','O produtor não vai retomar a conversa por enquanto.','Ficou sem compromisso para a próxima visita.','Nenhum compromisso ficou pendente.'])
  assert.deepEqual(narrativeFollowups({clientId:'c',sourceId:'i',summary:frase}),[],frase)
})

test('compromisso afirmativo continua virando sugestão',()=>{
 const rows=narrativeFollowups({clientId:'c',sourceId:'i',summary:'O produtor não pretende retomar o plantio de milho. Combinamos enviar a proposta até 20/09/2026.'})
 assert.equal(rows.length,1)
 assert.match(rows[0].description,/Combinamos enviar a proposta/)
 assert.equal(rows[0].dueAt,'2026-09-20T12:00:00-03:00')
})
