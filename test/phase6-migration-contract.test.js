import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const migration=read('database/migrations/20260823_004_visit_learning_loop_expand.sql')
const statements=migration.replace(/^\s*--.*$/gm,'').replace(/COMMENT ON[\s\S]*?;/gi,'')

test('migration da Fase 6 é exclusivamente expand-only',()=>{
 assert.doesNotMatch(statements,/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|UPDATE|RENAME)\b/i)
 assert.doesNotMatch(statements,/ALTER\s+(?:TABLE|COLUMN)[\s\S]*?\bTYPE\b/i)
 assert.doesNotMatch(statements,/ALTER\s+TABLE[\s\S]*?DROP\b/i)
 assert.match(statements,/ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_status/i)
})

test('migration não reclassifica visita, memória ou conhecimento legado',()=>{
 assert.doesNotMatch(statements,/INSERT\s+INTO\s+val_memories/i)
 assert.doesNotMatch(statements,/INSERT\s+INTO\s+val_learning_candidates/i)
 assert.doesNotMatch(statements,/SET\s+lifecycle_status/i)
 assert.doesNotMatch(statements,/CREATE\s+TABLE[^;]*knowledge/i)
})

test('todas as entidades materiais da Fase 6 possuem vínculo tenant-safe',()=>{
 for(const table of ['val_visit_lifecycle_events','val_visit_preparations','val_visit_transcripts','val_visit_reports','val_outcomes','val_learning_candidates'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?tenant_id UUID NOT NULL`,'i'))
 for(const relation of ['visit_id','client_id','context_snapshot_id','action_plan_id','transcript_id','visit_report_id','source_visit_id','source_outcome_id'])assert.match(migration,new RegExp(`FOREIGN KEY \\(tenant_id,${relation}\\)`,'i'))
})

test('migration preserva IDs e status legados e adiciona índices operacionais',()=>{
 assert.equal((statements.match(/ALTER TABLE visits ADD COLUMN/gi)||[]).length,8)
 assert.doesNotMatch(statements,/ALTER TABLE visits[^;]*\bstatus\b(?!_)/i)
 for(const index of ['idx_visits_lifecycle','idx_val_visit_preparations_visit_latest','idx_val_visit_transcripts_visit','idx_val_visit_reports_visit_status','idx_val_outcomes_visit','idx_val_learning_candidates_visit_status'])assert.match(migration,new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${index}`,'i'))
})

test('constraints exigem confirmação humana e LearningCandidate governado',()=>{
 assert.match(migration,/confirmation_status<>'CONFIRMED'[\s\S]*confirmed_by IS NOT NULL[\s\S]*confirmed_at IS NOT NULL/i)
 assert.match(migration,/status IN \('CANDIDATE','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED'\)/i)
 assert.match(migration,/COMMENT ON TABLE val_learning_candidates[\s\S]*não promove KnowledgeItem/i)
})
