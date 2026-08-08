import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const dockerfile=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8')
const dockerignore=readFileSync(new URL('../.dockerignore',import.meta.url),'utf8')
const railway=JSON.parse(readFileSync(new URL('../railway.json',import.meta.url),'utf8'))

test('imagem de produção é multi-stage, não privilegiada e não declara segredos',()=>{
 assert.equal((dockerfile.match(/^FROM /gm)||[]).length,2)
 assert.match(dockerfile,/^FROM node:22-alpine AS build$/m)
 assert.match(dockerfile,/^FROM node:22-alpine AS runtime$/m)
 assert.match(dockerfile,/^USER node$/m)
 assert.doesNotMatch(dockerfile,/^ARG\b/m)
 assert.doesNotMatch(dockerfile,/(?:OPENAI_API_KEY|DATABASE_URL|VAL_ADMIN_PASSWORD|VAL_SESSION_SECRET|VAL_INTEGRATION_TOKEN)/)
})

test('imagem final contém os artefatos exigidos por migrate e start',()=>{
 for(const required of [
  '/app/dist ./dist',
  'server.js ./server.js',
  'server ./server',
  'database ./database',
  'src/data ./src/data',
  'src/lib ./src/lib'
 ])assert.ok(dockerfile.includes(required),`COPY ausente: ${required}`)
 assert.match(dockerfile,/mkdir -p \/app\/\.data/)
 assert.match(dockerfile,/^EXPOSE 8080$/m)
 assert.match(dockerfile,/CMD \["npm", "start"\]/)
})

test('contexto Docker exclui segredos e Railway usa o Dockerfile',()=>{
 for(const ignored of ['.env','.env.*','.npmrc','*.key','*.pem'])assert.match(dockerignore,new RegExp(`^${ignored.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m'))
 assert.deepEqual(railway.build,{builder:'DOCKERFILE',dockerfilePath:'Dockerfile'})
 assert.equal(railway.deploy.preDeployCommand,'npm run db:migrate')
 assert.equal(railway.deploy.startCommand,'npm run start')
})
