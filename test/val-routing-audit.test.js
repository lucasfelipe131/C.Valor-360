import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildValRouteAudit,emitValRouteAudit,selectValModel} from '../server/val-engine.js'

const models={modelDaily:'terra',modelStrategic:'sol',modelFast:'luna'}

test('roteador explica qual regra e qual padrão escolheram o modelo',()=>{
 const explicit=selectValModel('texto comum','strategic',models)
 assert.deepEqual({tier:explicit.tier,model:explicit.model,triggerId:explicit.triggerId,source:explicit.triggerSource},{tier:'strategic',model:'sol',triggerId:'explicit_strategic_mode',source:'mode'})

 const strategic=selectValModel('Prepare a conversa com o comitê da grande conta','daily',models)
 assert.equal(strategic.tier,'strategic')
 assert.equal(strategic.triggerId,'strategic_message_pattern')
 assert.match(strategic.triggerPattern,/comit/)
 assert.match(strategic.matchedText,/comitê/i)

 const fast=selectValModel('Classifique esta importação','daily',models)
 assert.equal(fast.tier,'fast')
 assert.equal(fast.model,'luna')
 assert.equal(fast.triggerId,'fast_message_pattern')
 assert.match(fast.matchedText,/classifi/i)

 const daily=selectValModel('Prepare a visita de amanhã','daily',models)
 assert.equal(daily.tier,'daily')
 assert.equal(daily.triggerId,'default_daily')
})

test('auditoria é estruturada e não copia a mensagem integral para o log',()=>{
 const message='Produtor Exemplo quer discutir uma grande conta amanhã.'
 const route=selectValModel(message,'daily',models)
 const audit=buildValRouteAudit({message,mode:'daily',route,at:new Date('2026-08-17T01:00:00.000Z')})
 assert.equal(audit.event,'val.model_route')
 assert.equal(audit.at,'2026-08-17T01:00:00.000Z')
 assert.equal(audit.selected.tier,'strategic')
 assert.match(audit.message.sha256,/^[a-f0-9]{64}$/)
 assert.equal(audit.message.characters,message.length)
 assert.ok(audit.message.words>0)
 assert.doesNotMatch(JSON.stringify(audit),/Produtor Exemplo/)
 assert.match(audit.trigger.matchedText,/grande conta/i)
})

test('logger pode ser injetado e falha de observabilidade não derruba a recomendação',()=>{
 const events=[]
 const audit=buildValRouteAudit({message:'resuma o cadastro',mode:'daily',route:selectValModel('resuma o cadastro','daily',models)})
 assert.equal(emitValRouteAudit({info:event=>events.push(event)},audit),audit)
 assert.deepEqual(events,[audit])
 assert.doesNotThrow(()=>emitValRouteAudit({info:()=>{throw new Error('logger fora')}} ,audit))
})

test('modelRun persiste a mesma decisão de roteamento junto da recomendação',()=>{
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 assert.match(engine,/const routeAudit=emitValRouteAudit/)
 assert.match(engine,/routing:routeAudit/)
 assert.match(engine,/question:message/)
})
