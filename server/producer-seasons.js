import {SEASON_CROPS,seasonCode,validSeasonCode,numeric} from '../src/lib/producer-seasons.js'
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
const demo=client=>client?.isDemo===true||client?.demo?.synthetic===true||client?.profileSource==='val-demo-synthetic-v1'||client?.source==='val-demo-synthetic-v1'
export function normalizeSeasonInput(input){
 const season=seasonCode(input?.season)
 if(!validSeasonCode(season))fail('Informe um nome de safra com 2 a 30 caracteres, como 2627V ou Verão 2028/29.')
 if(!Number.isInteger(input?.revision)||input.revision<0)fail('Recarregue a safra antes de salvar.')
 const sourceNote=String(input.sourceNote||'').trim();if(!sourceNote||sourceNote.length>500)fail('Informe a origem dos dados (até 500 caracteres).')
 const observedOn=String(input.observedOn||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(observedOn)||Number.isNaN(Date.parse(observedOn))||new Date(observedOn).toISOString().slice(0,10)!==observedOn||observedOn>new Date().toISOString().slice(0,10))fail('Informe uma data de referência válida, até hoje.')
 if(!Array.isArray(input.crops)||input.crops.length!==4||new Set(input.crops.map(r=>r?.crop)).size!==4)fail('Informe as quatro culturas sem duplicação.')
 const crops=SEASON_CROPS.map(crop=>{
  const row=input.crops.find(r=>r?.crop===crop);if(!row)fail('Cultura inválida.')
  const result={crop}
  for(const [key,max] of Object.entries({areaHa:10000000,expectedYield:1000,actualYield:1000,retainedSc:10000000000,otherBuyersSc:10000000000,targetSharePct:100,deliveredSc:10000000000})){
   if(row[key]!=null&&!['string','number'].includes(typeof row[key]))fail(`Valor inválido em ${crop}: ${key}.`)
   const value=numeric(row[key]);if(value!==null&&(!Number.isFinite(value)||value<0||value>max))fail(`Valor inválido em ${crop}: ${key}.`)
   result[key]=value
  }
  return result
 })
 return {season,revision:input.revision,sourceNote,observedOn,crops}
}
const record=row=>({season:row.season,revision:row.revision,crops:row.crops,sourceNote:row.source_note,observedOn:String(row.observed_on instanceof Date?row.observed_on.toISOString():row.observed_on).slice(0,10),isDemo:row.is_demo,updatedAt:row.updated_at})
async function authorized(repository,clientId,ownerId,db=repository.db,lock=false){
 if(!ownerId)fail('Sua sessão expirou.',401)
 if(!repository.db.configured){const client=(await repository.getIntelligence(ownerId)).clients.find(c=>String(c.id)===String(clientId));if(!client)fail('Produtor não encontrado na sua carteira.',404);return client}
 const result=await db.query(`SELECT id,source FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1${lock?' FOR UPDATE':''}`,[repository.tenantId,ownerId,clientId]);if(!result.rows[0])fail('Produtor não encontrado na sua carteira.',404);return result.rows[0]
}
export async function readProducerSeasons(repository,clientId,ownerId){
 const client=await authorized(repository,clientId,ownerId)
 const isDemo=demo(client)
 if(!repository.db.configured){const rows=repository.readStore().val?.producerSeasons||[];return {clientId,isDemo,seasons:rows.filter(r=>r.tenantId===repository.tenantId&&r.ownerId===ownerId&&r.clientId===clientId&&(isDemo||!r.isDemo)).map(({tenantId,ownerId,clientId,...row})=>row)}}
 const result=await repository.db.query('SELECT s.* FROM val_producer_seasons s JOIN clients c ON c.tenant_id=s.tenant_id AND c.id=s.client_id WHERE s.tenant_id=$1 AND c.consultant_id=$2 AND s.owner_user_id=$2 AND s.client_id=$3 AND ($4 OR s.is_demo=FALSE) ORDER BY s.season DESC',[repository.tenantId,ownerId,client.id,isDemo])
 return {clientId,isDemo,seasons:result.rows.map(record)}
}
export async function saveProducerSeason(repository,clientId,ownerId,input){
 const normalized=normalizeSeasonInput(input)
 if(!repository.db.configured){
  const client=await authorized(repository,clientId,ownerId);const store=repository.readStore();store.val||={};store.val.producerSeasons||=[]
  const index=store.val.producerSeasons.findIndex(r=>r.tenantId===repository.tenantId&&r.clientId===clientId&&r.season===normalized.season)
  const old=store.val.producerSeasons[index];if(old&&old.ownerId!==ownerId)fail('Safra indisponível para esta carteira.',403)
  if((old?.revision||0)!==normalized.revision)fail('A safra mudou em outra sessão. Recarregue antes de salvar.',409)
  const row={...normalized,revision:normalized.revision+1,clientId,tenantId:repository.tenantId,ownerId,isDemo:demo(client),updatedAt:new Date().toISOString()}
  if(index>=0)store.val.producerSeasons[index]=row;else store.val.producerSeasons.push(row)
  repository.saveStore(store);return row
 }
 return repository.db.transaction(async db=>{
  const client=await authorized(repository,clientId,ownerId,db,true)
  const previous=await db.query('SELECT revision,owner_user_id FROM val_producer_seasons WHERE tenant_id=$1 AND client_id=$2 AND season=$3 FOR UPDATE',[repository.tenantId,client.id,normalized.season])
  const old=previous.rows[0];if(old&&String(old.owner_user_id)!==String(ownerId))fail('Safra indisponível para esta carteira.',403)
  if((old?.revision||0)!==normalized.revision)fail('A safra mudou em outra sessão. Recarregue antes de salvar.',409)
  const result=await db.query(`INSERT INTO val_producer_seasons(tenant_id,client_id,owner_user_id,season,revision,crops,source_note,observed_on,is_demo) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) ON CONFLICT(tenant_id,client_id,season) DO UPDATE SET revision=EXCLUDED.revision,crops=EXCLUDED.crops,source_note=EXCLUDED.source_note,observed_on=EXCLUDED.observed_on,is_demo=EXCLUDED.is_demo,updated_at=NOW() RETURNING *`,[repository.tenantId,client.id,ownerId,normalized.season,normalized.revision+1,JSON.stringify(normalized.crops),normalized.sourceNote,normalized.observedOn,demo(client)])
  return record(result.rows[0])
 })
}
