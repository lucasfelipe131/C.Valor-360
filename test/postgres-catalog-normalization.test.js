import assert from 'node:assert/strict'
import test from 'node:test'
import {semanticIndexDefinition} from '../scripts/lib/postgres-catalog.js'

// Exact index definitions from PostgreSQL 16.15 source and restored catalogs
// in CI run 34070943466, phase6-gate-evidence-34070943466.
const source="CREATE INDEX idx_val_voice_interactions_pending ON public.val_voice_interactions USING btree (tenant_id, actor_id, status, updated_at DESC) WHERE ((status)::text = ANY ((ARRAY['AUDIO_STORED'::character varying, 'FAILED_TRANSCRIPTION'::character varying, 'FAILED_EXTRACTION'::character varying, 'PENDING_REVIEW'::character varying])::text[]))"
const restored="CREATE INDEX idx_val_voice_interactions_pending ON public.val_voice_interactions USING btree (tenant_id, actor_id, status, updated_at DESC) WHERE ((status)::text = ANY (ARRAY[('AUDIO_STORED'::character varying)::text, ('FAILED_TRANSCRIPTION'::character varying)::text, ('FAILED_EXTRACTION'::character varying)::text, ('PENDING_REVIEW'::character varying)::text]))"

test('PostgreSQL index catalog treats only the equivalent varchar literal array cast forms as identical',()=>{
 assert.notEqual(source,restored)
 assert.equal(semanticIndexDefinition(source),restored)
 assert.equal(semanticIndexDefinition(restored),restored)
 assert.equal(semanticIndexDefinition(semanticIndexDefinition(source)),restored)
})

test('catalog normalization still detects index columns, order, predicate, enum values, uniqueness and relation changes',()=>{
 const canonical=semanticIndexDefinition(source)
 const changes=[
  source.replace('tenant_id, ',''),
  source.replace('actor_id, status','status, actor_id'),
  source.replace('updated_at DESC','updated_at ASC'),
  source.replace('WHERE ((status)::text =','WHERE ((status)::text <>'),
  source.replace('AUDIO_STORED','CONFIRMED'),
  source.replace(", 'FAILED_TRANSCRIPTION'::character varying",''),
  source.replace('CREATE INDEX','CREATE UNIQUE INDEX'),
  source.replace('ON public.val_voice_interactions','ON public.other_table'),
  source.replace('USING btree','USING hash'),
  source.replace('idx_val_voice_interactions_pending','other_index'),
 ]
 for(const changed of changes)assert.notEqual(semanticIndexDefinition(changed),canonical)
})

test('normalization preserves quoted SQL and does not collapse length-limited casts or arbitrary array expressions',()=>{
 for(const definition of [
  source.replaceAll('::character varying','::character varying(4)'),
  source.replaceAll('::character varying','::character'),
  source.replaceAll('::character varying','::integer'),
  source.replace("'AUDIO_STORED'::character varying",'status'),
  "CREATE INDEX idx ON records USING btree (note) WHERE note = '(ARRAY[''AUDIO_STORED''::character varying])::text[]'",
  'CREATE INDEX "(ARRAY[\'AUDIO_STORED\'::character varying])::text[]" ON records USING btree (note)',
 ])assert.equal(semanticIndexDefinition(definition),definition)
 const escaped="CREATE INDEX idx ON records USING btree (note) WHERE note = ANY ((ARRAY['producer''s note'::character varying])::text[])"
 assert.equal(semanticIndexDefinition(escaped),"CREATE INDEX idx ON records USING btree (note) WHERE note = ANY (ARRAY[('producer''s note'::character varying)::text])")
})
