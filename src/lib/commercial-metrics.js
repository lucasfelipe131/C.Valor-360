const hasNumber=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key)&&value?.[key]!==''&&value?.[key]!==null&&value?.[key]!==undefined&&Number.isFinite(Number(value[key]))
const number=(value,key)=>hasNumber(value,key)?Math.max(0,Number(value[key])):0

export function commercialMetrics(client={}){
 const commercial=client?.commercial||{}
 const currentKnown=hasNumber(commercial,'purchaseCurrentSeason')
 const currentPurchases=number(commercial,'purchaseCurrentSeason')
 const canonicalPotentialKnown=hasNumber(commercial,'potentialTotal')
 const legacyPotentialKnown=commercial.potentialValidated!==false&&hasNumber(commercial,'potential')
 const potentialKnown=canonicalPotentialKnown||legacyPotentialKnown
 const potentialTotal=canonicalPotentialKnown?number(commercial,'potentialTotal'):legacyPotentialKnown?number(commercial,'potential'):0
 const explicitOpenKnown=hasNumber(commercial,'openPotential')
 const calculatedOpenKnown=canonicalPotentialKnown&&currentKnown
 const openPotential=explicitOpenKnown?number(commercial,'openPotential'):calculatedOpenKnown?Math.max(0,potentialTotal-currentPurchases):legacyPotentialKnown?potentialTotal:0
 const pipelineKnown=hasNumber(commercial,'openPipeline')
 const openPipeline=number(commercial,'openPipeline')
 const explicitShareKnown=hasNumber(commercial,'realizedShare')||hasNumber(commercial,'walletShare')
 const realizedShare=hasNumber(commercial,'realizedShare')?number(commercial,'realizedShare'):currentKnown&&potentialKnown&&potentialTotal>0?Math.min(100,currentPurchases/potentialTotal*100):hasNumber(commercial,'walletShare')?number(commercial,'walletShare'):null
 const profileLabel=String(client?.primaryProfile||'')
 const profileMeasured=Boolean(client?.profileUpdatedAt||client?.profileVersion||profileLabel&&!/^a (?:classificar|confirmar)|^aguardando/i.test(profileLabel))
 return {
  currentKnown,currentPurchases,potentialKnown,potentialTotal,openPotential,openPotentialKnown:explicitOpenKnown||calculatedOpenKnown||legacyPotentialKnown,
  pipelineKnown,openPipeline,shareKnown:explicitShareKnown||(currentKnown&&potentialKnown&&potentialTotal>0),realizedShare,profileMeasured,
  irtKnown:profileMeasured&&client?.irt!==null&&client?.irt!==undefined&&Number.isFinite(Number(client.irt)),
  npsKnown:profileMeasured&&client?.nps!==null&&client?.nps!==undefined&&Number.isFinite(Number(client.nps))
 }
}

export function relationshipSummary(clients=[]){
 const portfolio=Array.isArray(clients)?clients:[]
 const measured=portfolio.map(client=>({client,metrics:commercialMetrics(client)}))
 const irtValues=measured.filter(item=>item.metrics.irtKnown).map(item=>Number(item.client.irt))
 const npsValues=measured.filter(item=>item.metrics.npsKnown).map(item=>Number(item.client.nps))
 const average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null
 const promoters=npsValues.filter(value=>value>=9).length
 return {
  total:portfolio.length,
  profileMeasured:measured.filter(item=>item.metrics.profileMeasured).length,
  irtKnown:irtValues.length,
  irtAverage:average(irtValues),
  npsKnown:npsValues.length,
  promoters,
  promoterRate:npsValues.length?promoters/npsValues.length*100:null
 }
}

export function compactBRL(value,{known=true}={}){
 if(!known)return 'A medir'
 const amount=Math.max(0,Number(value)||0)
 if(amount>=1_000_000)return `R$ ${(amount/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} mi`
 if(amount>=1_000)return `R$ ${(amount/1_000).toLocaleString('pt-BR',{maximumFractionDigits:0})} mil`
 return amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
}

export const metricValue=(value,known,suffix='')=>known?`${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}${suffix}`:'A medir'
