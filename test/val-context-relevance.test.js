import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {compactValContext,rankValContextItems,valContextTopicTokens} from '../server/val-engine.js'

const now=new Date('2026-08-17T12:00:00.000Z')

test('tokens do assunto removem palavras genéricas e preservam termos técnicos',()=>{
 assert.deepEqual(valContextTopicTokens('Preciso falar com o produtor sobre cigarrinha e Efficon no milho.'),['preciso','falar','cigarrinha','efficon','milho'])
})

test('registro antigo e relevante vence registro recente sem relação com a pergunta',()=>{
 const items=[
  {id:'recente',summary:'Planejamento de trigo e armazenagem',updatedAt:'2026-08-16T12:00:00.000Z'},
  {id:'relevante',summary:'Histórico de cigarrinha no milho e conversa sobre Efficon',updatedAt:'2025-01-10T12:00:00.000Z'}
 ]
 const ranked=rankValContextItems(items,'manejo de cigarrinha com Efficon',{kind:'interactions',now})
 assert.deepEqual(ranked.map(item=>item.id),['relevante','recente'])
})

test('entre registros igualmente relevantes, o mais recente vem primeiro e o empate é estável',()=>{
 const items=[
  {id:'antigo',summary:'cigarrinha no milho',updatedAt:'2026-01-01T12:00:00.000Z'},
  {id:'novo',summary:'cigarrinha no milho',updatedAt:'2026-08-16T12:00:00.000Z'},
  {id:'sem-data-a',summary:'cigarrinha no milho'},
  {id:'sem-data-b',summary:'cigarrinha no milho'}
 ]
 const first=rankValContextItems(items,'cigarrinha no milho',{kind:'visits',now})
 const second=rankValContextItems(items,'cigarrinha no milho',{kind:'visits',now})
 assert.deepEqual(first.map(item=>item.id),['novo','antigo','sem-data-a','sem-data-b'])
 assert.deepEqual(second,first)
})

test('compactação corta depois de ordenar e respeita o limite configurado',()=>{
 const businessHistory=Array.from({length:80},(_,index)=>({id:`hist-${index}`,summary:index===79?'cigarrinha Efficon milho':'assunto sem relação '+index,updatedAt:index===79?'2024-01-01T00:00:00.000Z':'2026-08-16T00:00:00.000Z',detail:'registro '.repeat(120)}))
 const context={client:{id:'p1',name:'Produtor Teste'},businessHistory,visits:[],interactions:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[],attachments:[],currentAttachments:[],opportunities:[]}
 const compact=compactValContext(context,12_000,'cigarrinha Efficon',{now})
 assert.ok(JSON.stringify(compact).length<=12_000)
 assert.equal(compact.businessHistory?.[0]?.id,'hist-79')
})

test('índice compacto mantém todas as oportunidades em ordem relevante',()=>{
 const opportunities=Array.from({length:200},(_,index)=>({id:`opp-${index}`,title:index===199?'Efficon para cigarrinha':`Oportunidade ${index}`,stage:index%4===0?'Fechado':'Diagnóstico',estimated_value:index*1000,probability:null,next_action_at:'2026-09-01T12:00:00.000Z',evidence:[{summary:'evidência '.repeat(20)}]}))
 const context={client:{id:'p1',name:'Produtor Teste'},opportunities,businessHistory:Array.from({length:40},()=>({detail:'histórico '.repeat(300)})),visits:[],interactions:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[],attachments:[],currentAttachments:[]}
 const compact=compactValContext(context,30_000,'Efficon cigarrinha',{now})
 const items=compact.opportunities||compact.opportunityIndex?.items||[]
 const titles=items.map(item=>Array.isArray(item)?String(item[0]):String(item.title))
 assert.equal(items.length,200)
 assert.match(titles[0],/Efficon/i)
 assert.ok(titles.some(title=>/Oportunidade 0/.test(title)))
 assert.ok(titles.some(title=>/Oportunidade 198/.test(title)))
 assert.ok(JSON.stringify(compact).length<=30_000)
})

test('engine entrega a mensagem atual ao compactador',()=>{
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 assert.match(engine,/compactValContext\(context,this\.config\.maxContextChars,message\)/)
 assert.doesNotMatch(engine,/businessHistory:\(candidate\.businessHistory\|\|\[\]\)\.slice\(0,30\)/)
})
