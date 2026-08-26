const compact=(value,maxLength=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength)
const quoted=value=>compact(value).replace(/[“”"]/g,"'")
const identifier=value=>compact(value,120)

const contextObject=({type,id,label}={})=>{
 const normalized={type:identifier(type),id:identifier(id),label:compact(label)}
 return normalized.type||normalized.id||normalized.label?normalized:null
}

export function buildOpportunityCopilotContext({opportunity,client}={}){
 if(!opportunity)return {source:'opportunities',clientId:'',prompt:'',context:null,persistenceMode:'NONE'}
 const title=quoted(opportunity.title||opportunity.hypothesis||'Oportunidade sem título')
 const stage=quoted(opportunity.stage||'etapa não informada')
 return {
  source:'opportunities',
  clientId:identifier(client?.id||opportunity.clientId||opportunity.client_id),
  prompt:`Contexto selecionado na interface (não registrar como fato): oportunidade “${title}”, etapa ${stage}. Revise este negócio ativo e me ajude a definir o próximo avanço com base apenas no contexto confirmado.`,
  context:contextObject({type:'opportunity',id:opportunity.id||opportunity.opportunityId||opportunity.candidateKey,label:title}),
  persistenceMode:'NONE'
 }
}

export function buildVisitCopilotContext({visit,client,preparing=false,draft=false}={}){
 if(!visit)return {source:preparing?'prepare_visit':'visits',clientId:identifier(client?.id),prompt:'',context:null,persistenceMode:'NONE'}
 const objective=quoted(visit.objective||'objetivo ainda não informado')
 const lifecycle=quoted(visit.lifecycleStatus||visit.lifecycle_status||visit.status||'estado não informado')
 const source=preparing?'prepare_visit':'visits'
 const objectType=draft?'visit_draft':'visit'
 const action=preparing?'Estou preparando esta visita':'Revise esta visita ativa'
 return {
  source,
  clientId:identifier(client?.id||visit.clientId||visit.client_id),
  prompt:`Contexto selecionado na interface (não registrar como fato): visita com objetivo “${objective}”, estado ${lifecycle}. ${action} e me ajude a definir o próximo passo com base apenas no contexto confirmado.`,
  context:contextObject({type:objectType,id:visit.id||visit.visitId,label:objective}),
  persistenceMode:'NONE'
 }
}

export function buildAgroCopilotContext({tool}={}){
 if(!tool)return {source:'agro',clientId:'',prompt:'',context:null,persistenceMode:'NONE'}
 const label=quoted(tool.label||tool.id||'capacidade agronômica')
 return {
  source:'agro',
  clientId:'',
  prompt:`Contexto selecionado na interface (não registrar como fato): capacidade agronômica “${label}”. Considere esta ferramenta ativa e me ajude a analisar a decisão sem transformar hipótese em prescrição.`,
  context:contextObject({type:'agronomic_tool',id:tool.id||tool.page,label}),
  persistenceMode:'NONE'
 }
}

export function resolveCopilotLaunch({input={},implicitContext=null,page='',storageScope='',clients=[],selectedClient=null}={}){
 const scopedImplicit=implicitContext
  &&implicitContext.source===page
  &&String(implicitContext.storageScope||'')===String(storageScope||'')
   ?implicitContext
   :null
 const requested={...(scopedImplicit||{}),...(input||{})}
 const requestedClientId=identifier(requested.client?.id||requested.clientId)
 const portfolioClient=requestedClientId
  ?clients.find(item=>String(item?.id)===String(requestedClientId))||null
  :page==='client360'&&selectedClient?.id
   ?clients.find(item=>String(item?.id)===String(selectedClient.id))||null
   :null
 const rejectedClient=Boolean(requestedClientId&&!portfolioClient)
 return {
  clientId:portfolioClient?.id||'',
  prompt:rejectedClient?'':compact(requested.prompt,3000),
  mode:requested.mode||'ASK',
  capture:rejectedClient?'':requested.capture||'',
  source:requested.source||page||'global',
  context:rejectedClient?null:contextObject(requested.context),
  persistenceMode:'NONE'
 }
}
