-- Additive evolution of the canonical LearningCandidate. No runtime ranker/prompt write.
ALTER TABLE val_learning_candidates ADD COLUMN IF NOT EXISTS learning_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE val_learning_candidates ADD COLUMN IF NOT EXISTS candidate_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_candidate_fingerprint ON val_learning_candidates(tenant_id,candidate_fingerprint) WHERE candidate_fingerprint IS NOT NULL;
ALTER TABLE val_recommendations ADD COLUMN IF NOT EXISTS learning_snapshot JSONB;
CREATE TABLE IF NOT EXISTS val_learning_artifacts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES organizations(id),
 owner_id UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('DATASET','PATTERN','SHADOW','DRIFT')),
 fingerprint TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES memberships(tenant_id,user_id), UNIQUE(tenant_id,kind,fingerprint), UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_learning_artifacts_page ON val_learning_artifacts(tenant_id,kind,created_at DESC,id);
CREATE TABLE IF NOT EXISTS val_learning_promotions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES organizations(id),
 candidate_id UUID NOT NULL, created_by UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('KNOWLEDGE','PROMPT','POLICY','WEIGHT','MODEL','QUESTION','RULE')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','UNDER_REVIEW','APPROVED','REJECTED','PUBLISHED','SUPERSEDED','ROLLED_BACK')),
 fingerprint TEXT NOT NULL, payload JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,candidate_id) REFERENCES val_learning_candidates(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id), UNIQUE(tenant_id,fingerprint), UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_learning_promotions_page ON val_learning_promotions(tenant_id,status,created_at DESC,id);
CREATE TABLE IF NOT EXISTS val_learning_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES organizations(id),
 candidate_id UUID,promotion_id UUID,reviewer UUID NOT NULL,decision TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((candidate_id IS NOT NULL)::integer+(promotion_id IS NOT NULL)::integer=1),
 FOREIGN KEY(tenant_id,candidate_id) REFERENCES val_learning_candidates(tenant_id,id),
 FOREIGN KEY(tenant_id,promotion_id) REFERENCES val_learning_promotions(tenant_id,id),
 FOREIGN KEY(tenant_id,reviewer) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_reviews_candidate ON val_learning_reviews(tenant_id,candidate_id,created_at);
CREATE INDEX IF NOT EXISTS idx_learning_reviews_promotion ON val_learning_reviews(tenant_id,promotion_id,created_at);
-- Publication records use the existing KnowledgeItem contract and source registry.
-- No second retrieval engine or automatic inclusion in production.
CREATE TABLE IF NOT EXISTS val_learning_publications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES organizations(id),
 promotion_id UUID NOT NULL,kind TEXT NOT NULL,version TEXT NOT NULL,previous_version TEXT,rollback_target TEXT NOT NULL,
 payload JSONB NOT NULL,published_by UUID NOT NULL,valid_until TIMESTAMPTZ NOT NULL,review_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,promotion_id) REFERENCES val_learning_promotions(tenant_id,id),
 FOREIGN KEY(tenant_id,published_by) REFERENCES memberships(tenant_id,user_id),UNIQUE(tenant_id,promotion_id),UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_learning_publications_page ON val_learning_publications(tenant_id,created_at DESC,id);
CREATE OR REPLACE FUNCTION val_learning_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Learning history is append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS val_learning_reviews_immutable ON val_learning_reviews;
CREATE TRIGGER val_learning_reviews_immutable BEFORE UPDATE OR DELETE ON val_learning_reviews FOR EACH ROW EXECUTE FUNCTION val_learning_history_immutable();
DROP TRIGGER IF EXISTS val_learning_publications_immutable ON val_learning_publications;
CREATE TRIGGER val_learning_publications_immutable BEFORE UPDATE OR DELETE ON val_learning_publications FOR EACH ROW EXECUTE FUNCTION val_learning_history_immutable();
CREATE OR REPLACE FUNCTION val_learning_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.learning_snapshot IS DISTINCT FROM NEW.learning_snapshot THEN RAISE EXCEPTION 'Recommendation snapshot is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS val_learning_snapshot_immutable ON val_recommendations;
CREATE TRIGGER val_learning_snapshot_immutable BEFORE UPDATE ON val_recommendations FOR EACH ROW EXECUTE FUNCTION val_learning_snapshot_immutable();
ALTER TABLE val_recommendations ADD COLUMN IF NOT EXISTS learning_displayed_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS val_learning_controls (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES organizations(id),kind TEXT NOT NULL CHECK(kind IN ('SAMPLE','DRIFT','REGRESSION')),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')),version TEXT NOT NULL,payload JSONB NOT NULL,
 created_by UUID NOT NULL,reviewed_by UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),FOREIGN KEY(tenant_id,reviewed_by) REFERENCES memberships(tenant_id,user_id),
 UNIQUE(tenant_id,kind,version),UNIQUE(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_learning_controls_status ON val_learning_controls(tenant_id,kind,status,created_at DESC);
