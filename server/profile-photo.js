const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
export function validateProfilePhoto(value){
 if(value===null)return null
 if(typeof value!=='string'||value.length>350000)fail('Use uma foto de até 250 KB.')
 const match=value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
 if(!match)fail('Use uma imagem JPEG ou PNG.')
 const bytes=Buffer.from(match[2],'base64')
 if(bytes.length>250000||bytes.length<20||bytes.toString('base64')!==match[2])fail('Imagem inválida ou muito grande.')
 const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217
 if(!valid)fail('O arquivo não corresponde ao formato da imagem.')
 return value
}
export async function profilePhoto(repository,identity,{clientId=null,propertyId=null,write=false,input={}}={}){
 if(!identity?.id||identity.mustChangePassword)fail('Entre novamente e conclua a configuração da conta.',401)
 if(!repository.db.configured)fail('O armazenamento de perfis está indisponível.',503)
 if(propertyId&&!clientId)fail('Informe o produtor da propriedade.')
 const tenant=identity.tenantId,owner=identity.id,kind=propertyId?'property':clientId?'producer':'consultant'
 return repository.db.transaction(async db=>{
  const result=propertyId
   ?await db.query("SELECT p.id,p.name FROM properties p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE p.tenant_id=$1 AND c.consultant_id=$2 AND (c.id::text=$3 OR c.external_key=$3) AND p.id::text=$4 AND c.status='active' FOR UPDATE OF p",[tenant,owner,String(clientId),String(propertyId)])
   :clientId
   ?await db.query("SELECT id,name FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' FOR UPDATE",[tenant,owner,String(clientId)])
   :await db.query('SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND u.id=$2 FOR UPDATE OF u',[tenant,owner])
  const entity=result.rows[0];if(!entity)fail('Cadastro não encontrado para este acesso.',404)
  if(write){
   if(!clientId&&input.name!==undefined){
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)fail('Informe um nome de até 120 caracteres.')
    entity.name=input.name.trim();await db.query('UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2',[entity.name,owner])
   }
   if(input.photo!==undefined){
    const photo=validateProfilePhoto(input.photo)
    await db.query('INSERT INTO val_profile_photos(tenant_id,entity_kind,entity_id,photo,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,entity_kind,entity_id) DO UPDATE SET photo=EXCLUDED.photo,updated_by=EXCLUDED.updated_by,updated_at=NOW()',[tenant,kind,entity.id,photo,owner])
   }
  }
  const photo=await db.query('SELECT photo,updated_at FROM val_profile_photos WHERE tenant_id=$1 AND entity_kind=$2 AND entity_id=$3',[tenant,kind,entity.id])
  return {id:String(entity.id),name:entity.name,photo:photo.rows[0]?.photo||null,updatedAt:photo.rows[0]?.updated_at||null}
 })
}
