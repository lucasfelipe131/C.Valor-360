import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const migration=readFileSync(new URL('../database/migrations/20260823_005_voice_capture_expand.sql',import.meta.url),'utf8')
const statements=migration.replace(/^\s*--.*$/gm,'').replace(/COMMENT ON[\s\S]*?;/gi,'')

test('Voice migration 005 — é expand-only e não promove memória ou conhecimento',()=>{
 assert.doesNotMatch(statements,/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i)
 assert.doesNotMatch(statements,/ALTER\s+TABLE[\s\S]*?\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i)
 assert.doesNotMatch(statements,/INSERT\s+INTO\s+(?:val_memories|val_learning_candidates|knowledge_items)/i)
 assert.doesNotMatch(statements,/CREATE\s+TABLE[^;]*(?:knowledge|memory)/i)
 assert.match(migration,/CREATE TABLE IF NOT EXISTS val_voice_interactions/)
 assert.match(migration,/CREATE TABLE IF NOT EXISTS val_voice_transcripts/)
})

test('Voice migration 005 — todas as relações materiais usam chaves compostas tenant-safe',()=>{
 for(const table of ['val_voice_interactions','val_voice_transcripts']){
  assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?tenant_id UUID NOT NULL`,'i'))
  assert.match(migration,new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_tenant_id_id[\\s\\S]*?ON ${table}\\(tenant_id,id\\)`,'i'))
 }
 for(const relation of ['actor_id','client_id','visit_id'])assert.match(migration,new RegExp(`FOREIGN KEY \\(tenant_id,${relation}\\)`,'i'))
 assert.match(migration,/FOREIGN KEY \(tenant_id,audio_attachment_id,actor_id,client_id\)[\s\S]*?REFERENCES val_attachments\(tenant_id,id,consultant_id,client_id\)/i)
 assert.match(migration,/FOREIGN KEY \(tenant_id,voice_interaction_id,created_by\)[\s\S]*?REFERENCES val_voice_interactions\(tenant_id,id,actor_id\)/i)
 assert.match(migration,/FOREIGN KEY \(tenant_id,voice_interaction_id,client_id\)[\s\S]*?REFERENCES val_voice_interactions\(tenant_id,id,client_id\)/i)
 assert.match(migration,/FOREIGN KEY \(tenant_id,voice_interaction_id,visit_id\)[\s\S]*?REFERENCES val_voice_interactions\(tenant_id,id,visit_id\)/i)
 assert.match(migration,/FOREIGN KEY \(tenant_id,latest_transcript_id,id\)[\s\S]*?REFERENCES val_voice_transcripts\(tenant_id,id,voice_interaction_id\)/i)
 assert.match(migration,/UNIQUE \(tenant_id,voice_interaction_id,attempt_no\)/i)
})

test('Voice migration 005 — constraints preservam estados, confirmação e limites',()=>{
 for(const value of ['PRE_VISIT','FIELD_NOTE','POST_VISIT','CLIENT_NOTE','GENERAL_CONTEXT'])assert.match(migration,new RegExp(`interaction_type IN \\([^)]*'${value}'`,'i'))
 for(const value of ['CREATED','AUDIO_STORED','TRANSCRIBING','TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','CANCELLED','FAILED_TRANSCRIPTION','FAILED_EXTRACTION'])assert.match(migration,new RegExp(`status IN \\([^)]*'${value}'`,'i'))
 assert.match(migration,/duration_seconds>0 AND duration_seconds<=900/i)
 assert.match(migration,/confidence>=0 AND confidence<=1/i)
 assert.match(migration,/status='COMPLETED' AND transcript_text IS NOT NULL/i)
 assert.match(migration,/retry_count>=0/i)
 assert.match(migration,/revision_no>=1/i)
 assert.match(migration,/jsonb_typeof\(initial_candidates\)='array'/i)
 assert.match(migration,/jsonb_typeof\(reviewed_candidates\)='array'/i)
})

test('Voice migration 005 — áudio bruto fica por referência e transcript possui retenção independente',()=>{
 const interactionTable=migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS val_voice_interactions'),migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_interactions_tenant_id_id'))
 assert.match(interactionTable,/audio_attachment_id UUID/)
 assert.match(interactionTable,/audio_ref VARCHAR\(240\)/)
 assert.doesNotMatch(interactionTable,/BYTEA|base64/i)
 assert.match(migration,/Transcrições separadas do áudio bruto para retry, auditoria e retenção independente/i)
})

test('Voice migration 005 — comandos de criação são repetíveis e o FK circular é guardado',()=>{
 for(const match of migration.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+([^\s]+)/gi)){
  assert.equal(match[1].toUpperCase(),'IF',`CREATE sem IF NOT EXISTS: ${match[0]}`)
 }
 assert.match(migration,/IF NOT EXISTS \([\s\S]*conname='val_voice_interactions_latest_transcript_same_tenant_fkey'/i)
 assert.match(migration,/REFERENCES val_voice_transcripts\(tenant_id,id,voice_interaction_id\) NOT VALID/i)
})
