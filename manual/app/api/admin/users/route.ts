import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createEmailConfirmation,
  ensureAccessSchema,
  generateTemporaryPassword,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeUsername,
  recordUsage,
  requireAdmin,
} from "../../../lib/access";
import { accessEmailConfigured, sendAccessEmail } from "../../../lib/access-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(request: NextRequest) {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn("admin:users:invalid-app-public-url");
    }
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProtocol || "https"}://${forwardedHost}`;
  return request.nextUrl.origin;
}

function emailError(error: unknown) {
  if (error instanceof Error && error.message === "ACCESS_EMAIL_NOT_CONFIGURED") {
    return "O envio de e-mail ainda não está configurado na Railway.";
  }
  return "O acesso não foi enviado. Confira o remetente e a configuração de e-mail.";
}

function isUuid(value: string | undefined) {
  return /^[0-9a-f-]{36}$/i.test(value ?? "");
}

async function availableUsername(
  pool: Awaited<ReturnType<typeof ensureAccessSchema>>,
  seed: string,
) {
  const base = normalizeUsername(seed).slice(0, 70) || "assinante";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}.${randomUUID().replace(/-/g, "").slice(0, 4)}`;
    const existing = await pool.query(`SELECT 1 FROM app_users WHERE username = $1 LIMIT 1`, [candidate]);
    if (!existing.rows[0]) return candidate;
  }
  return `${base}.${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    const pool = await ensureAccessSchema();
    const result = await pool.query(`
      SELECT u.id, u.username, u.email,
             u.display_name AS "displayName", u.role,
             u.status, u.expires_at AS "expiresAt",
             u.email_verified_at AS "emailVerifiedAt",
             u.invitation_sent_at AS "invitationSentAt",
             u.invitation_expires_at AS "invitationExpiresAt",
             u.must_change_password AS "mustChangePassword",
             u.created_at AS "createdAt", u.updated_at AS "updatedAt",
             u.last_login_at AS "lastLoginAt",
             (
               SELECT CONCAT_WS(' · ',
                 NULLIF(le.detail->>'city', ''),
                 NULLIF(le.detail->>'region', ''),
                 NULLIF(le.detail->>'country', '')
               )
               FROM app_usage_events le
               WHERE le.user_id = u.id AND le.event_type = 'access_location'
               ORDER BY le.created_at DESC
               LIMIT 1
             ) AS "lastLocation",
             COUNT(DISTINCT s.id)::int AS "sessionCount",
             COUNT(DISTINCT e.id)::int AS "eventCount",
             COUNT(DISTINCT e.id) FILTER (
               WHERE e.event_type = 'login' AND e.created_at >= NOW() - INTERVAL '30 days'
             )::int AS "loginCount30d",
             COUNT(DISTINCT e.id) FILTER (
               WHERE e.created_at >= NOW() - INTERVAL '30 days'
             )::int AS "activityCount30d",
             COUNT(DISTINCT DATE(e.created_at)) FILTER (
               WHERE e.created_at >= NOW() - INTERVAL '30 days'
             )::int AS "activeDays30d",
             MAX(e.created_at) AS "lastActivityAt"
      FROM app_users u
      LEFT JOIN app_sessions s ON s.user_id = u.id
      LEFT JOIN app_usage_events e ON e.user_id = u.id
      GROUP BY u.id
      ORDER BY u.role ASC, u.created_at DESC
    `);
    return NextResponse.json({
      users: result.rows,
      currentAdminId: admin.user.id,
      emailConfigured: accessEmailConfigured(),
    });
  } catch (error) {
    console.error("admin:users:get", error);
    return NextResponse.json({ error: "Não foi possível consultar os usuários." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    const body = (await request.json()) as {
      displayName?: string;
      email?: string;
      expiresAt?: string | null;
      role?: "tester" | "admin";
    };
    const displayName = String(body.displayName ?? "").trim().slice(0, 160);
    const email = normalizeEmail(String(body.email ?? ""));
    const role = body.role === "admin" ? "admin" : "tester";
    if (!displayName || !isValidEmail(email)) {
      return NextResponse.json({ error: "Informe o nome completo e um e-mail válido." }, { status: 400 });
    }
    if (!accessEmailConfigured()) {
      return NextResponse.json({ error: "O envio de e-mail ainda não está configurado na Railway." }, { status: 503 });
    }

    const pool = await ensureAccessSchema();
    const username = await availableUsername(pool, email.split("@")[0] || displayName);
    const temporaryPassword = generateTemporaryPassword();
    const confirmation = createEmailConfirmation();
    const userId = randomUUID();
    const result = await pool.query(
      `INSERT INTO app_users
        (id, username, email, display_name, role, password_hash, status,
         expires_at, must_change_password, invitation_token_hash,
         invitation_sent_at, invitation_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'blocked', $7, TRUE, $8, NOW(), $9)
       RETURNING id, username, email, display_name AS "displayName", role,
                 status, expires_at AS "expiresAt",
                 email_verified_at AS "emailVerifiedAt",
                 invitation_sent_at AS "invitationSentAt",
                 invitation_expires_at AS "invitationExpiresAt",
                 must_change_password AS "mustChangePassword",
                 created_at AS "createdAt", last_login_at AS "lastLoginAt"`,
      [userId, username, email, displayName, role, await hashPassword(temporaryPassword), body.expiresAt || null, confirmation.tokenHash, confirmation.expiresAt],
    );

    const confirmationUrl = new URL("/api/access/confirm", publicOrigin(request));
    confirmationUrl.searchParams.set("token", confirmation.token);
    try {
      await sendAccessEmail({
        to: email,
        displayName,
        login: email,
        temporaryPassword,
        preparedBy: admin.user.displayName,
        confirmationUrl: confirmationUrl.toString(),
        trialExpiresAt: body.expiresAt || null,
      });
    } catch (error) {
      await pool.query(`DELETE FROM app_users WHERE id = $1`, [userId]);
      console.error("admin:users:email", error);
      return NextResponse.json({ error: emailError(error) }, { status: 502 });
    }

    await recordUsage(admin.user.id, admin.sessionId, "admin_invitation_sent", "administracao", { userId, role });
    return NextResponse.json({ user: result.rows[0], emailSent: true });
  } catch (error) {
    console.error("admin:users:post", error);
    const message = error instanceof Error && /email_unique|username|unique/i.test(error.message)
      ? "Este e-mail ou usuário já possui um acesso."
      : "Não foi possível criar o acesso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    const body = (await request.json()) as {
      id?: string;
      displayName?: string;
      email?: string;
      username?: string;
      role?: "tester" | "admin";
      status?: "active" | "blocked";
      expiresAt?: string | null;
      resetPassword?: boolean;
      resendInvitation?: boolean;
    };
    if (!isUuid(body.id)) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
    if (body.id === admin.user.id && (body.status === "blocked" || body.role === "tester")) {
      return NextResponse.json({ error: "O administrador atual não pode bloquear ou rebaixar o próprio acesso." }, { status: 400 });
    }

    const pool = await ensureAccessSchema();
    const targetResult = await pool.query(
      `SELECT id, username, email, display_name AS "displayName", role, status,
              expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt"
       FROM app_users WHERE id = $1 LIMIT 1`,
      [body.id],
    );
    const target = targetResult.rows[0];
    if (!target) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

    if (target.role === "admin" && body.role === "tester") {
      const admins = await pool.query(`SELECT COUNT(*)::int AS total FROM app_users WHERE role = 'admin'`);
      if (Number(admins.rows[0]?.total ?? 0) <= 1) {
        return NextResponse.json({ error: "O sistema precisa manter pelo menos um administrador." }, { status: 400 });
      }
    }

    if (body.resetPassword || body.resendInvitation) {
      if (!target.email || !isValidEmail(target.email)) {
        return NextResponse.json({ error: "Este acesso não possui e-mail válido cadastrado." }, { status: 400 });
      }
      if (!accessEmailConfigured()) {
        return NextResponse.json({ error: "O envio de e-mail ainda não está configurado na Railway." }, { status: 503 });
      }
      const temporaryPassword = generateTemporaryPassword();
      const needsConfirmation = Boolean(body.resendInvitation || !target.emailVerifiedAt);
      const confirmation = needsConfirmation ? createEmailConfirmation() : null;
      const temporaryExpiresAt = confirmation?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
      const updated = await pool.query(
        `UPDATE app_users SET
           password_hash = $1,
           must_change_password = TRUE,
           status = CASE WHEN $2::boolean THEN 'blocked' ELSE status END,
           email_verified_at = CASE WHEN $2::boolean THEN NULL ELSE email_verified_at END,
           invitation_token_hash = $3,
           invitation_sent_at = NOW(),
           invitation_expires_at = $4,
           updated_at = NOW()
         WHERE id = $5
         RETURNING id, username, email, display_name AS "displayName", role,
                   status, expires_at AS "expiresAt",
                   email_verified_at AS "emailVerifiedAt",
                   invitation_sent_at AS "invitationSentAt",
                   invitation_expires_at AS "invitationExpiresAt",
                   must_change_password AS "mustChangePassword",
                   created_at AS "createdAt", last_login_at AS "lastLoginAt"`,
        [await hashPassword(temporaryPassword), needsConfirmation, confirmation?.tokenHash ?? null, temporaryExpiresAt, body.id],
      );
      await pool.query(`DELETE FROM app_sessions WHERE user_id = $1`, [body.id]);
      const confirmationUrl = confirmation ? new URL("/api/access/confirm", publicOrigin(request)) : undefined;
      confirmationUrl?.searchParams.set("token", confirmation?.token ?? "");
      try {
        await sendAccessEmail({
          to: target.email,
          displayName: target.displayName,
          login: target.email,
          temporaryPassword,
          preparedBy: admin.user.displayName,
          confirmationUrl: confirmationUrl?.toString(),
          trialExpiresAt: target.expiresAt,
        });
      } catch (error) {
        console.error("admin:users:email", error);
        return NextResponse.json({ error: emailError(error) }, { status: 502 });
      }
      await recordUsage(
        admin.user.id,
        admin.sessionId,
        needsConfirmation ? "admin_invitation_resent" : "admin_temp_password_created",
        "administracao",
        { userId: body.id },
      );
      return NextResponse.json({ user: updated.rows[0], emailSent: true });
    }

    const hasDisplayName = Object.prototype.hasOwnProperty.call(body, "displayName");
    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
    const hasUsername = Object.prototype.hasOwnProperty.call(body, "username");
    const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(body, "expiresAt");
    const nextDisplayName = hasDisplayName ? String(body.displayName ?? "").trim().slice(0, 160) : target.displayName;
    const nextEmail = hasEmail ? normalizeEmail(String(body.email ?? "")) : target.email;
    const nextUsername = hasUsername ? normalizeUsername(String(body.username ?? "")) : target.username;
    const nextRole = hasRole ? body.role : target.role;
    if (!nextDisplayName) return NextResponse.json({ error: "Informe o nome do usuário." }, { status: 400 });
    if (hasEmail && !isValidEmail(nextEmail)) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    if (!nextUsername || nextUsername.length < 3) return NextResponse.json({ error: "O usuário deve ter pelo menos 3 caracteres válidos." }, { status: 400 });
    if (hasRole && nextRole !== "admin" && nextRole !== "tester") return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });

    const emailChanged = hasEmail && nextEmail !== target.email;
    if (emailChanged) {
      if (!accessEmailConfigured()) {
        return NextResponse.json({ error: "O envio de e-mail ainda não está configurado na Railway." }, { status: 503 });
      }
      const temporaryPassword = generateTemporaryPassword();
      const confirmation = createEmailConfirmation();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE app_users SET
             display_name = $1, email = $2, username = $3, role = $4,
             status = 'blocked', expires_at = $5,
             password_hash = $6, must_change_password = TRUE,
             email_verified_at = NULL, invitation_token_hash = $7,
             invitation_sent_at = NOW(), invitation_expires_at = $8,
             updated_at = NOW()
           WHERE id = $9
           RETURNING id, username, email, display_name AS "displayName", role,
                     status, expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
                     invitation_sent_at AS "invitationSentAt", invitation_expires_at AS "invitationExpiresAt",
                     must_change_password AS "mustChangePassword", created_at AS "createdAt",
                     last_login_at AS "lastLoginAt"`,
          [nextDisplayName, nextEmail, nextUsername, nextRole, hasExpiresAt ? body.expiresAt || null : target.expiresAt, await hashPassword(temporaryPassword), confirmation.tokenHash, confirmation.expiresAt, body.id],
        );
        const confirmationUrl = new URL("/api/access/confirm", publicOrigin(request));
        confirmationUrl.searchParams.set("token", confirmation.token);
        await sendAccessEmail({
          to: nextEmail,
          displayName: nextDisplayName,
          login: nextEmail,
          temporaryPassword,
          preparedBy: admin.user.displayName,
          confirmationUrl: confirmationUrl.toString(),
          trialExpiresAt: hasExpiresAt ? body.expiresAt || null : target.expiresAt,
        });
        await client.query(`DELETE FROM app_sessions WHERE user_id = $1`, [body.id]);
        await client.query("COMMIT");
        await recordUsage(admin.user.id, admin.sessionId, "admin_user_updated", "administracao", { userId: body.id, emailChanged: true });
        return NextResponse.json({ user: result.rows[0], emailSent: true });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("admin:users:email-change", error);
        const message = error instanceof Error && /email_unique|username|unique/i.test(error.message)
          ? "O e-mail ou usuário informado já está em uso."
          : emailError(error);
        return NextResponse.json({ error: message }, { status: 400 });
      } finally {
        client.release();
      }
    }

    const result = await pool.query(
      `UPDATE app_users SET
         display_name = $1,
         email = $2,
         username = $3,
         role = $4,
         status = CASE
           WHEN email IS NOT NULL AND email_verified_at IS NULL THEN 'blocked'
           ELSE $5
         END,
         expires_at = $6,
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, username, email, display_name AS "displayName", role,
                 status, expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
                 invitation_sent_at AS "invitationSentAt", invitation_expires_at AS "invitationExpiresAt",
                 must_change_password AS "mustChangePassword", created_at AS "createdAt",
                 last_login_at AS "lastLoginAt"`,
      [
        nextDisplayName,
        nextEmail,
        nextUsername,
        nextRole,
        hasStatus ? body.status : target.status,
        hasExpiresAt ? body.expiresAt || null : target.expiresAt,
        body.id,
      ],
    );
    if (hasStatus && body.status === "blocked") await pool.query(`DELETE FROM app_sessions WHERE user_id = $1`, [body.id]);
    await recordUsage(
      admin.user.id,
      admin.sessionId,
      hasStatus && !hasDisplayName && !hasUsername && !hasRole && !hasExpiresAt
        ? "admin_user_status_changed"
        : "admin_user_updated",
      "administracao",
      { userId: body.id, status: body.status, role: nextRole },
    );
    return NextResponse.json({ user: result.rows[0] });
  } catch (error) {
    console.error("admin:users:patch", error);
    const message = error instanceof Error && /email_unique|username|unique/i.test(error.message)
      ? "O e-mail ou usuário informado já está em uso."
      : "Não foi possível atualizar o acesso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    const body = (await request.json()) as { id?: string };
    if (!isUuid(body.id)) return NextResponse.json({ error: "Usuário inválido." }, { status: 400 });
    if (body.id === admin.user.id) {
      return NextResponse.json({ error: "O administrador atual não pode excluir o próprio login." }, { status: 400 });
    }
    const pool = await ensureAccessSchema();
    const target = await pool.query(`SELECT id, display_name AS "displayName", role FROM app_users WHERE id = $1`, [body.id]);
    if (!target.rows[0]) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    if (target.rows[0].role === "admin") {
      const admins = await pool.query(`SELECT COUNT(*)::int AS total FROM app_users WHERE role = 'admin'`);
      if (Number(admins.rows[0]?.total ?? 0) <= 1) {
        return NextResponse.json({ error: "O sistema precisa manter pelo menos um administrador." }, { status: 400 });
      }
    }
    await pool.query(`DELETE FROM app_users WHERE id = $1`, [body.id]);
    await recordUsage(admin.user.id, admin.sessionId, "admin_user_deleted", "administracao", {
      userId: body.id,
      displayName: target.rows[0].displayName,
      role: target.rows[0].role,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin:users:delete", error);
    return NextResponse.json({ error: "Não foi possível excluir o login." }, { status: 500 });
  }
}
