import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {marketFormPayload} from '../src/lib/sog-market-form.js'

test('market form preserves the observed instant across browser and server timezones',()=>{
 const code="import {marketFormPayload} from './src/lib/sog-market-form.js';console.log(JSON.stringify(marketFormPayload({observedAt:'2026-09-22T21:20',sourceName:'SINTÉTICO'})))"
 const payload=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ:'America/Sao_Paulo'},encoding:'utf8'}))
 assert.equal(payload.observedAt,'2026-09-23T00:20:00.000Z')
 assert.equal(payload.sourceName,'SINTÉTICO')
 assert.throws(()=>marketFormPayload({observedAt:''}),/Informe/)
})
