-- O identificador externo do ERP/app de campo (numero do pedido, numero do laudo, cena NDVI) era
-- unico por (tenant_id,source,external_id), sem o dono. Como toda a integracao manual grava
-- source='manual-do-agronomo', o identificador virava um espaco de nomes GLOBAL do tenant: dois
-- consultores usando o mesmo numero de pedido ou de laudo colidiam entre si. O laudo e o NDVI do
-- primeiro eram REESCRITOS para o produtor do segundo (upsert), e a venda do segundo era ENGOLIDA
-- pelo ON CONFLICT DO NOTHING - em ambos os casos com HTTP 202 accepted:true.
-- Mesma correcao ja aplicada em integration_events: chave escopada pelo dono.

ALTER TABLE business_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ndvi_observations ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Backfill pelo consultor do produtor: cada linha ja pertence, de fato, a carteira de um consultor.
UPDATE business_events target SET owner_user_id=client.consultant_id
  FROM clients client WHERE client.id=target.client_id AND target.owner_user_id IS NULL;
UPDATE field_reports target SET owner_user_id=client.consultant_id
  FROM clients client WHERE client.id=target.client_id AND target.owner_user_id IS NULL;
UPDATE ndvi_observations target SET owner_user_id=client.consultant_id
  FROM clients client WHERE client.id=target.client_id AND target.owner_user_id IS NULL;

ALTER TABLE business_events DROP CONSTRAINT IF EXISTS business_events_tenant_id_source_external_id_key;
ALTER TABLE field_reports DROP CONSTRAINT IF EXISTS field_reports_tenant_id_source_external_id_key;
ALTER TABLE ndvi_observations DROP CONSTRAINT IF EXISTS ndvi_observations_tenant_id_source_external_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_events_owner_external ON business_events(tenant_id,owner_user_id,source,external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_reports_owner_external ON field_reports(tenant_id,owner_user_id,source,external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ndvi_observations_owner_external ON ndvi_observations(tenant_id,owner_user_id,source,external_id);
