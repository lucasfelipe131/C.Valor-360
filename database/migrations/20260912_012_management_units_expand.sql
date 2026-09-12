-- Explicit unit membership. No existing account is assigned or widened by this migration.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
 CHECK (role IN ('consultant','manager','admin','technical_reviewer','bi_viewer'));

CREATE TABLE IF NOT EXISTS val_management_units (
 tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 id UUID NOT NULL DEFAULT gen_random_uuid(),
 name VARCHAR(120) NOT NULL CHECK (length(trim(name))>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS val_management_units_name_idx ON val_management_units(tenant_id,lower(name));
CREATE TABLE IF NOT EXISTS val_management_memberships (
 tenant_id UUID NOT NULL,
 user_id UUID NOT NULL,
 unit_id UUID NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,user_id),
 FOREIGN KEY (tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,unit_id) REFERENCES val_management_units(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS val_management_memberships_unit_idx ON val_management_memberships(tenant_id,unit_id,user_id);
