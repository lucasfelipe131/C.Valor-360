-- Passo 10: additive facts and governance; no backfill or historical reclassification.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS value_plan JSONB;
CREATE TABLE IF NOT EXISTS val_commercial_coach_cards (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 client_id UUID NOT NULL REFERENCES clients(id),source_key TEXT NOT NULL,card JSONB NOT NULL,
 fingerprint TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,source_key,fingerprint)
);
CREATE INDEX IF NOT EXISTS val_commercial_coach_scope ON val_commercial_coach_cards(tenant_id,owner_id,client_id);
CREATE TABLE IF NOT EXISTS val_commercial_coach_feedback (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 card_id UUID NOT NULL REFERENCES val_commercial_coach_cards(id),request_id UUID NOT NULL,
 feedback TEXT NOT NULL CHECK(feedback IN ('USEFUL','ADAPTED','EXECUTED','DISMISSED')),
 result TEXT NOT NULL,learning_status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(learning_status IN ('PROPOSED','REVIEWED','APPROVED','REJECTED','ROLLED_BACK')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(tenant_id,owner_id,request_id)
);
CREATE TABLE IF NOT EXISTS val_observed_impacts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 client_id UUID NOT NULL REFERENCES clients(id),outcome_id UUID NOT NULL REFERENCES val_outcomes(id),
 request_id UUID NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,request_id)
);
CREATE INDEX IF NOT EXISTS val_observed_impact_scope ON val_observed_impacts(tenant_id,owner_id,client_id,created_at DESC);
CREATE OR REPLACE FUNCTION val_outcome_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM visits v JOIN clients c ON c.tenant_id=v.tenant_id AND c.id=v.client_id WHERE v.id=NEW.visit_id AND v.tenant_id=NEW.tenant_id AND v.client_id=NEW.client_id AND v.consultant_id=NEW.recorded_by AND c.consultant_id=NEW.recorded_by) THEN RAISE EXCEPTION 'outcome_visit_scope' USING ERRCODE='23514'; END IF;
 IF NEW.action_plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM val_action_plans a WHERE a.id=NEW.action_plan_id AND a.tenant_id=NEW.tenant_id AND a.client_id=NEW.client_id AND a.owner_user_id=NEW.recorded_by) THEN RAISE EXCEPTION 'outcome_action_scope' USING ERRCODE='23514'; END IF;
 IF NEW.visit_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM val_visit_reports r WHERE r.id=NEW.visit_report_id AND r.tenant_id=NEW.tenant_id AND r.client_id=NEW.client_id AND r.visit_id=NEW.visit_id AND r.created_by=NEW.recorded_by) THEN RAISE EXCEPTION 'outcome_report_scope' USING ERRCODE='23514'; END IF;
 IF NEW.recommendation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM val_recommendations r WHERE r.id=NEW.recommendation_id AND r.tenant_id=NEW.tenant_id AND r.client_id=NEW.client_id AND r.consultant_id=NEW.recorded_by) THEN RAISE EXCEPTION 'outcome_recommendation_scope' USING ERRCODE='23514'; END IF;
 IF NEW.commitment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM val_commitments k WHERE k.id=NEW.commitment_id AND k.tenant_id=NEW.tenant_id AND k.client_id=NEW.client_id AND (k.owner_type<>'USER' OR k.owner_id=NEW.recorded_by::text)) THEN RAISE EXCEPTION 'outcome_commitment_scope' USING ERRCODE='23514'; END IF;
 IF NEW.result->'value' IS NOT NULL AND NEW.result->'value'<>'null'::jsonb THEN
  IF jsonb_typeof(NEW.result->'value')<>'number' THEN RAISE EXCEPTION 'outcome_value_invalid' USING ERRCODE='23514'; END IF;
  IF (NEW.result->>'value')::numeric<0 THEN RAISE EXCEPTION 'outcome_value_invalid' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.outcome_type='WON' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.evidence_refs) r WHERE r->>'type' IN ('ORDER','INVOICE','COMMERCIAL_EVENT','CONFIRMED_RECORD') AND r->>'confirmed'='true' AND length(trim(r->>'id'))>0) THEN
  RAISE EXCEPTION 'won_commercial_evidence_required' USING ERRCODE='23514';
 END IF;
 IF NEW.outcome_type='LOST' AND COALESCE(NEW.result->>'loss_reason','') NOT IN ('PRICE','TIMING','COMPETITOR','TECHNICAL','CREDIT','RELATIONSHIP','OTHER') THEN
  RAISE EXCEPTION 'loss_reason_required_use_no_decision_separately' USING ERRCODE='23514';
 END IF;
 IF NEW.result->>'opportunity_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opportunities o JOIN clients c ON c.id=o.client_id AND c.tenant_id=o.tenant_id WHERE o.id::text=NEW.result->>'opportunity_id' AND o.tenant_id=NEW.tenant_id AND o.client_id=NEW.client_id AND c.consultant_id=NEW.recorded_by) THEN
  RAISE EXCEPTION 'outcome_opportunity_scope' USING ERRCODE='23514';
 END IF;
 IF NEW.result->>'decision_card_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM val_decision_cards d WHERE d.id::text=NEW.result->>'decision_card_id' AND d.tenant_id=NEW.tenant_id AND d.client_id=NEW.client_id AND d.owner_id=NEW.recorded_by) THEN
  RAISE EXCEPTION 'outcome_decision_scope' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS val_outcome_evidence ON val_outcomes;
