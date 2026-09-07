export const routeTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Sao_Paulo'
export async function routeRequest(path,{method='GET',body,signal,keepalive=false}={}){
 const timeout=AbortSignal.timeout(15000)
 const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout
 const response=await fetch(`/api/visit-routes/${path}`,{method,signal:requestSignal,keepalive,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})
 const payload=await response.json().catch(()=>({}))
 if(response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('valor360:unauthorized'))
 if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar o roteiro. Tente novamente.')
 return payload
}
export const routeDayPath=date=>`day?date=${encodeURIComponent(date)}&timeZone=${encodeURIComponent(routeTimeZone())}`
