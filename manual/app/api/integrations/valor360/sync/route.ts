import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/access";
import { ensureRecordsSchema } from "../../../../lib/db";
import {
  publishManualRecordToValor,
  publishWorkspaceToValor,
  valor360Configured,
} from "../../../../lib/valor360";

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
  if (!valor360Configured()) {
    return NextResponse.json(
      { error: "A integração com o VALOR 360 ainda não foi configurada." },
      { status: 503 },
    );
  }

  try {
    const pool = await ensureRecordsSchema();
    const workspace = workspaceId(request, session.user.id);
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
      session.valor360OwnerId ?? session.user.id,
      request.headers.get("x-request-id") ?? "",
    );
    const recordResults = [];
    const concurrency = 6;
    for (let index = 0; index < records.rows.length; index += concurrency) {
      const batch = records.rows.slice(index, index + concurrency);
      const results = await Promise.all(
        batch.map((record) => publishManualRecordToValor(
          record,
          session.valor360OwnerId ?? session.user.id,
          request.headers.get("x-request-id") ?? "",
        )),
      );
      recordResults.push(...results.flat());
    }

    return NextResponse.json({
      synchronized: true,
      workspace: workspaceResult,
      records: {
        attempted: recordResults.length,
        delivered: recordResults.filter((item) => item.ok).length,
        failed: recordResults.filter((item) => !item.ok && !item.skipped).length,
        skipped: recordResults.filter((item) => item.skipped).length,
        truncated: records.rows.length >= 1000,
      },
    });
  } catch (error) {
    console.error("valor360:sync", error);
    return NextResponse.json(
      { error: "Não foi possível concluir a sincronização com o VALOR 360." },
      { status: 500 },
    );
  }
}