CREATE TRIGGER val_outcome_evidence BEFORE INSERT OR UPDATE ON val_outcomes FOR EACH ROW EXECUTE FUNCTION val_outcome_evidence_guard();
CREATE OR REPLACE FUNCTION val_revenue_fact_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor UUID; action_name TEXT;
BEGIN
 IF TG_TABLE_NAME='val_outcomes' THEN actor:=NEW.recorded_by;action_name:='outcome_recorded';
 ELSE RETURN NEW;
 END IF;
 IF NEW.visit_report_id IS NULL THEN
  INSERT INTO val_learning_candidates(tenant_id,source_visit_id,source_outcome_id,created_by,contract_version,hypothesis,scope,supporting_evidence,confidence,status)
  VALUES(NEW.tenant_id,NEW.visit_id,NEW.id,NEW.recorded_by,'val.learning_candidate.v1','Revisar o resultado registrado e suas evidências antes de propor mudança de prática.',jsonb_build_object('client_id',NEW.client_id,'owner_id',NEW.recorded_by,'automaticWeightChange',false),NEW.evidence_refs,NEW.confidence,'CANDIDATE');
 END IF;
 INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES(NEW.tenant_id,actor,action_name,TG_TABLE_NAME,NEW.id::text,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS val_outcome_revenue_audit ON val_outcomes;
CREATE TRIGGER val_outcome_revenue_audit AFTER INSERT ON val_outcomes FOR EACH ROW EXECUTE FUNCTION val_revenue_fact_audit();
CREATE TABLE IF NOT EXISTS val_revenue_projection (
 tenant_id UUID NOT NULL,owner_id UUID NOT NULL,client_id UUID NOT NULL REFERENCES clients(id),
 fingerprint TEXT NOT NULL,payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_id,client_id)
);
CREATE OR REPLACE FUNCTION val_commitment_revenue_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor UUID; event_name TEXT;
BEGIN
 SELECT consultant_id INTO actor FROM clients WHERE id=NEW.client_id AND tenant_id=NEW.tenant_id;
 event_name:=CASE WHEN TG_OP='INSERT' THEN 'commitment_created' WHEN NEW.status='DONE' AND OLD.status IS DISTINCT FROM NEW.status THEN 'commitment_completed' ELSE NULL END;
 IF event_name IS NOT NULL THEN INSERT INTO audit_events(tenant_id,actor_id,action,entity_type,entity_id,after_data) VALUES(NEW.tenant_id,actor,event_name,'commitment',NEW.id::text,to_jsonb(NEW)); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS val_commitment_revenue_events ON val_commitments;
CREATE TRIGGER val_commitment_revenue_events AFTER INSERT OR UPDATE ON val_commitments FOR EACH ROW EXECUTE FUNCTION val_commitment_revenue_audit();
CREATE TABLE IF NOT EXISTS val_wallet_observations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL,owner_id UUID NOT NULL,
 client_id UUID NOT NULL REFERENCES clients(id),current_purchases NUMERIC NOT NULL,potential_total NUMERIC NOT NULL,
 source_ref TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS val_wallet_observations_scope ON val_wallet_observations(tenant_id,owner_id,client_id,observed_at DESC);
