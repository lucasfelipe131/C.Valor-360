// Extrai as variantes da marca oficial A PARTIR DO ARQUIVO ORIGINAL.
//
// A logo da VAL é um ativo raster com textura de pedra e duas folhas
// sobrepostas. Redesenhar em SVG produz uma aproximação — e o briefing é
// explícito: "NÃO redesenhar, NÃO aproximar por CSS, usar o asset oficial
// fornecido". Este script recorta o original em vez de imitá-lo.
//
// Usa Chrome headless por CDP porque não há sharp nem ImageMagick no ambiente:
// carrega o PNG num canvas, mede a caixa real de cada peça pelo canal alfa e
// exporta os recortes.
//
// Uso: node scripts/extract-brand-asset.mjs <origem.png> [public/brand]

import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const SOURCE=process.argv[2]
const OUT=process.argv[3]||'public/brand'
if(!SOURCE||!existsSync(SOURCE)){console.error('Informe o PNG oficial da marca.');process.exit(1)}

const PORT=9334
const PROFILE=join(tmpdir(),`val-brand-${Date.now()}`)
const CHROME=[
 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 '/usr/bin/google-chrome','/usr/bin/chromium'
].find(existsSync)
if(!CHROME){console.error('Nenhum Chrome/Edge encontrado.');process.exit(1)}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const chrome=spawn(CHROME,[
 '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
 `--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'about:blank'
],{stdio:'ignore'})

const endpoint=async()=>{
 for(let attempt=0;attempt<40;attempt+=1){
  try{const response=await fetch(`http://127.0.0.1:${PORT}/json/version`);if(response.ok)return (await response.json()).webSocketDebuggerUrl}catch{}
  await sleep(250)
 }
 throw new Error('Chrome não abriu a porta de depuração.')
}

class Session{
 constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();this.sessionId=null
  socket.addEventListener('message',event=>{
   const message=JSON.parse(event.data)
   const resolve=this.pending.get(message.id)
   if(resolve){this.pending.delete(message.id);resolve(message)}
  })}
 send(method,params={},useSession=true){
  const id=++this.id
  const payload={id,method,params}
  if(useSession&&this.sessionId)payload.sessionId=this.sessionId
  this.socket.send(JSON.stringify(payload))
  return new Promise(resolve=>this.pending.set(id,resolve))
 }
 async evaluate(expression){
  const message=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if(message.result?.exceptionDetails)throw new Error(message.result.exceptionDetails.text)
  return message.result?.result?.value
 }
}

