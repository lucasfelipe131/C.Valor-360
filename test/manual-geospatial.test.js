import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  boundaryAsGeoJson,
  boundaryAsKml,
  parseBoundaryFile,
  polygonAreaHa,
  polygonCentroid,
  polygonPerimeterM,
  simplifyPolygon,
} from '../manual/app/lib/field-geometry.ts'
import {
  BRAZIL_UFS,
  parseCarGeoJson,
  parseSigefGml,
  queryCarAtPoint,
  querySigefAtPoint,
} from '../manual/app/lib/official-geodata.ts'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')
const square=[
  {lat:-28.0000,lng:-54.0000},
  {lat:-28.0000,lng:-53.9990},
  {lat:-28.0010,lng:-53.9990},
  {lat:-28.0010,lng:-54.0000},
]

test('geometria do talhão calcula área, perímetro e centroide sem fechar o array em duplicidade',()=>{
 const area=polygonAreaHa([...square,square[0]])
 const perimeter=polygonPerimeterM(square)
 const centroid=polygonCentroid(square)
 assert.ok(area>1&&area<1.2,`área inesperada: ${area}`)
 assert.ok(perimeter>400&&perimeter<430,`perímetro inesperado: ${perimeter}`)
 assert.ok(centroid)
 assert.ok(Math.abs(centroid.lat+28.0005)<0.00001)
 assert.ok(Math.abs(centroid.lng+53.9995)<0.00001)
})

test('KML e GeoJSON preservam um polígono válido no ciclo exportar/importar',()=>{
 const geojson=parseBoundaryFile(boundaryAsGeoJson(square,{name:'Talhão Norte'}),'talhao.geojson')
 const kml=parseBoundaryFile(boundaryAsKml(square,'Talhão Norte'),'talhao.kml')
 assert.equal(geojson.length,1)
 assert.equal(kml.length,1)
 assert.equal(geojson[0].points.length,4)
 assert.equal(kml[0].points.length,4)
 assert.equal(geojson[0].label,'Talhão Norte')
 assert.equal(kml[0].label,'Talhão Norte')
})

test('simplificação remove vértice redundante sem invalidar o limite',()=>{
 const detailed=[square[0],{lat:-28,lng:-53.9995},square[1],square[2],square[3]]
 const simplified=simplifyPolygon(detailed,1.5)
 assert.ok(simplified.length<detailed.length)
 assert.ok(simplified.length>=3)
})

test('parser SIGEF expõe apenas metadados permitidos e nunca inventa proprietário',()=>{
 const xml=`<wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml" xmlns:ms="urn:test"><gml:featureMember><ms:parcela><ms:msGeometry><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>-54.001,-28.001 -53.999,-28.001 -53.999,-27.999 -54.001,-27.999 -54.001,-28.001</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></ms:msGeometry><ms:parcela_codigo>parcela-1</ms:parcela_codigo><ms:codigo_imovel>imovel-1</ms:codigo_imovel><ms:registro_matricula>R.1-123</ms:registro_matricula><ms:codigo_municipio>4300000</ms:codigo_municipio><ms:status>CERTIFICADA</ms:status><ms:situacao_informada>REGISTRADA</ms:situacao_informada><ms:nome_area>Fazenda Teste</ms:nome_area><ms:data_aprovacao>2024-01-02</ms:data_aprovacao><ms:proprietario>Nome que não pode sair</ms:proprietario></ms:parcela></gml:featureMember></wfs:FeatureCollection>`
 const [feature]=parseSigefGml(xml,{lat:-28,lng:-54},'particular')
 assert.ok(feature)
 assert.equal(feature.registry,'R.1-123')
 assert.equal(feature.status,'CERTIFICADA')
 assert.equal(feature.ownerAvailability,'not_provided')
 assert.equal('proprietario' in feature,false)
 assert.doesNotMatch(JSON.stringify(feature),/Nome que não pode sair/)
})

test('parser CAR mantém somente campos públicos permitidos e exige polígono contendo o ponto',()=>{
 const geojson={type:'FeatureCollection',features:[
  {type:'Feature',id:'car.1',geometry:{type:'MultiPolygon',coordinates:[[[[-54.001,-28.001],[-53.999,-28.001],[-53.999,-27.999],[-54.001,-27.999],[-54.001,-28.001]]]]},properties:{cod_imovel:'RS-000-ABC',status_imovel:'AT',dat_criacao:'2020-01-02T00:00:00Z',area:14.17,condicao:'Aguardando análise',uf:'RS',municipio:'Teste',cod_municipio_ibge:4300000,m_fiscal:0.7,tipo_imovel:'IRU',proprietario:'Nome proibido',matricula:'123'}},
  {type:'Feature',id:'car.2',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},properties:{cod_imovel:'FORA'}},
  {type:'Feature',id:'car.3',geometry:{type:'Polygon',coordinates:[
   [[-54.001,-28.001],[-53.999,-28.001],[-53.999,-27.999],[-54.001,-27.999],[-54.001,-28.001]],
   [[-54.0002,-28.0002],[-53.9998,-28.0002],[-53.9998,-27.9998],[-54.0002,-27.9998],[-54.0002,-28.0002]],
  ]},properties:{cod_imovel:'FURO'}},
 ]}
 const parsed=parseCarGeoJson(geojson,{lat:-28,lng:-54})
 const [feature]=parsed
 assert.equal(parsed.length,1)
 assert.ok(feature)
 assert.equal(feature.propertyCode,'RS-000-ABC')
 assert.equal(feature.condition,'Aguardando análise')
 assert.equal(feature.declaredAreaHa,14.17)
 assert.equal(feature.ownerAvailability,'not_provided')
 assert.equal('proprietario' in feature,false)
 assert.equal('matricula' in feature,false)
 assert.doesNotMatch(JSON.stringify(feature),/Nome proibido/)
})

