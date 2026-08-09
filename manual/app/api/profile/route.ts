import { NextRequest, NextResponse } from "next/server";
import { ensureAccessSchema, recordUsage, sessionFromRequest } from "../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredProfile = {
  profession?: "Engenheiro Agrônomo" | "Técnico Agrícola";
  council?: "CREA" | "CFTA";
  registration?: string;
  company?: string;
  phone?: string;
  watermark?: string;
  watermarkOpacity?: number;
};

function safeText(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeProfile(input: Record<string, unknown>): StoredProfile {
  const profession = input.profession === "Técnico Agrícola"
    ? "Técnico Agrícola"
    : "Engenheiro Agrônomo";
  const council = input.council === "CFTA" ? "CFTA" : "CREA";
  const rawWatermark = String(input.watermark ?? "");
  const watermark = rawWatermark &&
    /^data:image\/(?:png|jpeg|webp);base64,/i.test(rawWatermark) &&
    rawWatermark.length <= 3_000_000
      ? rawWatermark
      : "";
  const rawOpacity = Number(input.watermarkOpacity);
  return {
    profession,
    council,
    registration: safeText(input.registration, 80),
    company: safeText(input.company, 160),
    phone: safeText(input.phone, 40),
    watermark,
    watermarkOpacity: Number.isFinite(rawOpacity)
      ? Math.min(25, Math.max(3, Math.round(rawOpacity)))
      : 10,
  };
}

function responseProfile(
  stored: StoredProfile,
  user: { displayName: string; email: string | null },
) {
  return {
    ...stored,
    name: user.displayName,
    email: user.email ?? "",
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const pool = await ensureAccessSchema();
    const result = await pool.query(
      `SELECT professional_profile AS profile FROM app_users WHERE id = $1 LIMIT 1`,
      [session.user.id],
    );
    const stored = (result.rows[0]?.profile ?? {}) as StoredProfile;
    return NextResponse.json({ profile: responseProfile(stored, session.user) });
  } catch (error) {
    console.error("profile:get", error);
    return NextResponse.json({ error: "Não foi possível consultar o perfil." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const profile = normalizeProfile(body);
    const pool = await ensureAccessSchema();
    await pool.query(
      `UPDATE app_users
       SET professional_profile = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(profile), session.user.id],
    );
    await recordUsage(session.user.id, session.sessionId, "profile_updated", "perfil");
    return NextResponse.json({ profile: responseProfile(profile, session.user) });
  } catch (error) {
    console.error("profile:put", error);
    return NextResponse.json({ error: "Não foi possível salvar o perfil." }, { status: 500 });
  }
}
