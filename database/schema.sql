-- VALOR 360 — banco canônico da engine VAL
-- Idempotente: pode ser executado no pre-deploy da Railway.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('valor360-schema-migration'));
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A versão 0.3 possuía tabelas homônimas sem tenant_id. Preservamos essas
-- tabelas e migramos os registros, em vez de tentar alterá-las parcialmente.
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='tenant_id') THEN
    IF to_regclass('public.val_recommendations_legacy_v03') IS NULL AND to_regclass('public.val_recommendations') IS NOT NULL THEN ALTER TABLE val_recommendations RENAME TO val_recommendations_legacy_v03; END IF;
    IF to_regclass('public.client_profiles_legacy_v03') IS NULL AND to_regclass('public.client_profiles') IS NOT NULL THEN ALTER TABLE client_profiles RENAME TO client_profiles_legacy_v03; END IF;
    IF to_regclass('public.opportunities_legacy_v03') IS NULL AND to_regclass('public.opportunities') IS NOT NULL THEN ALTER TABLE opportunities RENAME TO opportunities_legacy_v03; END IF;
    IF to_regclass('public.visits_legacy_v03') IS NULL AND to_regclass('public.visits') IS NOT NULL THEN ALTER TABLE visits RENAME TO visits_legacy_v03; END IF;
    IF to_regclass('public.clients_legacy_v03') IS NULL THEN ALTER TABLE clients RENAME TO clients_legacy_v03; END IF;
    IF to_regclass('public.users_legacy_v03') IS NULL AND to_regclass('public.users') IS NOT NULL THEN ALTER TABLE users RENAME TO users_legacy_v03; END IF;
  END IF;
  -- Recupera também o estado intermediário deixado por uma versão anterior:
  -- clients já canônico, mas technical_context ainda com o nome legado.
  IF to_regclass('public.technical_context_legacy_v03') IS NULL
     AND to_regclass('public.technical_context') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='technical_context' AND column_name='tenant_id') THEN
    ALTER TABLE technical_context RENAME TO technical_context_legacy_v03;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id,name,slug)
VALUES ('00000000-0000-4000-8000-000000000001','VALOR 360 — Ambiente inicial','valor360-inicial')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL CHECK (role IN ('consultant','manager','admin','technical_reviewer')),
  portfolio_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,user_id)
);

CREATE TABLE IF NOT EXISTS survey_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token VARCHAR(80) NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID,
  producer_name VARCHAR(240),
  consultant_name VARCHAR(240),
  status VARCHAR(30) NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','respondido','integrado')),
  answers JSONB,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  integrated_at TIMESTAMPTZ,
  UNIQUE (tenant_id,token)
);

ALTER TABLE survey_invitations ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_key VARCHAR(180) NOT NULL,
  consultant_id UUID REFERENCES users(id),
  name VARCHAR(180) NOT NULL,
  municipality VARCHAR(140),
  total_area_ha NUMERIC(14,2),
  area_band VARCHAR(120),
  cultures TEXT,
  preferred_channel VARCHAR(60),
  commercial_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  relationship_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  source VARCHAR(80),
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,external_key)
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS commercial_profile JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS area_band VARCHAR(120);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS relationship_profile JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tenant_id_external_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_owner_external_key ON clients(tenant_id,consultant_id,external_key);

CREATE TABLE IF NOT EXISTS client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  primary_profile VARCHAR(40),
  secondary_profile VARCHAR(40),
  irt_score NUMERIC(5,2),
  nps_score INTEGER,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key VARCHAR(240),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  valid_until TIMESTAMPTZ,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  corrected_at TIMESTAMPTZ
);

ALTER TABLE survey_invitations DROP CONSTRAINT IF EXISTS survey_invitations_client_id_fkey;
ALTER TABLE survey_invitations ADD CONSTRAINT survey_invitations_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS source_survey_id UUID REFERENCES survey_invitations(id) ON DELETE SET NULL;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS source_key VARCHAR(240);
UPDATE client_profiles profile
SET profile_snapshot=survey.result
FROM survey_invitations survey
WHERE profile.tenant_id=survey.tenant_id
  AND profile.source_survey_id=survey.id
  AND profile.profile_snapshot='{}'::jsonb
  AND jsonb_typeof(survey.result)='object';

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_key VARCHAR(180),
  name VARCHAR(180) NOT NULL,
  municipality VARCHAR(140),
  area_ha NUMERIC(14,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,external_key)
);

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_tenant_id_external_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_client_external_key ON properties(tenant_id,client_id,external_key) WHERE external_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  external_key VARCHAR(180),
  name VARCHAR(180) NOT NULL,
  area_ha NUMERIC(14,2),
  geometry_ref TEXT,
  geometry_version VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,external_key)
);

