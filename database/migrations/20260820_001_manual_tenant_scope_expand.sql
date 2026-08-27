-- PASSO 01 / EXPAND
-- Acrescenta escopo organizacional ao Manual sem remover colunas, chaves ou dados.
-- O default mantém compatibilidade durante o piloto monoempresa e deve ser removido
-- apenas na fase CONTRACT, depois que todos os writers enviarem tenant_id.

ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'tester')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  expires_at TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  invitation_token_hash TEXT,
  invitation_sent_at TIMESTAMPTZ,
  invitation_expires_at TIMESTAMPTZ,
  professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES app_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  page_key TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_feedback (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('suggestion', 'problem')),
  module_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE app_workspace_data ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE app_records ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE app_usage_events ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;

UPDATE app_workspace_data SET tenant_id='00000000-0000-4000-8000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE app_records SET tenant_id='00000000-0000-4000-8000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE app_sessions SET tenant_id='00000000-0000-4000-8000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE app_usage_events SET tenant_id='00000000-0000-4000-8000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE app_feedback SET tenant_id='00000000-0000-4000-8000-000000000001'::uuid WHERE tenant_id IS NULL;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['app_workspace_data','app_records','app_sessions','app_usage_events','app_feedback'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=table_name||'_tenant_fk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE NOT VALID',table_name,table_name||'_tenant_fk');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=table_name||'_tenant_required') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (tenant_id IS NOT NULL) NOT VALID',table_name,table_name||'_tenant_required');
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS app_workspace_tenant_workspace_unique ON app_workspace_data (tenant_id,workspace_id);
CREATE INDEX IF NOT EXISTS app_records_tenant_workspace_updated ON app_records (tenant_id,workspace_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS app_sessions_tenant_user_expires ON app_sessions (tenant_id,user_id,expires_at DESC);
CREATE INDEX IF NOT EXISTS app_usage_tenant_created ON app_usage_events (tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_feedback_tenant_status_created ON app_feedback (tenant_id,status,created_at DESC);
