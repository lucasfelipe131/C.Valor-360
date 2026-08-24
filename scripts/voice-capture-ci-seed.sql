-- Fixtures totalmente sintéticos para o gate descartável PostgreSQL 16 do Voice Capture.
-- Os IDs são compartilhados apenas com scripts/voice-capture-postgres-verify.mjs.

INSERT INTO organizations (id,name,slug)
VALUES ('00000000-0000-4000-8000-000000000702','Tenant adversarial Voice Capture','voice-capture-tenant-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id,name,email,status)
VALUES
  ('00000000-0000-4000-8000-000000000701','Consultor Voice A','voice-a@example.test','active'),
  ('00000000-0000-4000-8000-000000000703','Consultor Voice A2','voice-a2@example.test','active'),
  ('00000000-0000-4000-8000-000000000711','Consultor Voice B','voice-b@example.test','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope)
VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000701','consultant','{"scope":"own_portfolio"}'::jsonb),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000703','consultant','{"scope":"own_portfolio"}'::jsonb),
  ('00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000711','consultant','{"scope":"own_portfolio"}'::jsonb)
ON CONFLICT (tenant_id,user_id) DO NOTHING;

INSERT INTO clients (id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,commercial_profile,relationship_profile,status,source)
VALUES
  ('00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-000000000001','producer-voice-a','00000000-0000-4000-8000-000000000701','Produtor Voice A','Cascavel',620,'Soja, milho e trigo','{}'::jsonb,'{}'::jsonb,'active','voice_capture_fixture'),
  ('00000000-0000-4000-8000-000000000722','00000000-0000-4000-8000-000000000001','producer-voice-a2','00000000-0000-4000-8000-000000000703','Produtor Voice A2','Cascavel',310,'Soja','{}'::jsonb,'{}'::jsonb,'active','voice_capture_fixture'),
  ('00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-000000000702','producer-voice-b','00000000-0000-4000-8000-000000000711','Produtor Voice B','Toledo',440,'Soja e milho','{}'::jsonb,'{}'::jsonb,'active','voice_capture_fixture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits (id,tenant_id,client_id,consultant_id,scheduled_at,objective,status,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000741','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-000000000701','2026-08-23T14:00:00Z','Negociar fertilizante com evidência econômica.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000742','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-000000000701','2026-08-30T14:00:00Z','Retornar com comparativo e alinhar a decisão.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000743','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000722','00000000-0000-4000-8000-000000000703','2026-08-25T14:00:00Z','Visita do segundo consultor no mesmo tenant.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000744','00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-000000000711','2026-08-26T14:00:00Z','Visita do tenant adversarial.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO val_memories (id,tenant_id,client_id,memory_type,key,value,evidence,confidence,status,source,valid_from,created_at,updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000751',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000721',
  'fact','legacy.voice.fixture','{"value":"preservar"}'::jsonb,'[]'::jsonb,80,'verified','legacy_fixture',
  '2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;
