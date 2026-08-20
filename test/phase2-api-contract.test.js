import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')

test('API canônica é aditiva e rotas legadas usam o mesmo adaptador',()=>{
  const server=read('../server.js')
  assert.match(server,/url\.pathname==='\/api\/v1\/val\/recommendations'/)
  assert.match(server,/valCore\.execute\(requestEnvelope/)
  assert.match(server,/url\.pathname==='\/api\/v1\/val\/recommendations'\?coreResponse:legacyRecommendationResponse\(coreResponse,requestId\)/)
  assert.match(server,/organization_id:organizationId/)
  assert.doesNotMatch(server,/organization_id:payload/)
})

test('OpenAPI documenta os contratos canônico e legado',()=>{
  const openapi=read('../openapi/val-core-v1.yaml')
  assert.match(openapi,/openapi: 3\.1\.0/)
  assert.match(openapi,/\/api\/val\/chat:/)
  assert.match(openapi,/\/api\/val\/recommendations:/)
  assert.match(openapi,/\/api\/v1\/val\/recommendations:/)
  assert.match(openapi,/response-envelope\.schema\.json/)
  assert.match(openapi,/RequestEnvelope:/)
})
