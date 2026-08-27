export const agroHeroContractVersion='val.agro_hero_action.v1'
export const agroHeroContextVersion='val.agro_hero_context.v1'

export const AGRO_HERO_ACTIONS=Object.freeze(['voice','text','photo','file'])
export const AGRO_HERO_STATES=Object.freeze(['idle','loading','success','error'])

export const AGRO_HERO_FILE_POLICY=Object.freeze({
 maxBytes:6_000_000,
 photoAccept:'image/jpeg,image/png,image/webp',
 fileAccept:'.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/jpeg,image/png,image/webp,application/pdf,text/csv,text/plain',
 photoTypes:Object.freeze(['image/jpeg','image/png','image/webp']),
 fileTypes:Object.freeze([
  'image/jpeg','image/png','image/webp','application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'
 ])
})

const clean=(value,max=240)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const identifier=value=>clean(value,120)
const entity=(value,type)=>{
 if(!value||typeof value!=='object')return null
 const id=identifier(value.id??value.externalKey??value.external_key)
 const label=clean(value.name??value.label??value.title??value.sampleCode??value.sample_code,240)
 if(!id&&!label)return null
 return Object.freeze({type,id,label})
}

export function createAgroHeroStates(){
 return Object.fromEntries(AGRO_HERO_ACTIONS.map(action=>[action,{status:'idle',phase:'idle',message:'',errorCode:''}]))
}

export function transitionAgroHeroState(states,action,status,{phase=status,message='',errorCode=''}={}){
 if(!AGRO_HERO_ACTIONS.includes(action))throw new TypeError('Ação do hero agronômico inválida.')
 if(!AGRO_HERO_STATES.includes(status))throw new TypeError('Estado do hero agronômico inválido.')
 return {...states,[action]:{status,phase:clean(phase,80)||status,message:clean(message,500),errorCode:clean(errorCode,120)}}
}

export function createAgroHeroContext({producer,client,property,field,talhao,analysis,tool}={}){
 const normalized={
  version:agroHeroContextVersion,
  producer:entity(producer||client,'producer'),
  property:entity(property,'property'),
  field:entity(field||talhao,'field'),
  analysis:entity(analysis,'analysis'),
  tool:entity(tool,'agronomic_tool')
 }
 const contextRefs=['producer','property','field','analysis','tool'].flatMap(key=>normalized[key]?[normalized[key]]:[])
 return Object.freeze({...normalized,clientId:normalized.producer?.id||'',context_refs:Object.freeze(contextRefs)})
}

export function mostSpecificAgroContext(context={}){
 return context.analysis||context.field||context.property||context.tool||null
}

export function normalizeAgroToolDescriptor(value){
 if(!value)return null
 const raw=typeof value==='string'?{id:value}:value
 if(typeof raw!=='object')return null
 const safe=value=>identifier(value).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')
 const id=safe(raw.id||raw.tool)
 if(!id)return null
 const aliases={
  mapping:{tool:'mapping',page:'produtores'},'area-mapping':{tool:'mapping',page:'produtores'},mapeamento:{tool:'mapping',page:'produtores'},produtores:{tool:'mapping',page:'produtores'},
  calculator:{tool:'calculators',page:'calculadoras'},calculators:{tool:'calculators',page:'calculadoras'},calculadoras:{tool:'calculators',page:'calculadoras'},
  soil:{tool:'soil',page:'solo'},'analyze-soil':{tool:'soil',page:'solo'},solo:{tool:'soil',page:'solo'},
  diagnosis:{tool:'diagnosis',page:'diagnostico'},diagnostico:{tool:'diagnosis',page:'diagnostico'},
  nutriscan:{tool:'diagnosis',page:'diagnostico',diagnosisMode:'nutrition'},
  fitoscan:{tool:'diagnosis',page:'diagnostico',diagnosisMode:'disease'},
  fitscan:{tool:'diagnosis',page:'diagnostico',diagnosisMode:'disease'},
  insetoscan:{tool:'diagnosis',page:'diagnostico',diagnosisMode:'insect'},
  daninhascan:{tool:'diagnosis',page:'diagnostico',diagnosisMode:'weed'}
 }
 const canonical=aliases[safe(raw.tool)]||aliases[id]||{}
 const page=safe(raw.page)||canonical.page||id
 const mode=safe(raw.mode)||'open'
 const diagnosisMode=safe(raw.diagnosisMode)||canonical.diagnosisMode||(['nutrition','disease','insect','weed'].includes(mode)?mode:'')
 const calculator=safe(raw.calculator||raw.calculatorKey)
 return Object.freeze({id,page,tool:canonical.tool||'',mode,diagnosisMode,calculator,label:clean(raw.label||raw.title,240)||id})
}