test('adapter SIGEF fixa host oficial, limita BBOX/resultado e rejeita UF inválida',async()=>{
 assert.equal(BRAZIL_UFS.size,27)
 const requested=[]
 const emptyFetch=async url=>{
  requested.push(new URL(String(url)))
  return {ok:true,text:async()=>'<wfs:FeatureCollection />'}
 }
 const result=await querySigefAtPoint({lat:-28,lng:-54},'RS',emptyFetch)
 assert.equal(result.status,'no_match')
 assert.equal(requested.length,2)
 requested.forEach(url=>{
  assert.equal(url.hostname,'acervofundiario.incra.gov.br')
  assert.equal(url.protocol,'https:')
  assert.equal(url.searchParams.get('MAXFEATURES'),'12')
  assert.match(url.searchParams.get('tema'),/^certificada_sigef_(particular|publico)_rs$/)
  const bbox=url.searchParams.get('BBOX').split(',').slice(0,4).map(Number)
  assert.ok(bbox[2]-bbox[0]<0.002)
  assert.ok(bbox[3]-bbox[1]<0.002)
 })
 await assert.rejects(()=>querySigefAtPoint({lat:-28,lng:-54},'XX',emptyFetch),/UF inválida/)
})

test('adapter CAR fixa WFS oficial por UF, limita BBOX/resultado e falha com segurança',async()=>{
 const requested=[]
 const emptyFetch=async url=>{
  requested.push(new URL(String(url)))
  return {ok:true,text:async()=>'{"type":"FeatureCollection","features":[]}'}
 }
 const result=await queryCarAtPoint({lat:-28,lng:-54},'RS',emptyFetch)
 assert.equal(result.status,'no_match')
 assert.equal(requested.length,1)
 const [url]=requested
 assert.equal(url.hostname,'geoserver.car.gov.br')
 assert.equal(url.protocol,'https:')
 assert.equal(url.searchParams.get('count'),'12')
 assert.equal(url.searchParams.get('typeNames'),'sicar:sicar_imoveis_rs')
 const bbox=url.searchParams.get('bbox').split(',').slice(0,4).map(Number)
 assert.ok(bbox[2]-bbox[0]<0.002)
 assert.ok(bbox[3]-bbox[1]<0.002)
 await assert.rejects(()=>queryCarAtPoint({lat:-28,lng:-54},'XX',emptyFetch),/UF inválida/)
 const unavailable=await queryCarAtPoint({lat:-28,lng:-54},'RS',async()=>{throw new Error('timeout')})
 assert.equal(unavailable.status,'unavailable')
 assert.equal(unavailable.features.length,0)
})

test('timeout/falha da fonte oficial preserva o fluxo com status indisponível',async()=>{
 const failingFetch=async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'})}
 const result=await querySigefAtPoint({lat:-28,lng:-54},'RS',failingFetch)
 assert.equal(result.status,'unavailable')
 assert.equal(result.features.length,0)
 assert.equal(result.failedSources,2)
})

test('UX de mapeamento mantém NDVI, desenho e persistência por conta enquanto adiciona fluxo guiado',()=>{
 const map=read('manual/app/FieldMap.tsx')
 const registry=read('manual/app/ProducerLandRegistry.tsx')
 const officialRoute=read('manual/app/api/geospatial/official-boundaries/route.ts')
 const workspace=read('manual/app/api/workspace/route.ts')
 assert.match(map,/Localizar[\s\S]*Importar[\s\S]*Desenhar[\s\S]*Revisar/)
 assert.match(map,/Importar KML|KML ou GeoJSON/)
 assert.match(map,/Exportar GeoJSON/)
 assert.match(map,/Exportar KML/)
 assert.match(map,/ndviTileUrl/)
 assert.match(map,/Reverter alteração/)
 assert.match(map,/Simplificar/)
 assert.match(map,/Proprietário: não disponibilizado pela fonte/)
 assert.match(map,/Consultar CAR e SIGEF neste ponto/)
 assert.match(map,/CAR não comprova domínio/)
 assert.match(registry,/boundaryEvidence/)
 assert.match(officialRoute,/sessionFromRequest/)
 assert.match(officialRoute,/BRAZIL_UFS\.has\(uf\)/)
 assert.match(workspace,/WHERE tenant_id = \$1 AND workspace_id = \$2/)
 assert.match(workspace,/ON CONFLICT \(workspace_id\)/)
 assert.match(workspace,/professional_profile AS "professionalProfile"/)
 assert.match(workspace,/ADD COLUMN IF NOT EXISTS professional_profile/)
})
