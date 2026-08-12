import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')

test('dossiê do produtor oferece galeria de lavoura com metadados e armazenamento protegido',()=>{
 const gallery=read('src/components/ProducerFieldGallery.jsx')
 const client360=read('src/pages/Client360.jsx')
 const server=read('server.js')
 const repository=read('server/repository.js')
 assert.match(client360,/ProducerFieldGallery/)
 assert.match(gallery,/\/api\/val\/attachments\?clientId=/)
 assert.match(gallery,/method:'POST'/)
 assert.match(gallery,/method:'PATCH'/)
 assert.match(gallery,/fieldPhoto:\{\.\.\.metadata,source:'client360'/)
 assert.match(gallery,/Rótulo da foto/)
 assert.match(gallery,/Categoria/)
 assert.match(gallery,/Data observada/)
 assert.match(gallery,/Notas da observação/)
 assert.match(gallery,/capture="environment"/)
 assert.match(server,/url\.pathname\.startsWith\('\/api\/val\/attachments'\)/)
 assert.match(repository,/a\.consultant_id=\$2/)
 assert.match(repository,/c\.external_key=\$3/)
})

test('linha superior do produtor usa apenas métricas comerciais canônicas',()=>{
 const client360=read('src/pages/Client360.jsx')
 assert.match(client360,/commercialMetrics\(client\)/)
 assert.match(client360,/IRT \/ NPS/)
 assert.match(client360,/Potencial em aberto/)
 assert.match(client360,/Pipeline aberto/)
 assert.match(client360,/Share realizado/)
 assert.doesNotMatch(client360,/commercial\?\.potential\b/)
 assert.match(client360,/metricValue\(client\.irt,metrics\.irtKnown\)/)
 assert.match(client360,/compactBRL\(metrics\.openPotential/)
})

test('galeria possui composição responsiva para celular, tablet e desktop',()=>{
 const css=read('src/styles.css')
 assert.match(css,/\.field-photo-grid\{[^}]*repeat\(auto-fit,minmax\(260px,1fr\)\)/)
 assert.match(css,/@media\(max-width:900px\)\{\.field-photo-composer\{grid-template-columns:1fr\}/)
 assert.match(css,/@media\(max-width:600px\)[\s\S]*\.field-photo-grid\{grid-template-columns:1fr/)
 assert.match(css,/\.field-photo-actions button\{min-height:44px/)
})
