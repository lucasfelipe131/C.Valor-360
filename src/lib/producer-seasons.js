export const SEASON_CROPS=['Milho','Soja','Trigo','Canola']
// O <option> do DOM colapsa espacos no value: gravar 'INVERNO  2029' (espaco duplo) deixava a safra
// inalcancavel pela tela e permitia criar uma segunda linha visualmente identica.
export const seasonCode=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase()
// Labels are user-defined. Only recognised codes participate in automatic historical averages.
export function validSeasonCode(value){const label=seasonCode(value);return label.length>=2&&label.length<=30&&/^[\p{L}\p{N}][\p{L}\p{N} /_.()-]*$/u.test(label)}
export function seasonPeriod(value){
 const code=seasonCode(value);if(!/^\d{4}[IV]$/.test(code))return null
 const start=Number(code.slice(0,2)),end=Number(code.slice(2,4));if(end!==start&&end!==start+1)return null
 return {order:(2000+end)*10+(code.endsWith('I')?2:1),type:code.slice(-1)}
}
export const seasonOrder=code=>seasonPeriod(code)?.order??0
export const compareSeasons=(a,b)=>seasonOrder(b)-seasonOrder(a)||a.localeCompare(b,'pt-BR',{numeric:true})
export const numeric=value=>value===null||value===undefined||String(value).trim()===''?null:Number(String(value).replace(',','.'))
export const emptySeasonCrops=()=>SEASON_CROPS.map(crop=>({crop,areaHa:null,expectedYield:null,actualYield:null,retainedSc:null,otherBuyersSc:null,targetSharePct:null,deliveredSc:null}))
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0
export function cropPotential(row){
 const productionSc=known(row.areaHa)&&known(row.expectedYield)?row.areaHa*row.expectedYield:null
 const actualProductionSc=known(row.areaHa)&&known(row.actualYield)?row.areaHa*row.actualYield:null
 const deductionsKnown=known(row.retainedSc)&&known(row.otherBuyersSc)
 const conflict=productionSc!==null&&deductionsKnown&&row.retainedSc+row.otherBuyersSc>productionSc
 const availableSc=productionSc!==null&&deductionsKnown&&!conflict?productionSc-row.retainedSc-row.otherBuyersSc:null
 const targetSc=availableSc!==null&&known(row.targetSharePct)&&row.targetSharePct<=100?availableSc*row.targetSharePct/100:null
 return {productionSc,actualProductionSc,availableSc,targetSc,remainingSc:targetSc!==null&&known(row.deliveredSc)?Math.max(0,targetSc-row.deliveredSc):null,achievementPct:targetSc>0&&known(row.deliveredSc)?row.deliveredSc/targetSc*100:null,conflict}
}
// Devolve tambem QUAIS safras entraram na conta: o texto de origem gravado no cadastro (e impresso no
// relatorio do produtor) precisa nomear exatamente as safras da media, nao uma lista filtrada por
// outra regra. Antes o botao refazia o filtro pela ultima letra do rotulo e citava safras futuras.
export function previousYield(seasons,code,crop){
 const target=seasonPeriod(code);if(!target)return null
 const eligible=seasons.filter(s=>{const prior=seasonPeriod(s.season);return prior&&prior.order<target.order&&prior.type===target.type})
 const rows=eligible.flatMap(s=>(s.crops||[]).filter(r=>r.crop===crop&&known(r.actualYield)&&known(r.areaHa)&&r.areaHa>0).map(r=>({...r,season:s.season})))
 const area=rows.reduce((sum,r)=>sum+r.areaHa,0)
 return area?{yield:rows.reduce((sum,r)=>sum+r.areaHa*r.actualYield,0)/area,count:rows.length,seasons:[...new Set(rows.map(r=>r.season))]}:null
}
