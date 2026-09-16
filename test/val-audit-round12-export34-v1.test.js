import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {csvExportIsPartial,csvExportScope,managementCsv,recordedTravel,summarizeManagement} from '../src/lib/management-data.js'

const at=iso=>new Date(iso).toISOString()

// EXPORT-04. A quilometragem gerencial somava qualquer trecho entre dois pontos separados por ate
// 120 s, sem nenhum teste de plausibilidade. Um unico salto de GPS de 79,5 km em 105 s - 2.726 km/h
// - virava 80,6 km no painel do gestor, num dia cujo trajeto real foi 1,1 km.
const trajetoReal=[
 {lat:-28.0000,lng:-54.0000,timestamp:at('2026-09-12T15:00:00Z')},
 {lat:-28.0050,lng:-54.0000,timestamp:at('2026-09-12T15:01:00Z')},
 {lat:-28.0100,lng:-54.0000,timestamp:at('2026-09-12T15:02:00Z')}
]
const comSaltoDeGps=[
 {lat:-28.0000,lng:-54.0000,timestamp:at('2026-09-12T15:00:00Z')},
 {lat:-28.0050,lng:-54.0000,timestamp:at('2026-09-12T15:01:00Z')},
 {lat:-28.7200,lng:-54.0000,timestamp:at('2026-09-12T15:02:45Z')},
 {lat:-28.7250,lng:-54.0000,timestamp:at('2026-09-12T15:03:45Z')}
]

test('EXPORT-04 — salto de GPS impossivel nao entra na quilometragem',()=>{
 const limpo=recordedTravel(trajetoReal)
 const sujo=recordedTravel(comSaltoDeGps)
 assert.equal(limpo.discardedSegments,0)
 assert.equal(sujo.discardedSegments,1,'o trecho impossível precisa ser contado, não apenas sumir')
 assert.ok(Math.abs(sujo.distanceKm-limpo.distanceKm)<0.001,`o salto ainda entra: ${sujo.distanceKm} km`)
 assert.ok(sujo.distanceKm<2,'o dia real tem pouco mais de 1 km')
})

test('EXPORT-04 — deslocamento rodoviario legitimo continua contado',()=>{
 // ~2 km em 60 s = 120 km/h. Rápido, plausível, e não pode ser descartado.
 const rodovia=recordedTravel([
  {lat:-28.0000,lng:-54.0000,timestamp:at('2026-09-12T15:00:00Z')},
  {lat:-28.0180,lng:-54.0000,timestamp:at('2026-09-12T15:01:00Z')}
 ])
 assert.equal(rodovia.discardedSegments,0)
 assert.equal(rodovia.segments,1)
 assert.ok(rodovia.distanceKm>1.8&&rodovia.distanceKm<2.2)
})

test('EXPORT-04 — o resumo da unidade propaga os trechos descartados',()=>{
 const routes=[{...recordedTravel(comSaltoDeGps)},{...recordedTravel(trajetoReal)}]
 assert.equal(summarizeManagement({producers:[],visits:[],routes}).discardedSegments,1)
})

// EXPORT-03. O painel corta a lista de produtores em 5.000 linhas e avisa NA TELA. O CSV baixado
// nao carregava marca nenhuma: aberto no Power BI depois, ou recebido por e-mail, 5.000 produtores
// se leem como a carteira inteira.
test('EXPORT-03 — a abrangencia do arquivo e declarada dentro do CSV, em toda linha',()=>{
 const parcial=csvExportScope({truncated:true,rows:5000,total:5001})
 assert.match(parcial,/^PARCIAL: 5000 de 5001 produtores da carteira$/)
 assert.equal(csvExportIsPartial(parcial),true)
 const completo=csvExportScope({truncated:false,rows:12,total:12})
 assert.equal(completo,'COMPLETO no filtro aplicado')
 assert.equal(csvExportIsPartial(completo),false)

 const colunas=[{key:'name'},{key:'exportScope'}]
 const csv=managementCsv(colunas,[{name:'Produtor A',exportScope:parcial},{name:'Produtor B',exportScope:parcial}])
 const linhas=csv.replace('﻿','').trim().split('\r\n')
 assert.equal(linhas[0],'"name","exportScope"')
 // Em TODA linha: sobrevive a filtro, ordenação e reexportação no Power BI.
 for(const linha of linhas.slice(1))assert.match(linha,/"PARCIAL: 5000 de 5001 produtores da carteira"$/)
})

test('EXPORT-03 — a tela de gestao exporta a coluna de abrangencia e marca o nome do arquivo',()=>{
 const pagina=readFileSync(new URL('../src/pages/Management.jsx',import.meta.url),'utf8')
 // A coluna precisa estar declarada nos três arquivos exportáveis, não só no de produtores.
 assert.equal(pagina.match(/\['exportScope','Abrangência do arquivo'\]/g)?.length,3)
 assert.match(pagina,/csvExportScope\(\{truncated:kind==='producers'&&Boolean\(data\?\.truncated\?\.producers\)/)
 assert.match(pagina,/csvExportIsPartial\(exportScope\)\?'-parcial':''/)
})
