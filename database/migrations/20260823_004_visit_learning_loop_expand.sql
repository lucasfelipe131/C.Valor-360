-- PASSO 06 / EXPAND ONLY
-- Primeiro ciclo vertical de visita: lifecycle, preparação versionada, transcript,
-- report confirmado, outcome e LearningCandidate.
--
-- Esta migration NÃO atualiza linhas existentes, NÃO classifica visitas legadas,
-- NÃO altera IDs, NÃO remove/renomeia colunas ou tabelas e NÃO promove memória
-- ou conhecimento automaticamente.

ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(40);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_version VARCHAR(80);
ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_revision INTEGER;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS lifecycle_updated_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='visits_lifecycle_status_check'
      AND conrelid='visits'::regclass
  ) THEN
    ALTER TABLE visits ADD CONSTRAINT visits_lifecycle_status_check
      CHECK (
        lifecycle_status IS NULL OR lifecycle_status IN (
          'PLANNED',
          'PREPARED',
          'IN_PROGRESS',
          'COMPLETED_PENDING_REVIEW',
          'COMPLETED',
          'CANCELLED'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='visits_lifecycle_revision_check'
      AND conrelid='visits'::regclass
  ) THEN
    ALTER TABLE visits ADD CONSTRAINT visits_lifecycle_revision_check
      CHECK (lifecycle_revision IS NULL OR lifecycle_revision>=0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='visits_lifecycle_updated_by_fkey'
      AND conrelid='visits'::regclass
  ) THEN
    ALTER TABLE visits ADD CONSTRAINT visits_lifecycle_updated_by_fkey
      FOREIGN KEY (lifecycle_updated_by) REFERENCES users(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_tenant_id_id
  ON interactions(tenant_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_attachments_tenant_id_id
  ON val_attachments(tenant_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_recommendations_tenant_id_id
  ON val_recommendations(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_visits_lifecycle
  ON visits(tenant_id,consultant_id,lifecycle_status,lifecycle_updated_at DESC)
  WHERE lifecycle_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS val_visit_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  contract_version VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  reason_code VARCHAR(100) NOT NULL,
  request_id VARCHAR(180),
  revision INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_visit_lifecycle_events_from_status_check
    CHECK (
      from_status IS NULL OR from_status IN (
        'PLANNED','PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'
      )
    ),
  CONSTRAINT val_visit_lifecycle_events_to_status_check
    CHECK (
      to_status IN (
        'PLANNED','PREPARED','IN_PROGRESS','COMPLETED_PENDING_REVIEW','COMPLETED','CANCELLED'
      )
    ),
  CONSTRAINT val_visit_lifecycle_events_revision_check
    CHECK (revision>=0),
  CONSTRAINT val_visit_lifecycle_events_metadata_object_check
    CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT val_visit_lifecycle_events_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_visit_lifecycle_events_actor_same_tenant_fkey
    FOREIGN KEY (tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_val_visit_lifecycle_events_visit
  ON val_visit_lifecycle_events(tenant_id,visit_id,revision,occurred_at);

CREATE INDEX IF NOT EXISTS idx_val_visit_lifecycle_events_request
  ON val_visit_lifecycle_events(tenant_id,request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS val_visit_preparations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  client_id UUID NOT NULL,
  prepared_by UUID NOT NULL,
  version_no INTEGER NOT NULL,
  preparation_id VARCHAR(180) NOT NULL,
  contract_version VARCHAR(80) NOT NULL,
  context_snapshot_id UUID NOT NULL,
  behavioral_profile_version VARCHAR(80) NOT NULL,
  decision_thesis_id VARCHAR(180) NOT NULL,
  decision_thesis_version VARCHAR(80) NOT NULL,
  value_plan_id VARCHAR(180) NOT NULL,
  value_plan_version VARCHAR(80) NOT NULL,
  action_plan_id UUID NOT NULL,
  preparation_payload JSONB NOT NULL,
  request_id VARCHAR(180),
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_visit_preparations_version_check
    CHECK (version_no>=1),
  CONSTRAINT val_visit_preparations_payload_object_check
    CHECK (jsonb_typeof(preparation_payload)='object'),
  CONSTRAINT val_visit_preparations_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_visit_preparations_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_visit_preparations_actor_same_tenant_fkey
    FOREIGN KEY (tenant_id,prepared_by) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_visit_preparations_snapshot_same_tenant_fkey
    FOREIGN KEY (tenant_id,context_snapshot_id) REFERENCES val_context_snapshots(tenant_id,id),
  CONSTRAINT val_visit_preparations_action_plan_same_tenant_fkey
    FOREIGN KEY (tenant_id,action_plan_id) REFERENCES val_action_plans(tenant_id,id),
  UNIQUE (tenant_id,visit_id,version_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_visit_preparations_tenant_id_id
  ON val_visit_preparations(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_visit_preparations_visit_latest
  ON val_visit_preparations(tenant_id,prepared_by,visit_id,version_no DESC);

CREATE INDEX IF NOT EXISTS idx_val_visit_preparations_snapshot
  ON val_visit_preparations(tenant_id,context_snapshot_id);

CREATE TABLE IF NOT EXISTS val_visit_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  client_id UUID NOT NULL,
  created_by UUID NOT NULL,
  interaction_id UUID,
  source_attachment_id UUID,
  contract_version VARCHAR(80) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  provider_reference VARCHAR(240),
  language VARCHAR(30),
  status VARCHAR(30) NOT NULL,
  transcript_text TEXT,
  error_code VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT val_visit_transcripts_status_check
    CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  CONSTRAINT val_visit_transcripts_completed_check
    CHECK (status<>'COMPLETED' OR (transcript_text IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT val_visit_transcripts_failed_check
    CHECK (status<>'FAILED' OR error_code IS NOT NULL),
  CONSTRAINT val_visit_transcripts_metadata_object_check
    CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT val_visit_transcripts_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_visit_transcripts_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_visit_transcripts_actor_same_tenant_fkey
    FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_visit_transcripts_interaction_same_tenant_fkey
    FOREIGN KEY (tenant_id,interaction_id) REFERENCES interactions(tenant_id,id),
  CONSTRAINT val_visit_transcripts_attachment_same_tenant_fkey
    FOREIGN KEY (tenant_id,source_attachment_id) REFERENCES val_attachments(tenant_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_visit_transcripts_tenant_id_id
  ON val_visit_transcripts(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_visit_transcripts_visit
  ON val_visit_transcripts(tenant_id,created_by,visit_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_visit_transcripts_attachment
  ON val_visit_transcripts(tenant_id,source_attachment_id)
  WHERE source_attachment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS val_visit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  client_id UUID NOT NULL,
  created_by UUID NOT NULL,
  confirmed_by UUID,
  transcript_id UUID,
  contract_version VARCHAR(80) NOT NULL,
  source_type VARCHAR(30) NOT NULL,
  source_ref VARCHAR(240) NOT NULL,
  transcript_ref VARCHAR(240),
  visit_objective TEXT NOT NULL,
  summary TEXT NOT NULL,
  discussed_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  expectations_created JSONB NOT NULL DEFAULT '[]'::jsonb,
  objections JSONB NOT NULL DEFAULT '[]'::jsonb,
  producer_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunities_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  commitments_proposed JSONB NOT NULL DEFAULT '[]'::jsonb,
  commitments_confirmed JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_business JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_business JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  technical_observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  behavioral_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  consultant_notes TEXT,
  confidence NUMERIC(4,3) NOT NULL,
  confirmation_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW',
  revision_no INTEGER NOT NULL DEFAULT 1,
  idempotency_key VARCHAR(180) NOT NULL,
  initial_extraction JSONB NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_visit_reports_source_type_check
    CHECK (source_type IN ('TEXT','AUDIO')),
  CONSTRAINT val_visit_reports_confirmation_status_check
    CHECK (confirmation_status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),
  CONSTRAINT val_visit_reports_confidence_check
    CHECK (confidence>=0 AND confidence<=1),
  CONSTRAINT val_visit_reports_revision_check
    CHECK (revision_no>=1),
  CONSTRAINT val_visit_reports_confirmation_check
    CHECK (
      confirmation_status<>'CONFIRMED' OR
      (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
  CONSTRAINT val_visit_reports_initial_extraction_object_check
    CHECK (jsonb_typeof(initial_extraction)='object'),
  CONSTRAINT val_visit_reports_arrays_check
    CHECK (
      jsonb_typeof(discussed_topics)='array' AND
      jsonb_typeof(expectations_created)='array' AND
      jsonb_typeof(objections)='array' AND
      jsonb_typeof(producer_signals)='array' AND
      jsonb_typeof(opportunities_detected)='array' AND
      jsonb_typeof(commitments_proposed)='array' AND
      jsonb_typeof(commitments_confirmed)='array' AND
      jsonb_typeof(closed_business)='array' AND
      jsonb_typeof(pending_business)='array' AND
      jsonb_typeof(next_steps)='array' AND
      jsonb_typeof(technical_observations)='array' AND
      jsonb_typeof(behavioral_signals)='array' AND
      jsonb_typeof(missing_information)='array'
    ),
  CONSTRAINT val_visit_reports_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_visit_reports_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_visit_reports_creator_same_tenant_fkey
    FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_visit_reports_confirmer_same_tenant_fkey
    FOREIGN KEY (tenant_id,confirmed_by) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_visit_reports_transcript_same_tenant_fkey
    FOREIGN KEY (tenant_id,transcript_id) REFERENCES val_visit_transcripts(tenant_id,id),
  UNIQUE (tenant_id,visit_id,idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_visit_reports_tenant_id_id
  ON val_visit_reports(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_visit_reports_visit_status
  ON val_visit_reports(tenant_id,created_by,visit_id,confirmation_status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_visit_reports_client_confirmed
  ON val_visit_reports(tenant_id,client_id,confirmed_at DESC)
  WHERE confirmation_status='CONFIRMED';

CREATE TABLE IF NOT EXISTS val_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL,
  client_id UUID NOT NULL,
  visit_report_id UUID,
  recommendation_id UUID,
  action_plan_id UUID,
  commitment_id UUID,
  contract_version VARCHAR(80) NOT NULL,
  outcome_type VARCHAR(40) NOT NULL,
  result JSONB NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  measured_at TIMESTAMPTZ NOT NULL,
  recorded_by UUID NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_outcomes_type_check
    CHECK (outcome_type IN (
      'WON','LOST','PARTIAL','NO_DECISION','FOLLOW_UP',
      'TECHNICAL_RESULT','RELATIONSHIP_PROGRESS','NO_CHANGE'
    )),
  CONSTRAINT val_outcomes_confidence_check
    CHECK (confidence>=0 AND confidence<=1),
  CONSTRAINT val_outcomes_result_object_check
    CHECK (jsonb_typeof(result)='object'),
  CONSTRAINT val_outcomes_evidence_array_check
    CHECK (jsonb_typeof(evidence_refs)='array'),
  CONSTRAINT val_outcomes_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_outcomes_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_outcomes_report_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_report_id) REFERENCES val_visit_reports(tenant_id,id),
  CONSTRAINT val_outcomes_recommendation_same_tenant_fkey
    FOREIGN KEY (tenant_id,recommendation_id) REFERENCES val_recommendations(tenant_id,id),
  CONSTRAINT val_outcomes_action_plan_same_tenant_fkey
    FOREIGN KEY (tenant_id,action_plan_id) REFERENCES val_action_plans(tenant_id,id),
  CONSTRAINT val_outcomes_commitment_same_tenant_fkey
    FOREIGN KEY (tenant_id,commitment_id) REFERENCES val_commitments(tenant_id,id),
  CONSTRAINT val_outcomes_recorder_same_tenant_fkey
    FOREIGN KEY (tenant_id,recorded_by) REFERENCES memberships(tenant_id,user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_outcomes_tenant_id_id
  ON val_outcomes(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_outcomes_visit
  ON val_outcomes(tenant_id,visit_id,measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_outcomes_client_type
  ON val_outcomes(tenant_id,client_id,outcome_type,measured_at DESC);

CREATE TABLE IF NOT EXISTS val_learning_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_visit_id UUID NOT NULL,
  source_visit_report_id UUID,
  source_outcome_id UUID,
  created_by UUID NOT NULL,
  contract_version VARCHAR(80) NOT NULL,
  hypothesis TEXT NOT NULL,
  scope JSONB NOT NULL,
  supporting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  contrary_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CANDIDATE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_learning_candidates_status_check
    CHECK (status IN ('CANDIDATE','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED')),
  CONSTRAINT val_learning_candidates_confidence_check
    CHECK (confidence>=0 AND confidence<=1),
  CONSTRAINT val_learning_candidates_scope_object_check
    CHECK (jsonb_typeof(scope)='object'),
  CONSTRAINT val_learning_candidates_evidence_arrays_check
    CHECK (
      jsonb_typeof(supporting_evidence)='array' AND
      jsonb_typeof(contrary_evidence)='array'
    ),
  CONSTRAINT val_learning_candidates_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,source_visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_learning_candidates_report_same_tenant_fkey
    FOREIGN KEY (tenant_id,source_visit_report_id) REFERENCES val_visit_reports(tenant_id,id),
  CONSTRAINT val_learning_candidates_outcome_same_tenant_fkey
    FOREIGN KEY (tenant_id,source_outcome_id) REFERENCES val_outcomes(tenant_id,id),
  CONSTRAINT val_learning_candidates_creator_same_tenant_fkey
    FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_learning_candidates_tenant_id_id
  ON val_learning_candidates(tenant_id,id);

CREATE INDEX IF NOT EXISTS idx_val_learning_candidates_visit_status
  ON val_learning_candidates(tenant_id,source_visit_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_learning_candidates_outcome
  ON val_learning_candidates(tenant_id,source_outcome_id)
  WHERE source_outcome_id IS NOT NULL;

COMMENT ON COLUMN visits.lifecycle_status IS
  'VisitLifecycle v1 para novas transições; status legado permanece inalterado.';
COMMENT ON TABLE val_visit_lifecycle_events IS
  'Histórico append-only das transições explícitas do VisitLifecycle v1.';
COMMENT ON TABLE val_visit_preparations IS
  'Versões append-only de PrepareVisit; regeneração não sobrescreve versões anteriores.';
COMMENT ON TABLE val_visit_transcripts IS
  'Transcript rastreável; texto transcrito nunca é consolidado como fato sem confirmação do report.';
COMMENT ON TABLE val_visit_reports IS
  'VisitReport v1 candidato e revisável; confirmação humana antecede qualquer consolidação.';
COMMENT ON TABLE val_outcomes IS
  'Outcome v1 da visita, incluindo resultados comerciais, técnicos e relacionais.';
COMMENT ON TABLE val_learning_candidates IS
  'LearningCandidate v1; a Fase 6 cria somente CANDIDATE e não promove KnowledgeItem.';
