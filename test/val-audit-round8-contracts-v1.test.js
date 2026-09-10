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

import {normalizeCadastralGeoJSON,referenceParts} from '../src/lib/cadastral-map.js'
import {manualToCanonicalValGeometry,encodeCanonicalGeometryRef} from '../src/lib/agronomic-geometry-adapter.js'
import {fieldPointsFromGeometryRef,normalizeFieldPoints} from '../server/property-profile.js'

const TENANT='tenant-geo-r8'
const ring=[{lat:-17.80,lng:-50.92},{lat:-17.80,lng:-50.91},{lat:-17.81,lng:-50.91},{lat:-17.81,lng:-50.92}]
const secondRing=ring.map(point=>({lat:Number((point.lat-.02).toFixed(7)),lng:Number((point.lng-.02).toFixed(7))}))
const multipartRef=()=>encodeCanonicalGeometryRef(manualToCanonicalValGeometry({organizationId:TENANT,clientId:'c1',propertyId:'p1',fieldId:'f1',fieldName:'Talhão 1',polygons:[ring,secondRing],provenance:{source:'manual-do-agronomo',method:'import',observedAt:new Date().toISOString(),capturedBy:'ana'}}))

// GEO-01: talhão multiparte aparecia como "Sem contorno" e era destruído no redesenho.
test('Mapa — talhão MultiPolygon entrega todas as partes a quem desenha', () => {
 const geometry=fieldPointsFromGeometryRef(multipartRef(),{organizationId:TENANT})
 assert.equal(geometry.geometryStatus,'CANONICAL')
 assert.equal(geometry.multipart,true)
 assert.equal(geometry.partCount,2)
 assert.equal(geometry.polygons.length,2)
 assert.deepEqual(geometry.points,[],'points segue vazio: quem só lê um anel não pode receber meia geometria')
})

test('Mapa — talhão de uma parte só continua entregando points', () => {
 const single=encodeCanonicalGeometryRef(manualToCanonicalValGeometry({organizationId:TENANT,clientId:'c1',propertyId:'p1',fieldId:'f2',fieldName:'Talhão 2',points:ring,provenance:{source:'valor360',method:'consultant-map-draw',observedAt:new Date().toISOString(),capturedBy:'ana'}}))
 const geometry=fieldPointsFromGeometryRef(single,{organizationId:TENANT})
 assert.equal(geometry.multipart,false)
 assert.equal(geometry.partCount,1)
 assert.equal(geometry.points.length,ring.length)
})

// GEO-04: latitude/longitude trocadas passavam pela faixa e iam para o Atlântico.
test('Mapa — arquivo com latitude e longitude trocadas é recusado', () => {
 const closed=[[-50.92,-17.80],[-50.91,-17.80],[-50.91,-17.81],[-50.92,-17.81],[-50.92,-17.80]]
 const feature=coordinates=>({type:'Feature',geometry:{type:'Polygon',coordinates:[coordinates]},properties:{matricula:'12.345'}})
 assert.ok(normalizeCadastralGeoJSON(feature(closed)),'arquivo correto precisa continuar passando')
 assert.throws(()=>normalizeCadastralGeoJSON(feature(closed.map(([lng,lat])=>[lat,lng]))),/latitude,longitude/)
})

test('Talhão — contorno com coordenadas trocadas não é salvo', () => {
 const open=[[-50.92,-17.80],[-50.91,-17.80],[-50.91,-17.81],[-50.92,-17.81]]
 assert.equal(normalizeFieldPoints(open.map(([lng,lat])=>({lat,lng})),'Talhão 1').length,4)
 assert.throws(()=>normalizeFieldPoints(open.map(([lng,lat])=>({lat:lng,lng:lat})),'Talhão 1'),error=>error.code==='field_points_swapped')
})

// GEO-03: id posicional fazia a prévia trocar de imóvel quando o mapa se movia.
test('Camadas — identificador da parte cadastral vem do conteúdo, não da posição', () => {
 const layer=(matricula,nome,base)=>({id:'official-car',geojson:normalizeCadastralGeoJSON({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[base]},properties:{matricula,nome}}]})})
 const meu=[[-50.92,-17.80],[-50.91,-17.80],[-50.91,-17.81],[-50.92,-17.81],[-50.92,-17.80]]
 const vizinho=[[-50.80,-17.70],[-50.79,-17.70],[-50.79,-17.71],[-50.80,-17.71],[-50.80,-17.70]]
 const meuId=referenceParts(layer('12.345','Fazenda São João',meu))[0].id
 const vizinhoId=referenceParts(layer('99.999','Fazenda do Vizinho',vizinho))[0].id
 assert.notEqual(meuId,vizinhoId,'imóveis diferentes na mesma posição não podem compartilhar id')
 assert.equal(referenceParts(layer('12.345','Fazenda São João',meu))[0].id,meuId,'o mesmo imóvel mantém o id entre consultas')
})

import {deterministicVoiceCandidateExtraction} from '../server/voice-capture/extraction.js'

// VOZ-2: relato longo parava no meio sem avisar; o consultor confirmava metade acreditando ter tudo.
test('Voz — relato longo marca o corte em vez de parar em silêncio', () => {
 const long=Array.from({length:80},(_,index)=>`Combinei de retornar na quinta com o comparativo ${index+1}`).join('. ')+'.'
 const extraction=deterministicVoiceCandidateExtraction({transcript:long,voiceInteractionId:'vi-1',transcriptRef:'tr-1',interactionType:'FIELD_NOTE',now:new Date('2026-09-10T12:00:00Z')})
 assert.equal(extraction.truncated,true,'o corte precisa ser declarado')
 assert.ok(extraction.clauses_skipped>0,'a tela precisa saber quantos trechos ficaram de fora')
 assert.equal(extraction.candidate_limit,50)
})

test('Voz — relato curto não é marcado como cortado', () => {
 const short='O João achou o preço caro. Combinei de retornar na quinta.'
 const extraction=deterministicVoiceCandidateExtraction({transcript:short,voiceInteractionId:'vi-2',transcriptRef:'tr-2',interactionType:'FIELD_NOTE',now:new Date('2026-09-10T12:00:00Z')})
 assert.equal(extraction.truncated,false)
 assert.equal(extraction.clauses_skipped,0)
})

// ANX-01: sem offset, qualquer anexo além do 200º mais recente era inalcançável.
test('Anexos — a listagem pagina e declara o acervo inteiro', async () => {
 const {ValRepository}=await import('../server/repository.js')
 const store={val:{attachments:Array.from({length:205},(_,index)=>({id:`a${index}`,tenantId:'t',tenant_id:'t',ownerId:'o',clientId:'c',mimeType:'image/png',status:'received',original_name:`foto-${index}.png`,created_at:new Date(2026,0,1+index).toISOString()}))}}
 const repository=new ValRepository({tenantId:'t',db:{configured:false},readStore:()=>structuredClone(store),saveStore:()=>{}})
 const first=await repository.listAttachments({ownerId:'o',clientId:'c',limit:120,offset:0,mimePrefix:'image/'})
 assert.equal(first.length,120)
 assert.equal(first.total,205)
 const second=await repository.listAttachments({ownerId:'o',clientId:'c',limit:120,offset:120,mimePrefix:'image/'})
 assert.equal(second.length,85)
 assert.equal(new Set([...first,...second].map(item=>item.id)).size,205,'nenhum anexo pode ficar inalcançável')
})
