import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UF_PATTERN = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;

export async function GET(request: NextRequest) {
  const uf = (request.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
  if (!UF_PATTERN.test(uf)) {
    return NextResponse.json({ error: "UF inválida." }, { status: 400 });
  }
  try {
    const url = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/" + uf + "/municipios?orderBy=nome";
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 30 },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("IBGE respondeu com status " + response.status);
    const source = (await response.json()) as Array<{ id?: number; nome?: string }>;
    const municipalities = source
      .filter((item) => Number.isFinite(Number(item.id)) && String(item.nome ?? "").trim())
      .map((item) => ({ id: Number(item.id), nome: String(item.nome).trim() }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return NextResponse.json({ uf, municipalities, count: municipalities.length, source: "IBGE" }, {
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800" },
    });
  } catch (error) {
    console.error("municipalities:get", error);
    return NextResponse.json({ error: "Não foi possível carregar os municípios do IBGE." }, { status: 502 });
  }
}
