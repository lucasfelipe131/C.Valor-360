import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {buildEntryAssets,stampServiceWorker,verifyServiceWorker} from '../scripts/pwa-release.mjs'

// OFFLINE-02. O pre-cache guardava so a casca (/, /index.html, manifesto, icone) e o activate apaga
// o cache do release anterior inteiro. Na primeira vez offline depois de uma atualizacao, o
// index.html novo pedia hashes novos que nunca foram pre-cacheados, e os antigos ja tinham sido
// apagados: "Failed to fetch" no /assets/index-*.js e tela em branco, sem mensagem, no campo sem
// sinal. Medido com dois builds reais e o dist/sw.js carimbado: o cache do release novo ficava com
// 4 entradas, nenhuma delas JS ou CSS.
const modelo=()=>readFileSync(new URL('../public/sw.js',import.meta.url),'utf8')
const comBuild=(root,html)=>{
 mkdirSync(join(root,'public'),{recursive:true})
 mkdirSync(join(root,'dist'),{recursive:true})
 writeFileSync(join(root,'public','sw.js'),modelo())
 if(html!==null)writeFileSync(join(root,'dist','index.html'),html)
}
const htmlDeBuild=(js,css)=>`<!doctype html><html><head><script type="module" crossorigin src="${js}"></script><link rel="stylesheet" crossorigin href="${css}"></head><body><div id="root"></div></body></html>`

test('OFFLINE-02 — o modelo do worker declara o pre-cache do build e o usa no install',()=>{
 const worker=modelo()
 assert.match(worker,/const PRECACHE_BUILD=__VAL_BUILD_ASSETS__/)
 assert.match(worker,/\[\.\.\.PRECACHE_BUILD,\.\.\.PRECACHE_EXTRA\]\.map\(asset=>cache\.add\(asset\)\)/)
 // A casca continua sendo tudo-ou-nada; o resto entra item a item.
 assert.match(worker,/await cache\.addAll\(PRECACHE_SHELL\)/)
})

test('OFFLINE-02 — o carimbo do build preenche o pre-cache com os arquivos de entrada',()=>{
 const root=mkdtempSync(join(tmpdir(),'valor360-offline02-'))
 try{
  comBuild(root,htmlDeBuild('/assets/index-AAAA1111.js','/assets/index-BBBB2222.css'))
  assert.deepEqual(buildEntryAssets({root}),['/assets/index-AAAA1111.js','/assets/index-BBBB2222.css'])
  const carimbado=stampServiceWorker({root,releaseId:'release-offline02'})
  assert.deepEqual(carimbado.precachedAssets,['/assets/index-AAAA1111.js','/assets/index-BBBB2222.css'])
  const compilado=readFileSync(join(root,'dist','sw.js'),'utf8')
  assert.doesNotMatch(compilado,/__VAL_BUILD_ASSETS__/)
  assert.match(compilado,/const PRECACHE_BUILD=\["\/assets\/index-AAAA1111\.js","\/assets\/index-BBBB2222\.css"\]/)
  assert.equal(verifyServiceWorker({root,releaseId:'release-offline02'}).cacheName,carimbado.cacheName)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('OFFLINE-02 — a verificacao recusa um worker que nao pre-carrega os arquivos do build',()=>{
 const root=mkdtempSync(join(tmpdir(),'valor360-offline02-vazio-'))
 try{
  comBuild(root,htmlDeBuild('/assets/index-CCCC3333.js','/assets/index-DDDD4444.css'))
  stampServiceWorker({root,releaseId:'release-offline02b'})
  // Simula a regressão: alguém devolve o pré-cache vazio. Sem esta guarda o defeito volta em
  // silêncio — o app sobe normalmente e só quebra offline, depois da próxima atualização.
  const caminho=join(root,'dist','sw.js')
  writeFileSync(caminho,readFileSync(caminho,'utf8').replace(/const PRECACHE_BUILD=\[[^\]]*\]/,'const PRECACHE_BUILD=[]'))
  assert.throws(()=>verifyServiceWorker({root,releaseId:'release-offline02b'}),/não pré-carrega os arquivos de entrada do build/)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('OFFLINE-02 — sem build presente o carimbo continua funcionando com pre-cache vazio',()=>{
 // O carimbo é usado em cenário sem dist/ (testes, ferramentas); ali não há o que pré-carregar.
 const root=mkdtempSync(join(tmpdir(),'valor360-offline02-sembuild-'))
 try{
  comBuild(root,null)
  const carimbado=stampServiceWorker({root,releaseId:'release-sem-build'})
  assert.deepEqual(carimbado.precachedAssets,[])
  assert.match(readFileSync(join(root,'dist','sw.js'),'utf8'),/const PRECACHE_BUILD=\[\]/)
  assert.equal(verifyServiceWorker({root,releaseId:'release-sem-build'}).cacheName,'valor360-vrelease-sem-build')
 }finally{rmSync(root,{recursive:true,force:true})}
})
