#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pg_bin="${PHASE6_PG_BIN:-/tmp/val-phase3-pg16-root/usr/lib/postgresql/16/bin}"
pg_lib="${PHASE6_PG_LIB:-/tmp/val-phase3-pg16-root/usr/lib/x86_64-linux-gnu}"
fake_user_lib="${PHASE6_FAKE_USER_LIB:-/tmp/val-phase3-pg16-root/lib/libfakepguser.so}"
source_port="${PHASE6_SOURCE_PORT:-55475}"
restore_port="${PHASE6_RESTORE_PORT:-55476}"
evidence_dir="${PHASE6_GATE_EVIDENCE_DIR:?PHASE6_GATE_EVIDENCE_DIR é obrigatório}"
gate_root="$(mktemp -d /tmp/val-phase6-pg16-gate-XXXXXX)"
source_data="$gate_root/source"
restore_data="$gate_root/restore"
backup_file="$evidence_dir/phase6-migrated.dump"
source_evidence="$evidence_dir/source-verification.json"
source_started=0
restore_started=0

mkdir -p "$evidence_dir" "$source_data" "$restore_data"

pg_exec(){
  env LD_LIBRARY_PATH="$pg_lib" LD_PRELOAD="$fake_user_lib" "$@"
}

source_psql(){
  pg_exec "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$source_port" -U postgres "$@"
}

restore_psql(){
  pg_exec "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$restore_port" -U postgres "$@"
}

stop_clusters(){
  if [[ "$restore_started" == 1 ]]; then
    pg_exec "$pg_bin/pg_ctl" -D "$restore_data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  if [[ "$source_started" == 1 ]]; then
    pg_exec "$pg_bin/pg_ctl" -D "$source_data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  case "$gate_root" in
    /tmp/val-phase6-pg16-gate-*) rm -rf "$gate_root" ;;
    *) printf 'Diretório temporário inesperado; limpeza omitida: %s\n' "$gate_root" >&2 ;;
  esac
}
trap stop_clusters EXIT

normalize_schema(){
  sed -E '/^-- Dumped (from|by)/d;/^\\(un)?restrict /d;s/::character varying::text/::character varying/g;s/]::text\[\]/]/g' "$1" > "$2"
}

apply_baseline(){
  local database_name="$1"
  source_psql -d "$database_name" -f "$repository_root/database/schema.sql" > "$evidence_dir/${database_name}-schema.log" 2>&1
  source_psql -d "$database_name" -f "$repository_root/database/migrations/20260820_001_manual_tenant_scope_expand.sql" > "$evidence_dir/${database_name}-migration-001.log" 2>&1
  source_psql -d "$database_name" -f "$repository_root/database/migrations/20260820_002_memory_context_expand.sql" > "$evidence_dir/${database_name}-migration-002.log" 2>&1
  source_psql -d "$database_name" -f "$repository_root/database/migrations/20260822_003_execution_insight_expand.sql" > "$evidence_dir/${database_name}-migration-003.log" 2>&1
}

"$pg_bin/postgres" --version | tee "$evidence_dir/postgres-version.txt"
pg_exec "$pg_bin/initdb" -D "$source_data" --auth=trust --username=postgres --no-locale --encoding=UTF8 > "$evidence_dir/source-initdb.log"
pg_exec "$pg_bin/pg_ctl" -D "$source_data" -l "$evidence_dir/source-postgres.log" -o "-h 127.0.0.1 -p $source_port -c unix_socket_directories=''" -w start
source_started=1

pg_exec "$pg_bin/createdb" -h 127.0.0.1 -p "$source_port" -U postgres phase6_baseline_ref
pg_exec "$pg_bin/createdb" -h 127.0.0.1 -p "$source_port" -U postgres phase6_source
apply_baseline phase6_baseline_ref
apply_baseline phase6_source

pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --schema-only --no-owner --no-privileges phase6_baseline_ref > "$evidence_dir/baseline-ref-schema.sql"
pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --schema-only --no-owner --no-privileges phase6_source > "$evidence_dir/source-pre-migration-schema.sql"
normalize_schema "$evidence_dir/baseline-ref-schema.sql" "$evidence_dir/baseline-ref-schema.normalized.sql"
normalize_schema "$evidence_dir/source-pre-migration-schema.sql" "$evidence_dir/source-pre-migration-schema.normalized.sql"
cmp "$evidence_dir/baseline-ref-schema.normalized.sql" "$evidence_dir/source-pre-migration-schema.normalized.sql"
sha256sum "$evidence_dir/source-pre-migration-schema.normalized.sql" > "$evidence_dir/pre-migration-schema.sha256"

