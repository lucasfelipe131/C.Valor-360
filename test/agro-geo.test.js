import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAgronomicTerritory} from '../server/agronomic-geometry-bridge.js'
import {agroFreshness,weatherContract,cadastralContract} from '../server/agro-geo-policy.js'
import {assessGeoPlausibility} from '../src/lib/geo-plausibility.js'
import {agronomicDecisionQuery,agronomicDecisionResponse} from '../server/decision-copilot/agronomic-decision.js'
const now=Date.parse('2026-10-02T12:00:00Z'),date=new Date(now-86400000).toISOString()
const geometry={type:'Polygon',coordinates:[[[-50,-20],[-49.999,-20],[-49.999,-19.999],[-50,-19.999],[-50,-20]]]}
function fixture(){return {client:{id:'producer',name:'Synthetic'},canonicalClientId:'canonical',properties:[{id:'p',tenant_id:'t',client_id:'canonical',name:'Same name',area_ha:100,fields:[{id:'f',tenant_id:'t',property_id:'p',name:'Field',geometry,geometry_version:'v1',seasons:[{id:'s',season:'2026/27',crop:'soja'}]}]}],ndviObservations:[{id:'n',tenant_id:'t',owner_user_id:'o',client_id:'canonical',property_id:'p',field_id:'f',source:'Manual',external_id:'source-123',observed_at:date,index_name:'NDVI',geometry_version:'v1',sensor:'synthetic',resolution_m:10,cloud_percent:3,processing_version:'v1',anomaly:{flag:true}}]}}
const build=context=>buildAgronomicTerritory(context,{now,tenantId:'t',ownerId:'o'})
test('territorial scope excludes foreign tenant owner client and mismatched property',()=>{for(const change of [{tenant_id:'x'},{owner_user_id:'x'},{client_id:'x'},{property_id:'x'}]){const c=fixture();Object.assign(c.ndviObservations[0],change);assert.equal(build(c).cards.length,0)}})
test('NDVI remains observation, with provenance through the deterministic copilot',()=>{const t=build(fixture()),card=t.cards[0];assert.equal(card.validation_state,'OBSERVED');assert.equal(card.signal.evidence.causal_diagnosis,false);assert.equal(card.source_refs[0].source_ref,'source-123');const response=agronomicDecisionResponse({enabled:true,items:t.cards});assert.deepEqual(response.agronomicDecisionCards,t.cards);assert.equal(response.responseMetadata.providerCalls,0)})
test('stale NDVI cannot turn into a current diagnosis or keep its priority',()=>{const c=fixture(),current=build(c).cards[0];c.ndviObservations[0].observed_at='2020-01-01';const stale=build(c).cards[0];assert.equal(stale.signal.freshness,'STALE');assert.ok(stale.priority.score<current.priority.score);assert.equal(stale.confidence,'LOW')})
test('missing soil units block comparisons; unlinked imagery is queued',()=>{const c=fixture();c.soilAnalyses=[{...c.ndviObservations[0],id:'soil',sampled_at:date,measurements:[{raw_value:20,raw_unit:null}]}];c.ndviObservations[0].field_id=null;const t=build(c);assert.equal(t.cards[0].signal.evidence.comparisons_allowed,false);assert.equal(t.unlinked.length,1)})
test('probable disease, pests without sampling, and insufficient weed ID cannot be validated',()=>{for(const category of ['DISEASE_RISK','PEST_RISK','WEED_PRESSURE']){const c=fixture();c.ndviObservations=[];c.fieldReports=[{...fixture().ndviObservations[0],observations:[{id:'obs',observation_type:category,value:{validation_state:'PROBABLE'}}]}];const card=build(c).cards[0];assert.equal(card.validation_state,'PROBABLE');assert.notEqual(card.confidence,'HIGH');assert.ok(!JSON.stringify(card).includes('dose'))}})
test('geometry review detects closure, self intersection, duplicates, area and containment',()=>{
 assert.equal(assessGeoPlausibility(geometry).status,'VALID')
 assert.ok(assessGeoPlausibility(geometry,{otherGeometries:[geometry]}).reasons.includes('SPATIAL_DUPLICATE'))
 assert.ok(assessGeoPlausibility(geometry,{areaHa:100,calculatedAreaHa:1,propertyAreaHa:2}).reasons.includes('AREA_MISMATCH'))
 const open=structuredClone(geometry);open.coordinates[0].pop();assert.ok(assessGeoPlausibility(open).reasons.includes('UNCLOSED_RING'))
 const cross={type:'Polygon',coordinates:[[[-50,-20],[-49,-19],[-50,-19],[-49,-20],[-50,-20]]]};assert.ok(assessGeoPlausibility(cross).reasons.includes('SELF_INTERSECTION'))
 const outside={type:'Polygon',coordinates:[[[10,10],[11,10],[11,11],[10,10]]]};assert.ok(assessGeoPlausibility(outside).reasons.includes('OUTSIDE_BRAZIL'));assert.ok(assessGeoPlausibility(outside,{parentGeometry:geometry}).reasons.includes('FIELD_OUTSIDE_PROPERTY'))
 assert.ok(assessGeoPlausibility(geometry,{crs:'EPSG:3857'}).reasons.includes('CRS_UNSUPPORTED'))
})
test('no invented current weather or official cadastral ownership',()=>{assert.equal(weatherContract().CURRENT_WEATHER,'UNAVAILABLE');assert.equal(cadastralContract({source_ref:'https://example.com',canonical_link_verified:true}).status,'UNVERIFIED');assert.equal(cadastralContract({ambiguous:true}).status,'AMBIGUOUS');assert.equal(cadastralContract().readiness,'CONTRACT_READY');assert.equal(cadastralContract().LIVE_SOURCE_AVAILABLE,false)})
test('freshness differs by evidence type and future observations are not current',()=>{const old=new Date(now-30*86400000).toISOString();assert.equal(agroFreshness('soil',old,now),'CURRENT');assert.equal(agroFreshness('ndvi',old,now),'STALE');assert.equal(agroFreshness('weather','2030-01-01',now),'FUTURE')})
test('same property name does not merge clients; ambiguous seasons enter review',()=>{const c=fixture();c.properties.push({...c.properties[0],id:'other',client_id:'another'});c.properties[0].fields[0].seasons.push({id:'s2',season:'2026/27',crop:'milho'});const t=build(c);assert.equal(t.properties.length,1);assert.ok(t.conflicts.some(c=>c.type==='CROP_SEASON_CONFLICT'))})
test('100 properties and 500 fields produce bounded useful cards without quadratic portfolio joins',()=>{const c=fixture();c.ndviObservations=[];c.properties=Array.from({length:100},(_,p)=>({...fixture().properties[0],id:`p${p}`,fields:Array.from({length:5},(_,f)=>({...fixture().properties[0].fields[0],id:`f${p}-${f}`,property_id:`p${p}`}))}));const start=performance.now(),t=build(c);assert.equal(t.properties.flatMap(p=>p.fields).length,500);assert.ok(performance.now()-start<2000)})
test('all requested territorial Copilot questions use same route',()=>{for(const q of ['Qual talhão eu deveria olhar primeiro?','Onde estão as principais anomalias?','Por que esse talhão está prioritário?','Tem algum sinal de problema nesta propriedade?','Compare os talhões desta safra.','Cruze solo, NDVI e histórico.','Que informação falta para concluir?'])assert.equal(agronomicDecisionQuery(q),true,q)})

test('territorial Copilot preserves exact canonical response scope',async()=>{
 const {assertValResponseScope}=await import('../server/decision-copilot/response-scope.js')
 for(const domain of ['AGRONOMY','GEO','GENERAL','MULTI_DOMAIN']){
  const payload=agronomicDecisionResponse({enabled:true,items:[]},{tenantId:'t',ownerId:'o',clientId:'c',conversationId:'chat',contextEpoch:3,domain})
  assert.doesNotThrow(()=>assertValResponseScope(payload,{tenantId:'t',ownerId:'o',producerId:'c',conversationId:'chat',contextEpoch:3,domain}))
 }
})
