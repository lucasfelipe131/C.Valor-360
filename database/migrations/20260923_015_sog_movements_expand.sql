-- Minimal append-only operational ledger. No ERP connector or historical rewrite.
CREATE TABLE IF NOT EXISTS sog_movements (
 tenant_id UUID NOT NULL,
 owner_user_id UUID NOT NULL,
 client_id UUID NOT NULL,
 id VARCHAR(80) NOT NULL,
 commodity VARCHAR(40) NOT NULL CHECK (commodity IN ('soja','milho','trigo','sorgo','feijao','arroz','cevada')),
 unit VARCHAR(20) NOT NULL CHECK (unit IN ('sc_60kg','t','kg')),
 kind VARCHAR(20) NOT NULL CHECK (kind IN ('opening','entry','exit')),
 quantity NUMERIC(16,3) NOT NULL CHECK (quantity >= 0 AND (kind='opening' OR quantity>0)),
 origin VARCHAR(240) NOT NULL CHECK (length(btrim(origin))>0),
 reference VARCHAR(240) NOT NULL CHECK (length(btrim(reference))>0),
 occurred_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,owner_user_id,client_id,id),
 UNIQUE (tenant_id,owner_user_id,client_id,origin,reference),
 FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
 FOREIGN KEY (tenant_id,owner_user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sog_movements_opening ON sog_movements(tenant_id,owner_user_id,client_id,commodity,unit) WHERE kind='opening';
CREATE INDEX IF NOT EXISTS idx_sog_movements_scope_date ON sog_movements(tenant_id,owner_user_id,client_id,occurred_at,id);
