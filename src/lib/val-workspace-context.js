export const VAL_WORKSPACE_CONTEXT_VERSION='val.workspace_context.v1'

export const VAL_WORKSPACE_MODULES=Object.freeze(['dashboard','clients','datahub','client360','visits','opportunities','val','agro','questionnaire','reports','settings','admin','copilot'])
const modules=new Set(VAL_WORKSPACE_MODULES)
const clean=(value,max=180)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const ref=(value,type)=>{
 if(!value||typeof value!=='object')return null
 const id=clean(value.id??value.external_key??value.externalKey)
 const label=clean(value.label??value.name??value.title)
 return id||label?Object.freeze({type,id:id||null,label:label||null}):null
}

export function createValWorkspaceContext({module='dashboard',client=null,property=null,field=null,visit=null,opportunity=null,attachment=null,analysis=null,conversation=null}={}){
 const currentModule=modules.has(String(module))?String(module):'dashboard'
 const currentClient=ref(client,'client')
 const currentProperty=currentClient?ref(property,'property'):null
 const currentField=currentProperty?ref(field,'field'):null
 return Object.freeze({
  contract_version:VAL_WORKSPACE_CONTEXT_VERSION,
  current_module:currentModule,
  current_client:currentClient,
  current_property:currentProperty,
  current_field:currentField,
  current_visit:currentClient?ref(visit,'visit'):null,
  current_opportunity:currentClient?ref(opportunity,'opportunity'):null,
  current_attachment:ref(attachment,'attachment'),
  current_analysis:ref(analysis,'analysis'),
  current_conversation:ref(conversation,'conversation'),
  persistence_mode:'NONE'
 })
}

export function validateValWorkspaceAction(value){
 if(!value||typeof value!=='object'||value.contract_version!=='val.workspace_action.v1')return null
 const type=clean(value.type,60).toUpperCase()
 if(!['NAVIGATE','OPEN_CLIENT','PREPARE_VISIT'].includes(type))return null
 const page=clean(value.page,60)
 if(!modules.has(page))return null
 return Object.freeze({type,page,label:clean(value.label),clientId:clean(value.client_id),clientName:clean(value.client_name),tool:clean(value.tool,80),manualPage:clean(value.manual_page,80),diagnosisMode:clean(value.diagnosis_mode,80),requiresConfirmation:value.requires_confirmation===true})
}
