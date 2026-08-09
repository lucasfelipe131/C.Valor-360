import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  ensureAccessSchema,
  recordUsage,
  sessionFromRequest,
} from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({ user: session.user });
  } catch (error) {
    console.error("access:session:get", error);
    return NextResponse.json(
      { error: "Não foi possível consultar a sessão." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (session) {
      const pool = await ensureAccessSchema();
      await recordUsage(
        session.user.id,
        session.sessionId,
        "logout",
      );
      await pool.query(`DELETE FROM app_sessions WHERE id = $1`, [
        session.sessionId,
      ]);
    }
    return clearSessionCookie(NextResponse.json({ ok: true }));
  } catch (error) {
    console.error("access:session:delete", error);
    return clearSessionCookie(NextResponse.json({ ok: true }));
  }
}
