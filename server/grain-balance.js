const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
const required=(value,max,label)=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw error(`${label} inválido.`)
 return value.trim()
}
const choices=(value,values,label)=>{if(!values.includes(value))throw error(`${label} inválido.`);return value}
const decimal=units=>`${units<0n?'-':''}${(units<0n?-units:units)/1000n}.${String((units<0n?-units:units)%1000n).padStart(3,'0')}`
const milli=value=>{const [whole,fraction='']=String(value).split('.');return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'))}
export function normalizeMovement(input={}){
 const id=required(input.id,80,'Identificador')
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw error('Identificador inválido.')
 const commodity=choices(input.commodity,['soja','milho','trigo','sorgo','feijao','arroz','cevada'],'Grão')
 const unit=choices(input.unit,['sc_60kg','t','kg'],'Unidade')
 const kind=choices(input.kind,['opening','entry','exit'],'Tipo')
 const raw=typeof input.quantity==='number'?String(input.quantity):input.quantity
 if(typeof raw!=='string'||!/^\d{1,9}(?:\.\d{1,3})?$/.test(raw))throw error('Quantidade deve ter até três casas decimais e ser não negativa.')
 const units=milli(raw)
 if(kind!=='opening'&&units===0n)throw error('Movimento deve ter quantidade positiva.')
 const origin=required(input.origin,240,'Origem'),reference=required(input.reference,240,'Referência')
 const timestamp=required(input.occurredAt,40,'Timestamp')
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp))throw error('Timestamp deve informar o fuso horário.')
 const occurredAt=new Date(timestamp)
 if(Number.isNaN(occurredAt.getTime())||occurredAt.getTime()>Date.now()+3_600_000)throw error('Timestamp inválido ou futuro.')
 return {id,commodity,unit,kind,quantity:decimal(units),origin,reference,occurredAt:occurredAt.toISOString()}
}
const record=row=>({id:row.id,producerId:String(row.client_id),commodity:row.commodity,unit:row.unit,kind:row.kind,quantity:String(row.quantity),origin:row.origin,reference:row.reference,occurredAt:new Date(row.occurred_at).toISOString(),createdAt:new Date(row.created_at).toISOString()})
export function reconcileMovements(movements){
 const groups=new Map()
 for(const movement of movements){
  const key=`${movement.commodity}:${movement.unit}`
  if(!groups.has(key))groups.set(key,{commodity:movement.commodity,unit:movement.unit,opening:0n,entries:0n,exits:0n,openingCount:0,movementIds:[]})
  const group=groups.get(key),quantity=milli(movement.quantity)
  if(movement.kind==='opening'){group.opening+=quantity;group.openingCount++}
  else if(movement.kind==='entry')group.entries+=quantity
  else if(movement.kind==='exit')group.exits+=quantity
  else throw error('Movimento persistido inválido.',500)
  group.movementIds.push(movement.id)
 }
 return [...groups.values()].map(group=>{
  if(group.openingCount!==1)throw error('Saldo inicial ausente ou duplicado.',409)
  return {commodity:group.commodity,unit:group.unit,opening:decimal(group.opening),entries:decimal(group.entries),exits:decimal(group.exits),current:decimal(group.opening+group.entries-group.exits),movementIds:group.movementIds}
 })
}
async function scopedTransaction(repository,clientId,ownerId,work){
 if(!ownerId)throw error('Autenticação obrigatória.',401)
 const producer=required(clientId,240,'Produtor')
 if(!repository.db.configured)throw error('O saldo operacional requer o banco protegido disponível.',503)
 return repository.db.transaction(async db=>{
  // The same producer lock serializes competing retries and opening balances.
  const found=await db.query(`SELECT id FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1 FOR UPDATE`,[repository.tenantId,ownerId,producer])
  if(!found.rows.length)throw error('Produtor não encontrado na sua carteira.',404)
  const scope=[repository.tenantId,ownerId,found.rows[0].id]
  const result=await db.query('SELECT * FROM sog_movements WHERE tenant_id=$1 AND owner_user_id=$2 AND client_id=$3 ORDER BY occurred_at,created_at,id',scope)
  return work(db,scope,result.rows.map(record))
 })
}
export async function readGrainBalance(repository,clientId,ownerId){
 return scopedTransaction(repository,clientId,ownerId,async(_db,scope,movements)=>({producerId:String(scope[2]),movements,balances:reconcileMovements(movements)}))
}
export async function appendGrainMovement(repository,clientId,ownerId,payload){
 const input=normalizeMovement(payload)
 return scopedTransaction(repository,clientId,ownerId,async(db,scope,movements)=>{
  const duplicates=movements.filter(row=>row.id===input.id||(row.origin===input.origin&&row.reference===input.reference))
  if(duplicates.length){
   const same=duplicates.length===1&&['commodity','unit','kind','quantity','origin','reference','occurredAt'].every(key=>duplicates[0][key]===input[key])
   if(!same)throw error('Identificador ou referência já usado com dados diferentes.',409)
   return {movement:duplicates[0],idempotent:true,balances:reconcileMovements(movements)}
  }
  const bucket=movements.filter(row=>row.commodity===input.commodity&&row.unit===input.unit)
  if(input.kind==='opening'&&bucket.length)throw error('Já existe saldo inicial para este grão e unidade.',409)
  if(input.kind!=='opening'&&!bucket.some(row=>row.kind==='opening'))throw error('Registre primeiro o saldo inicial deste grão e unidade.',409)
  const result=await db.query(`INSERT INTO sog_movements (tenant_id,owner_user_id,client_id,id,commodity,unit,kind,quantity,origin,reference,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[...scope,input.id,input.commodity,input.unit,input.kind,input.quantity,input.origin,input.reference,input.occurredAt])
  const movement=record(result.rows[0])
  return {movement,idempotent:false,balances:reconcileMovements([...movements,movement])}
 })
}
