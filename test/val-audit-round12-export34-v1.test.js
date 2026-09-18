import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {csvExportIsPartial,csvExportScope,implausibleGroundStep,managementCsv,recordedTravel,summarizeManagement} from '../src/lib/management-data.js'

const distanciaKm=(a,b)=>{const r=Math.PI/180;const dlat=(b.lat-a.lat)*r;const dlng=(b.lng-a.lng)*r;const v=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v))}

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


test('EXPORT-04 — a tela do consultor e a do gestor leem o mesmo numero do mesmo trace',()=>{
 // O teto de 200 km/h entrou primeiro só no painel de gestão. Medido pela rodada 13: no mesmo trace
 // do mesmo dia o consultor lia "81 km registrados por GPS" e o gestor lia 1,2 km — e o aviso do
 // descarte existia só num dos dois lados. A regra agora vive num lugar só.
 const telaDoConsultor=trace=>{
  const segmentos=[];let pontos=[];let descartados=0
  for(const ponto of trace){
   const anterior=pontos.at(-1)
   if(anterior){
    const segundos=(Date.parse(ponto.timestamp)-Date.parse(anterior.timestamp))/1000
    const salto=implausibleGroundStep(distanciaKm(anterior,ponto),segundos)
    if(segundos>120||salto){if(salto)descartados+=1;if(pontos.length>1)segmentos.push(pontos);pontos=[]}
   }
   pontos.push(ponto)
  }
  if(pontos.length>1)segmentos.push(pontos)
  return {km:segmentos.reduce((total,item)=>total+item.slice(1).reduce((soma,ponto,indice)=>soma+distanciaKm(item[indice],ponto),0),0),descartados}
 }
 for(const [nome,trace] of [['trajeto real',trajetoReal],['com salto de GPS',comSaltoDeGps],['só o salto',[{lat:-28.0,lng:-54.0,timestamp:at('2026-09-12T15:00:00Z')},{lat:-28.76,lng:-54.0,timestamp:at('2026-09-12T15:01:45Z')}]]]){
  const gestor=recordedTravel(trace)
  const consultor=telaDoConsultor(trace)
  assert.ok(Math.abs((gestor.distanceKm||0)-consultor.km)<0.001,`${nome}: gestor ${gestor.distanceKm} km, consultor ${consultor.km} km`)
  assert.equal(gestor.discardedSegments,consultor.descartados,`${nome}: contagem de descartes diferente`)
 }
})

test('EXPORT-03 — coluna nova entra no fim e nao desloca coluna existente',()=>{
 const pagina=readFileSync(new URL('../src/pages/Management.jsx',import.meta.url),'utf8')
 const rotas=pagina.slice(pagina.indexOf(' routes:['),pagina.indexOf('\n}',pagina.indexOf(' routes:[')))
 const chaves=[...rotas.matchAll(/\['([a-zA-Z]+)',/g)].map(item=>item[1])
 // A ordem histórica precisa ser prefixo da ordem atual: quem lê o CSV por posição não pode quebrar.
 assert.deepEqual(chaves.slice(0,9),['unitId','consultantId','consultant','date','distanceKm','recordedSeconds','segments','timeZone','dataStatus'])
 assert.deepEqual(chaves.slice(9),['discardedSegments','exportScope'])
})

test('EXPORT-04 — a tela do consultor avisa o descarte, como o painel de gestao',()=>{
 const mapa=readFileSync(new URL('../src/components/map/RouteMap.jsx',import.meta.url),'utf8')
 assert.match(mapa,/implausibleGroundStep/,'a tela do consultor usa a mesma regra')
 assert.match(mapa,/trecho\$\{recorded\.discarded>1\?'s':''\} de GPS descartado/,'e diz que descartou')
})
