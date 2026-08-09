import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  ensureAccessSchema,
  normalizeEmail,
  normalizeUsername,
  recordUsage,
  setSessionCookie,
  verifyPassword,
} from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const login = String(body.username ?? "").trim();
    const username = normalizeUsername(login);
    const email = normalizeEmail(login);
    const password = String(body.password ?? "");
    if (!login || !password) {
      return NextResponse.json({ error: "Informe o usuário ou e-mail e a senha." }, { status: 400 });
    }
    const pool = await ensureAccessSchema();
    const result = await pool.query(
      `SELECT id, username, email, display_name AS "displayName", role, status,
              expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
              invitation_sent_at AS "invitationSentAt",
              invitation_expires_at AS "invitationExpiresAt",
              must_change_password AS "mustChangePassword",
              last_login_at AS "lastLoginAt", password_hash
       FROM app_users
       WHERE username = $1 OR LOWER(email) = $2
       LIMIT 1`,
      [username, email],
    );
    const row = result.rows[0];
    const valid = row ? await verifyPassword(password, String(row.password_hash)) : false;
    if (!row || !valid) {
      return NextResponse.json({ error: "Usuário/e-mail ou senha inválidos." }, { status: 401 });
    }
    if (row.role !== "admin" && row.email && !row.emailVerifiedAt) {
      return NextResponse.json({ error: "Confirme sua identidade pelo link enviado ao e-mail antes de entrar." }, { status: 403 });
    }
    if (
      row.mustChangePassword
      && row.emailVerifiedAt
      && row.invitationExpiresAt
      && new Date(row.invitationExpiresAt).getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: "A senha temporária expirou. Solicite uma nova ao administrador." }, { status: 403 });
    }
    if (row.status !== "active") {
      return NextResponse.json({ error: "Este acesso está bloqueado pelo administrador." }, { status: 403 });
    }
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Este acesso de avaliação expirou." }, { status: 403 });
    }
    const session = await createSession(String(row.id), request.headers.get("user-agent") ?? "");
    await pool.query(`UPDATE app_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
    await recordUsage(String(row.id), session.sessionId, "login");
    const response = NextResponse.json({
      user: {
        id: String(row.id),
        username: row.username,
        email: row.email ?? null,
        displayName: row.displayName,
        role: row.role,
        status: row.status,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        emailVerifiedAt: row.emailVerifiedAt ? new Date(row.emailVerifiedAt).toISOString() : null,
        invitationSentAt: row.invitationSentAt ? new Date(row.invitationSentAt).toISOString() : null,
        invitationExpiresAt: row.invitationExpiresAt ? new Date(row.invitationExpiresAt).toISOString() : null,
        mustChangePassword: Boolean(row.mustChangePassword),
        lastLoginAt: new Date().toISOString(),
      },
    });
    return setSessionCookie(response, session);
  } catch (error) {
    console.error("access:login", error);
    return NextResponse.json({ error: "Não foi possível validar o acesso agora." }, { status: 500 });
  }
}