let navigationRequestSequence=0

export function createAgroWorkspaceMessage({context={},tool,requestId=''}={}){
 const normalizedContext=createAgroHeroContext(context)
 const descriptor=normalizeAgroToolDescriptor(tool)
 if(!descriptor)throw new TypeError('Ferramenta agronômica inválida.')
 const resolvedRequestId=identifier(requestId)||`agro-${Date.now().toString(36)}-${(++navigationRequestSequence).toString(36)}`
 return Object.freeze({
  type:'valor360:navigate',
  version:1,
  requestId:resolvedRequestId,
  page:descriptor.page,
  ...(descriptor.tool?{tool:descriptor.tool}:{}),
  mode:descriptor.mode,
  ...(descriptor.diagnosisMode?{diagnosisMode:descriptor.diagnosisMode}:{}),
  ...(descriptor.calculator?{calculator:descriptor.calculator}:{}),
  context:Object.freeze({
   clientId:normalizedContext.clientId,
   clientName:normalizedContext.producer?.label||'',
   propertyId:normalizedContext.property?.id||'',
   propertyName:normalizedContext.property?.label||'',
   fieldId:normalizedContext.field?.id||'',
   fieldName:normalizedContext.field?.label||'',
   analysisId:normalizedContext.analysis?.id||''
  })
 })
}

export function buildAgroCopilotLaunchContext(input={}){
 // The version marker is descriptive, not a trust boundary. Re-normalizing here
 // prevents callers from smuggling tenant/owner fields into the UI contract.
 const context=createAgroHeroContext(input)
 const selected=mostSpecificAgroContext(context)
 return Object.freeze({
  source:'agro',
  clientId:context.clientId||'',
  context:selected?{type:selected.type,id:selected.id,label:selected.label}:null,
  persistenceMode:'NONE',
  agroContext:context
 })
}

export function inferAgroHeroIntent(action,file={}){
 if(action==='photo'||String(file.type||'').startsWith('image/'))return 'IMAGE_DIAGNOSIS'
 const name=clean(file.name,300).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/(?:^|[^a-z])(solo|fertilidade|laudo|laboratorio)(?:[^a-z]|$)/.test(name))return 'ANALYZE_SOIL'
 return 'ASK_AGRONOMIC'
}

export function validateAgroHeroFile(file,action='file'){
 if(!file||typeof file!=='object')return {ok:false,code:'FILE_REQUIRED',message:'Selecione um arquivo para continuar.'}
 const mimeType=clean(file.type,160).toLowerCase()
 const extension=clean(file.name,300).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||''
 const size=Number(file.size||0)
 const allowed=action==='photo'?AGRO_HERO_FILE_POLICY.photoTypes:AGRO_HERO_FILE_POLICY.fileTypes
 const extensionAllowed=(action==='photo'?['jpg','jpeg','png','webp']:['jpg','jpeg','png','webp','pdf','doc','docx','xls','xlsx','csv','txt']).includes(extension)
 const genericMime=!mimeType||mimeType==='application/octet-stream'
 if(!allowed.includes(mimeType)&&!(genericMime&&extensionAllowed))return {ok:false,code:action==='photo'?'PHOTO_TYPE_INVALID':'FILE_TYPE_INVALID',message:action==='photo'?'Use uma foto JPG, PNG ou WebP.':'Use foto, PDF, Word, Excel, CSV ou TXT.'}
 if(!Number.isFinite(size)||size<=0)return {ok:false,code:'FILE_EMPTY',message:'O arquivo está vazio ou não pôde ser lido.'}
 if(size>AGRO_HERO_FILE_POLICY.maxBytes)return {ok:false,code:'FILE_TOO_LARGE',message:'O arquivo pode ter no máximo 6 MB.'}
 return {ok:true,code:'VALID',message:'Arquivo pronto.',metadata:Object.freeze({name:clean(file.name,300)||'arquivo',mimeType,sizeBytes:size,intent:inferAgroHeroIntent(action,file)})}
}

