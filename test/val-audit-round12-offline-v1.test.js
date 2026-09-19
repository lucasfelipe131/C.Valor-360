import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import test from 'node:test'

const raiz=new URL('../',import.meta.url)
const worker=readFileSync(new URL('public/sw.js',raiz),'utf8')
const lista=nome=>{
 const bruto=worker.match(new RegExp('const '+nome+'=\\[([^\\]]*)\\]'))?.[1]||''
 return bruto.split(',').map(item=>item.trim().replace(/^'|'$/g,'')).filter(Boolean)
}

test('tudo que o service worker pre-cacheia existe de verdade', () => {
 // /icon.svg era pedido no pré-cache e não existe em lugar nenhum: nem em public/, nem no build,
 // nem servido por rota. Como cache.addAll é tudo-ou-nada, o install nunca concluía e o service
 // worker NUNCA ativava — o consultor instalava a VAL e, sem sinal, abria a página de erro do
 // navegador. No escritório nada denunciava o problema.
 const ausentes=[...lista('PRECACHE_SHELL'),...lista('PRECACHE_EXTRA')]
  .filter(caminho=>caminho!=='/')
  .filter(caminho=>!existsSync(new URL(`public${caminho}`,raiz))&&!existsSync(new URL(`dist${caminho}`,raiz)))
 assert.deepEqual(ausentes,[],`pré-cache pede arquivo que não existe: ${ausentes.join(', ')}`)
})

test('um arquivo faltando nao pode mais derrubar o modo offline inteiro', () => {
 // A casca continua sendo requisito — sem ela não há o que abrir. O resto entra item a item, para
 // que um arquivo renomeado num deploy futuro custe aquele arquivo, não o offline todo.
 assert.match(worker,/await cache\.addAll\(PRECACHE_SHELL\)/)
 // OFFLINE-02 somou os arquivos de entrada do build à mesma lista item a item; a propriedade que
 // este caso protege — um arquivo que falha não derruba o install inteiro — continua valendo.
 // A rodada 13 trocou cache.add por precache(), que passa pela checagem de Content-Type; a
 // propriedade protegida aqui — um arquivo que falha não derruba o install inteiro — é a mesma.
 assert.match(worker,/await Promise\.allSettled\(\[\.\.\.PRECACHE_BUILD,\.\.\.PRECACHE_EXTRA\]\.map\(asset=>precache\(cache,asset\)\)\)/)
 assert.equal([...lista('PRECACHE_SHELL'),...lista('PRECACHE_EXTRA')].includes('/icon.svg'),false)
})

test('o icone pre-cacheado e o mesmo que o manifesto declara', () => {
 const manifesto=JSON.parse(readFileSync(new URL('public/manifest.webmanifest',raiz),'utf8'))
 const icones=(manifesto.icons||[]).map(item=>item.src)
 assert.ok(lista('PRECACHE_EXTRA').some(caminho=>icones.includes(caminho)),`o pré-cache precisa guardar um ícone real do manifesto (${icones.join(', ')})`)
})
