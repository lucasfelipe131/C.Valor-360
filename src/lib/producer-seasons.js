export const SEASON_CROPS=['Milho','Soja','Trigo','Canola']
export const seasonCode=value=>String(value||'').trim().toUpperCase()
export function validSeasonCode(value){const code=seasonCode(value);if(!/^\d{4}[IV]$/.test(code))return false;const start=Number(code.slice(0,2)),end=Number(code.slice(2,4));return end===start||end===start+1}
export const seasonOrder=code=>Number(String(code).slice(2,4))*10+(String(code).endsWith('I')?2:1)
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
export function previousYield(seasons,code,crop){
 const rows=seasons.filter(s=>s.season!==code&&seasonOrder(s.season)<seasonOrder(code)&&s.season.endsWith(code.slice(-1))).flatMap(s=>(s.crops||[]).filter(r=>r.crop===crop&&known(r.actualYield)&&known(r.areaHa)&&r.areaHa>0))
 const area=rows.reduce((sum,r)=>sum+r.areaHa,0)
 return area?{yield:rows.reduce((sum,r)=>sum+r.areaHa*r.actualYield,0)/area,count:rows.length}:null
}
