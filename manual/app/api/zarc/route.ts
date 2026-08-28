import { NextRequest, NextResponse } from "next/server";
import { consultZarc } from "../../../../server/zarc-provider.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await consultZarc({
      uf: request.nextUrl.searchParams.get("uf") ?? "",
      municipality: request.nextUrl.searchParams.get("municipality") ?? "",
      crop: request.nextUrl.searchParams.get("crop") ?? "",
      soil: request.nextUrl.searchParams.get("soil") ?? "",
      cycle: request.nextUrl.searchParams.get("cycle") ?? "",
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 502;
    const message = error instanceof Error ? error.message : "Zoneamento indisponível.";
    return NextResponse.json({ error: message }, { status });
  }
}
