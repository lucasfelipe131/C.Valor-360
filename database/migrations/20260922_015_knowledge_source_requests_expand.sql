-- Fila de dúvidas que a VAL não respondeu, para virarem fonte aprovada.
--
-- knowledgeLifecycleStates existe em server/knowledge/policy.js desde a primeira versão da
-- Biblioteca e nunca teve produtor: o acervo é corpus versionado, somente leitura. Esta tabela é o
-- produtor que faltava — a dúvida sem cobertura entra como rascunho em vez de morrer no texto de
-- recusa que mandava o consultor pesquisar sozinho.
--
-- Diferente de val_shared_knowledge_answers, que é compartilhada entre tenants e por isso guarda só
-- o hash da pergunta, esta fila é lida por uma pessoa que precisa entender o que foi perguntado.
-- Por isso a pergunta é gravada em texto — e por isso ela é escopada por tenant e só aceita o
-- caminho geral do copiloto: sem produtor selecionado, sem memória privada, sem conversa.
CREATE TABLE IF NOT EXISTS val_knowledge_source_requests (
 tenant_id UUID NOT NULL,
 request_key CHAR(32) NOT NULL CHECK (request_key ~ '^[a-f0-9]{32}$'),
 domain VARCHAR(40) NOT NULL,
 reason VARCHAR(40) NOT NULL CHECK (reason IN ('REGULATED_SOURCE_REQUIRED','LIBRARY_NO_COVERAGE')),
 question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
 status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
  CHECK (status IN ('DRAFT','UNDER_REVIEW','APPROVED','REJECTED','SUPERSEDED','EXPIRED')),
 asked_count INTEGER NOT NULL DEFAULT 1 CHECK (asked_count > 0),
 asked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
 source JSONB,
 approved_by VARCHAR(320),
 approved_at TIMESTAMPTZ,
 rejection_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,request_key),
 -- Quem aprova responde tecnicamente pela resposta que a VAL passa a dar. O banco recusa uma
 -- aprovação sem fonte e sem dono para que nenhum caminho de escrita futuro possa criar uma
 -- afirmação de bula anônima.
 CONSTRAINT val_knowledge_source_requests_approved_has_owner
  CHECK (status <> 'APPROVED' OR (source IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CONSTRAINT val_knowledge_source_requests_rejected_has_reason
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS val_knowledge_source_requests_queue_idx
 ON val_knowledge_source_requests (tenant_id,status,asked_count DESC,last_asked_at DESC);
COMMENT ON TABLE val_knowledge_source_requests IS 'Dúvidas gerais sem fonte aprovada, aguardando revisão humana. Nunca contém produtor, memória privada, conversa, crédito ou recomendação.';
