const STAGES=Object.freeze({
  received:{order:0,label:'Recebendo a solicitação'},
  context:{order:1,label:'Cruzando histórico e sinais'},
  products:{order:2,label:'Comparando alternativas de produto'},
  language:{order:3,label:'Redigindo a recomendação'},
  persist:{order:4,label:'Salvando a recomendação'},
  complete:{order:5,label:'Recomendação pronta'},
  failed:{order:6,label:'Não foi possível concluir'}
})

const REQUEST_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text=value=>String(value??'').trim().slice(0,180)
const requiredScope=(value,label)=>{const normalized=text(value);if(!normalized)throw Object.assign(new Error(`${label} é obrigatório para escopar o acompanhamento.`),{code:'val_progress_scope_required'});return normalized}
const progressKey=(tenantId,ownerId,requestId)=>`${requiredScope(tenantId,'tenantId')}\u001f${requiredScope(ownerId,'ownerId')}\u001f${requestId}`

export function normalizeValProgressRequestId(value){
  const requestId=text(value)
  return REQUEST_ID.test(requestId)?requestId:''
}

export function createValProgressTracker({ttlMs=300_000,maxEntries=500,clock=()=>Date.now()}={}){
  const entries=new Map()

  function prune(){
    const cutoff=clock()-ttlMs
    for(const [key,value] of entries)if(value.updatedAtMs<cutoff)entries.delete(key)
    while(entries.size>maxEntries)entries.delete(entries.keys().next().value)
  }

  function snapshot(entry){
    if(!entry)return null
    const definition=STAGES[entry.stage]||STAGES.received
    return {
      requestId:entry.requestId,
      clientId:entry.clientId,
      mode:entry.mode,
      stage:entry.stage,
      label:definition.label,
      order:definition.order,
      total:STAGES.complete.order,
      done:entry.stage==='complete'||entry.stage==='failed',
      failed:entry.stage==='failed',
      updatedAt:new Date(entry.updatedAtMs).toISOString()
    }
  }

  function start({requestId,tenantId,ownerId,clientId,mode='daily'}){
    prune()
    const normalized=normalizeValProgressRequestId(requestId)
    if(!normalized)return null
    const now=clock()
    const tenant=requiredScope(tenantId,'tenantId')
    const owner=requiredScope(ownerId,'ownerId')
    const entry={requestId:normalized,tenantId:tenant,ownerId:owner,clientId:text(clientId),mode:text(mode)||'daily',stage:'received',updatedAtMs:now}
    entries.set(progressKey(tenant,owner,normalized),entry)
    return snapshot(entry)
  }

  function update({requestId,tenantId,ownerId,stage}){
    prune()
    const normalized=normalizeValProgressRequestId(requestId)
    if(!normalized)return null
    const tenant=requiredScope(tenantId,'tenantId')
    const owner=requiredScope(ownerId,'ownerId')
    const entry=entries.get(progressKey(tenant,owner,normalized))
    if(!entry||entry.tenantId!==tenant||entry.ownerId!==owner||!STAGES[stage])return null
    const current=STAGES[entry.stage]?.order??0
    const next=STAGES[stage].order
    if(stage!=='failed'&&next<current)return snapshot(entry)
    entry.stage=stage
    entry.updatedAtMs=clock()
    return snapshot(entry)
  }

  const complete=input=>update({...input,stage:'complete'})
  const fail=input=>update({...input,stage:'failed'})

  function get({requestId,tenantId,ownerId}){
    prune()
    const normalized=normalizeValProgressRequestId(requestId)
    if(!normalized)return null
    const tenant=requiredScope(tenantId,'tenantId')
    const owner=requiredScope(ownerId,'ownerId')
    const entry=entries.get(progressKey(tenant,owner,normalized))
    if(!entry||entry.tenantId!==tenant||entry.ownerId!==owner)return null
    return snapshot(entry)
  }

  return {start,update,complete,fail,get,stages:STAGES}
}

export const valProgressStages=STAGES
