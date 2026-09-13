const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
export function validateProfilePhoto(value){
 if(value===null)return null
 if(typeof value!=='string'||value.length>350000)fail('Use uma foto de até 250 KB.')
 const match=value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
 if(!match)fail('Use uma imagem JPEG ou PNG.')
 const bytes=Buffer.from(match[2],'base64')
 if(bytes.length>250000||bytes.length<20||bytes.toString('base64')!==match[2])fail('Imagem inválida ou muito grande.')
 const valid=match[1]==='png'?validPng(bytes):validJpeg(bytes)
 if(!valid)fail('O arquivo não corresponde ao formato da imagem.')
 return value
}
// Conferir so a assinatura deixava passar qualquer coisa: 8 bytes de PNG na frente de um shell
// script era aceito, guardado como foto do produtor e devolvido depois com Content-Type image/png.
// Aqui a estrutura inteira e percorrida — se ela nao fecha exatamente no fim do arquivo, nao e
// imagem. Nenhum decodificador e chamado; e so leitura de cabecalho.
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10])
const MAX_DIMENSION=20000
function validPng(bytes){
 if(bytes.length<57||!bytes.subarray(0,8).equals(PNG_SIGNATURE))return false
 let offset=8,first=true,ended=false
 while(offset+8<=bytes.length){
  const length=bytes.readUInt32BE(offset)
  const type=bytes.toString('latin1',offset+4,offset+8)
  if(!/^[A-Za-z]{4}$/.test(type)||length>bytes.length)return false
  const next=offset+12+length
  if(next>bytes.length)return false
  if(first){
   if(type!=='IHDR'||length!==13)return false
   const width=bytes.readUInt32BE(offset+8),height=bytes.readUInt32BE(offset+12)
   if(!width||!height||width>MAX_DIMENSION||height>MAX_DIMENSION)return false
   first=false
  }
  if(type==='IEND'){ended=length===0&&next===bytes.length;break}
  offset=next
 }
 return ended
}
// JPEG: percorre os marcadores ate o inicio do scan. Exige um SOF real (a dimensao esta nele) e o
// EOI no fim. Os dados comprimidos depois do SOS nao sao validados — nao ha como, sem decodificar.
function validJpeg(bytes){
 if(bytes.length<125||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return false
 let offset=2,sof=false
 while(offset+4<=bytes.length){
  if(bytes[offset]!==255)return false
  let marker=bytes[offset+1]
  while(marker===255&&offset+2<bytes.length){offset+=1;marker=bytes[offset+1]}
  if(marker===216||marker===217)return false
  if(marker===1||marker>=208&&marker<=215){offset+=2;continue}
  const length=bytes.readUInt16BE(offset+2)
  if(length<2||offset+2+length>bytes.length)return false
  if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
   if(length<8)return false
   const height=bytes.readUInt16BE(offset+5),width=bytes.readUInt16BE(offset+7)
   if(!width||!height||width>MAX_DIMENSION||height>MAX_DIMENSION)return false
   sof=true
  }
  if(marker===218)return sof
  offset+=2+length
 }
 return false
}
export async function profilePhoto(repository,identity,{clientId=null,propertyId=null,write=false,input={}}={}){
 if(!identity?.id||identity.mustChangePassword)fail('Entre novamente e conclua a configuração da conta.',401)
 if(!repository.db.configured)fail('O armazenamento de perfis está indisponível.',503)
 if(propertyId&&!clientId)fail('Informe o produtor da propriedade.')
 const tenant=identity.tenantId,owner=identity.id,kind=propertyId?'property':clientId?'producer':'consultant'
 // LER a foto nao pode travar a linha. Com FOR UPDATE tambem na leitura, abrir o Cliente 360 durante
 // uma importacao comercial (que faz upsert de ate 2.000 produtores numa transacao so) deixava o
 // pedido pendurado ate a importacao terminar; e como cada pedido preso segura uma conexao do pool
 // (max 10), poucas fotos travadas derrubavam o produto inteiro, inclusive /api/auth/session.
 // O lock continua exatamente onde precisa existir: na escrita.
 const lock=write?' FOR UPDATE':''
 const lockOf=column=>write?` FOR UPDATE OF ${column}`:''
 return repository.db.transaction(async db=>{
  const result=propertyId
   ?await db.query(`SELECT p.id,p.name FROM properties p JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.client_id WHERE p.tenant_id=$1 AND c.consultant_id=$2 AND (c.id::text=$3 OR c.external_key=$3) AND p.id::text=$4 AND c.status='active'${lockOf('p')}`,[tenant,owner,String(clientId),String(propertyId)])
   :clientId
   ?await db.query(`SELECT id,name FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active'${lock}`,[tenant,owner,String(clientId)])
   :await db.query(`SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND u.id=$2${lockOf('u')}`,[tenant,owner])
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
