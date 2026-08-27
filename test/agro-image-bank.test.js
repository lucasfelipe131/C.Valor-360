import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

const root=join(import.meta.dirname,'..')
const read=relative=>readFileSync(join(root,relative),'utf8')

test('schema do banco de imagens VAL explicita conteúdo, escopo, hash, lifecycle e limites',()=>{
 const schema=read('database/schema.sql')
 const table=schema.match(/CREATE TABLE IF NOT EXISTS val_attachments \([\s\S]*?\n\);/)?.[0]||''
 assert.ok(table,'tabela val_attachments não encontrada')
 for(const column of ['tenant_id','consultant_id','client_id','original_name','mime_type','size_bytes','content_base64','sha256','status','analysis','created_at','updated_at','confirmed_at']){
  assert.match(table,new RegExp(`\\b${column}\\b`))
 }
 assert.match(table,/size_bytes > 0 AND size_bytes <= 6000000/)
 assert.match(table,/status IN \('received','interpreted','confirmed','stored','rejected'\)/)
 assert.doesNotMatch(table,/\bproperty_id\b|\bfield_id\b/)
 assert.match(schema,/idx_val_attachments_client_date ON val_attachments\(tenant_id,consultant_id,client_id,created_at DESC\)/)
 assert.match(schema,/idx_val_attachments_sha ON val_attachments\(tenant_id,consultant_id,client_id,sha256\)/)
})