// Roda no navegador: mede a caixa alfa de uma faixa e devolve o recorte.
const SCRIPT=dataUrl=>`(async()=>{
 const img=new Image();img.src=${JSON.stringify(dataUrl)};
 await img.decode();
 const W=img.naturalWidth,H=img.naturalHeight;
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(img,0,0);
 const data=ctx.getImageData(0,0,W,H).data;
 const ALPHA=24;

 // Perfil de opacidade por linha: separa símbolo, wordmark e assinatura.
 const rows=new Array(H).fill(0);
 for(let y=0;y<H;y+=1){let count=0;for(let x=0;x<W;x+=1){if(data[(y*W+x)*4+3]>ALPHA)count+=1}rows[y]=count}
 const bands=[];let start=-1;
 for(let y=0;y<H;y+=1){
  const filled=rows[y]>W*0.004;
  if(filled&&start<0)start=y;
  if(!filled&&start>=0){if(y-start>H*0.02)bands.push([start,y]);start=-1}
 }
 if(start>=0&&H-start>H*0.02)bands.push([start,H]);

 // O original traz respingos decorativos esparsos ao redor da marca. Uma caixa
 // alfa pura os incluiria, então cada coluna e cada linha só contam quando têm
 // densidade real — o respingo tem alguns pixels, o traço da marca tem centenas.
 const box=(top,bottom)=>{
  const height=bottom-top;
  const cols=new Array(W).fill(0);
  const rowHits=new Array(height).fill(0);
  for(let y=top;y<bottom;y+=1)for(let x=0;x<W;x+=1){
   if(data[(y*W+x)*4+3]<=ALPHA)continue;
   cols[x]+=1;rowHits[y-top]+=1;
  }
  const colFloor=Math.max(3,height*0.012);
  const rowFloor=Math.max(3,W*0.004);
  let minX=-1,maxX=-1,minY=-1,maxY=-1;
  for(let x=0;x<W;x+=1)if(cols[x]>=colFloor){if(minX<0)minX=x;maxX=x}
  for(let y=0;y<height;y+=1)if(rowHits[y]>=rowFloor){if(minY<0)minY=y;maxY=y}
  if(maxX<0||maxY<0)return null;
  return {x:minX,y:top+minY,w:maxX-minX+1,h:maxY-minY+1};
 };

 const crop=(rect,targetWidth)=>{
  const scale=targetWidth/rect.w;
  const out=document.createElement('canvas');
  out.width=Math.round(rect.w*scale);out.height=Math.round(rect.h*scale);
  const octx=out.getContext('2d');
  octx.imageSmoothingQuality='high';
  octx.drawImage(canvas,rect.x,rect.y,rect.w,rect.h,0,0,out.width,out.height);
  return out.toDataURL('image/png').split(',')[1];
 };

 // A caixa cheia é a união das faixas, não um box global: a assinatura é mais
 // larga que o wordmark e tem traço fino, então uma densidade calculada sobre a
 // imagem inteira cortaria o "VALOR" do fim.
 const boxes=bands.map(([top,bottom])=>box(top,bottom)).filter(Boolean);
 const full=boxes.length?boxes.reduce((acc,rect)=>{
  const x=Math.min(acc.x,rect.x),y=Math.min(acc.y,rect.y);
  const right=Math.max(acc.x+acc.w,rect.x+rect.w),bottom=Math.max(acc.y+acc.h,rect.y+rect.h);
  return {x,y,w:right-x,h:bottom-y};
 }):box(0,H);
 // O símbolo é a primeira faixa; wordmark + assinatura, o resto.
 const symbol=boxes[0]||null;
 const wordmark=boxes.length>1?boxes.slice(1).reduce((acc,rect)=>{
  const x=Math.min(acc.x,rect.x),y=Math.min(acc.y,rect.y);
  const right=Math.max(acc.x+acc.w,rect.x+rect.w),bottom=Math.max(acc.y+acc.h,rect.y+rect.h);
  return {x,y,w:right-x,h:bottom-y};
 }):null;

 return {
  size:{W,H},
  bands,
  full:{rect:full,png:crop(full,1200)},
  symbol:symbol?{rect:symbol,png:crop(symbol,512)}:null,
  wordmark:wordmark?{rect:wordmark,png:crop(wordmark,900)}:null,
  wordmarkOnly:boxes[1]?{rect:boxes[1],png:crop(boxes[1],900)}:null,
  signature:boxes[2]?{rect:boxes[2],png:crop(boxes[2],900)}:null
 };
})()`

try{
 const socket=new WebSocket(await endpoint())
 await new Promise(resolve=>socket.addEventListener('open',resolve))
 const cdp=new Session(socket)
 const created=await cdp.send('Target.createTarget',{url:'about:blank'},false)
 const attached=await cdp.send('Target.attachToTarget',{targetId:created.result.targetId,flatten:true},false)
 cdp.sessionId=attached.result.sessionId
 await cdp.send('Runtime.enable')

 const dataUrl=`data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`
 const result=await cdp.evaluate(SCRIPT(dataUrl))

 mkdirSync(OUT,{recursive:true})
 console.log(`origem ${result.size.W}x${result.size.H}, ${result.bands.length} faixa(s) detectada(s)`)
 const write=(name,piece)=>{
  if(!piece){console.warn(`  ${name}: não detectado`);return}
  const path=join(OUT,name)
  writeFileSync(path,Buffer.from(piece.png,'base64'))
  console.log(`  ${path}  (recorte ${piece.rect.w}x${piece.rect.h} do original)`)
 }
 write('val-logo-official.png',result.full)
 write('val-symbol-official.png',result.symbol)
 write('val-wordmark-official.png',result.wordmark)
 write('val-wordmark-only-official.png',result.wordmarkOnly)
 write('val-signature-official.png',result.signature)
 socket.close()
}catch(error){
 console.error(error.message)
 process.exitCode=1
}finally{
 chrome.kill()
 try{rmSync(PROFILE,{recursive:true,force:true})}catch{}
}
