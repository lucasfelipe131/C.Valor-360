import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureFeedbackSchema,
  recordUsage,
  sessionFromRequest,
} from "../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categories = new Set(["suggestion", "problem"]);
const statuses = new Set(["open", "in_progress", "resolved"]);

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const pool = await ensureFeedbackSchema();
    const isAdmin = session.user.role === "admin";
    const result = await pool.query(
      `SELECT f.id, f.category, f.module_key AS module, f.title, f.message,
              f.status, f.admin_note AS "adminNote",
              f.created_at AS "createdAt", f.updated_at AS "updatedAt",
              u.id AS "userId", u.display_name AS "displayName", u.email
       FROM app_feedback f
       JOIN app_users u ON u.id = f.user_id
       WHERE f.tenant_id = $1
         AND ($2::boolean OR f.user_id = $3)
       ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                f.created_at DESC
       LIMIT 250`,
      [session.tenantId, isAdmin, session.user.id],
    );
    return NextResponse.json({ feedback: result.rows });
  } catch (error) {
    console.error("feedback:get", error);
    return NextResponse.json({ error: "Não foi possível consultar os feedbacks." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const body = (await request.json()) as {
      category?: string;
      module?: string;
      title?: string;
      message?: string;
    };
    const category = String(body.category ?? "");
    const moduleKey = String(body.module ?? "").trim().slice(0, 80);
    const title = String(body.title ?? "").trim().slice(0, 180);
    const message = String(body.message ?? "").trim().slice(0, 5000);
    if (!categories.has(category) || !title || message.length < 10) {
      return NextResponse.json(
        { error: "Informe o tipo, um título e uma descrição com pelo menos 10 caracteres." },
        { status: 400 },
      );
    }
    const pool = await ensureFeedbackSchema();
    const result = await pool.query(
      `INSERT INTO app_feedback (id, tenant_id, user_id, category, module_key, title, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, category, module_key AS module, title, message, status,
                 admin_note AS "adminNote", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [randomUUID(), session.tenantId, session.user.id, category, moduleKey, title, message],
    );
    await recordUsage(session.user.id, session.sessionId, "feedback_submitted", "feedback", {
      category,
      module: moduleKey,
    }, session.tenantId);
    return NextResponse.json({ feedback: result.rows[0] });
  } catch (error) {
    console.error("feedback:post", error);
    return NextResponse.json({ error: "Não foi possível enviar o feedback." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    }
    const body = (await request.json()) as { id?: string; status?: string; adminNote?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.id ?? "") || !statuses.has(String(body.status ?? ""))) {
      return NextResponse.json({ error: "Atualização inválida." }, { status: 400 });
    }
    const pool = await ensureFeedbackSchema();
    const result = await pool.query(
      `UPDATE app_feedback
       SET status = $1,
           admin_note = $2,
           updated_at = NOW(),
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE NULL END
       WHERE id = $3 AND tenant_id = $4
       RETURNING id, category, module_key AS module, title, message, status,
                 admin_note AS "adminNote", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [String(body.status), String(body.adminNote ?? "").trim().slice(0, 2000), body.id, session.tenantId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Feedback não encontrado." }, { status: 404 });
    await recordUsage(session.user.id, session.sessionId, "feedback_updated", "administracao", {
      feedbackId: body.id,
      status: body.status,
    }, session.tenantId);
    return NextResponse.json({ feedback: result.rows[0] });
  } catch (error) {
    console.error("feedback:patch", error);
    return NextResponse.json({ error: "Não foi possível atualizar o feedback." }, { status: 500 });
  }
}