test('rotas VAL validam formato/tamanho e protegem listagem, gravação, edição e conteúdo',()=>{
 const server=read('server.js')
 assert.match(server,/const attachmentMaxBytes=6_000_000/)
 assert.match(server,/attachmentMimeTypes=new Set/)
 assert.match(server,/if\(buffer\.length>attachmentMaxBytes\)/)
 assert.match(server,/url\.pathname==='\/api\/val\/attachments'&&request\.method==='GET'/)
 assert.match(server,/url\.pathname==='\/api\/val\/attachments'&&request\.method==='POST'/)
 assert.match(server,/url\.pathname==='\/api\/val\/attachments'&&request\.method==='PATCH'/)
 assert.match(server,/url\.pathname\.startsWith\('\/api\/val\/attachments'\)/)
 assert.match(server,/Cache-Control':'private, no-store'/)
 assert.match(server,/X-Content-Type-Options':'nosniff'/)
})

test('repositório isola attachment por tenant, consultor e produtor e torna rejected terminal',()=>{
 const repository=read('server/repository.js')
 assert.match(repository,/const attachmentRecord=row=>/)
 assert.match(repository,/\.\.\.\(row\.content_base64\?\{dataBase64:row\.content_base64\}:\{\}\)/)
 assert.match(repository,/a\.tenant_id=\$1 AND a\.consultant_id=\$2/)
 assert.match(repository,/c\.id::text=\$3 OR c\.external_key=\$3/)
 assert.match(repository,/a\.status<>'rejected'/)
 assert.match(repository,/attachment_rejected_terminal/)
 assert.match(repository,/const allowed=new Set\(\['interpreted','confirmed','stored','rejected'\]\)/)
 assert.match(repository,/sha256=createHash\('sha256'\)\.update\(dataBase64\)/)
})

test('listagens PostgreSQL e fallback omitem binário e o fallback preserva tenant explícito',()=>{
 const repository=read('server/repository.js')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 assert.match(repository,/SELECT a\.\*,NULL::text content_base64,c\.external_key client_external_key FROM val_attachments/)
 assert.match(repository,/\.map\(attachmentMetadataRecord\)/)
 assert.match(repository,/attachmentInTenant\(item,tenantId\)/)
 assert.match(diff,/both PostgreSQL and fallback listings omit binary content/i)
})

test('galeria de campo usa câmera/galeria, metadados e vínculo explícito ao produtor',()=>{
 const gallery=read('src/components/ProducerFieldGallery.jsx')
 assert.match(gallery,/PHOTO_TYPES=new Set\(\['image\/jpeg','image\/png','image\/webp'\]\)/)
 assert.match(gallery,/MAX_PHOTO_BYTES=6_000_000/)
 assert.match(gallery,/capture="environment"/)
 assert.match(gallery,/multiple onChange=\{upload\}/)
 assert.match(gallery,/\/api\/val\/attachments\?clientId=/)
 assert.match(gallery,/fieldPhoto:\{\.\.\.metadata,source:'client360',updatedAt:/)
 for(const label of ['Rótulo da foto','Categoria','Data observada','Notas da observação'])assert.match(gallery,new RegExp(label))
 assert.match(gallery,/As fotos ficam vinculadas ao produtor e isoladas no seu login/)
})

test('Manual salva resultado revisado e provenance, mas mantém as imagens raw fora do registro',()=>{
 const diagnosis=read('manual/app/PhotoDiagnosis.tsx')
 const records=read('manual/app/records.ts')
 const sanitizer=read('manual/app/lib/photo-diagnosis-record.ts')
 const route=read('manual/app/api/records/route.ts')
 assert.match(diagnosis,/type: "photo_diagnosis"/)
 assert.match(diagnosis,/confirmation: "USER_EXPLICIT"/)
 assert.match(diagnosis,/imageRetention: "METADATA_ONLY"/)
 assert.match(diagnosis,/rawImagesStored: false/)
 assert.match(diagnosis,/inlineBinaryStored: false/)
 assert.match(diagnosis,/imageEvidence: photos\.map/)
 assert.match(records,/sanitizePhotoDiagnosisPayload/)
 assert.match(sanitizer,/blockedBinaryKey/)
 assert.match(sanitizer,/inlineBinary/)
 assert.match(route,/containsInlineImage\(body\.payload\)/)
 assert.doesNotMatch(
  diagnosis.slice(diagnosis.indexOf('async function saveDiagnosis'),diagnosis.indexOf('function reset()')),
  /photo\.dataUrl|photo\.preview/
 )
})

test('API de diagnóstico mantém limites, autenticação, schema e safety de triagem',()=>{
 const component=read('manual/app/PhotoDiagnosis.tsx')
 const route=read('manual/app/api/diagnosis/route.ts')
 assert.match(component,/photos\.length \+ files\.length > 3/)
 assert.match(component,/file\.size > 15 \* 1024 \* 1024/)
 assert.match(component,/accept="image\/jpeg,image\/png,image\/webp"/)
 assert.match(route,/sessionFromRequest\(request\)/)
 assert.match(route,/contentLength > 20 \* 1024 \* 1024/)
 assert.match(route,/rawImages\.length > 3/)
 assert.ok(route.includes('image\\/(?:jpeg|png|webp)'))
 assert.match(route,/5 \* 1024 \* 1024/)
 assert.match(route,/minItems: 3/)
 assert.match(route,/maxItems: 3/)
 assert.match(route,/store: false/)
 assert.match(route,/Não recomende marca comercial, produto, ingrediente ativo ou dose/)
 assert.match(route,/Cache-Control": "no-store"/)
})

test('integração Manual → VAL remove binário e preserva ligação formal por referência',()=>{
 const integration=read('manual/app/lib/valor360.ts')
 const diff=read('VAL_AGRONOMIC_CAPABILITY_DIFF.md')
 assert.match(integration,/const blockedKey = .*base64.*image.*photo.*file/i)
 assert.ok(integration.includes('/^(?:data:|blob:)/i'))
 assert.match(integration,/type: "agronomic\.scan\.completed"/)
 assert.match(diff,/Protocol v2 passes `attachment_id`/i)
 assert.match(diff,/signed `agronomic\.scan\.completed` event validates tenant\/owner\/link claims/i)
 assert.match(diff,/source-level boundary is `ENGINE_CONFIRMED`/i)
})
