import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/access";
import { ensureRecordsSchema } from "../../../../lib/db";
import {
  publishManualRecordToValor,
  publishWorkspaceToValor,
  valor360Configured,
} from "../../../../lib/valor360";
import { authenticatedValor360OwnerForWorkspace } from "../../../../lib/valor360-workspace-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceId(request: NextRequest, fallback: string) {
  const current = request.cookies.get("mp_workspace")?.value;
  return /^[0-9a-f-]{36}$/i.test(current ?? "") ? current! : fallback;
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session) {
    return NextResponse.json(
      { error: "Somente a administração pode sincronizar o histórico completo." },
      { status: 403 },
    );
  }
  const workspace = workspaceId(request, session.user.id);
  const valor360OwnerId = authenticatedValor360OwnerForWorkspace(session, workspace);
  if (!valor360OwnerId) {
    return NextResponse.json(
      {
        error: "Entre no workspace do titular antes de sincronizar o histórico com o VALOR 360.",
        code: "valor360_workspace_owner_not_authenticated",
      },
      { status: 403 },
    );
  }
  if (!valor360Configured()) {
    return NextResponse.json(
      { error: "A integração com o VALOR 360 ainda não foi configurada." },
      { status: 503 },
    );
  }

  try {
    const pool = await ensureRecordsSchema();
    const records = await pool.query(
      `SELECT id, record_type AS type, title,
              producer_name AS "producerName", payload,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM app_records
       WHERE tenant_id = $1 AND workspace_id = $2
       ORDER BY updated_at DESC
       LIMIT 1000`,
      [session.tenantId, workspace],
    );
    let producers: unknown[] = [];
    let soilAnalyses: unknown[] = [];
    try {
      const snapshot = await pool.query(
        `SELECT producers, soil_analyses AS "soilAnalyses"
         FROM app_workspace_data
         WHERE tenant_id = $1 AND workspace_id = $2
         LIMIT 1`,
        [session.tenantId, workspace],
      );
      producers = Array.isArray(snapshot.rows[0]?.producers)
        ? snapshot.rows[0].producers
        : [];
      soilAnalyses = Array.isArray(snapshot.rows[0]?.soilAnalyses)
        ? snapshot.rows[0].soilAnalyses
        : [];
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01") throw error;
    }

    const workspaceResult = await publishWorkspaceToValor(
      producers,
      soilAnalyses,
      valor360OwnerId,
      request.headers.get("x-request-id") ?? "",
    );
    const recordResults = [];
    const concurrency = 6;
    for (let index = 0; index < records.rows.length; index += concurrency) {
      const batch = records.rows.slice(index, index + concurrency);
      const results = await Promise.all(
        batch.map((record) => publishManualRecordToValor(
          record,
          valor360OwnerId,
          request.headers.get("x-request-id") ?? "",
        )),
      );
      recordResults.push(...results.flat());
    }

    const recordSummary = {
      attempted: recordResults.length,
      delivered: recordResults.filter((item) => item.ok).length,
      failed: recordResults.filter((item) => !item.ok && !item.skipped).length,
      skipped: recordResults.filter((item) => item.skipped).length,
      truncated: records.rows.length >= 1000,
      errors: recordResults
        .filter((item) => !item.ok && !item.skipped)
        .slice(0, 5)
        .map((item) => ({
          eventType: item.eventType,
          externalId: item.externalId,
          status: item.status ?? null,
          error: item.error ?? "Falha de integração não detalhada.",
        })),
    };
    const partial = !workspaceResult.configured ||
      workspaceResult.failed > 0 ||
      workspaceResult.skipped > 0 ||
      workspaceResult.truncated ||
      recordSummary.failed > 0 ||
      recordSummary.skipped > 0 ||
      recordSummary.truncated;
    return NextResponse.json({
      synchronized: !partial,
      partial,
      workspace: workspaceResult,
      records: recordSummary,
    }, { status: partial ? 207 : 200 });
  } catch (error) {
    console.error("valor360:sync", error);
    return NextResponse.json(
      { error: "Não foi possível concluir a sincronização com o VALOR 360." },
      { status: 500 },
    );
  }
}
