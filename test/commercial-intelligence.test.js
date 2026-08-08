import test from 'node:test'
import assert from 'node:assert/strict'
import {buildCommercialIntelligence} from '../src/lib/commercial-intelligence.js'

test('importação comercial preserva data e resultado ausentes como desconhecidos',()=>{
  const [client]=buildCommercialIntelligence([
    {Produtor:'Fazenda Horizonte',Valor:'R$ 12.500'},
    {Produtor:'Fazenda Horizonte',Valor:'R$ 7.500'}
  ],{client:'Produtor',value:'Valor'})

  assert.equal(client.commercial.lastContactDays,null)
  assert.equal(client.commercial.lastBusinessAt,null)
  assert.equal(client.commercial.conversion,null)
  assert.equal(client.commercial.knownOutcomes,0)
  assert.doesNotMatch(client.commercial.opportunity,/reativar|motivos registrados/i)
})

test('conversão considera somente resultados explicitamente classificados',()=>{
  const [client]=buildCommercialIntelligence([
    {Produtor:'Fazenda Aurora',Status:'Fechado'},
    {Produtor:'Fazenda Aurora',Status:'Perdido'},
    {Produtor:'Fazenda Aurora',Status:'Em análise'},
    {Produtor:'Fazenda Aurora',Status:''}
  ],{client:'Produtor',status:'Status'})

  assert.equal(client.commercial.knownOutcomes,2)
  assert.equal(client.commercial.conversion,50)
})
