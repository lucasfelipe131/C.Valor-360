import {createReadStream,existsSync,statSync} from 'node:fs'
import {createServer} from 'node:http'
import {dirname,extname,join,normalize} from 'node:path'
import {fileURLToPath} from 'node:url'

const port=Number(process.env.PORT||3000)
const root=join(dirname(fileURLToPath(import.meta.url)),'dist')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp'}

createServer((request,response)=>{
 const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}
 if(request.url==='/health'){
  response.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8'})
  return response.end(JSON.stringify({status:'ok',service:'valor360'}))
 }
 let pathname='/'
 try{pathname=decodeURIComponent(new URL(request.url||'/',`http://${request.headers.host||'localhost'}`).pathname)}catch{}
 const relative=normalize(pathname==='/'?'index.html':pathname.replace(/^\/+/,''))
 let target=join(root,relative)
 if(!target.startsWith(root)||!existsSync(target)||statSync(target).isDirectory())target=join(root,'index.html')
 const extension=extname(target).toLowerCase()
 response.writeHead(200,{...headers,'Content-Type':mime[extension]||'application/octet-stream','Cache-Control':extension==='.html'?'no-cache':'public, max-age=31536000, immutable'})
 createReadStream(target).pipe(response)
}).listen(port,'0.0.0.0',()=>console.log(`VALOR 360 disponível na porta ${port}`))
