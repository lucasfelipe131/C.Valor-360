-- Fontes oficiais candidatas encontradas pela pesquisa, para o revisor.
--
-- A pesquisa não responde dúvida regulada: ela encontra onde a resposta pode estar, e uma pessoa
-- abre o endereço, copia o trecho literal e aprova em seu nome. Guardar as candidatas evita que um
-- segundo revisor pague a mesma busca. Só entram endereços em https sob gov.br ou embrapa.br, e só
-- endereço e título: nenhum texto escrito pelo modelo é gravado aqui, para não ser confundido com o
-- conteúdo da fonte.
ALTER TABLE val_knowledge_source_requests
 ADD COLUMN IF NOT EXISTS candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS candidates_researched_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS candidates_researched_by VARCHAR(320);
ALTER TABLE val_knowledge_source_requests
 ADD CONSTRAINT val_knowledge_source_requests_candidates_is_array CHECK (jsonb_typeof(candidates)='array');
