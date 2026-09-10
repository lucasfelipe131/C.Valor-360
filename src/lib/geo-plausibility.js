// Latitude e longitude trocadas nao sao pegas por checagem de faixa: em qualquer ponto do Brasil a
// latitude (|lat| ate 34) cabe na faixa de longitude e a longitude (|lng| de 34 a 74) cabe na faixa
// de latitude. O arquivo passava na validacao e o talhao ia parar no Atlantico, com a area errada.
// So acusamos a inversao quando ela e demonstravel: o ponto esta fora do Brasil e, trocado, cai
// dentro. Coordenada legitimamente fora do Brasil continua passando.
const BRAZIL={minLat:-34.2,maxLat:5.5,minLng:-74.2,maxLng:-28.6}

export const insideBrazil=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=BRAZIL.minLat&&lat<=BRAZIL.maxLat&&lng>=BRAZIL.minLng&&lng<=BRAZIL.maxLng

// Recebe pares [lng,lat] (ordem GeoJSON). Devolve true quando a troca e a unica leitura plausivel.
export function looksLikeSwappedRing(pairs){
 const points=(Array.isArray(pairs)?pairs:[]).filter(pair=>Array.isArray(pair)&&Number.isFinite(pair[0])&&Number.isFinite(pair[1]))
 if(points.length<3)return false
 const mean=index=>points.reduce((sum,pair)=>sum+pair[index],0)/points.length
 const lng=mean(0);const lat=mean(1)
 return !insideBrazil(lat,lng)&&insideBrazil(lng,lat)
}

export const SWAPPED_COORDINATES_MESSAGE='As coordenadas parecem estar na ordem latitude,longitude. Exporte o arquivo em WGS84 na ordem longitude,latitude (padrão GeoJSON) e importe de novo.'
