import {createHash,randomUUID} from 'node:crypto'
import {WORKSPACE_METADATA,WORKSPACE_EVENT,OPPORTUNITY_STAGES,BUSINESS_TYPES,knownNumber} from '../src/lib/opportunity-workspace.js'

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const text=(value,length)=>String(value??'').trim().slice(0,length)
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key)
const fields=['crop','season','businessType','status','lossReason','volume','volumeUnit','waitingProducer','nextActionDone','closedAt']
export function workspaceDetails(evidence=[]){return (Array.isArray(evidence)?evidence:[]).find(x=>x?.type===WORKSPACE_METADATA)||{}}
const numeric=(value,label)=>{
 if(value===null||value===undefined||(typeof value==='string'&&value.trim()===''))return null
 if(!knownNumber(value)||Number(value)<0)throw fail(label+' inválido.')
 return Number(value)
}
const timestamp=(value,label)=>{
 if(value===null||value===undefined||value==='')return null
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value))throw fail(label+' inválido.')
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw fail(label+' inválido.')
 return date.toISOString()
}

export function buildWorkspaceMutation(current,input,{ownerId,now=new Date().toISOString()}){
 if(!ownerId)throw fail('A carteira autenticada é obrigatória.',403)
 const title=text(input.title,220),candidateKey=text(input.candidateKey,300)
 if(!title||!candidateKey||!OPPORTUNITY_STAGES.includes(input.stage))throw fail('Oportunidade, origem ou etapa inválida.')
 const previous=workspaceDetails(current?.evidence)
 const get=key=>has(input,key)?input[key]:previous[key]
 const status=get('status')||(input.stage==='Fechado'?'closed':'open')
 if(!['open','won','lost','archived','closed'].includes(status))throw fail('Resultado inválido.')
 if((input.stage==='Fechado')===(status==='open'))throw fail('Confira a etapa e o resultado do negócio.')
 const lossReason=text(get('lossReason'),2000)
 if(status==='lost'&&!lossReason)throw fail('Informe o motivo da perda.')
 const businessType=text(get('businessType'),30)
 if(businessType&&!BUSINESS_TYPES.includes(businessType))throw fail('Tipo de negócio inválido.')
 const volume=numeric(get('volume'),'Volume'),volumeUnit=text(get('volumeUnit'),20)
 if(volume!==null&&!['sc','t','kg','L','un'].includes(volumeUnit))throw fail('Informe uma unidade válida para o volume.')
 const data={title,candidateKey,stage:input.stage,value:numeric(input.value,'Valor'),
  category:businessType||text(input.category||current?.category,120),
  hypothesis:text(input.hypothesis??current?.hypothesis,4000),
  nextAction:text(input.nextAction,2000),nextActionAt:timestamp(input.nextActionAt,'Prazo'),
  crop:text(get('crop'),120),season:text(get('season'),60),businessType,status,lossReason,
  volume,volumeUnit:volume===null?'':volumeUnit,waitingProducer:get('waitingProducer')===true,
  nextActionDone:get('nextActionDone')===true,
  closedAt:status==='won'?(previous.status==='won'&&previous.closedAt?previous.closedAt:now):null}
 if(data.nextActionAt&&!data.nextAction)throw fail('Informe a próxima ação para vincular o prazo.')
 const note=text(input.returnNote,4000)
 const mutationId=text(input.mutationId,100)
 if(!/^[a-zA-Z0-9-]{16,100}$/.test(mutationId))throw fail('Identificador de gravação inválido.')
 const fingerprint=createHash('sha256').update(JSON.stringify({data,note})).digest('hex')
 const evidence=Array.isArray(current?.evidence)?current.evidence:[]
 const replay=evidence.find(x=>x?.type===WORKSPACE_EVENT&&x.mutationId===mutationId)
 // closedAt is assigned by the server, so a retry of a won creation compares the stored date.
 if(replay){
  const retryData={...data,closedAt:previous.closedAt||data.closedAt}
  const retryFingerprint=createHash('sha256').update(JSON.stringify({data:retryData,note})).digest('hex')
  if(replay.fingerprint!==retryFingerprint)throw fail('Esta gravação já foi utilizada. Reabra o formulário.',409)
  return {replay:true,record:current}
 }
 if(current?.updatedAt&&String(input.expectedUpdatedAt||'')!==String(current.updatedAt))throw fail('A oportunidade mudou desde a abertura. Atualize a carteira e reabra o formulário.',409)
 const metadata={type:WORKSPACE_METADATA,candidateKey,...Object.fromEntries(fields.map(key=>[key,data[key]]))}
 const before={...current,...previous}
 const changes=Object.keys(data).filter(key=>JSON.stringify(before[key]??null)!==JSON.stringify(data[key]??null)).map(field=>({field,before:before[field]??null,after:data[field]??null}))
 const event={type:WORKSPACE_EVENT,candidateKey,at:now,actorId:String(ownerId),mutationId,fingerprint,
  from:current?.stage||null,to:data.stage,
  label:!current?'Oportunidade criada':note?'Retorno registrado':current.stage!==data.stage?'Etapa atualizada para '+data.stage:'Oportunidade atualizada',
  note,changes}
 const stageEvidence={type:data.status==='won'?'won':'manual_set',candidateKey,from:current?.stage||'Diagnóstico',to:data.stage,at:now,actorId:String(ownerId)}
 return {replay:false,record:{...data,valueKnown:data.value!==null,
  evidence:[...evidence.filter(x=>x?.type!==WORKSPACE_METADATA),metadata,event,stageEvidence],
  workspaceDetails:metadata,stageEvidence,updatedAt:now,createdAt:current?.createdAt||now}}
}

