import {useEffect,useRef,useState} from 'react'
import {routeDayPath,routeRequest,routeTimeZone} from '../../lib/visit-route-api'

const REQUEST_TIMEOUT_MS=12000
const newSession=(date,scope)=>({date,scope,live:true,revoked:false,watch:null,watchEpoch:0,queue:[],lastTime:0,active:false,starting:false,stopping:false,started:false,flushQueued:false,failures:0,controllers:new Set()})

// Ler uma rota não inicia GPS. Cada sessão pertence a um dia e uma identidade;
// respostas antigas nunca atualizam a tela nem iniciam um novo observador GPS.
export default function useRouteTracking({date,storageScope='',onTrace,onPosition,onError}){
 const [tracking,setTracking]=useState(false)
 const [busy,setBusy]=useState(false)
 const session=useRef(null)
 const transport=useRef(Promise.resolve())
 const boundary=useRef({date,scope:storageScope})
 const callbacks=useRef({onTrace,onPosition,onError})
 boundary.current={date,scope:storageScope}
 callbacks.current={onTrace,onPosition,onError}
 const sameScope=current=>!current.revoked&&boundary.current.scope===current.scope
 const isCurrent=current=>current.live&&session.current===current&&sameScope(current)&&boundary.current.date===current.date
 const clearWatch=current=>{
  if(current.watch!==null)navigator.geolocation?.clearWatch(current.watch)
  current.watch=null;current.active=false;current.watchEpoch+=1
 }
 const request=async(current,body,{keepalive=false}={})=>{
  const controller=new AbortController();current.controllers.add(controller)
  let timer
  try{
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('A gravação demorou mais de 12 segundos. Tente novamente.'))},REQUEST_TIMEOUT_MS)})
   return await Promise.race([routeRequest(routeDayPath(current.date),{method:'PUT',body:{...body,timeZone:routeTimeZone()},signal:controller.signal,keepalive}),deadline])
  }finally{clearTimeout(timer);current.controllers.delete(controller)}
 }
 const enqueue=(current,operation,{final=false}={})=>{
  // Um início não pode ultrapassar a pausa anterior, mesmo em outra geração.
  const task=transport.current.catch(()=>{}).then(()=>{
   if(!sameScope(current)||(!final&&!isCurrent(current)))return null
   return operation()
  })
  transport.current=task
  return task
 }
 const persist=async(current,{stop=false,final=false}={})=>{
  // A fila só perde pontos após confirmação. Falha transitória não cria um
  // ciclo de tentativas: a próxima amostra ou ação explícita tenta novamente.
  do{
   if(!sameScope(current)||(!final&&!isCurrent(current)))return
   const points=current.queue.slice(0,250)
   const lastBatch=current.queue.length<=250
   const payload=await request(current,{tracePoints:points,...(stop&&lastBatch?{tracking:false}:{})},{keepalive:final||stop})
   current.queue.splice(0,points.length);current.failures=0
   if(stop&&lastBatch)current.started=false
   if(isCurrent(current))callbacks.current.onTrace?.(payload.trace||[])
   if(!stop||lastBatch)return
  }while(current.queue.length)
 }
 const stopSession=async(current)=>{
  if(!current||current.stopping)return
  clearWatch(current);current.stopping=true
  if(isCurrent(current)){setTracking(false);setBusy(true)}
  try{await enqueue(current,()=>persist(current,{stop:true}))}
  catch(error){if(isCurrent(current))callbacks.current.onError?.(`O trecho ainda não foi salvo: ${error.message}`)}
  finally{current.stopping=false;if(isCurrent(current)&&!current.starting)setBusy(false)}
 }
 const flush=current=>{
  if(current.flushQueued||!current.queue.length)return
  current.flushQueued=true
  enqueue(current,()=>persist(current)).catch(error=>{
   if(!isCurrent(current))return
   current.failures+=1
   callbacks.current.onError?.(`O trecho ainda não foi salvo: ${error.message}`)
   // Uma falha persistente pausa o GPS e conserva os pontos para uma nova
   // tentativa explícita; não envia a mesma fila indefinidamente.
   if(current.failures>=3){clearWatch(current);setTracking(false);callbacks.current.onError?.('O percurso foi pausado após falhas ao salvar. Os pontos pendentes serão reenviados ao iniciar novamente.')}
  }).finally(()=>{current.flushQueued=false})
 }
 const start=async()=>{
  const current=session.current
  if(!current||!isCurrent(current)||current.active||current.starting||current.stopping)return
  if(!navigator.geolocation){callbacks.current.onError?.('Este aparelho não oferece localização ao navegador.');return}
  const epoch=++current.watchEpoch
  current.starting=true;setBusy(true);callbacks.current.onError?.('')
  try{
   await enqueue(current,async()=>{
    // Pontos de uma pausa malsucedida precedem um novo trackingStartedAt.
    if(current.queue.length)await persist(current)
    if(!isCurrent(current))return
    await request(current,{tracking:true});current.started=true
   })
   if(!isCurrent(current)||current.watchEpoch!==epoch||current.stopping)return
   current.active=true;current.lastTime=0;setTracking(true)
   current.watch=navigator.geolocation.watchPosition(position=>{
    if(!isCurrent(current)||!current.active||current.watchEpoch!==epoch)return
    const {latitude:lat,longitude:lng,accuracy}=position.coords||{}
    const timestamp=Number(position.timestamp)
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(timestamp)||Number.isNaN(new Date(timestamp).getTime())||Math.abs(lat)>90||Math.abs(lng)>180)return
    const point={lat,lng,timestamp:new Date(timestamp).toISOString(),accuracy}
    callbacks.current.onPosition?.(point)
    if(!Number.isFinite(accuracy)||accuracy<0||accuracy>100||timestamp-current.lastTime<15000)return
    current.lastTime=timestamp;current.queue.push(point);flush(current)
   },error=>{
    if(!isCurrent(current)||!current.active||current.watchEpoch!==epoch)return
    callbacks.current.onError?.(error.code===1?'Permita a localização para registrar o percurso.':'O GPS está sem sinal. O percurso foi pausado; tente novamente em local aberto.')
    stopSession(current)
   },{enableHighAccuracy:true,maximumAge:5000,timeout:20000})
  }catch(error){
   if(isCurrent(current)){clearWatch(current);setTracking(false);callbacks.current.onError?.(error.message)}
  }finally{current.starting=false;if(isCurrent(current)&&!current.stopping)setBusy(false)}
 }
 const stop=()=>stopSession(session.current)
 useEffect(()=>{
  const current=newSession(date,storageScope);session.current=current
  setTracking(false);setBusy(false)
  return()=>{
   current.live=false;clearWatch(current)
   if(!sameScope(current)){
    // Nunca enviar uma fila antiga com as credenciais da nova identidade.
    current.revoked=true;current.queue=[];for(const controller of current.controllers)controller.abort()
    return
   }
   if(current.started||current.starting||current.queue.length)enqueue(current,()=>persist(current,{stop:true,final:true}),{final:true}).catch(()=>{})
  }
 },[date,storageScope])
 return {tracking,busy,start,stop}
}
