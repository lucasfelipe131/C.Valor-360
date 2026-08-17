import {ValRepository} from './repository.js'
import {buildCommitmentLadders} from './commitment-ladder.js'
import {buildObjectionLibrary,loadPortfolioBusinessHistory} from './objection-library.js'

const PATCHED=Symbol.for('valor360.conversion-innovations.patched')

if(!globalThis[PATCHED]){
 globalThis[PATCHED]=true
 const originalGetClientContext=ValRepository.prototype.getClientContext
 ValRepository.prototype.getClientContext=async function contextWithConversionInnovations(input){
  const context=await originalGetClientContext.call(this,input)
  let portfolioHistory=context.businessHistory||[]
  let objectionLibraryLoadError=''
  try{portfolioHistory=await loadPortfolioBusinessHistory(this,input?.ownerId)}
  catch(error){objectionLibraryLoadError=String(error?.message||'A biblioteca da carteira não pôde ser consultada.').slice(0,300)}
  return {
   ...context,
   conversionInnovations:{
    ...(context.conversionInnovations||{}),
    commitmentLadders:buildCommitmentLadders(context),
    objectionLibrary:{...buildObjectionLibrary(context,{portfolioHistory}),loadError:objectionLibraryLoadError}
   }
  }
 }
}
