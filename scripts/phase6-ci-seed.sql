-- Synthetic, tenant-separated fixtures used only by the disposable PostgreSQL 16 CI gate.
-- The identifiers intentionally match scripts/phase6-postgres-verify.mjs.

INSERT INTO organizations (id,name,slug)
VALUES ('00000000-0000-4000-8000-000000000002','Tenant adversarial da Fase 6','phase6-tenant-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id,name,email,status)
VALUES
  ('00000000-0000-4000-8000-000000000601','Consultor Fase 6 A','phase6-a@example.test','active'),
  ('00000000-0000-4000-8000-000000000602','Consultor Fase 6 B','phase6-b@example.test','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope)
VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601','consultant','{"scope":"own_portfolio"}'::jsonb),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000602','consultant','{"scope":"own_portfolio"}'::jsonb)
ON CONFLICT (tenant_id,user_id) DO NOTHING;

INSERT INTO clients (id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,commercial_profile,relationship_profile,status,source)
VALUES
  ('00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000001','producer-a','00000000-0000-4000-8000-000000000601','Produtor A','Cascavel',620,'Soja e milho','{}'::jsonb,'{}'::jsonb,'active','phase6_fixture'),
  ('00000000-0000-4000-8000-000000000620','00000000-0000-4000-8000-000000000002','producer-b','00000000-0000-4000-8000-000000000602','Produtor B','Toledo',400,'Soja','{}'::jsonb,'{}'::jsonb,'active','phase6_fixture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits (id,tenant_id,client_id,consultant_id,scheduled_at,objective,status,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000611','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-08-23T14:00:00Z','Negociar fertilizante com evidência.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000612','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-08-30T14:00:00Z','Retornar com comparativo e próximo passo.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000613','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-09-15T14:00:00Z','Fixture legado intencional.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO val_attachments (id,tenant_id,consultant_id,client_id,original_name,mime_type,size_bytes,content_base64,sha256,status,analysis,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000621','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000610','visita.webm','audio/webm',20,'YXVkaW8tZml4dHVyZQ==','f9a6c425d00c188b9ebeeea9a948e342ba337717f95d10ae6207f26a07e0f878','received','{}'::jsonb,'2026-08-23T14:00:00Z','2026-08-23T14:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO val_memories (id,tenant_id,client_id,memory_type,key,value,evidence,confidence,status,source,valid_from,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000631','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','fact','legacy.phase6.fixture','{"value":"preserve"}'::jsonb,'[]'::jsonb,80,'verified','legacy_fixture','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
