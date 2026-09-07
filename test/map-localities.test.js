import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {searchMunicipalities,localityBounds} from '../src/lib/map-localities.js'
const rows=JSON.parse(readFileSync('public/geo/municipalities.json'))
test('municipality search accepts accents and UF and distinguishes namesakes',()=>{
 assert.equal(searchMunicipalities(rows,'sao luiz gonzaga','RS')[0][0],'4318903')
 assert.equal(searchMunicipalities(rows,'São Luiz Gonzaga RS')[0][0],'4318903')
 assert.equal(searchMunicipalities(rows,'sao luiz gonzaga','SC').length,0)
 assert.equal(searchMunicipalities(rows,'').length,0)
 assert.ok(new Set(searchMunicipalities(rows,'Bom Jesus').map(row=>row[2])).size>1)
})
test('IBGE state reference includes 27 divisions; municipality extents are navigation only',()=>{
 const geo=JSON.parse(readFileSync('public/geo/states.geojson'))
 assert.equal(geo.features.length,27)
 assert.equal(new Set(geo.features.map(f=>f.properties.uf)).size,27)
 const row=searchMunicipalities(rows,'São Luiz Gonzaga','RS')[0]
 const b=localityBounds(row);assert.ok(b[0][0]<-28&&b[1][0]>-29)
 assert.equal(localityBounds(['missing','Missing','RS',null]),null)
 assert.equal(localityBounds(['bad','Invalid','RS',[0,0,0,0]]),null)
})
