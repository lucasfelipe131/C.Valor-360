import {ValRepository} from './repository.js'
import {buildCommitmentLadders} from './commitment-ladder.js'
import {buildObjectionLibrary} from './objection-library.js'
import {buildValueScenarios} from './value-scenarios.js'

const PATCHED=Symbol.for('valor360.conversion-innovations.patched')

if(!globalThis[PATCHED]){
 globalThis[PATCHED]=true
 const originalGetClientContext=ValRepository.prototype.getClientContext
 ValRepository.prototype.getClientContext=async function contextWithConversionInnovations(input){
  const context=await originalGetClientContext.call(this,input)
  return {
   ...context,
   conversionInnovations:{
    ...(context.conversionInnovations||{}),
    commitmentLadders:buildCommitmentLadders(context),
    objectionLibrary:buildObjectionLibrary(context),
    valueScenarios:buildValueScenarios(context)
   }
  }
 }
}
