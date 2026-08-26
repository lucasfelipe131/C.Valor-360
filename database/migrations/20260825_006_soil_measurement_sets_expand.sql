-- SOIL MEASUREMENT SETS / EXPAND
-- Mantém cada conjunto recebido como histórico auditável, mas expõe apenas um
-- conjunto corrente por análise. A troca é feita dentro da mesma transação do
-- evento de integração; nenhuma identidade lógica de soil_analyses é alterada.

ALTER TABLE soil_measurements
  ADD COLUMN IF NOT EXISTS link_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE soil_measurements
  ADD COLUMN IF NOT EXISTS source_event_id UUID;
ALTER TABLE soil_measurements
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE soil_analyses
  ADD COLUMN IF NOT EXISTS measurement_set_occurred_at TIMESTAMPTZ;
ALTER TABLE soil_analyses
  ADD COLUMN IF NOT EXISTS measurement_set_source_event_id UUID;
ALTER TABLE soil_analyses
  ADD COLUMN IF NOT EXISTS measurement_set_link_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE soil_analyses
  ADD COLUMN IF NOT EXISTS accepted_event_occurred_at TIMESTAMPTZ;
ALTER TABLE soil_analyses
  ADD COLUMN IF NOT EXISTS accepted_event_source_event_id UUID;

-- Linhas anteriores à introdução do relógio não podem ficar abertas a um
-- replay antigo. Recuperamos o maior occurred_at conhecido da mesma análise,
-- com escopo de tenant/source e, quando disponíveis, owner e cliente. O
-- created_at permanece como limite mínimo conservador/fail-closed.
WITH latest_analysis_events AS (
  SELECT analysis.id AS analysis_id,
    MAX(integration.occurred_at) AS occurred_at,
    (ARRAY_AGG(
      integration.id
      ORDER BY integration.occurred_at DESC,integration.ingested_at DESC,integration.id DESC
    ))[1] AS source_event_id
  FROM soil_analyses analysis
  JOIN integration_events integration
    ON integration.tenant_id=analysis.tenant_id
   AND integration.source=analysis.source
   AND integration.event_type='soil_analysis.completed'
   AND integration.payload->>'analysisExternalId'=analysis.external_id
   AND (
     analysis.client_external_key IS NULL
     OR integration.client_external_key IS NOT DISTINCT FROM analysis.client_external_key
   )
   AND (
     integration.owner_user_id IS NULL
     OR analysis.source<>'manual-do-agronomo'
     OR analysis.external_id LIKE 'manual-soil:'||integration.owner_user_id::TEXT||':%'
   )
  WHERE analysis.accepted_event_occurred_at IS NULL
  GROUP BY analysis.id
)
UPDATE soil_analyses analysis
SET accepted_event_occurred_at=GREATEST(analysis.created_at,latest.occurred_at),
    accepted_event_source_event_id=latest.source_event_id
FROM latest_analysis_events latest
WHERE analysis.id=latest.analysis_id
  AND analysis.accepted_event_occurred_at IS NULL;

UPDATE soil_analyses
SET accepted_event_occurred_at=created_at
WHERE accepted_event_occurred_at IS NULL;

UPDATE soil_measurements measurement
SET link_version=CASE
  WHEN COALESCE(analysis.validation_evidence->'linkage'->>'version','') ~ '^[0-9]{1,64}$'
    THEN LEAST((analysis.validation_evidence->'linkage'->>'version')::NUMERIC,1000000000)::BIGINT
  WHEN COALESCE(analysis.validation_evidence->'linkage'->>'version','') ~ '^[0-9]+$'
    THEN 1000000000
  ELSE 0
END
FROM soil_analyses analysis
WHERE analysis.tenant_id=measurement.tenant_id
  AND analysis.id=measurement.analysis_id
  AND measurement.link_version=0
  AND measurement.source_event_id IS NULL
  AND measurement.superseded_at IS NULL;

