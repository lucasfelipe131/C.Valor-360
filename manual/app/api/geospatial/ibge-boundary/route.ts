import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "../../../lib/access";
import {
  normalizePolygon,
  parseGeoJsonBoundaries,
  polygonCentroid,
  simplifyPolygon,
} from "../../../lib/field-geometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    const code = String(request.nextUrl.searchParams.get("code") ?? "");
    if (!/^\d{7}$/.test(code)) {
      return NextResponse.json({ error: "Código IBGE municipal inválido." }, { status: 400 });
    }
    const url = new URL(`https://servicodados.ibge.gov.br/api/v4/malhas/municipios/${code}`);
    url.searchParams.set("formato", "application/vnd.geo+json");
    url.searchParams.set("qualidade", "minima");
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.geo+json, application/json" },
      next: { revalidate: 60 * 60 * 24 * 30 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`IBGE respondeu ${response.status}.`);
    const source = await response.json() as unknown;
    const boundary = parseGeoJsonBoundaries(source)[0];
    if (!boundary) throw new Error("Malha municipal sem polígono válido.");
    const points = normalizePolygon(simplifyPolygon(boundary.points, 120)).slice(0, 1_200);
    return NextResponse.json({
      code,
      points,
      centroid: polygonCentroid(points),
      source: "IBGE · API de Malhas Geográficas",
      sourceUrl: "https://servicodados.ibge.gov.br/api/docs/malhas?versao=4",
      confidence: "limite municipal oficial simplificado para visualização",
      note: "Esta malha localiza o município; ela não representa o perímetro do imóvel ou do talhão.",
    }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    console.error("geospatial:ibge-boundary", error);
    return NextResponse.json({ error: "Não foi possível carregar a malha municipal oficial." }, { status: 502 });
  }
}
