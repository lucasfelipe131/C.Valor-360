import { NextRequest, NextResponse } from "next/server";
import { ensureAccessSchema, sessionFromRequest } from "../../lib/access";
import { publishWorkspaceToValor } from "../../lib/valor360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let workspaceSchemaReady: Promise<void> | undefined;

async function ensureWorkspaceSchema() {
  const pool = await ensureAccessSchema();
  if (!workspaceSchemaReady) {
    workspaceSchemaReady = pool.query(
      "CREATE TABLE IF NOT EXISTS app_workspace_data (" +
        "workspace_id UUID PRIMARY KEY," +
        "producers JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "soil_analyses JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ");",
    ).then(() => undefined).catch((error) => {
      workspaceSchemaReady = undefined;
      throw error;
    });
  }
  await workspaceSchemaReady;
  return pool;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const pool = await ensureWorkspaceSchema();
    const result = await pool.query(
      'SELECT producers, soil_analyses AS "soilAnalyses", updated_at AS "updatedAt" ' +
      "FROM app_workspace_data WHERE workspace_id = $1 LIMIT 1",
      [session.user.id],
    );
    const row = result.rows[0];
    return noStore(NextResponse.json({
      producers: Array.isArray(row?.producers) ? row.producers : [],
      soilAnalyses: Array.isArray(row?.soilAnalyses) ? row.soilAnalyses : [],
      updatedAt: row?.updatedAt ?? null,
      hasData: Boolean(row),
      storage: "postgresql",
    }));
  } catch (error) {
    console.error("workspace:get", error);
    return NextResponse.json({ error: "Não foi possível carregar o backup da conta." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "A base excedeu o limite de 12 MB por sincronização." }, { status: 413 });
    }
    const body = JSON.parse(raw) as { producers?: unknown; soilAnalyses?: unknown };
    if (!Array.isArray(body.producers) || !Array.isArray(body.soilAnalyses)) {
      return NextResponse.json({ error: "Formato de backup inválido." }, { status: 400 });
    }
    if (body.producers.length > 5000 || body.soilAnalyses.length > 2500) {
      return NextResponse.json({ error: "Quantidade de registros acima do limite de segurança." }, { status: 413 });
    }
    const pool = await ensureWorkspaceSchema();
    const result = await pool.query(
      "INSERT INTO app_workspace_data (workspace_id, producers, soil_analyses) " +
      "VALUES ($1, $2::jsonb, $3::jsonb) " +
      "ON CONFLICT (workspace_id) DO UPDATE SET " +
      "producers = EXCLUDED.producers, soil_analyses = EXCLUDED.soil_analyses, updated_at = NOW() " +
      'RETURNING updated_at AS "updatedAt"',
      [session.user.id, JSON.stringify(body.producers), JSON.stringify(body.soilAnalyses)],
    );
    const integration = await publishWorkspaceToValor(
      body.producers,
      body.soilAnalyses,
      session.valor360OwnerId ?? session.user.id,
    );
    return noStore(NextResponse.json({
      saved: true,
      updatedAt: result.rows[0]?.updatedAt ?? new Date().toISOString(),
      storage: "postgresql",
      integration,
    }));
  } catch (error) {
    console.error("workspace:put", error);
    return NextResponse.json({ error: "Não foi possível salvar o backup da conta." }, { status: 500 });
  }
}