-- Bancos anteriores podiam conter a mesma grandeza lógica mais de uma vez.
-- Preservamos todas as linhas e marcamos como corrente somente a mais recente.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id,analysis_id,COALESCE(sample_key,''),LOWER(BTRIM(analyte))
      ORDER BY created_at DESC,id DESC
    ) AS position
  FROM soil_measurements
  WHERE superseded_at IS NULL
)
UPDATE soil_measurements measurement
SET superseded_at=measurement.created_at
FROM ranked
WHERE ranked.id=measurement.id
  AND ranked.position>1;

WITH current_measurement_sets AS (
  SELECT tenant_id,analysis_id,MAX(created_at) AS accepted_at
  FROM soil_measurements
  WHERE superseded_at IS NULL
  GROUP BY tenant_id,analysis_id
)
UPDATE soil_analyses analysis
SET measurement_set_occurred_at=current_set.accepted_at,
    measurement_set_link_version=CASE
      WHEN COALESCE(analysis.validation_evidence->'linkage'->>'version','') ~ '^[0-9]{1,64}$'
        THEN LEAST((analysis.validation_evidence->'linkage'->>'version')::NUMERIC,1000000000)::BIGINT
      WHEN COALESCE(analysis.validation_evidence->'linkage'->>'version','') ~ '^[0-9]+$'
        THEN 1000000000
      ELSE 0
    END
FROM current_measurement_sets current_set
WHERE analysis.tenant_id=current_set.tenant_id
  AND analysis.id=current_set.analysis_id
  AND analysis.measurement_set_occurred_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='soil_measurements_link_version_nonnegative'
      AND conrelid='soil_measurements'::regclass
  ) THEN
    ALTER TABLE soil_measurements
      ADD CONSTRAINT soil_measurements_link_version_nonnegative
      CHECK (link_version>=0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='soil_measurements_source_event_fkey'
      AND conrelid='soil_measurements'::regclass
  ) THEN
    ALTER TABLE soil_measurements
      ADD CONSTRAINT soil_measurements_source_event_fkey
      FOREIGN KEY (source_event_id) REFERENCES integration_events(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='soil_analyses_measurement_set_source_event_fkey'
      AND conrelid='soil_analyses'::regclass
  ) THEN
    ALTER TABLE soil_analyses
      ADD CONSTRAINT soil_analyses_measurement_set_source_event_fkey
      FOREIGN KEY (measurement_set_source_event_id) REFERENCES integration_events(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='soil_analyses_accepted_event_source_fkey'
      AND conrelid='soil_analyses'::regclass
  ) THEN
    ALTER TABLE soil_analyses
      ADD CONSTRAINT soil_analyses_accepted_event_source_fkey
      FOREIGN KEY (accepted_event_source_event_id) REFERENCES integration_events(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

ALTER TABLE soil_measurements
  VALIDATE CONSTRAINT soil_measurements_link_version_nonnegative;
ALTER TABLE soil_measurements
  VALIDATE CONSTRAINT soil_measurements_source_event_fkey;
ALTER TABLE soil_analyses
  VALIDATE CONSTRAINT soil_analyses_measurement_set_source_event_fkey;
ALTER TABLE soil_analyses
  VALIDATE CONSTRAINT soil_analyses_accepted_event_source_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS idx_soil_measurements_current_logical
  ON soil_measurements(
    tenant_id,
    analysis_id,
    COALESCE(sample_key,''),
    LOWER(BTRIM(analyte))
  )
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_soil_measurements_analysis_history
  ON soil_measurements(tenant_id,analysis_id,link_version DESC,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soil_measurements_source_event
  ON soil_measurements(tenant_id,source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_soil_analyses_measurement_set_event
  ON soil_analyses(tenant_id,measurement_set_occurred_at DESC)
  WHERE measurement_set_occurred_at IS NOT NULL;

COMMENT ON COLUMN soil_measurements.superseded_at IS
  'NULL identifica o conjunto corrente; linhas substituídas permanecem como histórico auditável.';
COMMENT ON COLUMN soil_measurements.source_event_id IS
  'Evento de integração que materializou esta versão da medição.';
COMMENT ON COLUMN soil_analyses.measurement_set_occurred_at IS
  'Relógio monotônico do último conjunto de medições aceito para bloquear stale writes.';
