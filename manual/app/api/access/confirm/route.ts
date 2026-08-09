import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccessSchema,
  hashEmailConfirmationToken,
  recordUsage,
} from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(request: NextRequest) {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn("access:confirm:invalid-app-public-url");
    }
  }

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProtocol || "https"}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const destination = new URL("/", publicOrigin(request));
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) {
      destination.searchParams.set("acesso", "convite-invalido");
      return NextResponse.redirect(destination);
    }

    const pool = await ensureAccessSchema();
    const result = await pool.query(
      `UPDATE app_users
       SET email_verified_at = NOW(), status = 'active',
           invitation_token_hash = NULL, invitation_expires_at = NULL,
           updated_at = NOW()
       WHERE invitation_token_hash = $1
         AND invitation_expires_at > NOW()
         AND email IS NOT NULL
       RETURNING id, email`,
      [hashEmailConfirmationToken(token)],
    );
    const user = result.rows[0];
    if (!user) {
      destination.searchParams.set("acesso", "convite-invalido");
      return NextResponse.redirect(destination);
    }

    await recordUsage(
      String(user.id),
      null,
      "email_identity_confirmed",
      "acesso",
      { email: user.email },
    );
    destination.searchParams.set("acesso", "confirmado");
    return NextResponse.redirect(destination);
  } catch (error) {
    console.error("access:confirm", error);
    destination.searchParams.set("acesso", "erro-confirmacao");
    return NextResponse.redirect(destination);
  }
}
