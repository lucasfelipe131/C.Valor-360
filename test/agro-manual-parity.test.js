import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

const root=join(import.meta.dirname,'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('auditoria aponta para a versão real do Manual e preserva sua navegação principal',()=>{
 const pkg=JSON.parse(read('manual/package.json'))
 const page=read('manual/app/page.tsx')
 const audit=read('MANUAL_CURRENT_CAPABILITY_AUDIT.md')
 assert.equal(pkg.name,'manual-do-agronomo')
 assert.equal(pkg.version,'0.2.0')
 for(const [key,label] of [
  ['inicio','Visão geral'],['produtores','Produtores'],['solo','Análises de solo'],
  ['diagnostico','Diagnóstico por foto'],['calculadoras','Calculadoras'],['bulas','Bulas'],
  ['mercado','Mercado e notícias'],['relatorios','Relatórios']
 ]){
  assert.match(page,new RegExp(`key: "${key}", label: "${label}"`))
 }
 assert.match(audit,/Versão declarada: `0\.2\.0`/)
 assert.match(audit,/auditoria factual/i)
})

test('Inteligência Agronômica mantém os cinco domínios VAL e abre o núcleo técnico existente',()=>{
 const agro=read('src/pages/Agro.jsx')
 for(const label of ['CAMPO E SOLO','DIAGNÓSTICO','DECISÃO TÉCNICA','CONTEXTO','CONHECIMENTO'])assert.match(agro,new RegExp(label))
 for(const tool of ['solo','produtores','diagnostico','calculadoras','bulas','mercado'])assert.match(agro,new RegExp(`id:'${tool}'`))
 assert.match(agro,/src=\{`\/tecnico\?embedded=1&page=\$\{encodeURIComponent/)
 assert.match(agro,/allow="camera 'self'; microphone 'self'; geolocation 'self'"/)
 assert.match(agro,/createAgroWorkspaceMessage/)
 assert.match(agro,/contentWindow\.postMessage/)
})

test('bridge Manual ↔ VAL valida origem, janela pai e contexto navegacional',()=>{
 const page=read('manual/app/page.tsx')
 const protocol=read('manual/app/valor360-navigation.ts')
 const technical=read('server/technical-workspace.js')
 assert.match(page,/event\.origin !== window\.location\.origin/)
 assert.match(page,/event\.source !== window\.parent/)
 assert.match(protocol,/source\.type !== "valor360:navigate"/)
 for(const field of ['clientId','propertyId','fieldId','analysisId'])assert.match(protocol,new RegExp(`"${field}"`))
 assert.match(technical,/session|identity/i)
 assert.match(technical,/signature|signed|hmac/i)
})

test('roteador preserva capacidades agronômicas sem afirmar execução inexistente',()=>{
 const router=read('server/decision-copilot/capability-router.js')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 for(const capability of [
  'AGRONOMIC_WORKSPACE','SOIL_ANALYSIS','IMAGE_DIAGNOSIS','CALCULATORS','LABELS',
  'WEATHER','MARKET_COMMODITY','KNOWLEDGE_LIBRARY','AGRONOMIST_MANUAL'
 ])assert.match(router,new RegExp(`'${capability}'`))
 assert.match(router,/intentRoute\.intent==='CALCULATE'/)
 assert.match(router,/intentRoute\.intent==='ANALYZE_SOIL'/)
 assert.match(router,/intentRoute\.intent==='IMAGE_DIAGNOSIS'/)
 assert.match(diff,/native execution parity for the nine Manual engines must not be claimed/i)
 assert.match(diff,/`ACCESS_PRESERVED`/)
})

test('mapeamento atual mantém desenho, edição, geometria, fontes e exportação',()=>{
 const map=read('manual/app/FieldMap.tsx')
 const geometry=read('manual/app/lib/field-geometry.ts')
 const official=read('manual/app/lib/official-geodata.ts')
 for(const step of ['Localizar','Importar','Desenhar','Revisar'])assert.match(map,new RegExp(`label: "${step}"`))
 for(const fn of ['polygonAreaHa','polygonPerimeterM','polygonCentroid','simplifyPolygon','boundaryAsGeoJson','boundaryAsKml'])assert.match(geometry,new RegExp(`function ${fn}|const ${fn}|export function ${fn}`))
 assert.match(map,/Exportar GeoJSON/)
 assert.match(map,/Exportar KML/)
 assert.match(official,/acervofundiario\.incra\.gov\.br/)
 assert.match(official,/geoserver\.car\.gov\.br/)
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 assert.match(diff,/`geometry_ref`\/`geometry_version` are not populated/)
})

test('análise de solo preserva os quatro estados reais de vínculo e histórico versionado',()=>{
 const integration=read('manual/app/lib/valor360.ts')
 const repository=read('server/repository.js')
 for(const state of ['UNLINKED','LINKED_TO_CLIENT','LINKED_TO_PROPERTY','LINKED_TO_FIELD']){
  assert.match(integration,new RegExp(`"${state}"`))
  assert.match(repository,new RegExp(`'${state}'`))
 }
 assert.match(repository,/linkVersion/)
 assert.match(repository,/accepted_event_occurred_at/)
})

test('nomes de diagnóstico são canônicos e FitScan permanece apenas alias de FitoScan',()=>{
 const diagnosis=read('manual/app/PhotoDiagnosis.tsx')
 const route=read('manual/app/api/diagnosis/route.ts')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 for(const name of ['NutriScan','FitoScan','InsetoScan','DaninhaScan'])assert.match(diagnosis,new RegExp(`name: "${name}"`))
 assert.doesNotMatch(diagnosis,/\bFitScan\b/)
 for(const mode of ['nutrition','disease','insect','weed'])assert.match(route,new RegExp(`"${mode}"`))
 assert.match(route,/minItems: 3/)
 assert.match(route,/maxItems: 3/)
 assert.match(diff,/`FitScan` to the same methodology/)
 assert.match(diff,/never create a second product/i)
})

test('hero possui contrato de contexto e estados, mas o diff exige UAT em vez de falso E2E',()=>{
 const hero=read('src/lib/agro-hero-actions.js')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 const master=read('VAL_MASTER_EXPERIENCE_vNEXT.md')
 assert.match(hero,/AGRO_HERO_ACTIONS=Object\.freeze\(\['voice','text','photo','file'\]\)/)
 assert.match(hero,/AGRO_HERO_STATES=Object\.freeze\(\['idle','loading','success','error'\]\)/)
 for(const context of ['producer','property','field','analysis','tool'])assert.match(hero,new RegExp(`${context}:entity`))
 assert.match(hero,/persistenceMode:'NONE'/)
 assert.match(diff,/`UAT_REQUIRED`/)
 assert.match(master,/No static test may mark AGRO_HERO_001–010 as full E2E pass/i)
})
