-- Public general explanations only. This is not producer memory or evidence.
-- The application stores a question hash, never the question or conversation.
CREATE TABLE IF NOT EXISTS val_shared_knowledge_answers (
 cache_key CHAR(64) PRIMARY KEY CHECK (cache_key ~ '^[a-f0-9]{64}$'),
 policy_revision CHAR(64) NOT NULL CHECK (policy_revision ~ '^[a-f0-9]{64}$'),
 model VARCHAR(120) NOT NULL,
 answer_text TEXT NOT NULL CHECK (char_length(answer_text) BETWEEN 11 AND 1200),
 answer_hash CHAR(64) NOT NULL CHECK (answer_hash ~ '^[a-f0-9]{64}$'),
 evidence_status VARCHAR(40) NOT NULL DEFAULT 'UNVERIFIED_MODEL_KNOWLEDGE'
  CHECK (evidence_status = 'UNVERIFIED_MODEL_KNOWLEDGE'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '7 days')
);
CREATE INDEX IF NOT EXISTS val_shared_knowledge_answers_expiry_idx ON val_shared_knowledge_answers (expires_at);
COMMENT ON TABLE val_shared_knowledge_answers IS 'Shared general AI explanations, unverified; never producer facts, ContextSnapshot, memory, credit, grain intelligence, or recommendations.';
