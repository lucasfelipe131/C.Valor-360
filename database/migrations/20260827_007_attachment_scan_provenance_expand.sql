-- ATTACHMENT / SCAN PROVENANCE — COMPATIBILITY EXPAND
-- Permite que um attachment continue pertencendo ao tenant e ao consultor sem
-- inventar um vínculo com produtor. Nenhuma linha é apagada ou reescrita.

ALTER TABLE val_attachments
  ALTER COLUMN client_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_val_attachments_unlinked_date
  ON val_attachments(tenant_id,consultant_id,created_at DESC)
  WHERE client_id IS NULL;
