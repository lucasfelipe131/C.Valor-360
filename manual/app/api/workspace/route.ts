import { NextRequest, NextResponse } from "next/server";
import { ensureAccessSchema, sessionFromRequest } from "../../lib/access";
import { publishWorkspaceToValor } from "../../lib/valor360";
import { authenticatedValor360OwnerForWorkspace } from "../../lib/valor360-workspace-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let workspaceSchemaReady: Promise<void> | undefined;

async function ensureWorkspaceSchema() {
  const pool = await ensureAccessSchema();
  if (!workspaceSchemaReady) {
    workspaceSchemaReady = pool.query(
      "CREATE TABLE IF NOT EXISTS app_workspace_data (" +
        "workspace_id UUID PRIMARY KEY," +
        "tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid," +
        "producers JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "soil_analyses JSONB NOT NULL DEFAULT '[]'::jsonb," +
        "professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb," +
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ");" +
      "ALTER TABLE app_workspace_data ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;" +
      "ALTER TABLE app_workspace_data ADD COLUMN IF NOT EXISTS professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb;",
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
      'SELECT producers, soil_analyses AS "soilAnalyses", professional_profile AS "professionalProfile", updated_at AS "updatedAt" ' +
      "FROM app_workspace_data WHERE tenant_id = $1 AND workspace_id = $2 LIMIT 1",
      [session.tenantId, session.user.id],
    );
    const row = result.rows[0];
    return noStore(NextResponse.json({
      producers: Array.isArray(row?.producers) ? row.producers : [],
      soilAnalyses: Array.isArray(row?.soilAnalyses) ? row.soilAnalyses : [],
      professionalProfile: row?.professionalProfile && typeof row.professionalProfile === "object" && !Array.isArray(row.professionalProfile) ? row.professionalProfile : {},
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
    const valor360OwnerId = authenticatedValor360OwnerForWorkspace(session, session.user.id);
    if (!valor360OwnerId) {
      return NextResponse.json(
        { error: "A identidade deste workspace não foi validada para sincronização.", code: "valor360_workspace_owner_not_authenticated" },
        { status: 403 },
      );
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "A base excedeu o limite de 12 MB por sincronização." }, { status: 413 });
    }
    const body = JSON.parse(raw) as { producers?: unknown; soilAnalyses?: unknown; professionalProfile?: unknown };
    if (!Array.isArray(body.producers) || !Array.isArray(body.soilAnalyses) || !body.professionalProfile || typeof body.professionalProfile !== "object" || Array.isArray(body.professionalProfile)) {
      return NextResponse.json({ error: "Formato de backup inválido." }, { status: 400 });
    }
    if (body.producers.length > 5000 || body.soilAnalyses.length > 2500) {
      return NextResponse.json({ error: "Quantidade de registros acima do limite de segurança." }, { status: 413 });
    }
    const pool = await ensureWorkspaceSchema();
    const result = await pool.query(
      "INSERT INTO app_workspace_data (tenant_id, workspace_id, producers, soil_analyses, professional_profile) " +
      "VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) " +
      "ON CONFLICT (workspace_id) DO UPDATE SET " +
      "producers = EXCLUDED.producers, soil_analyses = EXCLUDED.soil_analyses, professional_profile = EXCLUDED.professional_profile, updated_at = NOW() " +
      "WHERE app_workspace_data.tenant_id = EXCLUDED.tenant_id " +
      'RETURNING updated_at AS "updatedAt"',
      [session.tenantId, session.user.id, JSON.stringify(body.producers), JSON.stringify(body.soilAnalyses), JSON.stringify(body.professionalProfile)],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Este workspace pertence a outra organização." }, { status: 409 });
    const integration = await publishWorkspaceToValor(
      body.producers,
      body.soilAnalyses,
      valor360OwnerId,
      request.headers.get("x-request-id") ?? "",
    );
    const integrationNeedsAttention = !integration.configured ||
      integration.failed > 0 ||
      integration.skipped > 0 ||
      integration.truncated;
    return noStore(NextResponse.json({
      saved: true,
      updatedAt: result.rows[0]?.updatedAt ?? new Date().toISOString(),
      storage: "postgresql",
      integration,
    }, { status: integrationNeedsAttention ? 207 : 200 }));
  } catch (error) {
    console.error("workspace:put", error);
    return NextResponse.json({ error: "Não foi possível salvar o backup da conta." }, { status: 500 });
  }
}
