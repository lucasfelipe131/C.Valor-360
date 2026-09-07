// Standalone, test-only browser surface for restricted preview environments.
import {build} from 'esbuild'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const out=resolve(process.argv[2]||'qa-preview')
await mkdir(out,{recursive:true})
const result=await build({entryPoints:['test/visual/opportunities-harness.jsx'],bundle:true,external:['/valor360-background-v1.webp'],format:'iife',write:false,outfile:'preview.js',define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},loader:{'.woff2':'dataurl','.woff':'dataurl','.png':'dataurl','.webp':'dataurl'},logLevel:'warning'})
let js=result.outputFiles.find(f=>f.path.endsWith('.js')).text
let css=result.outputFiles.find(f=>f.path.endsWith('.css')).text
for(const [path,mime] of [['brand/val-symbol-official.png','image/png'],['brand/val-wordmark-only-official.png','image/png'],['brand/val-signature-official.png','image/png'],['valor360-background-v1.webp','image/webp']]){
 const data='data:'+mime+';base64,'+(await readFile('public/'+path)).toString('base64')
 js=js.replaceAll('/'+path,data);css=css.replaceAll('/'+path,data)
}
const html='<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VAL — Oportunidades · teste isolado</title><style>'+css+'</style></head><body><div id="root"></div><script>'+js.replaceAll('</script','<\\/script')+'</script></body></html>'
await writeFile(resolve(out,'opportunities-qa.html'),html)
const frame=(await readFile('test/visual/frame.html','utf8')).replace('./opportunities.html','./opportunities-qa.html')
await writeFile(resolve(out,'frame.html'),frame)
console.log(out)
