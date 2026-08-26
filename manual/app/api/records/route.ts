import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ensureRecordsSchema, hasDatabase } from "../../lib/db";
import { sessionFromRequest } from "../../lib/access";
import { publishManualRecordToValor, valor360Configured } from "../../lib/valor360";
import { authenticatedValor360OwnerForWorkspace } from "../../lib/valor360-workspace-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recordTypes = new Set([
  "quote",
  "soil_analysis",
  "spray_recommendation",
  "fertilizer_comparison",
  "season_report",
  "field_analysis",
  "calculator",
  "crm_import",
  "producer_change",
  "land_registry",
  "system_change",
]);

function workspaceId(request: NextRequest, user: { id: string; role: string }) {
  if (user.role !== "admin") return user.id;
  const current = request.cookies.get("mp_workspace")?.value;
  return /^[0-9a-f-]{36}$/i.test(current ?? "") ? current! : user.id;
}

function withWorkspaceCookie(
  response: NextResponse,
  request: NextRequest,
  workspace: string,
) {
  if (!request.cookies.get("mp_workspace")?.value) {
    response.cookies.set("mp_workspace", workspace, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 3,
    });
  }
  return response;
}

function unavailable() {
  return NextResponse.json(
    {
      error:
        "Banco PostgreSQL ainda não está conectado. Configure DATABASE_URL na Railway.",
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  if (!hasDatabase()) return unavailable();
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }
  const workspace = workspaceId(request, session.user);
  const type = request.nextUrl.searchParams.get("type") ?? "";
  try {
    const pool = await ensureRecordsSchema();
    const params: string[] = [session.tenantId, workspace];
    let filter = "";
    if (type && recordTypes.has(type)) {
      params.push(type);
      filter = " AND record_type = $3";
    }
    const result = await pool.query(
      `SELECT id, record_type AS type, title, producer_name AS "producerName",
              payload, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM app_records
       WHERE tenant_id = $1 AND workspace_id = $2${filter}
       ORDER BY updated_at DESC
       LIMIT 250`,
      params,
    );
    return withWorkspaceCookie(
      NextResponse.json({ records: result.rows, storage: "postgresql" }),
      request,
      workspace,
    );
  } catch (error) {
    console.error("records:get", error);
    return NextResponse.json(
      { error: "Não foi possível consultar os registros salvos." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!hasDatabase()) return unavailable();
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }
  const workspace = workspaceId(request, session.user);
  const valor360OwnerId = authenticatedValor360OwnerForWorkspace(session, workspace);
  try {
    const body = (await request.json()) as {
      id?: string;
      type?: string;
      title?: string;
      producerName?: string;
      payload?: unknown;
    };
    if (!body.type || !recordTypes.has(body.type)) {
      return NextResponse.json({ error: "Tipo de registro inválido." }, { status: 400 });
    }
    if (!body.payload || typeof body.payload !== "object") {
      return NextResponse.json({ error: "Conteúdo do registro inválido." }, { status: 400 });
    }
    const id = /^[0-9a-f-]{36}$/i.test(body.id ?? "") ? body.id! : randomUUID();
    const pool = await ensureRecordsSchema();
    const result = await pool.query(
      `INSERT INTO app_records
        (id, tenant_id, workspace_id, record_type, title, producer_name, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         producer_name = EXCLUDED.producer_name,
         payload = EXCLUDED.payload,
         updated_at = NOW()
       WHERE app_records.tenant_id = EXCLUDED.tenant_id
         AND app_records.workspace_id = EXCLUDED.workspace_id
       RETURNING id, record_type AS type, title,
                 producer_name AS "producerName", payload,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        session.tenantId,
        workspace,
        body.type,
        String(body.title ?? "").slice(0, 240),
        String(body.producerName ?? "").slice(0, 180),
        JSON.stringify(body.payload),
      ],
    );
    if (!result.rows[0]) {
      return NextResponse.json(
        { error: "Este registro pertence a outro espaço de trabalho." },
        { status: 409 },
      );
    }
    const record = result.rows[0];
    const integration = valor360OwnerId
      ? await publishManualRecordToValor(
          record,
          valor360OwnerId,
          request.headers.get("x-request-id") ?? "",
        )
      : [{
          ok: false,
          skipped: true,
          eventType: "workspace.owner_validation",
          externalId: record.id,
          status: 403,
          error: "valor360_workspace_owner_not_authenticated",
        }];
    const integrationSummary = {
      configured: valor360Configured(),
      delivered: integration.filter((item) => item.ok).length,
      failed: integration.filter((item) => !item.ok && !item.skipped).length,
      skipped: integration.filter((item) => item.skipped).length,
      blockedCode: valor360OwnerId ? null : "valor360_workspace_owner_not_authenticated",
      errors: integration
        .filter((item) => !item.ok && !item.skipped)
        .slice(0, 5)
        .map((item) => ({
          eventType: item.eventType,
          externalId: item.externalId,
          status: item.status ?? null,
          error: item.error ?? "Falha de integração não detalhada.",
        })),
    };
    const integrationNeedsAttention = !integrationSummary.configured ||
      integrationSummary.failed > 0 ||
      integrationSummary.skipped > 0;
    return withWorkspaceCookie(
      NextResponse.json({
        record,
        storage: "postgresql",
        integration: integrationSummary,
      }, { status: integrationNeedsAttention ? 207 : 200 }),
      request,
      workspace,
    );
  } catch (error) {
    console.error("records:post", error);
    return NextResponse.json(
      { error: "Não foi possível salvar o registro no banco." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasDatabase()) return unavailable();
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Registro inválido." }, { status: 400 });
  }
  const workspace = workspaceId(request, session.user);
  try {
    const pool = await ensureRecordsSchema();
    const result = await pool.query(
      "DELETE FROM app_records WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 RETURNING id",
      [id, session.tenantId, workspace],
    );
    return withWorkspaceCookie(
      NextResponse.json({ deleted: Boolean(result.rowCount), id }),
      request,
      workspace,
    );
  } catch (error) {
    console.error("records:delete", error);
    return NextResponse.json(
      { error: "Não foi possível excluir o registro da conta." },
      { status: 500 },
    );
  }
}
