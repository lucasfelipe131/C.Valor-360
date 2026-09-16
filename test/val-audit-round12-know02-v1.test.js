import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import test from 'node:test'
import {buildGeneralNoClientResponse} from '../server/decision-copilot/capability-executor.js'
import {routeSystemCapability} from '../server/decision-copilot/capability-router.js'

// KNOW-02. O caminho geral entrega um item governado da Biblioteca e declara VERIFICADO 0.9, mas
// devolvia knowledge_refs vazio: nenhuma fonte SRC-, nenhuma autoridade, nenhum caveat de geografia
// ou de validade. Em item HIGH o texto avisava "exige responsavel tecnico habilitado" enquanto
// agronomic_context.human_review_required - o campo que a tela e a qualidade leem - vinha false.
// O caminho irmao (prepare-visit, via compactKnowledgeRefs) ja publicava tudo isso do MESMO item,
// entao a informacao existia e era descartada na saida.
const now=new Date('2026-08-30T12:00:00.000Z')
const perguntaHighRisk='Fonte regulatória prevalece em defensivos'

const responder=async message=>{
 const route=routeSystemCapability({message,hasClient:false})
 return buildGeneralNoClientResponse({message,route,organizationId:'00000000-0000-4000-8000-000000000001',ownerId:'owner-know02',conversationId:'k2',contextEpoch:0,now})
}

test('KNOW-02 — item governado chega com fonte, autoridade, risco e caveats da curadoria',async()=>{
 const payload=await responder(perguntaHighRisk)
 const reasoning=payload.advice.ai_reasoning
 assert.equal(reasoning.run.tool_result.context.knowledge_item_id,'KI-056','pré-requisito: a Biblioteca respondeu esta pergunta')
 const [ref]=reasoning.knowledge_refs
 assert.ok(ref,'a resposta nao pode declarar VERIFICADO sem dizer o que a verificou')
 assert.equal(ref.knowledge_item_id,'KI-056')
 assert.ok(ref.source_refs.length>0,'a fonte precisa viajar junto')
 assert.ok(ref.source_refs.every(item=>/^SRC-/.test(item)))
 assert.equal(ref.authority,'A')
 assert.equal(ref.risk,'HIGH')
 assert.equal(ref.library_version,'1.0')
 assert.ok(ref.freshness_caveats.length>0,'o caveat de validade da curadoria nao pode ser descartado')
 assert.equal(ref.requires_human_review,true)
})

test('KNOW-02 — item que exige responsavel tecnico marca o campo, nao so o texto',async()=>{
 const payload=await responder(perguntaHighRisk)
 const reasoning=payload.advice.ai_reasoning
 assert.match(reasoning.recommended_strategy.reading,/responsável técnico habilitado/)
 assert.equal(reasoning.agronomic_context.human_review_required,true)
})

test('KNOW-02 — pergunta sem cobertura da Biblioteca continua sem referencia forjada',async()=>{
 const payload=await responder('bom dia')
 assert.deepEqual(payload.advice.ai_reasoning.knowledge_refs,[],'saudacao nao vem da Biblioteca e nao pode ganhar fonte')
})

test('KNOW-02 — o painel de evidencias mostra fonte e caveats, nao apenas o titulo',async()=>{
 const directory=await mkdtemp(new URL('../.know02-render-',import.meta.url).pathname)
 let renderer
 const reasoning={
  facts_used:[],
  knowledge_refs:[{
   knowledge_item_id:'KI-056',title:'Fonte regulatória prevalece em defensivos',source_refs:['SRC-018'],
   authority:'A',risk:'HIGH',usage_mode:'GUARDRAIL_ONLY',library_version:'1.0',
   geography_caveats:['Escopo geográfico Brazil; validar aplicabilidade no contexto local antes de usar.'],
   freshness:'UNKNOWN',freshness_caveats:['Validade temporal não informada; aplicar somente dentro do escopo declarado e manter revisão governada.'],
   requires_human_review:true
  }],
  agronomic_context:{sources:{}},premises:{}
 }
 try{
  await build({entryPoints:['src/components/copilot/ValContextualPanel.jsx'],outfile:join(directory,'painel.js'),bundle:true,platform:'node',format:'esm',external:['react','react-dom','react/jsx-runtime'],loader:{'.css':'empty','.json':'json','.png':'empty','.svg':'empty'},banner:{js:"import{createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},logLevel:'silent'})
  const modulo=await import(pathToFileURL(join(directory,'painel.js')).href)
  const Painel=modulo.default||modulo.ValContextualPanel
  const texto=()=>{
   const partes=[]
   const percorrer=node=>{
    if(typeof node==='string'){partes.push(node);return}
    if(Array.isArray(node)){node.forEach(percorrer);return}
    if(!node||typeof node!=='object')return
    ;(node.children||[]).forEach(percorrer)
   }
   percorrer(renderer.toJSON())
   return partes.join(' ')
  }
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Painel,{open:true,tab:'evidence',latestPayload:{advice:{ai_reasoning:reasoning}},client:null,context:null,history:[]}))})
  const visivel=texto()
  assert.match(visivel,/Fonte regulatória prevalece em defensivos/)
  assert.match(visivel,/SRC-018/,'o consultor precisa poder conferir a fonte')
  assert.match(visivel,/Autoridade A/)
  assert.match(visivel,/Risco HIGH/)
  assert.match(visivel,/validar aplicabilidade no contexto local/i,'o caveat da curadoria tem que chegar na tela')
  assert.match(visivel,/Validade temporal não informada/i)
 }finally{
  renderer?.unmount()
  await rm(directory,{recursive:true,force:true})
 }
})
