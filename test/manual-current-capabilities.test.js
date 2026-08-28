import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {
 manualNavigationProtocolVersion,
 normalizeManualNavigation,
 resolveManualNavigationContext,
} from '../manual/app/valor360-navigation.ts'

const read=relative=>readFileSync(join(process.cwd(),relative),'utf8')

test('protocolo v1 normaliza deep-links de mapa, calculadora, solo e scans',()=>{
 assert.equal(manualNavigationProtocolVersion,1)
 const mapping=normalizeManualNavigation({type:'valor360:navigate',version:1,requestId:'map-1',tool:'AREA_MAPPING',context:{clientId:'p1',fieldId:'f1'}})
 assert.deepEqual(mapping,{type:'valor360:navigate',version:1,requestId:'map-1',page:'produtores',tool:'mapping',calculator:undefined,diagnosisMode:undefined,context:{clientId:'p1',fieldId:'f1'}})
 const soil=normalizeManualNavigation({type:'valor360:navigate',tool:'ANALYZE_SOIL',analysisId:'a1'})
 assert.equal(soil.page,'solo')
 assert.equal(soil.context.analysisId,'a1')
 const diagnosis=normalizeManualNavigation({type:'valor360:navigate',tool:'FitScan',context:{clientId:'p1'}})
 assert.equal(diagnosis.page,'diagnostico')
 assert.equal(diagnosis.diagnosisMode,'disease')
 const calculator=normalizeManualNavigation({type:'valor360:navigate',tool:'calculators',calculator:'fertilizante'})
 assert.equal(calculator.page,'calculadoras')
 assert.equal(calculator.calculator,'fertilizante')
 assert.equal(normalizeManualNavigation({type:'valor360:navigate',version:2,page:'solo'}),null)
 assert.equal(normalizeManualNavigation({type:'valor360:navigate',tool:'FITO_SCAN'}).diagnosisMode,'disease')
 assert.equal(normalizeManualNavigation({type:'valor360:navigate',tool:'NUTRI_SCAN'}).diagnosisMode,'nutrition')
})

