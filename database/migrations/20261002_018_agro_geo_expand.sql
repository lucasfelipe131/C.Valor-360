-- Additive territorial governance over existing canonical tables.
CREATE TABLE IF NOT EXISTS val_geo_history (
 id BIGSERIAL PRIMARY KEY,tenant_id UUID NOT NULL,owner_id UUID,client_id UUID NOT NULL,
 entity_type TEXT NOT NULL,entity_id UUID NOT NULL,action TEXT NOT NULL,
 before_data JSONB,after_data JSONB,actor_id UUID,source TEXT NOT NULL,reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS val_geo_history_scope ON val_geo_history(tenant_id,client_id,entity_type,entity_id,id DESC);
CREATE TABLE IF NOT EXISTS val_agro_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 client_id UUID NOT NULL REFERENCES clients(id),field_id UUID NOT NULL,
 signal_key TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,card JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,owner_id,signal_key,version)
);
CREATE INDEX IF NOT EXISTS val_agro_decisions_scope ON val_agro_decisions(tenant_id,owner_id,client_id,signal_key,version DESC);
CREATE TABLE IF NOT EXISTS val_geo_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 client_id UUID NOT NULL REFERENCES clients(id),fingerprint TEXT NOT NULL,payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RESOLVED','REJECTED')),
 resolution TEXT,resolved_by UUID,resolved_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,client_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS val_geo_reviews_scope ON val_geo_reviews(tenant_id,owner_id,status,created_at DESC);
CREATE OR REPLACE FUNCTION val_capture_territorial_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous JSONB; current_record JSONB; target JSONB; client UUID; owner UUID; actor UUID; event TEXT; source_value TEXT; reason_value TEXT;
BEGIN
 previous:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 current_record:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 target:=COALESCE(current_record,previous);
 IF TG_TABLE_NAME='fields' THEN
   SELECT p.client_id INTO client FROM properties p WHERE p.id=(target->>'property_id')::uuid AND p.tenant_id=(target->>'tenant_id')::uuid;
   IF TG_OP='UPDATE' AND previous->'geometry_ref' IS NOT DISTINCT FROM current_record->'geometry_ref' AND previous->'geometry_version' IS NOT DISTINCT FROM current_record->'geometry_version' THEN RETURN NEW; END IF;
   event:=CASE TG_OP WHEN 'INSERT' THEN 'field_created' WHEN 'DELETE' THEN 'field_deleted' ELSE 'field_geometry_changed' END;
 ELSIF TG_TABLE_NAME='properties' THEN
   client:=(target->>'client_id')::uuid;
   IF TG_OP='UPDATE' AND previous->'metadata' IS NOT DISTINCT FROM current_record->'metadata' AND previous->'area_ha' IS NOT DISTINCT FROM current_record->'area_ha' THEN RETURN NEW; END IF;
   event:=CASE TG_OP WHEN 'INSERT' THEN 'property_created' WHEN 'DELETE' THEN 'property_deleted' ELSE 'property_geometry_changed' END;
 ELSE
   client:=(target->>'client_id')::uuid;
   IF TG_OP='UPDATE' AND previous->'field_id' IS NOT DISTINCT FROM current_record->'field_id' AND previous->'property_id' IS NOT DISTINCT FROM current_record->'property_id' THEN RETURN NEW; END IF;
   event:=CASE WHEN current_record->>'field_id' IS NULL THEN 'analysis_unlinked' ELSE 'analysis_linked' END;
 END IF;
 IF client IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 SELECT consultant_id INTO owner FROM clients WHERE id=client AND tenant_id=(target->>'tenant_id')::uuid;
 actor:=NULLIF(current_setting('val.geo_actor',true),'')::uuid;
 source_value:=COALESCE(NULLIF(current_setting('val.geo_source',true),''),target->>'source','canonical_repository');
 reason_value:=COALESCE(NULLIF(current_setting('val.geo_reason',true),''),'Canonical source event: '||TG_OP);
 INSERT INTO val_geo_history(tenant_id,owner_id,client_id,entity_type,entity_id,action,before_data,after_data,actor_id,source,reason)
 VALUES((target->>'tenant_id')::uuid,owner,client,TG_TABLE_NAME,(target->>'id')::uuid,event,previous,current_record,actor,source_value,reason_value);
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS val_fields_history ON fields;
CREATE TRIGGER val_fields_history BEFORE INSERT OR UPDATE OR DELETE ON fields FOR EACH ROW EXECUTE FUNCTION val_capture_territorial_history();
DROP TRIGGER IF EXISTS val_properties_history ON properties;
CREATE TRIGGER val_properties_history BEFORE INSERT OR UPDATE OR DELETE ON properties FOR EACH ROW EXECUTE FUNCTION val_capture_territorial_history();
DROP TRIGGER IF EXISTS val_soil_link_history ON soil_analyses;
CREATE TRIGGER val_soil_link_history BEFORE INSERT OR UPDATE OR DELETE ON soil_analyses FOR EACH ROW EXECUTE FUNCTION val_capture_territorial_history();
CREATE TABLE IF NOT EXISTS val_agro_signal_validation (
 id BIGSERIAL PRIMARY KEY,tenant_id UUID NOT NULL,owner_id UUID NOT NULL,client_id UUID NOT NULL,
 signal_key TEXT NOT NULL,evidence_fingerprint TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('VALIDATED','REJECTED')),reason TEXT NOT NULL,
 evidence_refs JSONB NOT NULL,actor_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS val_agro_signal_validation_scope ON val_agro_signal_validation(tenant_id,owner_id,client_id,signal_key,id DESC);
CREATE OR REPLACE FUNCTION val_geo_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Territorial history is append-only'; END $$;
DROP TRIGGER IF EXISTS val_geo_history_immutable ON val_geo_history;
CREATE TRIGGER val_geo_history_immutable BEFORE UPDATE OR DELETE ON val_geo_history FOR EACH ROW EXECUTE FUNCTION val_geo_append_only();
DROP TRIGGER IF EXISTS val_agro_validation_immutable ON val_agro_signal_validation;
CREATE TRIGGER val_agro_validation_immutable BEFORE UPDATE OR DELETE ON val_agro_signal_validation FOR EACH ROW EXECUTE FUNCTION val_geo_append_only();
