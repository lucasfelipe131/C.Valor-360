-- Passo 07: expand the existing event ledger; never create a second producer store.
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_events_hub_scope ON integration_events (tenant_id,owner_user_id,id);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS hub_contract_version integer;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS canonical_client_id uuid;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS external_entity_type varchar(80);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS external_entity_id varchar(180);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS source_version bigint;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS envelope_hash char(64);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS decision varchar(40);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS error_code varchar(100);
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS retry_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE integration_events ADD COLUMN IF NOT EXISTS latency_ms integer;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='integration_events_canonical_scope_fk') THEN
  ALTER TABLE integration_events ADD CONSTRAINT integration_events_canonical_scope_fk FOREIGN KEY (canonical_client_id) REFERENCES clients(id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_integration_events_hub_operations ON integration_events (tenant_id,owner_user_id,source,status,ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_events_hub_entity ON integration_events (tenant_id,owner_user_id,source,external_entity_type,external_entity_id,observed_at DESC) WHERE hub_contract_version IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_entity_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES organizations(id),
 owner_user_id uuid NOT NULL REFERENCES users(id),
 source varchar(80) NOT NULL,
 external_entity_id varchar(180) NOT NULL,
 canonical_client_id uuid NOT NULL,
 created_by_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,owner_user_id,source,external_entity_id),
 FOREIGN KEY (canonical_client_id) REFERENCES clients(id),
 FOREIGN KEY (tenant_id,owner_user_id,created_by_event_id) REFERENCES integration_events(tenant_id,owner_user_id,id)
);
CREATE INDEX IF NOT EXISTS idx_integration_entity_links_canonical ON integration_entity_links (tenant_id,owner_user_id,canonical_client_id);

CREATE TABLE IF NOT EXISTS integration_event_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES organizations(id),
 owner_user_id uuid NOT NULL REFERENCES users(id),
 event_id uuid NOT NULL,
 action varchar(40) NOT NULL,
 payload_hash char(64) NOT NULL,
 envelope_hash char(64) NOT NULL,
 error_code varchar(100),
 attempt integer NOT NULL DEFAULT 0,
 latency_ms integer NOT NULL DEFAULT 0,
 actor_user_id uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,owner_user_id,event_id) REFERENCES integration_events(tenant_id,owner_user_id,id)
);
CREATE INDEX IF NOT EXISTS idx_integration_event_audit_scope ON integration_event_audit (tenant_id,owner_user_id,event_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_event_audit_action ON integration_event_audit (tenant_id,owner_user_id,action,created_at DESC);
