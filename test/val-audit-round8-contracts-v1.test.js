import {test} from 'node:test'
import assert from 'node:assert/strict'
import {recognizeQuestionnaire} from '../src/lib/smart-import.js'
import {buildCommercialIntelligence,summarizeLearning} from '../src/lib/commercial-intelligence.js'

const columnFor=header=>{
 const report=recognizeQuestionnaire({rows:[[header,'Nome do produtor','Municipio'],['VALOR-SENTINELA','Maria Souza','Sorriso']],format:'CSV'})
 return report.records[0]?.recognized.find(item=>item.value==='VALOR-SENTINELA')?.id??null
}

// IMP-002: alias curto casava por substring e o telefone ia para o campo de area.
test('Importação — cabeçalho de área continua reconhecido', () => {
 assert.equal(columnFor('Área total (ha)'),3)
 assert.equal(columnFor('Area cultivada'),3)
 assert.equal(columnFor('Hectares'),3)
 assert.equal(columnFor('ha'),3)
})

test('Importação — coluna que apenas contém "ha" não é lida como área', () => {
 for(const header of ['WhatsApp','Chácara','Trabalha com pecuária?','Telefone de contato'])assert.notEqual(columnFor(header),3,`${header} não pode virar área`)
})

test('Importação — "Há quanto tempo é cliente" não sequestra o nome do produtor', () => {
 assert.notEqual(columnFor('Há quanto tempo é cliente'),1)
 const report=recognizeQuestionnaire({rows:[['Há quanto tempo é cliente','Nome do produtor','Município'],['3 anos','Maria Souza','Sorriso']],format:'CSV'})
 assert.equal(report.records[0].producerName,'Maria Souza')
})

test('Importação — cabeçalhos legítimos seguem mapeando', () => {
 assert.equal(columnFor('Nome do produtor'),1)
 assert.equal(columnFor('Cliente'),1)
 assert.equal(columnFor('Município'),2)
 assert.equal(columnFor('Principais culturas'),4)
 assert.equal(columnFor('Quem decide a compra'),6)
})

// IMP-001 / IMP-006: data ISO lida como brasileira e data inexistente rolando de mês.
test('Importação — data ISO não é lida como data brasileira', () => {
 const mapping={client:'Cliente',value:'Valor',date:'Data',status:'Status'}
 const iso=buildCommercialIntelligence([{Cliente:'A',Valor:'1000',Data:'2026-08-20',Status:'Ganho'}],mapping)
 const br=buildCommercialIntelligence([{Cliente:'B',Valor:'1000',Data:'20/08/2026',Status:'Ganho'}],mapping)
 assert.equal(iso[0].commercial.lastPurchase,br[0].commercial.lastPurchase)
})

test('Importação — data inexistente é recusada em vez de rolar para o mês seguinte', () => {
 const mapping={client:'Cliente',value:'Valor',date:'Data',status:'Status'}
 const [client]=buildCommercialIntelligence([{Cliente:'A',Valor:'1000',Data:'31/02/2026',Status:'Ganho'}],mapping)
 assert.ok(!/03\/03|2026-03-03/.test(String(client.commercial.lastPurchase||'')),'31/02 não pode virar 03/03')
})

// IMP-003: o resumo precisa descrever o arquivo, não só o pedaço enviado.
test('Importação — resumo distingue linhas do arquivo das linhas incorporadas', () => {
 const rows=Array.from({length:12},(_,index)=>({Cliente:`P${index}`,Valor:'1000',Data:'05/03/2026',Status:'Ganho'}))
 const clients=buildCommercialIntelligence(rows,{client:'Cliente',value:'Valor',date:'Data',status:'Status'})
 const summary=summarizeLearning(clients,rows.length,'base.xlsx')
 assert.equal(summary.rowCount,rows.length)
 assert.equal(summary.clientCount,clients.length)
})
