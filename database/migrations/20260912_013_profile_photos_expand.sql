CREATE TABLE IF NOT EXISTS val_profile_photos (
 tenant_id UUID NOT NULL REFERENCES organizations(id),
 entity_kind TEXT NOT NULL CHECK (entity_kind IN ('producer','consultant')),
 entity_id UUID NOT NULL,
 photo TEXT CHECK (photo IS NULL OR octet_length(photo)<=350000),
 updated_by UUID NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,entity_kind,entity_id)
);
