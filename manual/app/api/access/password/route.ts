import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccessSchema,
  hashPassword,
  recordUsage,
  sessionFromRequest,
  verifyPassword,
} from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9]{8}$/.test(newPassword)) {
      return NextResponse.json(
        { error: "Use exatamente 8 caracteres, com ao menos uma letra maiúscula, uma minúscula e um número." },
        { status: 400 },
      );
    }
    const pool = await ensureAccessSchema();
    const result = await pool.query(`SELECT password_hash FROM app_users WHERE id = $1`, [session.user.id]);
    if (!result.rows[0] || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
      return NextResponse.json({ error: "A senha atual não confere." }, { status: 400 });
    }
    await pool.query(
      `UPDATE app_users
       SET password_hash = $1,
           must_change_password = FALSE,
           invitation_token_hash = NULL,
           invitation_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [await hashPassword(newPassword), session.user.id],
    );
    await recordUsage(session.user.id, session.sessionId, "password_changed");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("access:password", error);
    return NextResponse.json({ error: "Não foi possível alterar a senha." }, { status: 500 });
  }
}