source_psql -d phase6_source <<'SQL' > "$evidence_dir/seed.log"
INSERT INTO organizations (id,name,slug)
VALUES ('00000000-0000-4000-8000-000000000002','Tenant adversarial da Fase 6','phase6-tenant-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id,name,email,status)
VALUES
  ('00000000-0000-4000-8000-000000000601','Consultor Fase 6 A','phase6-a@example.test','active'),
  ('00000000-0000-4000-8000-000000000602','Consultor Fase 6 B','phase6-b@example.test','active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (tenant_id,user_id,role,portfolio_scope)
VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601','consultant','{"scope":"own_portfolio"}'::jsonb),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000602','consultant','{"scope":"own_portfolio"}'::jsonb)
ON CONFLICT (tenant_id,user_id) DO NOTHING;

INSERT INTO clients (id,tenant_id,external_key,consultant_id,name,municipality,total_area_ha,cultures,commercial_profile,relationship_profile,status,source)
VALUES
  ('00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000001','producer-a','00000000-0000-4000-8000-000000000601','Produtor A','Cascavel',620,'Soja e milho','{}'::jsonb,'{}'::jsonb,'active','phase6_fixture'),
  ('00000000-0000-4000-8000-000000000620','00000000-0000-4000-8000-000000000002','producer-b','00000000-0000-4000-8000-000000000602','Produtor B','Toledo',400,'Soja','{}'::jsonb,'{}'::jsonb,'active','phase6_fixture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits (id,tenant_id,client_id,consultant_id,scheduled_at,objective,status,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000611','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-08-23T14:00:00Z','Negociar fertilizante com evidência.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000612','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-08-30T14:00:00Z','Retornar com comparativo e próximo passo.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000613','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','00000000-0000-4000-8000-000000000601','2026-09-15T14:00:00Z','Fixture legado intencional.','Agendada','2026-08-20T12:00:00Z','2026-08-20T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO val_attachments (id,tenant_id,consultant_id,client_id,original_name,mime_type,size_bytes,content_base64,sha256,status,analysis,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000621','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000610','visita.webm','audio/webm',20,'YXVkaW8tZml4dHVyZQ==','f9a6c425d00c188b9ebeeea9a948e342ba337717f95d10ae6207f26a07e0f878','received','{}'::jsonb,'2026-08-23T14:00:00Z','2026-08-23T14:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO val_memories (id,tenant_id,client_id,memory_type,key,value,evidence,confidence,status,source,valid_from,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000631','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000610','fact','legacy.phase6.fixture','{"value":"preserve"}'::jsonb,'[]'::jsonb,80,'verified','legacy_fixture','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
SQL

source_psql -d phase6_source -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > "$evidence_dir/pre-migration-tables.txt"
source_psql -d phase6_source -At -c "SELECT conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||convalidated::text FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname" > "$evidence_dir/pre-migration-constraints.txt"
source_psql -d phase6_source -At -c "SELECT tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname" > "$evidence_dir/pre-migration-indexes.txt"
source_psql -d phase6_source -At -c "SELECT 'clients='||count(*) FROM clients UNION ALL SELECT 'visits='||count(*) FROM visits UNION ALL SELECT 'val_memories='||count(*) FROM val_memories UNION ALL SELECT 'val_attachments='||count(*) FROM val_attachments UNION ALL SELECT 'interactions='||count(*) FROM interactions ORDER BY 1" > "$evidence_dir/pre-migration-counts.txt"
source_psql -d phase6_source -At -c "SELECT md5(string_agg(entity,'|' ORDER BY entity)) FROM (SELECT 'client:'||id::text entity FROM clients UNION ALL SELECT 'visit:'||id::text FROM visits UNION ALL SELECT 'memory:'||id::text FROM val_memories UNION ALL SELECT 'attachment:'||id::text FROM val_attachments) ids" > "$evidence_dir/pre-migration-id-hash.txt"

if grep -Ein '^[[:space:]]*(UPDATE[[:space:]]|DELETE[[:space:]]|TRUNCATE[[:space:]]|DROP[[:space:]]|ALTER[[:space:]]+TABLE.+(DROP[[:space:]]|RENAME[[:space:]]|ALTER[[:space:]]+COLUMN))' "$repository_root/database/migrations/20260823_004_visit_learning_loop_expand.sql" > "$evidence_dir/expand-only-violations.txt"; then
  printf 'A migration 004 contém operação não expand-only.\n' >&2
  exit 1
fi

source_psql -d phase6_source -f "$repository_root/database/migrations/20260823_004_visit_learning_loop_expand.sql" > "$evidence_dir/migration-004-first.log" 2>&1
source_psql -d phase6_source -At -c "SELECT 'clients='||count(*) FROM clients UNION ALL SELECT 'visits='||count(*) FROM visits UNION ALL SELECT 'val_memories='||count(*) FROM val_memories UNION ALL SELECT 'val_attachments='||count(*) FROM val_attachments UNION ALL SELECT 'interactions='||count(*) FROM interactions ORDER BY 1" > "$evidence_dir/post-migration-pre-runtime-counts.txt"
source_psql -d phase6_source -At -c "SELECT md5(string_agg(entity,'|' ORDER BY entity)) FROM (SELECT 'client:'||id::text entity FROM clients UNION ALL SELECT 'visit:'||id::text FROM visits UNION ALL SELECT 'memory:'||id::text FROM val_memories UNION ALL SELECT 'attachment:'||id::text FROM val_attachments) ids" > "$evidence_dir/post-migration-pre-runtime-id-hash.txt"
cmp "$evidence_dir/pre-migration-counts.txt" "$evidence_dir/post-migration-pre-runtime-counts.txt"
cmp "$evidence_dir/pre-migration-id-hash.txt" "$evidence_dir/post-migration-pre-runtime-id-hash.txt"

pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --schema-only --no-owner --no-privileges phase6_source > "$evidence_dir/post-migration-first-schema.sql"
normalize_schema "$evidence_dir/post-migration-first-schema.sql" "$evidence_dir/post-migration-first-schema.normalized.sql"
source_psql -d phase6_source -f "$repository_root/database/migrations/20260823_004_visit_learning_loop_expand.sql" > "$evidence_dir/migration-004-second.log" 2>&1
pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --schema-only --no-owner --no-privileges phase6_source > "$evidence_dir/post-migration-second-schema.sql"
normalize_schema "$evidence_dir/post-migration-second-schema.sql" "$evidence_dir/post-migration-second-schema.normalized.sql"
cmp "$evidence_dir/post-migration-first-schema.normalized.sql" "$evidence_dir/post-migration-second-schema.normalized.sql"
sha256sum "$evidence_dir/post-migration-second-schema.normalized.sql" > "$evidence_dir/post-migration-schema.sha256"

DATABASE_URL="postgresql://postgres@127.0.0.1:$source_port/phase6_source" PHASE6_VERIFY_MODE=source PHASE6_EVIDENCE_FILE="$source_evidence" node "$repository_root/scripts/phase6-postgres-verify.mjs" | tee "$evidence_dir/source-runtime-verification.log"

source_psql -d phase6_source -At -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > "$evidence_dir/post-runtime-tables.txt"
source_psql -d phase6_source -At -c "SELECT conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||convalidated::text FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname" > "$evidence_dir/post-runtime-constraints.txt"
source_psql -d phase6_source -At -c "SELECT tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname" > "$evidence_dir/post-runtime-indexes.txt"

pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --format=custom --no-owner --no-privileges --file="$backup_file" phase6_source
sha256sum "$backup_file" > "$evidence_dir/backup.sha256"
pg_exec "$pg_bin/pg_restore" --list "$backup_file" > "$evidence_dir/backup-contents.txt"

pg_exec "$pg_bin/initdb" -D "$restore_data" --auth=trust --username=postgres --no-locale --encoding=UTF8 > "$evidence_dir/restore-initdb.log"
pg_exec "$pg_bin/pg_ctl" -D "$restore_data" -l "$evidence_dir/restore-postgres.log" -o "-h 127.0.0.1 -p $restore_port -c unix_socket_directories=''" -w start
restore_started=1
pg_exec "$pg_bin/createdb" -h 127.0.0.1 -p "$restore_port" -U postgres phase6_restore
pg_exec "$pg_bin/pg_restore" -h 127.0.0.1 -p "$restore_port" -U postgres --exit-on-error --no-owner --no-privileges -d phase6_restore "$backup_file" > "$evidence_dir/restore.log"

DATABASE_URL="postgresql://postgres@127.0.0.1:$restore_port/phase6_restore" PHASE6_VERIFY_MODE=restore PHASE6_EVIDENCE_FILE="$source_evidence" PHASE6_RESTORE_EVIDENCE_FILE="$evidence_dir/restore-catalog.json" node "$repository_root/scripts/phase6-postgres-verify.mjs" | tee "$evidence_dir/restore-runtime-verification.log"

pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$source_port" -U postgres --schema-only --no-owner --no-privileges phase6_source > "$evidence_dir/source-final-schema.sql"
pg_exec "$pg_bin/pg_dump" -h 127.0.0.1 -p "$restore_port" -U postgres --schema-only --no-owner --no-privileges phase6_restore > "$evidence_dir/restore-final-schema.sql"
normalize_schema "$evidence_dir/source-final-schema.sql" "$evidence_dir/source-final-schema.normalized.sql"
normalize_schema "$evidence_dir/restore-final-schema.sql" "$evidence_dir/restore-final-schema.normalized.sql"
diff -u "$evidence_dir/source-final-schema.normalized.sql" "$evidence_dir/restore-final-schema.normalized.sql" > "$evidence_dir/source-restore-schema-rendering.diff" || true
sha256sum "$evidence_dir/source-final-schema.normalized.sql" "$evidence_dir/restore-final-schema.normalized.sql" > "$evidence_dir/source-restore-schema-rendering.sha256"
restore_psql -d phase6_restore -At -c "SELECT 'visits='||count(*) FROM visits UNION ALL SELECT 'reports='||count(*) FROM val_visit_reports UNION ALL SELECT 'transcripts='||count(*) FROM val_visit_transcripts UNION ALL SELECT 'commitments='||count(*) FROM val_commitments UNION ALL SELECT 'outcomes='||count(*) FROM val_outcomes UNION ALL SELECT 'learning_candidates='||count(*) FROM val_learning_candidates ORDER BY 1" > "$evidence_dir/restore-essential-counts.txt"

printf 'PHASE6_POSTGRES_GATE_OK evidence=%s\n' "$evidence_dir"
