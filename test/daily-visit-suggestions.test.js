import test from 'node:test'
import assert from 'node:assert/strict'
import {dailyVisitSuggestions,narrativeFollowups} from '../src/lib/daily-visit-suggestions.js'
const now=new Date('2026-09-12T15:00:00Z')
const record=(id,extra={})=>({clientId:id,clientName:id,sourceId:id,description:`Retomar comparação ${id}`,updatedAt:now.toISOString(),...extra})
test('daily suggestions need no scheduled visits and distinguish past, today, future and undated',()=>{
 const rows=dailyVisitSuggestions({now,records:[record('past',{dueAt:'2026-09-09T15:00:00Z'}),record('today',{dueAt:now}),record('future',{dueAt:'2026-09-15T15:00:00Z'}),record('undated'),record('done',{status:'DONE'}),record('cancelled',{status:'CANCELLED'})]})
 assert.deepEqual(rows.map(r=>[r.clientId,r.classification]),[['today','DUE_TODAY'],['past','OVERDUE'],['undated','SUGGESTED']])
 assert.ok(rows.every(r=>r.confirmed===false));assert.match(rows[1].focus,/Confirmar se foi resolvido/)
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
