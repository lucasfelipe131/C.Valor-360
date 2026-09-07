-- Daily route order and explicit GPS trace, isolated by tenant and consultant.
CREATE TABLE IF NOT EXISTS val_visit_routes (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_date DATE NOT NULL,
  ordered_visit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracking BOOLEAN NOT NULL DEFAULT FALSE,
  time_zone VARCHAR(80) NOT NULL DEFAULT 'America/Sao_Paulo',
  tracking_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,owner_id,route_date),
  CHECK (jsonb_typeof(ordered_visit_ids)='array' AND jsonb_array_length(ordered_visit_ids)<=100),
  CHECK (jsonb_typeof(trace)='array' AND jsonb_array_length(trace)<=2000),
  CHECK (NOT tracking OR tracking_started_at IS NOT NULL)
);