export function createAgroHeroFileCandidate(value){
 const file=value?.file||value
 const validation=validateAgroHeroFile(file,'file')
 const name=clean(file?.name,300)||'arquivo'
 const mimeType=clean(file?.type,160)
 const sizeBytes=Number(file?.size||0)
 const intent=validation.ok?validation.metadata.intent:inferAgroHeroIntent('file',file||{})
 return Object.freeze({
  key:`${name}:${mimeType}:${sizeBytes}`,
  file,
  name,
  mimeType,
  sizeBytes,
  intent,
  intentLabel:intent==='ANALYZE_SOIL'?'Parece ser uma análise de solo.':intent==='IMAGE_DIAGNOSIS'?'Parece ser uma imagem de campo.':'Parece ser um documento técnico.',
  validation
 })
}

export function createAgroHeroActionPayload({action,prompt='',context={},file=null,recording=null}={}){
 if(!AGRO_HERO_ACTIONS.includes(action))throw new TypeError('Ação do hero agronômico inválida.')
 const normalizedContext=createAgroHeroContext(context)
 const launch=buildAgroCopilotLaunchContext(normalizedContext)
 const attachment=file?{
  file,
  name:clean(file.name,300)||'arquivo',
  mimeType:clean(file.type,160),
  sizeBytes:Number(file.size||0),
  intent:inferAgroHeroIntent(action,file)
 }:null
 return Object.freeze({
  version:agroHeroContractVersion,
  action:action.toUpperCase(),
  capture:action,
  mode:'ASK',
  source:'agro_hero',
  persistenceMode:'NONE',
  clientId:launch.clientId,
  context:launch.context,
  agroContext:normalizedContext,
  prompt:clean(prompt,3000),
  intent:attachment?.intent||(action==='voice'||action==='text'?'ASK_AGRONOMIC':inferAgroHeroIntent(action,file||{})),
  attachment,
  recording:recording?Object.freeze({durationSeconds:Number(recording.durationSeconds||0),mimeType:clean(recording.mimeType,160)}):null
 })
}

export function createAgroHeroTelemetry({action,status,context={},phase=status,errorCode='',at=new Date().toISOString()}={}){
 if(!AGRO_HERO_ACTIONS.includes(action)||!AGRO_HERO_STATES.includes(status))throw new TypeError('Telemetria do hero agronômico inválida.')
 const normalized=createAgroHeroContext(context)
 return Object.freeze({
  event:'agro_hero_interaction',
  version:agroHeroContractVersion,
  action:action.toUpperCase(),
  status:status.toUpperCase(),
  phase:clean(phase,80)||status,
  clientContext:Boolean(normalized.clientId),
  contextTypes:normalized.context_refs.map(item=>item.type),
  errorCode:clean(errorCode,120)||null,
  at:clean(at,60)
 })
}

export function agroHeroVoiceError(error){
 const name=clean(error?.name,120)
 if(name==='NotAllowedError'||name==='SecurityError')return {code:'MICROPHONE_NOT_ALLOWED',message:'Permita o uso do microfone para falar com a VAL ou use o texto.'}
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return {code:'MICROPHONE_NOT_FOUND',message:'Nenhum microfone foi encontrado. Use o texto ou conecte um microfone.'}
 if(name==='NotReadableError'||name==='TrackStartError')return {code:'MICROPHONE_BUSY',message:'O microfone está sendo usado por outro aplicativo.'}
 if(name==='UNSUPPORTED')return {code:'MICROPHONE_UNSUPPORTED',message:'Este navegador não oferece gravação direta. Use o texto.'}
 return {code:'MICROPHONE_FAILED',message:clean(error?.message,500)||'Não foi possível iniciar a gravação.'}
}
