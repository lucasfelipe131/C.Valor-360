import {installConversionComposition} from '../conversion-bootstrap.js'
import {installInnovationComposition} from '../innovation-bootstrap.js'

const COMPOSITION_STATE=Symbol.for('valor360.val-core.composition-state')
export const valRuntimeCompositionVersion='val.runtime.composition.v1'
export const valRuntimeCompositionOrder=Object.freeze(['conversion','innovation'])

export function installValRuntimeComposition(){
  if(globalThis[COMPOSITION_STATE])return globalThis[COMPOSITION_STATE]
  const steps=[installConversionComposition(),installInnovationComposition()]
  const state=Object.freeze({version:valRuntimeCompositionVersion,order:valRuntimeCompositionOrder,steps:Object.freeze(steps),ready:true})
  globalThis[COMPOSITION_STATE]=state
  return state
}

export function assertValRuntimeComposition(){
  const state=globalThis[COMPOSITION_STATE]
  if(!state?.ready)throw Object.assign(new Error('A composição explícita do VAL Core não foi instalada.'),{code:'val_core_composition_missing'})
  return state
}

export function currentValRuntimeComposition(){return globalThis[COMPOSITION_STATE]||null}