test('contexto não aceita autoridade e só resolve entidades da carteira carregada',()=>{
 const producers=[
  {id:'p1',crmCode:'crm-1',name:'João',properties:'Fazenda Sul',registrations:[{id:'r1',propertyName:'Fazenda Sul'}],fields:[{id:'f1',name:'Norte',registrationId:'r1'}]},
  {id:'p2',name:'Maria',properties:'Fazenda Norte',fields:[{id:'f2',name:'Leste'}]},
 ]
 const analyses=[{id:'a1',recordId:'ra1',producerId:'p1',property:'Fazenda Sul',fieldId:'f1'}]
 const command=normalizeManualNavigation({
  type:'valor360:navigate',tool:'soil',
  context:{tenantId:'tenant-forjado',ownerId:'owner-forjado',workspaceId:'workspace-forjado',clientId:'p1',analysisId:'a1'},
 })
 assert.deepEqual(command.context,{clientId:'p1',analysisId:'a1'})
 const resolved=resolveManualNavigationContext(command,producers,analyses)
 assert.deepEqual(resolved.issues,[])
 assert.deepEqual(resolved.context,{clientId:'p1',clientName:'João',propertyId:'r1',propertyName:'Fazenda Sul',fieldId:'f1',fieldName:'Norte',analysisId:'a1'})

 const crossField=normalizeManualNavigation({type:'valor360:navigate',tool:'mapping',context:{clientId:'p1',fieldId:'f2'}})
 const rejectedField=resolveManualNavigationContext(crossField,producers,analyses)
 assert.ok(rejectedField.issues.includes('field_not_in_client'))
 assert.equal(rejectedField.context.fieldId,undefined)

 const forgedProperty=normalizeManualNavigation({type:'valor360:navigate',tool:'mapping',context:{clientId:'p1',propertyId:'property-outside',propertyName:'Fazenda Sul'}})
 const rejectedPropertyId=resolveManualNavigationContext(forgedProperty,producers,analyses)
 assert.ok(rejectedPropertyId.issues.includes('property_id_not_in_client'))
 assert.equal(rejectedPropertyId.context.propertyName,'Fazenda Sul')
 assert.equal(rejectedPropertyId.context.propertyId,'r1')

 const crossAnalysis=normalizeManualNavigation({type:'valor360:navigate',tool:'soil',context:{clientId:'p2',analysisId:'a1'}})
 const rejectedAnalysis=resolveManualNavigationContext(crossAnalysis,producers,analyses)
 assert.ok(rejectedAnalysis.issues.includes('analysis_outside_client'))
 assert.equal(rejectedAnalysis.context.analysisId,undefined)

 const invalidClientWithValidAnalysis=normalizeManualNavigation({type:'valor360:navigate',tool:'soil',context:{clientId:'outside',analysisId:'a1'}})
 const rejectedMixedContext=resolveManualNavigationContext(invalidClientWithValidAnalysis,producers,analyses)
 assert.ok(rejectedMixedContext.issues.includes('analysis_outside_client'))
 assert.equal(rejectedMixedContext.context.analysisId,undefined)

 const fieldOnly=normalizeManualNavigation({type:'valor360:navigate',tool:'mapping',context:{clientId:'p1',fieldId:'f1'}})
 assert.deepEqual(resolveManualNavigationContext(fieldOnly,producers,analyses).context,{
  clientId:'p1',clientName:'João',propertyId:'r1',propertyName:'Fazenda Sul',fieldId:'f1',fieldName:'Norte',
 })

 const missingClient=normalizeManualNavigation({type:'valor360:navigate',tool:'mapping',context:{clientId:'outside'}})
 const rejectedClient=resolveManualNavigationContext(missingClient,producers,analyses)
 assert.deepEqual(rejectedClient.context,{})
 assert.ok(rejectedClient.issues.includes('client_not_in_workspace'))
})

test('receptor exige iframe pai e mesma origem e devolve acknowledgement explícito',()=>{
 const page=read('manual/app/page.tsx')
 assert.match(page,/event\.origin !== window\.location\.origin/)
 assert.match(page,/event\.source !== window\.parent/)
 assert.match(page,/normalizeManualNavigation\(message\)/)
 assert.match(page,/type: "valor360:navigation-result"/)
 assert.match(page,/"CONTEXT_REJECTED"/)
 assert.match(page,/resolveManualNavigationContext\(navigationCommand, producers, soilAnalyses\)/)
 assert.match(page,/initialMode=\{navigationCommand\?\.diagnosisMode \?\? "nutrition"\}/)
 assert.match(page,/initialFieldId=\{deepLink\?\.clientId === openProducerId \? deepLink\.fieldId : undefined\}/)
 assert.match(page,/function prefillSoilDraftFromNavigation/)
 assert.match(page,/navigationCommand\?\.page === "solo" \? navigationResolution\.context : \{\}/)
 assert.match(page,/linkState: "UNLINKED"/)
 assert.match(page,/reason: "CREATED_UNLINKED"/)
})

test('Manual preserva mapeamento atual e as nove calculadoras reais',()=>{
 const page=read('manual/app/page.tsx')
 const map=read('manual/app/FieldMap.tsx')
 const registry=read('manual/app/ProducerLandRegistry.tsx')
 for(const key of ['semeadora','populacao','sementes','colheita','zoneamento','pulverizacao','fertilizante','reposicao','cotacao']){
  assert.match(page,new RegExp(`\\| "${key}"`))
 }
 assert.match(map,/Importar KML|KML ou GeoJSON/)
 assert.match(map,/Exportar GeoJSON/)
 assert.match(map,/Exportar KML/)
 assert.match(map,/Consultar CAR e SIGEF neste ponto/)
 assert.match(registry,/boundaryEvidence/)
 assert.match(page,/ProducerLandRegistry/)
})
