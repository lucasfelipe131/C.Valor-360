import {ValRepository} from './repository.js'
import {buildPortfolioRadar,VAL_PORTFOLIO_RADAR_VERSION} from '../src/lib/portfolio-radar.js'

const PATCHED=Symbol.for('valor360.portfolio-radar.patched')

if(!globalThis[PATCHED]){
  globalThis[PATCHED]=true
  const originalGetIntelligence=ValRepository.prototype.getIntelligence

  ValRepository.prototype.getIntelligence=async function intelligenceWithDailyRadar(ownerId){
    const intelligence=await originalGetIntelligence.call(this,ownerId)
    return {
      ...intelligence,
      radar:buildPortfolioRadar(intelligence,{limit:5}),
      radarVersion:VAL_PORTFOLIO_RADAR_VERSION
    }
  }
}
