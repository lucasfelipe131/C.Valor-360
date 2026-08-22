-- PASSO 05 / EXPAND ONLY
-- Funda MEX/VIS com ActionPlan e Commitment de primeira classe.
-- Não altera, reclassifica, preenche, remove ou renomeia dados/colunas legados.

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_tenant_id_id
  ON clients(tenant_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_tenant_id_id
  ON visits(tenant_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_tenant_id_id
  ON opportunities(tenant_id,id);

CREATE TABLE IF NOT EXISTS val_action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  visit_id UUID,
  owner_user_id UUID NOT NULL,
  context_snapshot_id UUID NOT NULL,
  contract_version VARCHAR(80) NOT NULL,
  decision_thesis_id VARCHAR(180) NOT NULL,
  decision_thesis_version VARCHAR(80) NOT NULL,
  value_plan_id VARCHAR(180) NOT NULL,
  value_plan_version VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PROPOSED',
  priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  preparation_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_action_plans_status_check
    CHECK (status IN ('PROPOSED','ACCEPTED','IN_PROGRESS','DONE','BLOCKED','CANCELLED')),
  CONSTRAINT val_action_plans_priorities_array_check
    CHECK (jsonb_typeof(priorities)='array' AND jsonb_array_length(priorities)<=3),
  CONSTRAINT val_action_plans_preparation_object_check
    CHECK (preparation_payload IS NULL OR jsonb_typeof(preparation_payload)='object'),
  CONSTRAINT val_action_plans_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_action_plans_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_action_plans_owner_same_tenant_fkey
    FOREIGN KEY (tenant_id,owner_user_id) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_action_plans_snapshot_same_tenant_fkey
    FOREIGN KEY (tenant_id,context_snapshot_id) REFERENCES val_context_snapshots(tenant_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_action_plans_tenant_id_id
  ON val_action_plans(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_action_plans_visit
  ON val_action_plans(tenant_id,owner_user_id,visit_id,created_at DESC)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_val_action_plans_client_status
  ON val_action_plans(tenant_id,owner_user_id,client_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_action_plans_context_snapshot
  ON val_action_plans(tenant_id,context_snapshot_id);

CREATE TABLE IF NOT EXISTS val_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  visit_id UUID,
  opportunity_id UUID,
  action_plan_id UUID,
  action_id VARCHAR(180),
  description TEXT NOT NULL,
  owner_type VARCHAR(30) NOT NULL,
  owner_id VARCHAR(180) NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PROPOSED',
  success_criteria TEXT NOT NULL,
  agreed_with_client BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ref VARCHAR(240) NOT NULL,
  audit JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT val_commitments_status_check
    CHECK (status IN ('PROPOSED','ACCEPTED','IN_PROGRESS','DONE','BLOCKED','CANCELLED')),
  CONSTRAINT val_commitments_owner_type_check
    CHECK (owner_type IN ('USER','CLIENT','EXTERNAL')),
  CONSTRAINT val_commitments_description_check
    CHECK (length(btrim(description))>0),
  CONSTRAINT val_commitments_success_criteria_check
    CHECK (length(btrim(success_criteria))>0),
  CONSTRAINT val_commitments_evidence_array_check
    CHECK (jsonb_typeof(evidence_refs)='array'),
  CONSTRAINT val_commitments_audit_object_check
    CHECK (jsonb_typeof(audit)='object'),
  CONSTRAINT val_commitments_done_evidence_check
    CHECK (status<>'DONE' OR (completed_at IS NOT NULL AND jsonb_array_length(evidence_refs)>0)),
  CONSTRAINT val_commitments_cancelled_at_check
    CHECK (status<>'CANCELLED' OR cancelled_at IS NOT NULL),
  CONSTRAINT val_commitments_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_commitments_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_commitments_opportunity_same_tenant_fkey
    FOREIGN KEY (tenant_id,opportunity_id) REFERENCES opportunities(tenant_id,id),
  CONSTRAINT val_commitments_action_plan_same_tenant_fkey
    FOREIGN KEY (tenant_id,action_plan_id) REFERENCES val_action_plans(tenant_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_commitments_tenant_id_id
  ON val_commitments(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_commitments_client_due
  ON val_commitments(tenant_id,client_id,status,due_at);

CREATE INDEX IF NOT EXISTS idx_val_commitments_owner_due
  ON val_commitments(tenant_id,owner_type,owner_id,status,due_at);

CREATE INDEX IF NOT EXISTS idx_val_commitments_visit
  ON val_commitments(tenant_id,visit_id,created_at DESC)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_val_commitments_opportunity
  ON val_commitments(tenant_id,opportunity_id,created_at DESC)
  WHERE opportunity_id IS NOT NULL;

COMMENT ON TABLE val_action_plans IS
  'ActionPlan v1 do MEX; no máximo três prioridades e preparação de visita versionada.';
COMMENT ON COLUMN val_action_plans.preparation_payload IS
  'PrepareVisit v1 vinculado ao plano; não contém áudio ou registro pós-visita.';
COMMENT ON TABLE val_commitments IS
  'Commitment v1; somente compromissos com owner, prazo e critério de sucesso.';
COMMENT ON COLUMN val_commitments.evidence_refs IS
  'Referências de evidência; conclusão exige ao menos uma referência e completed_at.';
