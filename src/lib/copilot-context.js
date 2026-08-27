const compact=(value,maxLength=180)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength)
const quoted=value=>compact(value).replace(/[“”"]/g,"'")
const identifier=value=>compact(value,120)

const contextObject=({type,id,label,tool,page,mode,propertyId,fieldId,analysisId,crop,season}={})=>{
 const normalized={
  type:identifier(type),id:identifier(id),label:compact(label),tool:identifier(tool),page:identifier(page),mode:identifier(mode),
  propertyId:identifier(propertyId),fieldId:identifier(fieldId),analysisId:identifier(analysisId),crop:compact(crop,120),season:compact(season,120)
 }
 const compacted=Object.fromEntries(Object.entries(normalized).filter(([,value])=>value))
 return Object.keys(compacted).length?compacted:null
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

export function buildAgroCopilotContext({tool,client,property,field,analysis,crop,season}={}){
 if(!tool)return {source:'agro',clientId:'',prompt:'',context:null,persistenceMode:'NONE'}
 const label=quoted(tool.label||tool.id||'capacidade agronômica')
 const clientId=identifier(client?.id||tool.clientId)
 const fieldId=identifier(field?.id||tool.fieldId)
 const propertyId=identifier(property?.id||field?.propertyId||tool.propertyId)
 const analysisId=identifier(analysis?.id||tool.analysisId)
 return {
  source:'agro',
  clientId,
  prompt:`Contexto selecionado na interface (não registrar como fato): capacidade agronômica “${label}”. Considere esta ferramenta ativa e me ajude a analisar a decisão sem transformar hipótese em prescrição.`,
  context:contextObject({type:'agronomic_tool',id:tool.id||tool.page,label,tool:tool.id,page:tool.page,mode:tool.mode,propertyId,fieldId,analysisId,crop:crop||field?.crop||tool.crop,season:season||field?.season||tool.season}),
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
 const agroContext=requested.agroContext&&typeof requested.agroContext==='object'?requested.agroContext:null
 const requestedClientId=identifier(requested.client?.id||requested.clientId)
 const portfolioClient=requestedClientId
  ?clients.find(item=>String(item?.id)===String(requestedClientId))||null
  :page==='client360'&&selectedClient?.id
   ?clients.find(item=>String(item?.id)===String(selectedClient.id))||null
   :null
 const rejectedClient=Boolean(requestedClientId&&!portfolioClient)
 const requestedContext=contextObject({
  ...(requested.context||{}),
  tool:requested.context?.tool||agroContext?.tool?.id,
  propertyId:requested.context?.propertyId||agroContext?.property?.id,
  fieldId:requested.context?.fieldId||agroContext?.field?.id,
  analysisId:requested.context?.analysisId||agroContext?.analysis?.id,
  crop:requested.context?.crop||agroContext?.field?.crop,
  season:requested.context?.season||agroContext?.field?.season
 })
 const attachedFile=requested.attachment?.file
 const voiceFile=String(attachedFile?.type||'').startsWith('audio/')?attachedFile:null
 const prompt=rejectedClient?'':compact(requested.prompt,3000)
 return {
  clientId:portfolioClient?.id||'',
  prompt,
  autoSubmit:Boolean(!rejectedClient&&requested.autoSubmit&&prompt),
  mode:requested.mode||'ASK',
  intent:rejectedClient?'':identifier(requested.intent),
  capture:rejectedClient?'':attachedFile?'':requested.capture||'',
  source:requested.source||page||'global',
  context:rejectedClient?null:requestedContext,
  files:rejectedClient?[]:Array.isArray(requested.files)?requested.files.slice(0,3):attachedFile&&!voiceFile?[attachedFile]:[],
  voiceFile:rejectedClient?null:voiceFile,
  recording:rejectedClient?null:requested.recording||null,
  persistenceMode:'NONE'
 }
}

export function shouldAutoSubmitCopilotSeed({open=false,seedText=null,busy=false,uploading=false,selectedId='',activeContext=null}={}){
 if(!open||!seedText?.prompt||busy||uploading)return false
 if(String(selectedId||'')!==String(seedText.clientId||''))return false
 return JSON.stringify(activeContext||null)===JSON.stringify(seedText.context||null)
}
