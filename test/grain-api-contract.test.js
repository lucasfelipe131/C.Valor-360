import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('rotas SOG exigem sessão e reutilizam o proprietário da carteira',()=>{
 const server=read('server.js')
 assert.match(server,/url\.pathname\.startsWith\('\/api\/grains\/'\)/)
 assert.match(server,/new GrainRepository\(\{db:database,readStore,saveStore,tenantId:config\.defaultTenantId\}\)/)
 assert.match(server,/\/api\/grains\/bootstrap/)
 assert.match(server,/\/api\/grains\/profiles/)
 assert.match(server,/\/api\/grains\/intents/)
 assert.match(server,/\/api\/grains\/market/)
 assert.match(server,/grainRepository\.getWorkspace\(identity\?\.id\)/)
 assert.match(server,/grainRepository\.saveIntent\(intention,identity\?\.id\)/)
})

test('interface SOG grava somente pelas APIs protegidas e mostra a governança',()=>{
 const sog=read('src/components/SogWorkspace.jsx')
 assert.match(sog,/api\('\/api\/grains\/bootstrap'/)
 assert.match(sog,/api\('\/api\/grains\/profiles'/)
 assert.match(sog,/api\('\/api\/grains\/intents'/)
 assert.match(sog,/api\('\/api\/grains\/market'/)
 assert.match(sog,/requestJsonResource/)
 assert.match(sog,/Fonte e atualização obrigatórias/)
 assert.match(sog,/Sem operação automática/)
 assert.match(sog,/Preparados, ainda não conectados/)
})
