import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {activeStorageScopeKey} from '../src/lib/storage-scope.js'
import {hasSurveyDraft,purgeForeignSurveyDrafts,readSurveyDraft,writeSurveyDraft} from '../src/lib/survey-draft.js'

const memoriaDeSessao=()=>{
 const dados={}
 Object.defineProperties(dados,{
  getItem:{value:key=>dados[key]??null},
  setItem:{value:(key,value)=>{dados[key]=String(value)}},
  removeItem:{value:key=>{delete dados[key]}}
 })
 return dados
}

test('o rascunho do questionario nao vaza para outro login na mesma aba', () => {
 globalThis.sessionStorage=memoriaDeSessao()
 try{
  writeSurveyDraft('escopo-da-ana',{answers:{1:'Fazenda Santa Rita',2:'Cruz Alta - RS'},seed:'s'})
  writeSurveyDraft('escopo-do-bruno',{answers:{1:'Outro produtor'},seed:'s'})
  // A aba pode receber outro login no mesmo aparelho: as respostas de um produtor nunca podem
  // reaparecer para outra pessoa.
  assert.equal(readSurveyDraft('escopo-da-ana').answers[1],'Fazenda Santa Rita')
  assert.equal(purgeForeignSurveyDrafts('escopo-da-ana'),1)
  assert.equal(readSurveyDraft('escopo-do-bruno'),null)
  assert.equal(hasSurveyDraft('escopo-da-ana'),true)
  // Sem escopo (questionário público, sem sessão) nada é gravado.
  assert.equal(writeSurveyDraft('',{answers:{1:'x'}}),false)
 }finally{delete globalThis.sessionStorage}
})

test('o rascunho e sessionStorage, nunca localStorage', () => {
 // test/ui-layout-contract.test.js trava que o rascunho técnico morre com a aba. O rascunho do
 // questionário carrega respostas do produtor e segue a mesma regra.
 const fonte=readFileSync(new URL('../src/lib/survey-draft.js',import.meta.url),'utf8')
 assert.doesNotMatch(fonte,/localStorage\s*[.[]/,'o rascunho nunca pode ser gravado em localStorage')
 assert.match(fonte,/sessionStorage/)
})

test('a expiracao da sessao nao apaga mais as respostas digitadas', async () => {
 // A MESMA tela pergunta ao trocar de aba e ao sair da página, mas a morte da sessão (12h, logout
 // em outra aba, bloqueio pelo admin) desmontava a árvore inteira sem uma palavra. Aqui não cabe
 // perguntar "deseja sair?": a sessão acabou de verdade. O que resolve é preservar.
 const directory=await mkdtemp(new URL('../.survey-draft-render-test-',import.meta.url).pathname)
 let renderer=null
 globalThis.sessionStorage=memoriaDeSessao()
 sessionStorage.setItem(activeStorageScopeKey,'escopo-da-ana')
 try{
  await build({entryPoints:['src/components/SurveyForm.jsx'],outfile:join(directory,'form.js'),bundle:true,platform:'node',format:'esm',external:['react','react-dom','react/jsx-runtime'],loader:{'.css':'empty','.json':'json'},banner:{js:"import{createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},logLevel:'silent'})
  const SurveyForm=(await import(pathToFileURL(join(directory,'form.js')).href)).default
  globalThis.window={addEventListener(){},removeEventListener(){},confirm:()=>true,scrollTo(){}}

  await act(async()=>{renderer=TestRenderer.create(React.createElement(SurveyForm,{embedded:true,onSubmit:async()=>{}}))})
  const campos=[]
  const percorrer=node=>{
   if(!node||typeof node!=='object')return
   if(node.type==='input'&&node.props?.onChange)campos.push(node)
   ;(node.children||[]).forEach(percorrer)
  }
  percorrer(renderer.toJSON())
  assert.ok(campos.length>=2,'a primeira etapa precisa ter campos de resposta')
  await act(async()=>{campos[0].props.onChange({target:{value:'Fazenda Santa Rita - Antonio Nogueira'}})})
  await act(async()=>{
   const atuais=[]
   const buscar=node=>{if(!node||typeof node!=='object')return;if(node.type==='input'&&node.props?.onChange)atuais.push(node);(node.children||[]).forEach(buscar)}
   buscar(renderer.toJSON())
   atuais[1].props.onChange({target:{value:'Cruz Alta - RS'}})
  })

  // A sessão morre: App.jsx desmonta a árvore inteira, sem passar por guarda de navegação nenhuma.
  await act(async()=>{renderer.unmount()})
  const guardado=readSurveyDraft('escopo-da-ana')
  assert.ok(guardado,'o que foi digitado na frente do produtor precisa sobreviver ao desmonte')
  assert.equal(guardado.answers[1],'Fazenda Santa Rita - Antonio Nogueira')
  assert.equal(guardado.answers[2],'Cruz Alta - RS')

  // No reingresso com o mesmo login, o formulário volta preenchido.
  await act(async()=>{renderer=TestRenderer.create(React.createElement(SurveyForm,{embedded:true,onSubmit:async()=>{}}))})
  const devolvidos=[]
  const buscar=node=>{if(!node||typeof node!=='object')return;if(node.type==='input'&&node.props?.value!==undefined)devolvidos.push(node.props.value);(node.children||[]).forEach(buscar)}
  buscar(renderer.toJSON())
  assert.ok(devolvidos.includes('Fazenda Santa Rita - Antonio Nogueira'),`as respostas precisam voltar (vieram: ${JSON.stringify(devolvidos.slice(0,4))})`)
  await act(async()=>{renderer.unmount()})
  renderer=null
 }finally{
  renderer?.unmount()
  delete globalThis.window
  delete globalThis.sessionStorage
  await rm(directory,{recursive:true,force:true})
 }
})
