// Public administrative reference; never a producer polygon or ownership evidence.
import {normalizeCadastralGeoJSON} from '../src/lib/cadastral-map.js'
const fail=(message,statusCode=503)=>Object.assign(new Error(message),{statusCode,exposeMessage:true})
export function createMunicipalityBoundaries({fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
 const cache=new Map(),pending=new Map()
 return async code=>{
  if(!/^\d{7}$/.test(String(code)))throw fail('Código de município inválido.',400)
  const saved=cache.get(code);if(saved&&saved.expires>now())return saved.value
  if(pending.has(code))return pending.get(code)
  if(pending.size>=8)throw fail('Há consultas em andamento. Tente novamente em instantes.',503)
  const task=(async()=>{
   const sourceUrl=`https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${code}?formato=application/vnd.geo%2Bjson&qualidade=minima`
   try{
    const response=await fetchImpl(sourceUrl,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{Accept:'application/vnd.geo+json'}})
    if(!response.ok)throw fail('O limite deste município não está disponível no IBGE.',response.status===404?404:503)
    const chunks=[];let bytes=0
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw fail('A malha municipal excedeu o limite de carregamento.');chunks.push(chunk)}
    const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(raw.type!=='FeatureCollection'||raw.features?.length!==1||String(raw.features[0].properties?.codarea)!==code)throw fail('O IBGE não retornou o limite do município selecionado.')
    const geojson=normalizeCadastralGeoJSON(raw)
    const value={code,geojson,source:'IBGE · malha municipal simplificada',sourceUrl,queriedAt:new Date(now()).toISOString(),referenceOnly:true}
    cache.delete(code);cache.set(code,{value,expires:now()+86400000});if(cache.size>64)cache.delete(cache.keys().next().value)
    return value
   }catch(error){if(error.statusCode)throw error;throw fail('Não foi possível carregar a divisa municipal do IBGE. Tente novamente.')}finally{pending.delete(code)}
  })();pending.set(code,task);return task
 }
}
export const readMunicipalityBoundary=createMunicipalityBoundaries()
