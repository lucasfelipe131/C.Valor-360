-- User-entered producer-wide season budgets. Separate from field crop_seasons;
-- never add these aggregate areas to field areas or interpret goals as trades.
CREATE TABLE IF NOT EXISTS val_producer_seasons (
 tenant_id UUID NOT NULL REFERENCES organizations(id),
 client_id UUID NOT NULL,
 owner_user_id UUID NOT NULL,
 season VARCHAR(5) NOT NULL CHECK (season ~ '^[0-9]{4}[IV]$'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 crops JSONB NOT NULL CHECK (jsonb_typeof(crops)='array' AND jsonb_array_length(crops)=4),
 source_note VARCHAR(500) NOT NULL,
 observed_on DATE NOT NULL,
 is_demo BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,client_id,season),
 FOREIGN KEY (tenant_id,client_id) REFERENCES clients(tenant_id,id),
 FOREIGN KEY (tenant_id,owner_user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_val_producer_seasons_owner ON val_producer_seasons(tenant_id,owner_user_id,client_id);
COMMENT ON TABLE val_producer_seasons IS 'Declared season inputs and goals; projections are calculated on read, never confirmed deliveries or intelligence evidence.';