ALTER TABLE fields DROP CONSTRAINT IF EXISTS fields_tenant_id_external_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fields_property_external_key ON fields(tenant_id,property_id,external_key) WHERE external_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS crop_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  season VARCHAR(30) NOT NULL,
  crop VARCHAR(80) NOT NULL,
  cultivar VARCHAR(160),
  area_ha NUMERIC(14,2),
  productivity_target NUMERIC(12,3),
  productivity_actual NUMERIC(12,3),
  unit VARCHAR(30),
  planted_at DATE,
  harvested_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  consultant_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMPTZ,
  objective TEXT,
  process_agreement TEXT,
  summary TEXT,
  next_commitment TEXT,
  next_action_at TIMESTAMPTZ,
  status VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  channel VARCHAR(50),
  direction VARCHAR(20),
  occurred_at TIMESTAMPTZ NOT NULL,
  summary TEXT,
  commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
  source VARCHAR(80),
  source_external_id VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,source_external_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  source_signal_id UUID,
  title VARCHAR(220) NOT NULL,
  category VARCHAR(120),
  hypothesis TEXT,
  estimated_value NUMERIC(16,2),
  estimated_margin NUMERIC(16,2),
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  stage VARCHAR(40) NOT NULL DEFAULT 'signal',
  next_action TEXT,
  next_action_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS external_key VARCHAR(180);
DROP INDEX IF EXISTS idx_opportunities_tenant_external_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_client_external_key ON opportunities(tenant_id,client_id,external_key) WHERE external_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS value_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  alternative JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_value NUMERIC(16,2),
  low_value NUMERIC(16,2),
  high_value NUMERIC(16,2),
  total_incremental_cost NUMERIC(16,2),
  roi_percent NUMERIC(12,3),
  proof_plan TEXT,
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  source VARCHAR(80) NOT NULL,
  external_id VARCHAR(180) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  outcome VARCHAR(30) NOT NULL CHECK (outcome IN ('open','won','lost','cancelled')),
  category VARCHAR(140),
  product VARCHAR(180),
  quantity NUMERIC(16,4),
  value NUMERIC(16,2),
  margin NUMERIC(16,2),
  currency CHAR(3) DEFAULT 'BRL',
  loss_reason VARCHAR(240),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,external_id)
);

CREATE TABLE IF NOT EXISTS source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source VARCHAR(80) NOT NULL,
  external_id VARCHAR(180),
  file_name VARCHAR(300),
  mime_type VARCHAR(140),
  object_uri TEXT,
  sha256 CHAR(64),
  status VARCHAR(40) NOT NULL DEFAULT 'quarantine',
  parser_version VARCHAR(80),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (tenant_id,source,external_id)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id VARCHAR(180) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source_type VARCHAR(80) NOT NULL,
  file_name VARCHAR(300),
  status VARCHAR(40) NOT NULL,
  row_count INTEGER,
  recognized_count INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS field_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  field_id UUID REFERENCES fields(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  property_external_key VARCHAR(180),
  field_external_key VARCHAR(180),
  source_document_id UUID REFERENCES source_documents(id) ON DELETE SET NULL,
  source VARCHAR(80),
  external_id VARCHAR(180),
  observed_at TIMESTAMPTZ,
  crop_stage VARCHAR(100),
  summary TEXT,
  validated_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,external_id)
);

ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS client_external_key VARCHAR(180);
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS property_external_key VARCHAR(180);
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS field_external_key VARCHAR(180);
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS validation_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS field_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES field_reports(id) ON DELETE CASCADE,
  observation_type VARCHAR(80) NOT NULL,
  value JSONB NOT NULL,
  unit VARCHAR(60),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  evidence_ref TEXT,
  requires_review BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soil_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  field_id UUID REFERENCES fields(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  property_external_key VARCHAR(180),
  field_external_key VARCHAR(180),
  source_document_id UUID REFERENCES source_documents(id) ON DELETE SET NULL,
  source VARCHAR(80),
  external_id VARCHAR(180),
  laboratory VARCHAR(180),
  method VARCHAR(180),
  depth_from_cm NUMERIC(8,2),
  depth_to_cm NUMERIC(8,2),
  sampled_at DATE,
  validated_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,external_id)
);

