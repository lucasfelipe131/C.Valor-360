import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getPool } from "./db";
import { manualTenantId } from "./tenant";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "mp_access_session";
const SESSION_DAYS = 14;
const EMAIL_CONFIRMATION_HOURS = 72;

// Conta administrativa inicial. A senha é temporária e a troca é obrigatória
// no primeiro acesso. Somente o hash é versionado.
const INITIAL_ADMIN_PASSWORD_HASH =
  "scrypt$8fa2866df1748263e47def5e862ebcbd$01621bae94ea8bb0b8f20438690d84890edc8fa6509e6b94452dbfc54a4ef380f3167b93d38847480427eb91f890e3ca98e1668c9009a83c706a27ddeb25b613";

export type AccessRole = "admin" | "tester";

export type AccessUser = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: AccessRole;
  status: "active" | "blocked";
  expiresAt: string | null;
  emailVerifiedAt: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const globalAccess = globalThis as typeof globalThis & {
  manualAgronomoAccessSchema?: Promise<void>;
  manualAgronomoFeedbackSchema?: Promise<void>;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

type EmbeddedIdentity = {
  id: string;
  email: string;
  displayName: string;
  role: AccessRole;
  tenantId: string;
  exp: number;
};

function embeddedIdentityFromRequest(request: NextRequest) {
  const payload = request.headers.get("x-valor360-identity") ?? "";
  const signature = request.headers.get("x-valor360-signature") ?? "";
  const secret = process.env.VALOR360_EMBED_SECRET ?? "";
  if (!payload || !signature || secret.length < 32) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const identity = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as EmbeddedIdentity;
    if (
      !/^[0-9a-f-]{36}$/i.test(identity.id) ||
      !isValidEmail(identity.email) ||
      identity.tenantId !== manualTenantId() ||
      identity.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return {
      ...identity,
      role: identity.role === "tester" ? "tester" : "admin",
      displayName: String(identity.displayName || identity.email.split("@")[0]).slice(0, 160),
    };
  } catch {
    return null;
  }
}

async function embeddedSession(request: NextRequest) {
  const identity = embeddedIdentityFromRequest(request);
  if (!identity) return null;
  const pool = await ensureAccessSchema();
  const existing = await pool.query(
    `SELECT id, username, email, display_name AS "displayName", role, status,
            expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
            invitation_sent_at AS "invitationSentAt",
            invitation_expires_at AS "invitationExpiresAt",
            must_change_password AS "mustChangePassword",
            last_login_at AS "lastLoginAt"
       FROM app_users
      WHERE id = $1 OR LOWER(email) = LOWER($2)
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [identity.id, identity.email],
  );
  let row = existing.rows[0];
  if (!row) {
    const created = await pool.query(
      `INSERT INTO app_users
        (id, username, email, display_name, role, password_hash, status,
         must_change_password, email_verified_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', FALSE, NOW(), NOW())
       RETURNING id, username, email, display_name AS "displayName", role, status,
                 expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
                 invitation_sent_at AS "invitationSentAt",
                 invitation_expires_at AS "invitationExpiresAt",
                 must_change_password AS "mustChangePassword",
                 last_login_at AS "lastLoginAt"`,
      [
        identity.id,
        `valor360.${identity.id.replace(/-/g, "").slice(0, 16)}`,
        identity.email,
        identity.displayName,
        identity.role,
        INITIAL_ADMIN_PASSWORD_HASH,
      ],
    );
    row = created.rows[0];
  } else {
    const refreshed = await pool.query(
      `UPDATE app_users
          SET status = 'active', email_verified_at = COALESCE(email_verified_at, NOW()),
              must_change_password = FALSE, last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, email, display_name AS "displayName", role, status,
                  expires_at AS "expiresAt", email_verified_at AS "emailVerifiedAt",
                  invitation_sent_at AS "invitationSentAt",
                  invitation_expires_at AS "invitationExpiresAt",
                  must_change_password AS "mustChangePassword",
                  last_login_at AS "lastLoginAt"`,
      [row.id],
    );
    row = refreshed.rows[0];
  }
  return { user: rowToUser(row), sessionId: null, valor360OwnerId: identity.id, tenantId: identity.tenantId };
}

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").slice(0, 254);
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmail(value));
}

export function createEmailConfirmation() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: tokenHash(token),
    expiresAt: new Date(
      Date.now() + EMAIL_CONFIRMATION_HOURS * 60 * 60 * 1000,
    ),
  };
}

export function hashEmailConfirmationToken(token: string) {
  return tokenHash(token);
}

export function normalizeUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 80);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, expectedHex] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateTemporaryPassword() {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const alphabet = `${uppercase}${lowercase}${digits}`;
  const pick = (source: string) => source[randomBytes(1)[0] % source.length];
  const characters = [pick(uppercase), pick(lowercase), pick(digits)];

  while (characters.length < 8) characters.push(pick(alphabet));
  const shuffleBytes = randomBytes(characters.length);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = shuffleBytes[index] % (index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
}

export async function ensureAccessSchema() {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL não configurada");
  if (!globalAccess.manualAgronomoAccessSchema) {
    globalAccess.manualAgronomoAccessSchema = pool
      .query(`
        CREATE TABLE IF NOT EXISTS app_users (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          email TEXT,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'tester')),
          password_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
          expires_at TIMESTAMPTZ,
          must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ,
          email_verified_at TIMESTAMPTZ,
          invitation_token_hash TEXT,
          invitation_sent_at TIMESTAMPTZ,
          invitation_expires_at TIMESTAMPTZ
        );
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS invitation_token_hash TEXT;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ;
        ALTER TABLE app_users ADD COLUMN IF NOT EXISTS professional_profile JSONB NOT NULL DEFAULT '{}'::jsonb;
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
          ON app_users (LOWER(email)) WHERE email IS NOT NULL;
        CREATE TABLE IF NOT EXISTS app_sessions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL DEFAULT '${manualTenantId()}'::uuid,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_agent TEXT NOT NULL DEFAULT ''
        );
        ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${manualTenantId()}'::uuid;
        CREATE INDEX IF NOT EXISTS app_sessions_user_expires
          ON app_sessions (user_id, expires_at DESC);
        CREATE TABLE IF NOT EXISTS app_usage_events (
          id BIGSERIAL PRIMARY KEY,
          tenant_id UUID NOT NULL DEFAULT '${manualTenantId()}'::uuid,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          session_id UUID REFERENCES app_sessions(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          page_key TEXT NOT NULL DEFAULT '',
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE app_usage_events ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${manualTenantId()}'::uuid;
        CREATE INDEX IF NOT EXISTS app_usage_user_created
          ON app_usage_events (user_id, created_at DESC);
        INSERT INTO app_users
          (id, username, display_name, role, password_hash, status, must_change_password)
        SELECT
          'f1a21ba1-4521-4cb3-9227-0ad11a202601'::uuid,
          'admin.manual',
          'Administrador do sistema',
          'admin',
          '${INITIAL_ADMIN_PASSWORD_HASH}',
          'active',
          TRUE
        WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE role = 'admin');
      `)
      .then(() => undefined)
      .catch((error) => {
        globalAccess.manualAgronomoAccessSchema = undefined;
        throw error;
      });
  }
  await globalAccess.manualAgronomoAccessSchema;
  return pool;
}

export async function ensureFeedbackSchema() {
  const pool = await ensureAccessSchema();
  if (!globalAccess.manualAgronomoFeedbackSchema) {
    globalAccess.manualAgronomoFeedbackSchema = pool
      .query(`
        CREATE TABLE IF NOT EXISTS app_feedback (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL DEFAULT '${manualTenantId()}'::uuid,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          category TEXT NOT NULL CHECK (category IN ('suggestion', 'problem')),
          module_key TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
          admin_note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        );
        ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '${manualTenantId()}'::uuid;
        CREATE INDEX IF NOT EXISTS app_feedback_status_created
          ON app_feedback (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS app_feedback_user_created
          ON app_feedback (user_id, created_at DESC);
      `)
      .then(() => undefined)
      .catch((error) => {
        globalAccess.manualAgronomoFeedbackSchema = undefined;
        throw error;
      });
  }
  await globalAccess.manualAgronomoFeedbackSchema;
  return pool;
}

function rowToUser(row: Record<string, unknown>): AccessUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : null,
    displayName: String(row.displayName ?? row.display_name ?? ""),
    role: row.role as AccessRole,
    status: row.status as AccessUser["status"],
    expiresAt: row.expiresAt
      ? new Date(String(row.expiresAt)).toISOString()
      : row.expires_at
        ? new Date(String(row.expires_at)).toISOString()
        : null,
    emailVerifiedAt: row.emailVerifiedAt
      ? new Date(String(row.emailVerifiedAt)).toISOString()
      : row.email_verified_at
        ? new Date(String(row.email_verified_at)).toISOString()
        : null,
    invitationSentAt: row.invitationSentAt
      ? new Date(String(row.invitationSentAt)).toISOString()
      : row.invitation_sent_at
        ? new Date(String(row.invitation_sent_at)).toISOString()
        : null,
    invitationExpiresAt: row.invitationExpiresAt
      ? new Date(String(row.invitationExpiresAt)).toISOString()
      : row.invitation_expires_at
        ? new Date(String(row.invitation_expires_at)).toISOString()
        : null,
    mustChangePassword: Boolean(
      row.mustChangePassword ?? row.must_change_password,
    ),
    lastLoginAt: row.lastLoginAt
      ? new Date(String(row.lastLoginAt)).toISOString()
      : row.last_login_at
        ? new Date(String(row.last_login_at)).toISOString()
        : null,
  };
}

export async function createSession(
  userId: string,
  userAgent: string,
) {
  const pool = await ensureAccessSchema();
  const token = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  );
  await pool.query(
    `INSERT INTO app_sessions
      (id, tenant_id, user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, manualTenantId(), userId, tokenHash(token), expiresAt, userAgent.slice(0, 400)],
  );
  return { token, sessionId, expiresAt };
}

export function setSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: Date },
) {
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function sessionFromRequest(request: NextRequest) {
  const embedded = await embeddedSession(request);
  if (embedded) return embedded;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const pool = await ensureAccessSchema();
  const result = await pool.query(
    `SELECT s.id AS "sessionId", s.tenant_id AS "tenantId", u.id, u.username, u.email,
            u.display_name AS "displayName", u.role, u.status,
            u.expires_at AS "expiresAt",
            u.email_verified_at AS "emailVerifiedAt",
            u.invitation_sent_at AS "invitationSentAt",
            u.invitation_expires_at AS "invitationExpiresAt",
            u.must_change_password AS "mustChangePassword",
            u.last_login_at AS "lastLoginAt"
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.tenant_id = $2
       AND s.expires_at > NOW()
       AND u.status = 'active'
       AND (u.role = 'admin' OR u.email IS NULL OR u.email_verified_at IS NOT NULL)
       AND (u.expires_at IS NULL OR u.expires_at > NOW())
     LIMIT 1`,
    [tokenHash(token), manualTenantId()],
  );
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(
    `UPDATE app_sessions SET last_seen_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [row.sessionId, row.tenantId],
  );
  return {
    user: rowToUser(row),
    sessionId: String(row.sessionId),
    valor360OwnerId: undefined as string | undefined,
    tenantId: String(row.tenantId),
  };
}

export async function requireAdmin(request: NextRequest) {
  const session = await sessionFromRequest(request);
  return session?.user.role === "admin" ? session : null;
}

export async function recordUsage(
  userId: string,
  sessionId: string | null,
  eventType: string,
  pageKey = "",
  detail: Record<string, unknown> = {},
  tenantId = manualTenantId(),
) {
  const pool = await ensureAccessSchema();
  await pool.query(
    `INSERT INTO app_usage_events
      (tenant_id, user_id, session_id, event_type, page_key, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      manualTenantId(tenantId),
      userId,
      sessionId,
      eventType.slice(0, 60),
      pageKey.slice(0, 80),
      JSON.stringify(detail),
    ],
  );
}

export { SESSION_COOKIE, rowToUser };
