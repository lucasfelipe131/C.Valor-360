-- Decision records reference canonical clients; no producer or AI domain copy.
CREATE TABLE IF NOT EXISTS val_decision_settings (
 tenant_id UUID PRIMARY KEY REFERENCES organizations(id), revision INTEGER NOT NULL DEFAULT 1,
 flags JSONB NOT NULL, policy_version TEXT NOT NULL, registry JSONB NOT NULL,
 updated_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS val_decision_settings_history (
 tenant_id UUID NOT NULL REFERENCES organizations(id), revision INTEGER NOT NULL,
 flags JSONB NOT NULL, policy_version TEXT NOT NULL, registry JSONB NOT NULL,
 reason TEXT NOT NULL, actor_id UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,revision)
);
CREATE TABLE IF NOT EXISTS val_decision_cards (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES organizations(id),
 owner_id UUID NOT NULL REFERENCES users(id), client_id UUID NOT NULL REFERENCES clients(id),
 version INTEGER NOT NULL, fingerprint TEXT NOT NULL, policy_version TEXT NOT NULL,
 card JSONB NOT NULL, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,client_id,version), UNIQUE(tenant_id,owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_decision_latest ON val_decision_cards(tenant_id,owner_id,client_id,version DESC);
CREATE TABLE IF NOT EXISTS val_decision_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id UUID NOT NULL, owner_id UUID NOT NULL,
 card_id UUID NOT NULL, action TEXT NOT NULL, policy_version TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}', actor_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,owner_id,card_id) REFERENCES val_decision_cards(tenant_id,owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_decision_audit_scope ON val_decision_audit(tenant_id,owner_id,card_id,id);
CREATE TABLE IF NOT EXISTS val_decision_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, owner_id UUID NOT NULL,
 card_id UUID NOT NULL, reasons JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','RESOLVED')),
 resolution TEXT, resolved_by UUID REFERENCES users(id), resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,card_id),
 FOREIGN KEY(tenant_id,owner_id,card_id) REFERENCES val_decision_cards(tenant_id,owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_decision_review_queue ON val_decision_reviews(tenant_id,owner_id,status,created_at);
CREATE TABLE IF NOT EXISTS val_decision_feedback (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, owner_id UUID NOT NULL,
 card_id UUID NOT NULL, request_id UUID NOT NULL,
 feedback TEXT NOT NULL CHECK(feedback IN('USEFUL','NOT_USEFUL','ACTION_SELECTED','ACTION_EXECUTED','ACTION_ADAPTED','ACTION_DISMISSED')),
 note TEXT, actor_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,owner_id,request_id),
 FOREIGN KEY(tenant_id,owner_id,card_id) REFERENCES val_decision_cards(tenant_id,owner_id,id)
);
CREATE INDEX IF NOT EXISTS idx_decision_feedback_scope ON val_decision_feedback(tenant_id,owner_id,card_id,created_at);
