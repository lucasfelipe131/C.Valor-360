// Administrative reference only. Never a producer location, field or area estimate.
export const normalizePlace=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export function searchMunicipalities(rows,query,uf=''){
 const terms=normalizePlace(query).split(' ').filter(Boolean)
 if(!terms.length)return []
 return rows.filter(row=>(!uf||row[2]===uf)&&terms.every(term=>normalizePlace(`${row[1]} ${row[2]}`).includes(term)))
  .sort((a,b)=>Number(normalizePlace(b[1])===normalizePlace(query))-Number(normalizePlace(a[1])===normalizePlace(query))||a[1].localeCompare(b[1],'pt-BR')).slice(0,20)
}
export function localityBounds(row){
 const b=row?.[3]
 return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3]?[[b[0],b[1]],[b[2],b[3]]]:null
}
// Only public, versioned geographic references are shared across map instances.
let administrativePromise=null
export function loadAdministrativeReferences(fetcher=fetch){
 if(!administrativePromise){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  administrativePromise=Promise.all(['/geo/municipalities.json','/geo/states.geojson'].map(url=>fetcher(url,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('Referência indisponível.');return response.json()}))).then(([rows,geo])=>{
   if(!Array.isArray(rows)||geo?.features?.length!==27)throw new Error('Referência inválida.')
   return {rows,geo}
  }).catch(error=>{administrativePromise=null;throw error}).finally(()=>clearTimeout(timer))
 }
 return administrativePromise
}
