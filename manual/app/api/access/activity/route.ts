import { NextRequest, NextResponse } from "next/server";
import { recordUsage, sessionFromRequest } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    }
    const body = (await request.json()) as {
      eventType?: string;
      pageKey?: string;
      detail?: Record<string, unknown>;
    };
    const eventType = String(body.eventType || "page_view");
    const allowedEvents = new Set(["page_view", "calculator_view", "access_location"]);
    if (!allowedEvents.has(eventType)) {
      return NextResponse.json({ error: "Tipo de atividade inválido." }, { status: 400 });
    }
    const detail = eventType === "access_location"
      ? {
          city: String(body.detail?.city ?? "").trim().slice(0, 100),
          region: String(body.detail?.region ?? "").trim().slice(0, 100),
          country: String(body.detail?.country ?? "").trim().slice(0, 100),
        }
      : {};
    await recordUsage(
      session.user.id,
      session.sessionId,
      eventType,
      String(body.pageKey || ""),
      detail,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("access:activity", error);
    return NextResponse.json({ error: "Atividade não registrada." }, { status: 500 });
  }
}
