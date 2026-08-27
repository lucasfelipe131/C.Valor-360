import { Pool } from "pg";
import { manualTenantId } from "./tenant";

const globalDatabase = globalThis as typeof globalThis & {
  manualAgronomoPool?: Pool;
  manualAgronomoSchemaReady?: Promise<void>;
};

function databaseUrl() {
  return process.env.DATABASE_URL?.trim() ?? "";
}

export function hasDatabase() {
  return Boolean(databaseUrl());
}

export function getPool() {
  const connectionString = databaseUrl();
  if (!connectionString) return null;
  if (!globalDatabase.manualAgronomoPool) {
    const internalRailway = connectionString.includes(".railway.internal");
    globalDatabase.manualAgronomoPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: internalRailway ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalDatabase.manualAgronomoPool;
}

export async function ensureRecordsSchema() {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL não configurada");
  if (!globalDatabase.manualAgronomoSchemaReady) {
    globalDatabase.manualAgronomoSchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS app_records (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL DEFAULT '${manualTenantId()}'::uuid,
          workspace_id UUID NOT NULL,
          record_type TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          producer_name TEXT NOT NULL DEFAULT '',
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE app_records ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${manualTenantId()}'::uuid;
        CREATE INDEX IF NOT EXISTS app_records_workspace_type_updated
          ON app_records (workspace_id, record_type, updated_at DESC);
        CREATE INDEX IF NOT EXISTS app_records_tenant_workspace_updated
          ON app_records (tenant_id, workspace_id, updated_at DESC);
      `)
      .then(() => undefined)
      .catch((error) => {
        globalDatabase.manualAgronomoSchemaReady = undefined;
        throw error;
      });
  }
  await globalDatabase.manualAgronomoSchemaReady;
  return pool;
}
