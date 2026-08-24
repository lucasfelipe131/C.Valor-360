-- VOICE CAPTURE / EXPAND ONLY
-- Adiciona a camada transversal de captura por voz antes do Passo 07.
--
-- A migration não reclassifica registros legados, não promove memória ou
-- conhecimento e não remove/renomeia estruturas existentes. O áudio bruto
-- continua temporariamente em val_attachments atrás de uma abstração de
-- storage; metadados e transcrições recebem retenção independente.

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_attachments_tenant_id_id
  ON val_attachments(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_attachments_voice_scope
  ON val_attachments(tenant_id,id,consultant_id,client_id);

CREATE TABLE IF NOT EXISTS val_voice_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  client_id UUID NOT NULL,
  visit_id UUID,
  audio_attachment_id UUID,
  latest_transcript_id UUID,
  contract_version VARCHAR(80) NOT NULL DEFAULT 'val.voice_interaction.v1',
  interaction_type VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'CREATED',
  confirmation_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  audio_ref VARCHAR(240),
  transcript_ref VARCHAR(240),
  transcript_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  duration_seconds NUMERIC(10,3),
  language VARCHAR(30),
  source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  initial_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcription_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_artifacts JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  revision_no INTEGER NOT NULL DEFAULT 1,
  error_code VARCHAR(100),
  error_message VARCHAR(500),
  processed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT val_voice_interactions_type_check
    CHECK (interaction_type IN ('PRE_VISIT','FIELD_NOTE','POST_VISIT','CLIENT_NOTE','GENERAL_CONTEXT')),
  CONSTRAINT val_voice_interactions_status_check
    CHECK (status IN ('CREATED','AUDIO_STORED','TRANSCRIBING','TRANSCRIBED','EXTRACTING','PENDING_REVIEW','CONFIRMED','REJECTED','CANCELLED','FAILED_TRANSCRIPTION','FAILED_EXTRACTION')),
  CONSTRAINT val_voice_interactions_confirmation_check
    CHECK (confirmation_status IN ('PENDING','PENDING_REVIEW','CONFIRMED','REJECTED','CANCELLED')),
  CONSTRAINT val_voice_interactions_transcript_status_check
    CHECK (transcript_status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT val_voice_interactions_duration_check
    CHECK (duration_seconds IS NULL OR (duration_seconds>0 AND duration_seconds<=900)),
  CONSTRAINT val_voice_interactions_retry_check CHECK (retry_count>=0),
  CONSTRAINT val_voice_interactions_revision_check CHECK (revision_no>=1),
  CONSTRAINT val_voice_interactions_source_context_object_check
    CHECK (jsonb_typeof(source_context)='object'),
  CONSTRAINT val_voice_interactions_candidate_arrays_check
    CHECK (jsonb_typeof(initial_candidates)='array' AND jsonb_typeof(reviewed_candidates)='array'),
  CONSTRAINT val_voice_interactions_metadata_objects_check
    CHECK (
      jsonb_typeof(transcription_metadata)='object' AND
      jsonb_typeof(extraction_metadata)='object' AND
      jsonb_typeof(related_artifacts)='object'
    ),
  CONSTRAINT val_voice_interactions_actor_same_tenant_fkey
    FOREIGN KEY (tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id),
  CONSTRAINT val_voice_interactions_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_voice_interactions_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_voice_interactions_audio_same_tenant_fkey
    FOREIGN KEY (tenant_id,audio_attachment_id,actor_id,client_id)
    REFERENCES val_attachments(tenant_id,id,consultant_id,client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_interactions_tenant_id_id
  ON val_voice_interactions(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_interactions_actor_scope
  ON val_voice_interactions(tenant_id,id,actor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_interactions_client_scope
  ON val_voice_interactions(tenant_id,id,client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_interactions_visit_scope
  ON val_voice_interactions(tenant_id,id,visit_id);

CREATE INDEX IF NOT EXISTS idx_val_voice_interactions_actor_client
  ON val_voice_interactions(tenant_id,actor_id,client_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_val_voice_interactions_visit
  ON val_voice_interactions(tenant_id,visit_id,created_at DESC)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_val_voice_interactions_pending
  ON val_voice_interactions(tenant_id,actor_id,status,updated_at DESC)
  WHERE status::text = ANY (ARRAY[
    'AUDIO_STORED'::text,
    'FAILED_TRANSCRIPTION'::text,
    'FAILED_EXTRACTION'::text,
    'PENDING_REVIEW'::text
  ]);

CREATE TABLE IF NOT EXISTS val_voice_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  voice_interaction_id UUID NOT NULL,
  client_id UUID NOT NULL,
  visit_id UUID,
  created_by UUID NOT NULL,
  provider VARCHAR(80) NOT NULL,
  model VARCHAR(120) NOT NULL,
  provider_version VARCHAR(120),
  provider_reference VARCHAR(240),
  status VARCHAR(30) NOT NULL,
  transcript_text TEXT,
  language VARCHAR(30),
  duration_seconds NUMERIC(10,3),
  confidence NUMERIC(6,5),
  attempt_no INTEGER NOT NULL DEFAULT 1,
  error_code VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT val_voice_transcripts_status_check
    CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT val_voice_transcripts_text_check
    CHECK ((status='COMPLETED' AND transcript_text IS NOT NULL) OR status<>'COMPLETED'),
  CONSTRAINT val_voice_transcripts_duration_check
    CHECK (duration_seconds IS NULL OR (duration_seconds>0 AND duration_seconds<=900)),
  CONSTRAINT val_voice_transcripts_confidence_check
    CHECK (confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  CONSTRAINT val_voice_transcripts_attempt_check CHECK (attempt_no>=1),
  CONSTRAINT val_voice_transcripts_metadata_object_check
    CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT val_voice_transcripts_interaction_same_tenant_fkey
    FOREIGN KEY (tenant_id,voice_interaction_id) REFERENCES val_voice_interactions(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT val_voice_transcripts_actor_matches_interaction_fkey
    FOREIGN KEY (tenant_id,voice_interaction_id,created_by) REFERENCES val_voice_interactions(tenant_id,id,actor_id),
  CONSTRAINT val_voice_transcripts_client_matches_interaction_fkey
    FOREIGN KEY (tenant_id,voice_interaction_id,client_id) REFERENCES val_voice_interactions(tenant_id,id,client_id),
  CONSTRAINT val_voice_transcripts_visit_matches_interaction_fkey
    FOREIGN KEY (tenant_id,voice_interaction_id,visit_id) REFERENCES val_voice_interactions(tenant_id,id,visit_id),
  CONSTRAINT val_voice_transcripts_client_same_tenant_fkey
    FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
  CONSTRAINT val_voice_transcripts_visit_same_tenant_fkey
    FOREIGN KEY (tenant_id,visit_id) REFERENCES visits(tenant_id,id),
  CONSTRAINT val_voice_transcripts_creator_same_tenant_fkey
    FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
  UNIQUE (tenant_id,voice_interaction_id,attempt_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_transcripts_tenant_id_id
  ON val_voice_transcripts(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_val_voice_transcripts_interaction_identity
  ON val_voice_transcripts(tenant_id,id,voice_interaction_id);

CREATE INDEX IF NOT EXISTS idx_val_voice_transcripts_interaction
  ON val_voice_transcripts(tenant_id,voice_interaction_id,attempt_no DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='val_voice_interactions_latest_transcript_same_tenant_fkey'
      AND conrelid='val_voice_interactions'::regclass
  ) THEN
    ALTER TABLE val_voice_interactions
      ADD CONSTRAINT val_voice_interactions_latest_transcript_same_tenant_fkey
      FOREIGN KEY (tenant_id,latest_transcript_id,id)
      REFERENCES val_voice_transcripts(tenant_id,id,voice_interaction_id) NOT VALID;
  END IF;
END $$;

COMMENT ON TABLE val_voice_interactions IS
  'VoiceInteraction v1: captura transversal; nenhum candidato vira fato antes de confirmação humana.';
COMMENT ON TABLE val_voice_transcripts IS
  'Transcrições separadas do áudio bruto para retry, auditoria e retenção independente.';
COMMENT ON COLUMN val_voice_interactions.audio_ref IS
  'Referência opaca ao VoiceStorageProvider; o binário não faz parte do contrato da engine.';
COMMENT ON COLUMN val_voice_interactions.initial_candidates IS
  'Extração inicial não confiável e sempre pendente de revisão humana.';
COMMENT ON COLUMN val_voice_interactions.reviewed_candidates IS
  'Decisões e edições explícitas do consultor; não constitui KnowledgeItem automático.';
