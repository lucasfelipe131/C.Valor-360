import test from 'node:test'
import assert from 'node:assert/strict'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {readFileSync} from 'node:fs'

const client={id:'antonio',name:'Antônio Carlos Costa Beber'}

test('matriz operacional classifica leitura, navegação, ferramenta e escrita governada',()=>{
 const cases=[
  ['Abre o produtor Antônio.','OPEN','OPEN_CLIENT',false],
  ['Procura o produtor Beber.','SEARCH','OPEN_CLIENT',false],
  ['Abre a preparação de visita do Antônio.','PREPARE','PREPARE_VISIT',false],
  ['Prepara uma visita para o Antônio.','ASK',null,false],
  ['Registra que ele aumentou 100 hectares.','REGISTER',null,true],
  ['Abre as visitas dele.','NAVIGATE','NAVIGATE',false],
  ['Marca o compromisso como concluído.','MARK_COMPLETE',null,true],
  ['Abre a análise de solo.','NAVIGATE','NAVIGATE',false],
  ['Calcula custo por hectare.','CALCULATE',null,false],
  ['Quanto está a soja hoje?','SHOW',null,false],
  ['Abre o mapa da fazenda.','NAVIGATE','NAVIGATE',false],
 ]
 for(const [message,intent,type,confirm] of cases){
  const route=routeGlobalIntent({message,client})
  assert.equal(route.intent,intent,message)
  assert.equal(route.workspace_action?.type||null,type,message)
  assert.equal(route.requires_confirmation,confirm,message)
 }
})

test('fixtures de corte de áudio cobrem pausas, hesitação, nome, ruído, frase longa e interrupção',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/val-turn-detection-uat-v1.json',import.meta.url),'utf8'))
 assert.equal(fixture.provider_mode,'semantic_vad')
 assert.equal(fixture.default_eagerness,'low')
 assert.deepEqual(new Set(fixture.cases.map(item=>item.name)),new Set(['pausa_curta','fala_hesitante','nome_proprio','frase_longa','interrupcao','mudanca_de_ideia','ruido_de_campo']))
 assert.equal(fixture.cases.find(item=>item.name==='interrupcao').expected_barge_in,true)
})