export async function saveWorkspaceOpportunity(repository,input,ownerId,fromRow){
 if(!ownerId)throw fail('A carteira autenticada é obrigatória.',403)
 const clientId=text(input.clientId,180),candidateKey=text(input.candidateKey,300)
 if(!clientId||!candidateKey)throw fail('Produtor e origem são obrigatórios.')
 const externalKey='pipeline:'+createHash('sha256').update(clientId+':'+candidateKey).digest('hex')
 if(!repository.db.configured){
  const authorized=await repository.getIntelligence(ownerId)
  if(!authorized.clients.some(c=>String(c.id)===clientId))throw fail('Produtor não encontrado na sua carteira.',404)
  const store=repository.readStore();store.opportunities||=[]
  const matches=item=>String(item.tenantId)===String(repository.tenantId)&&String(item.ownerId)===String(ownerId)&&String(item.clientId)===clientId
  const current=store.opportunities.find(item=>matches(item)&&String(item.candidateKey)===candidateKey)
  const result=buildWorkspaceMutation(current,input,{ownerId})
  if(result.replay)return result.record
  const record={...current,...result.record,id:current?.id||'o-'+randomUUID(),clientId,tenantId:repository.tenantId,ownerId}
  store.opportunities=store.opportunities.filter(item=>!matches(item)||String(item.candidateKey)!==candidateKey).concat(record)
  repository.saveStore(store);return record
 }
 return repository.db.transaction(async connection=>{
  // Lock the authorized producer before lookup/insert. Concurrent retries of a new
  // candidate serialize, and a foreign producer/databaseId never gains authority.
  const client=await connection.query('SELECT id,external_key FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) FOR UPDATE',[repository.tenantId,ownerId,clientId])
  if(!client.rowCount)throw fail('Produtor não encontrado na sua carteira.',404)
  const c=client.rows[0]
  const found=await connection.query('SELECT * FROM opportunities WHERE tenant_id=$1 AND client_id=$2 AND '+(input.databaseId?'id::text=$3':'external_key=$3')+' FOR UPDATE',[repository.tenantId,c.id,String(input.databaseId||externalKey)])
  if(input.databaseId&&!found.rowCount)throw fail('Oportunidade não encontrada para este produtor.',404)
  const row=found.rows[0],current=row?fromRow({...row,client_external_key:c.external_key}):null
  if(current&&current.candidateKey!==candidateKey)throw fail('A origem da oportunidade não pode ser alterada.',409)
  const result=buildWorkspaceMutation(current,input,{ownerId})
  if(result.replay)return current
  const d=result.record
  const values=[repository.tenantId,c.id,d.title,d.category||null,d.hypothesis||null,d.value,d.stage,d.nextAction||null,d.nextActionAt,JSON.stringify(d.evidence),d.updatedAt]
  let saved
  if(row){
   saved=await connection.query('UPDATE opportunities SET title=$3,category=$4,hypothesis=$5,estimated_value=$6,stage=$7,next_action=$8,next_action_at=$9,evidence=$10,updated_at=$11 WHERE tenant_id=$1 AND client_id=$2 AND id=$12 RETURNING *',[...values,row.id])
  }else{
   saved=await connection.query('INSERT INTO opportunities (tenant_id,client_id,title,category,hypothesis,estimated_value,stage,next_action,next_action_at,evidence,updated_at,external_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11) RETURNING *',[...values,externalKey])
  }
  return fromRow({...saved.rows[0],client_external_key:c.external_key})
 })
}
