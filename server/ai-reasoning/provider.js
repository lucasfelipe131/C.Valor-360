export const reasoningProviderVersion='val.reasoning_provider.v1'

export class ReasoningProvider{
 constructor({name='unconfigured',model='unknown'}={}){this.name=name;this.model=model}
 synthesize(){throw new Error('ReasoningProvider.synthesize precisa ser implementado.')}
}

export class ComposedAdviceReasoningProvider extends ReasoningProvider{
 constructor({builder,model='rules-v7-specific'}={}){
  super({name:'val-composed-advice',model})
  if(typeof builder!=='function')throw new TypeError('ComposedAdviceReasoningProvider exige um builder.')
  this.builder=builder
 }
 synthesize(input){return this.builder({...input,provider:{name:this.name,model:input?.run?.model||this.model}})}
}
