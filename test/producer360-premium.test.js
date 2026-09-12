import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {displayDatum,isDemoRecord,scopedRecords} from '../src/lib/producer-display.js'

test('presentation preserves missing and zero, rejects demo evidence in real context',()=>{
 for(const value of [null,undefined,'',NaN])assert.deepEqual(displayDatum(value),{value:null,kind:'MISSING'})
 assert.deepEqual(displayDatum(0),{value:0,kind:'REAL DATA'})
 assert.deepEqual(displayDatum(15,{kind:'ESTIMATE'}),{value:15,kind:'ESTIMATE'})
 assert.deepEqual(displayDatum(15,{kind:'DERIVED DATA'}),{value:15,kind:'DERIVED DATA'})
 assert.deepEqual(displayDatum(15,{record:{demo:{synthetic:true}}}),{value:null,kind:'MISSING'})
 assert.deepEqual(displayDatum(15,{record:{demo:{synthetic:true}},demo:true}),{value:15,kind:'DEMO'})
})

test('producer display filters foreign producer and synthetic evidence',()=>{
 const records=[{clientId:'a',id:'real'},{clientId:'b',id:'foreign'},{clientId:'a',id:'demo',isDemo:true}]
 assert.deepEqual(scopedRecords(records,{id:'a'}).map(item=>item.id),['real'])
 assert.deepEqual(scopedRecords(records,{id:'a',isDemo:true}).map(item=>item.id),['real','demo'])
 assert.equal(isDemoRecord({profileSource:'val-demo-synthetic-v1'}),true)
})

test('empty producer retains layout without reference facts; real fields render unchanged',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'val-p360-ssr-'))
 const vite=await createServer({cacheDir,logLevel:'silent',server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:Client360}=await vite.ssrLoadModule('/src/pages/Client360.jsx')
  const props={client:{id:'empty-a',name:'Produtor sem dados',commercial:{}},visits:[],opportunities:[]}
  const empty=renderToStaticMarkup(React.createElement(Client360,props))
  for(const title of ['Saldo estimado de grãos','Ainda não calculado','Sem informação de crédito','Perfil comportamental','Não informado','Propriedades e talhões','Indicadores da safra','Carregando dado'])assert.ok(empty.includes(title),title)
  for(const fabricated of ['5.067','2.480','1.950','284.000','13.000','Analítico','R$ 1,2','25 dias','Antonio Carlos'])assert.equal(empty.includes(fabricated),false,fabricated)
  assert.equal((empty.match(/role="tab"/g)||[]).length,11)
  const filled=renderToStaticMarkup(React.createElement(Client360,{...props,client:{...props.client,area:'712 ha',cultures:'Canola'}}))
  assert.ok(filled.includes('712 ha'));assert.ok(filled.includes('Canola'))
  const demo=renderToStaticMarkup(React.createElement(Client360,{...props,client:{...props.client,isDemo:true}}))
  assert.ok(demo.includes('Dados demonstrativos'));assert.ok(demo.includes('data-provenance="DEMO"'))
 }finally{await vite.close();await rm(cacheDir,{recursive:true,force:true})}
})
