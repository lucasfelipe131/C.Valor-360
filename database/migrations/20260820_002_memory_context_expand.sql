-- PASSO 03 / EXPAND ONLY
-- Adiciona a fundação MMI/MCTX sem atualizar, classificar, apagar, renomear
-- ou reinterpretar registros e colunas legados.

ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS subject_type VARCHAR(40);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS subject_id VARCHAR(180);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS memory_state VARCHAR(40);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS memory_domain VARCHAR(40);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS source_ref VARCHAR(240);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS source_type VARCHAR(100);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS freshness_policy_version VARCHAR(80);
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS freshness_metadata JSONB;
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS supersedes_id UUID;
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE val_memories ADD COLUMN IF NOT EXISTS acl JSONB;

CREATE TABLE IF NOT EXISTS val_context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id VARCHAR(180),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_type VARCHAR(40) NOT NULL,
  subject_id VARCHAR(180) NOT NULL,
  objective VARCHAR(120) NOT NULL,
  contract_version VARCHAR(80) NOT NULL,
  selection_policy_version VARCHAR(80) NOT NULL,
  freshness_policy_version VARCHAR(80) NOT NULL,
  selected_refs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  excluded_refs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  exclusion_reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  confidence_level VARCHAR(40),
  snapshot_payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_context_snapshots_payload_object_check
    CHECK (jsonb_typeof(snapshot_payload)='object')
);

ALTER TABLE val_recommendations ADD COLUMN IF NOT EXISTS context_snapshot_id UUID;
ALTER TABLE val_recommendations ADD COLUMN IF NOT EXISTS context_snapshot_version VARCHAR(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_subject_pair_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_subject_pair_check
      CHECK ((subject_type IS NULL)=(subject_id IS NULL)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_subject_type_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_subject_type_check
      CHECK (
        subject_type IS NULL OR
        subject_type IN ('client','property','field','organization','user','visit','opportunity')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_state_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_state_check
      CHECK (
        memory_state IS NULL OR
        memory_state IN ('FACT','INFERENCE','HYPOTHESIS','VALIDATED_KNOWLEDGE')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_domain_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_domain_check
      CHECK (
        memory_domain IS NULL OR
        memory_domain IN ('PRODUCER','COMMERCIAL','AGRONOMIC','BEHAVIORAL','RELATIONSHIP','ORGANIZATIONAL','STRATEGIC')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_acl_object_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_acl_object_check
      CHECK (acl IS NULL OR jsonb_typeof(acl)='object') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_freshness_metadata_object_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_freshness_metadata_object_check
      CHECK (freshness_metadata IS NULL OR jsonb_typeof(freshness_metadata)='object') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_no_self_supersession_check'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_no_self_supersession_check
      CHECK (supersedes_id IS NULL OR supersedes_id<>id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_created_by_fkey'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_memories_tenant_id_id
  ON val_memories(tenant_id,id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_memories_supersedes_same_tenant_fkey'
      AND conrelid='val_memories'::regclass
  ) THEN
    ALTER TABLE val_memories ADD CONSTRAINT val_memories_supersedes_same_tenant_fkey
      FOREIGN KEY (tenant_id,supersedes_id)
      REFERENCES val_memories(tenant_id,id) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_val_memories_subject_current
  ON val_memories(
    tenant_id,
    subject_type,
    subject_id,
    memory_domain,
    key,
    status,
    valid_from DESC
  );

CREATE INDEX IF NOT EXISTS idx_val_memories_supersedes
  ON val_memories(tenant_id,supersedes_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_context_snapshots_tenant_id_id
  ON val_context_snapshots(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_subject
  ON val_context_snapshots(
    tenant_id,
    subject_type,
    subject_id,
    generated_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_request
  ON val_context_snapshots(tenant_id,request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_actor_objective
  ON val_context_snapshots(
    tenant_id,
    actor_id,
    objective,
    generated_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_selected_refs
  ON val_context_snapshots USING GIN(selected_refs);

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_excluded_refs
  ON val_context_snapshots USING GIN(excluded_refs);

CREATE INDEX IF NOT EXISTS idx_val_context_snapshots_exclusion_reason_codes
  ON val_context_snapshots USING GIN(exclusion_reason_codes);

CREATE INDEX IF NOT EXISTS idx_val_recommendations_context_snapshot
  ON val_recommendations(tenant_id,context_snapshot_id)
  WHERE context_snapshot_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_recommendations_context_snapshot_same_tenant_fkey'
      AND conrelid='val_recommendations'::regclass
  ) THEN
    ALTER TABLE val_recommendations
      ADD CONSTRAINT val_recommendations_context_snapshot_same_tenant_fkey
      FOREIGN KEY (tenant_id,context_snapshot_id)
      REFERENCES val_context_snapshots(tenant_id,id) NOT VALID;
  END IF;
END $$;

COMMENT ON TABLE val_context_snapshots IS
  'ContextSnapshot v1 imutável e rastreável; não substitui input_context legado.';
COMMENT ON COLUMN val_context_snapshots.selected_refs IS
  'Referências selecionadas pela política MCTX, sem conteúdo sensível.';
COMMENT ON COLUMN val_context_snapshots.excluded_refs IS
  'Referências não selecionadas pela política MCTX, sem conteúdo sensível.';
COMMENT ON COLUMN val_context_snapshots.exclusion_reason_codes IS
  'Códigos normalizados dos motivos de exclusão; detalhes permanecem no contrato.';
COMMENT ON COLUMN val_memories.memory_state IS
  'Estado epistemológico MMI v1 preenchido apenas por escrita ou curadoria explícita.';
COMMENT ON COLUMN val_memories.memory_domain IS
  'Natureza MMI v1 preenchida apenas por escrita ou curadoria explícita.';
COMMENT ON COLUMN val_memories.observed_at IS
  'Data de observação fornecida pela origem, sem TTL universal implícito.';
COMMENT ON COLUMN val_memories.source_updated_at IS
  'Data da última atualização informada pela fonte.';
COMMENT ON COLUMN val_memories.freshness_policy_version IS
  'Versão da política por domínio/tipo de fonte aplicada quando houver avaliação.';
COMMENT ON COLUMN val_memories.freshness_metadata IS
  'Metadados não sensíveis usados por políticas versionadas de freshness.';
COMMENT ON COLUMN val_memories.supersedes_id IS
  'Versão anterior corrigida, preservada e obrigatoriamente no mesmo tenant.';
COMMENT ON COLUMN val_memories.acl IS
  'ACL explícita para novas escritas; registros legados permanecem NULL.';
COMMENT ON COLUMN val_recommendations.context_snapshot_id IS
  'Referência tenant-safe para val_context_snapshots; input_context legado é preservado.';