ALTER TABLE soil_analyses ADD COLUMN IF NOT EXISTS client_external_key VARCHAR(180);
ALTER TABLE soil_analyses ADD COLUMN IF NOT EXISTS property_external_key VARCHAR(180);
ALTER TABLE soil_analyses ADD COLUMN IF NOT EXISTS field_external_key VARCHAR(180);
ALTER TABLE soil_analyses ADD COLUMN IF NOT EXISTS validation_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS soil_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES soil_analyses(id) ON DELETE CASCADE,
  sample_key VARCHAR(120),
  analyte VARCHAR(120) NOT NULL,
  raw_value NUMERIC(18,6),
  raw_unit VARCHAR(80),
  normalized_value NUMERIC(18,6),
  normalized_unit VARCHAR(80),
  method VARCHAR(180),
  interpretation VARCHAR(240),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ndvi_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  field_id UUID REFERENCES fields(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  property_external_key VARCHAR(180),
  field_external_key VARCHAR(180),
  source VARCHAR(80),
  external_id VARCHAR(180),
  index_name VARCHAR(30) NOT NULL DEFAULT 'NDVI',
  observed_at TIMESTAMPTZ NOT NULL,
  sensor VARCHAR(100),
  resolution_m NUMERIC(10,2),
  cloud_percent NUMERIC(6,2),
  processing_version VARCHAR(80),
  geometry_version VARCHAR(80),
  statistics JSONB NOT NULL DEFAULT '{}'::jsonb,
  anomaly JSONB NOT NULL DEFAULT '{}'::jsonb,
  raster_uri TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,external_id)
);

ALTER TABLE ndvi_observations ADD COLUMN IF NOT EXISTS client_external_key VARCHAR(180);
ALTER TABLE ndvi_observations ADD COLUMN IF NOT EXISTS property_external_key VARCHAR(180);
ALTER TABLE ndvi_observations ADD COLUMN IF NOT EXISTS field_external_key VARCHAR(180);

CREATE TABLE IF NOT EXISTS integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  external_id VARCHAR(180) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  source VARCHAR(80) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  client_external_key VARCHAR(180),
  property_external_key VARCHAR(180),
  field_external_key VARCHAR(180),
  payload JSONB NOT NULL,
  payload_hash CHAR(64),
  status VARCHAR(40) NOT NULL,
  error TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,source,external_id)
);

ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE integration_events DROP CONSTRAINT IF EXISTS integration_events_tenant_id_source_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_events_owner_external ON integration_events(tenant_id,owner_user_id,source,external_id);

CREATE TABLE IF NOT EXISTS agronomic_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  property_external_key VARCHAR(180),
  field_id UUID REFERENCES fields(id) ON DELETE SET NULL,
  field_external_key VARCHAR(180),
  source_event_id UUID REFERENCES integration_events(id) ON DELETE SET NULL,
  signal_type VARCHAR(100) NOT NULL,
  severity VARCHAR(40) NOT NULL,
  title VARCHAR(240) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  commercial_hypothesis TEXT,
  requires_agronomist BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(40) NOT NULL DEFAULT 'new',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS source_signal_id UUID;
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_source_signal_id_fkey;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_source_signal_id_fkey FOREIGN KEY (source_signal_id) REFERENCES agronomic_signals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS val_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(240),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS val_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES val_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','tool')),
  content JSONB NOT NULL,
  model_version VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS val_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  memory_type VARCHAR(40) NOT NULL CHECK (memory_type IN ('fact','episode','inference','preference','policy')),
  key VARCHAR(180) NOT NULL,
  value JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  status VARCHAR(30) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','verified','rejected','expired')),
  source VARCHAR(100),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS val_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  consultant_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_external_key VARCHAR(180),
  conversation_id UUID REFERENCES val_conversations(id) ON DELETE SET NULL,
  user_question TEXT,
  mode VARCHAR(40) NOT NULL,
  model_version VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(100),
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_content JSONB NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  status VARCHAR(40) NOT NULL DEFAULT 'generated',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE val_recommendations ADD COLUMN IF NOT EXISTS consultant_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS val_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_id UUID NOT NULL REFERENCES val_recommendations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  outcome VARCHAR(30) CHECK (outcome IN ('accepted','edited','rejected','scheduled','executed','won','lost')),
  value NUMERIC(16,2),
  reason VARCHAR(240),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE val_feedback DROP CONSTRAINT IF EXISTS val_feedback_outcome_check;
ALTER TABLE val_feedback ADD CONSTRAINT val_feedback_outcome_check CHECK (outcome IN ('accepted','edited','rejected','scheduled','executed','won','lost'));

CREATE TABLE IF NOT EXISTS model_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES val_recommendations(id) ON DELETE SET NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(100),
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status VARCHAR(40) NOT NULL,
  error_code VARCHAR(80),
  error_details JSONB,
  provider_response_id VARCHAR(180),
  provider_request_id VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE model_runs ADD COLUMN IF NOT EXISTS provider_response_id VARCHAR(180);
ALTER TABLE model_runs ADD COLUMN IF NOT EXISTS provider_request_id VARCHAR(180);
ALTER TABLE model_runs ADD COLUMN IF NOT EXISTS error_details JSONB;

CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  version VARCHAR(80) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,name,version)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(100),
  entity_id VARCHAR(180),
  before_data JSONB,
  after_data JSONB,
  correlation_id VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_tenant_name ON clients(tenant_id,name);
CREATE INDEX IF NOT EXISTS idx_clients_owner_name ON clients(tenant_id,consultant_id,name);
CREATE INDEX IF NOT EXISTS idx_surveys_owner_status ON survey_invitations(tenant_id,owner_user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_owner_date ON import_jobs(tenant_id,owner_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_val_recommendations_owner_date ON val_recommendations(tenant_id,consultant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surveys_tenant_status ON survey_invitations(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_client_date ON client_profiles(tenant_id,client_id,assessed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_source_survey ON client_profiles(source_survey_id);
DROP INDEX IF EXISTS idx_profiles_tenant_source_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_client_source_key ON client_profiles(tenant_id,client_id,source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visits_client_date ON visits(tenant_id,client_id,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(tenant_id,stage,next_action_at);
CREATE INDEX IF NOT EXISTS idx_business_client_date ON business_events(tenant_id,client_external_key,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_client_status ON agronomic_signals(tenant_id,client_external_key,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soil_field_date ON soil_analyses(tenant_id,field_id,sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_ndvi_field_date ON ndvi_observations(tenant_id,field_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_val_recommendations_client ON val_recommendations(tenant_id,client_external_key,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_feedback_one_per_recommendation ON val_feedback(tenant_id,recommendation_id);
CREATE INDEX IF NOT EXISTS idx_val_memory_lookup ON val_memories(tenant_id,client_id,memory_type,key,status);
CREATE INDEX IF NOT EXISTS idx_integration_events_date ON integration_events(tenant_id,event_type,occurred_at DESC);

COMMENT ON TABLE val_memories IS 'Memória auditável: inferências nunca sobrescrevem fatos e exigem evidência/confiança.';
COMMENT ON TABLE agronomic_signals IS 'Sinais para triagem e oportunidade; não substituem diagnóstico ou recomendação de responsável técnico.';
COMMENT ON TABLE integration_events IS 'Envelope idempotente de eventos do Manual do Agrônomo e outras fontes.';

-- Copia os registros do schema 0.3 uma única vez. As tabelas antigas ficam
-- disponíveis para auditoria e só devem ser removidas em migração posterior.
DO $$
DECLARE
  skipped_profile_count BIGINT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='legacy-v03-copy-v1') THEN
  IF to_regclass('public.users_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO users (id,name,email,status,created_at,updated_at)
      SELECT id,name,email,'active',COALESCE(created_at,NOW()),COALESCE(created_at,NOW()) FROM users_legacy_v03
      ON CONFLICT (id) DO NOTHING$sql$;
    EXECUTE $sql$INSERT INTO memberships (tenant_id,user_id,role)
      SELECT '00000000-0000-4000-8000-000000000001'::uuid,id,
        CASE WHEN lower(COALESCE(role,'')) IN ('admin','administrator') THEN 'admin'
             WHEN lower(COALESCE(role,'')) IN ('manager','gestor') THEN 'manager'
             WHEN lower(COALESCE(role,'')) IN ('technical_reviewer','agronomist','agronomo') THEN 'technical_reviewer'
             ELSE 'consultant' END
      FROM users_legacy_v03 ON CONFLICT (tenant_id,user_id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.clients_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO clients (id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,preferred_channel,status,source,created_at,updated_at)
      SELECT id,'00000000-0000-4000-8000-000000000001'::uuid,id::text,consultant_id,name,municipality,total_area_ha,cultures,LEFT(preferred_channel,60),'active','legacy-v03',COALESCE(created_at,NOW()),COALESCE(created_at,NOW())
      FROM clients_legacy_v03 ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.client_profiles_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$SELECT count(*)
      FROM client_profiles_legacy_v03 legacy
      LEFT JOIN clients client ON client.id=legacy.client_id AND client.tenant_id='00000000-0000-4000-8000-000000000001'::uuid
      WHERE legacy.client_id IS NULL OR client.id IS NULL$sql$ INTO skipped_profile_count;
    IF skipped_profile_count>0 THEN
      RAISE WARNING 'VALOR 360 ignorou % perfil(is) legacy sem client_id canônico; as tabelas legacy foram preservadas para auditoria.',skipped_profile_count;
    END IF;
    EXECUTE $sql$INSERT INTO client_profiles (id,tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,assessed_at)
      SELECT legacy.id,'00000000-0000-4000-8000-000000000001'::uuid,legacy.client_id,legacy.primary_profile,legacy.secondary_profile,legacy.irt,legacy.nps,COALESCE(legacy.answers,'{}'::jsonb),COALESCE(legacy.assessed_at,NOW())
      FROM client_profiles_legacy_v03 legacy
      JOIN clients client ON client.id=legacy.client_id AND client.tenant_id='00000000-0000-4000-8000-000000000001'::uuid
      WHERE legacy.client_id IS NOT NULL
      ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.visits_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO visits (id,tenant_id,client_id,consultant_id,scheduled_at,objective,summary,next_commitment,next_action_at,status)
      SELECT id,'00000000-0000-4000-8000-000000000001'::uuid,client_id,consultant_id,scheduled_at,objective,notes,next_commitment,next_action_at,status
      FROM visits_legacy_v03 ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.opportunities_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO opportunities (id,tenant_id,client_id,title,category,estimated_value,stage,probability,created_at,updated_at)
      SELECT id,'00000000-0000-4000-8000-000000000001'::uuid,client_id,COALESCE(title,'Oportunidade migrada'),category,estimated_value,COALESCE(stage,'signal'),CASE WHEN probability IS NULL THEN NULL ELSE LEAST(100,GREATEST(0,probability)) END,COALESCE(created_at,NOW()),COALESCE(created_at,NOW())
      FROM opportunities_legacy_v03 ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.val_recommendations_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO val_recommendations (id,tenant_id,client_id,mode,model_version,input_context,generated_content,status,created_at)
      SELECT id,'00000000-0000-4000-8000-000000000001'::uuid,client_id,'legacy','legacy-v03',COALESCE(context,'{}'::jsonb),COALESCE(recommendation,'{}'::jsonb),'migrated',COALESCE(created_at,NOW())
      FROM val_recommendations_legacy_v03 ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  IF to_regclass('public.technical_context_legacy_v03') IS NOT NULL THEN
    EXECUTE $sql$INSERT INTO val_memories (id,tenant_id,client_id,memory_type,key,value,evidence,status,source,valid_from,created_at,updated_at)
      SELECT id,'00000000-0000-4000-8000-000000000001'::uuid,client_id,'fact','consultant_technical_context',
        jsonb_build_object('property',property_name,'crops','','area','','weeds',weeds,'diseases',diseases,'insects',insects,'soil',soil_summary,'goal',producer_goal,'competitors',competitors,'notes',notes),
        jsonb_build_array(jsonb_build_object('source','technical_context_legacy_v03','source_id',id::text)),
        'proposed','legacy-v03',COALESCE(updated_at,NOW()),COALESCE(updated_at,NOW()),COALESCE(updated_at,NOW())
      FROM technical_context_legacy_v03 ON CONFLICT (id) DO NOTHING$sql$;
  END IF;
  INSERT INTO schema_migrations (version) VALUES ('legacy-v03-copy-v1') ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

-- Repara bancos que já haviam gravado o marker v1 antes de o contexto técnico
-- legado ser renomeado/copiado. Não substitui um contexto novo já informado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='legacy-v03-technical-context-v2') THEN
    IF to_regclass('public.technical_context_legacy_v03') IS NOT NULL THEN
      EXECUTE $sql$UPDATE val_memories memory
        SET key='consultant_technical_context',updated_at=NOW()
        WHERE memory.key='legacy_technical_context'
          AND EXISTS (SELECT 1 FROM technical_context_legacy_v03 legacy WHERE legacy.id=memory.id)
          AND NOT EXISTS (
            SELECT 1 FROM val_memories current
            WHERE current.tenant_id=memory.tenant_id
              AND current.client_id=memory.client_id
              AND current.key='consultant_technical_context'
              AND current.id<>memory.id
          )$sql$;
      EXECUTE $sql$INSERT INTO val_memories (id,tenant_id,client_id,memory_type,key,value,evidence,status,source,valid_from,created_at,updated_at)
        SELECT legacy.id,'00000000-0000-4000-8000-000000000001'::uuid,legacy.client_id,'fact','consultant_technical_context',
          jsonb_build_object('property',legacy.property_name,'crops','','area','','weeds',legacy.weeds,'diseases',legacy.diseases,'insects',legacy.insects,'soil',legacy.soil_summary,'goal',legacy.producer_goal,'competitors',legacy.competitors,'notes',legacy.notes),
          jsonb_build_array(jsonb_build_object('source','technical_context_legacy_v03','source_id',legacy.id::text)),
          'proposed','legacy-v03',COALESCE(legacy.updated_at,NOW()),COALESCE(legacy.updated_at,NOW()),COALESCE(legacy.updated_at,NOW())
        FROM technical_context_legacy_v03 legacy
        JOIN clients client ON client.id=legacy.client_id AND client.tenant_id='00000000-0000-4000-8000-000000000001'::uuid
        WHERE NOT EXISTS (SELECT 1 FROM val_memories memory WHERE memory.id=legacy.id)
          AND NOT EXISTS (
            SELECT 1 FROM val_memories current
            WHERE current.tenant_id='00000000-0000-4000-8000-000000000001'::uuid
              AND current.client_id=legacy.client_id
              AND current.key='consultant_technical_context'
          )
        ON CONFLICT (id) DO NOTHING$sql$;
    END IF;
    INSERT INTO schema_migrations (version) VALUES ('legacy-v03-technical-context-v2') ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

-- Normaliza valores já copiados pelas versões anteriores sem criar nova memória
-- nem alterar a data observada. O reparo é idempotente e preserva o legado bruto.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='legacy-v03-technical-context-canonical-v3') THEN
    UPDATE val_memories
    SET value=jsonb_build_object(
      'property',COALESCE(value->'property',value->'property_name','""'::jsonb),
      'crops',COALESCE(value->'crops','""'::jsonb),
      'area',COALESCE(value->'area','""'::jsonb),
      'weeds',COALESCE(value->'weeds','""'::jsonb),
      'diseases',COALESCE(value->'diseases','""'::jsonb),
      'insects',COALESCE(value->'insects','""'::jsonb),
      'soil',COALESCE(value->'soil',value->'soil_summary','""'::jsonb),
      'goal',COALESCE(value->'goal',value->'producer_goal','""'::jsonb),
      'competitors',COALESCE(value->'competitors','""'::jsonb),
      'notes',COALESCE(value->'notes','""'::jsonb)
    )
    WHERE source='legacy-v03'
      AND key IN ('consultant_technical_context','legacy_technical_context')
      AND (value ? 'property_name' OR value ? 'soil_summary' OR value ? 'producer_goal');
    IF to_regclass('public.technical_context_legacy_v03') IS NOT NULL THEN
      EXECUTE $sql$UPDATE val_memories memory
        SET valid_from=COALESCE(legacy.updated_at,memory.valid_from),
            updated_at=COALESCE(legacy.updated_at,memory.updated_at)
        FROM technical_context_legacy_v03 legacy
        WHERE memory.id=legacy.id
          AND memory.source='legacy-v03'
          AND memory.status IN ('proposed','verified')$sql$;
    END IF;
    WITH ranked AS (
      SELECT id,row_number() OVER (
        PARTITION BY tenant_id,client_id,key
        ORDER BY CASE WHEN source IS DISTINCT FROM 'legacy-v03' THEN 0 ELSE 1 END,valid_from DESC,created_at DESC,id
      ) AS position
      FROM val_memories
      WHERE client_id IS NOT NULL
        AND key='consultant_technical_context'
        AND status IN ('proposed','verified')
        AND (valid_until IS NULL OR valid_until>NOW())
    )
    UPDATE val_memories memory
    SET status='expired',valid_until=NOW(),updated_at=NOW()
    FROM ranked
    WHERE memory.id=ranked.id AND ranked.position>1;
    INSERT INTO schema_migrations (version) VALUES ('legacy-v03-technical-context-canonical-v3') ON CONFLICT (version) DO NOTHING;
  END IF;
END $$;

COMMIT;
