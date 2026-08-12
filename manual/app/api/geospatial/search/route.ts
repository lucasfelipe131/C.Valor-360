import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "../../../lib/access";
import { BRAZIL_UFS } from "../../../lib/official-geodata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IbgeMunicipality = {
  id?: number;
  nome?: string;
  microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } };
  "regiao-imediata"?: { "regiao-intermediaria"?: { UF?: { sigla?: string } } };
};

type NominatimResult = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function coordinateQuery(value: string) {
  const match = value.trim().match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function resultUf(result: NominatimResult) {
  const iso = result.address?.["ISO3166-2-lvl4"] || result.address?.["ISO3166-2-lvl6"] || result.extratags?.["ISO3166-2"] || "";
  const code = iso.split("-").at(-1)?.toUpperCase() ?? "";
  return BRAZIL_UFS.has(code) ? code : "";
}

async function nominatimSearch(query: string, reverse?: { lat: number; lng: number }) {
  const url = reverse
    ? new URL("https://nominatim.openstreetmap.org/reverse")
    : new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  if (reverse) {
    url.searchParams.set("lat", String(reverse.lat));
    url.searchParams.set("lon", String(reverse.lng));
    url.searchParams.set("zoom", "14");
  } else {
    url.searchParams.set("q", query);
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("limit", "5");
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": "ManualDoAgronomo/0.2 (+https://manualdoagronomo.com.br)",
    },
    next: { revalidate: reverse ? 86_400 : 3_600 },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) return [];
  const payload = await response.json() as NominatimResult | NominatimResult[];
  return Array.isArray(payload) ? payload : [payload];
}

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const query = String(request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 180);
  if (query.length < 3) {
    return NextResponse.json({ error: "Digite município, endereço ou latitude e longitude." }, { status: 400 });
  }
  const coordinates = coordinateQuery(query);
  try {
    if (coordinates) {
      const [reverse] = await nominatimSearch(query, coordinates).catch(() => []);
      return NextResponse.json({ results: [{
        id: `coordinate-${coordinates.lat}-${coordinates.lng}`,
        type: "coordinate",
        label: reverse?.display_name || `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        uf: reverse ? resultUf(reverse) : "",
        source: reverse ? "OpenStreetMap · Nominatim" : "Coordenada informada",
        confidence: reverse ? "localização aproximada" : "coordenada exata informada",
      }] }, { headers: { "Cache-Control": "private, max-age=300" } });
    }

    const ufHint = query.toUpperCase().match(/(?:^|[\s,/-])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?:$|[\s,/-])/)?.[1] ?? "";
    const municipalityTerm = normalize(query.replace(/(?:^|[\s,/-])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?:$|[\s,/-])/i, " "));
    const [ibgeResponse, addressResults] = await Promise.all([
      fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome", {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 * 60 * 24 * 30 },
        signal: AbortSignal.timeout(9_000),
      }),
      nominatimSearch(query).catch(() => []),
    ]);
    const municipalities = ibgeResponse.ok ? await ibgeResponse.json() as IbgeMunicipality[] : [];
    const ibgeResults = municipalities.flatMap((item) => {
      const uf = item.microrregiao?.mesorregiao?.UF?.sigla || item["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla || "";
      const name = String(item.nome ?? "").trim();
      const normalizedName = normalize(name);
      if (!name || !item.id || !municipalityTerm || !normalizedName.includes(municipalityTerm)) return [];
      if (ufHint && uf !== ufHint) return [];
      return [{
        id: `ibge-${item.id}`,
        type: "municipality",
        label: `${name}/${uf}`,
        municipality: name,
        uf,
        ibgeCode: Number(item.id),
        source: "IBGE · Localidades e Malhas",
        confidence: normalizedName === municipalityTerm ? "correspondência oficial exata" : "correspondência por nome",
        score: normalizedName === municipalityTerm ? 0 : normalizedName.startsWith(municipalityTerm) ? 1 : 2,
      }];
    }).sort((a, b) => a.score - b.score || a.label.localeCompare(b.label, "pt-BR")).slice(0, 6).map(({ score: _score, ...item }) => item);
    const addresses = addressResults.flatMap((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !item.display_name) return [];
      return [{
        id: `osm-${item.place_id ?? `${lat}-${lng}`}`,
        type: "address",
        label: item.display_name.slice(0, 260),
        lat,
        lng,
        uf: resultUf(item),
        source: "OpenStreetMap · Nominatim",
        confidence: Number(item.importance ?? 0) >= 0.5 ? "alta para localização" : "aproximada; confira no mapa",
      }];
    });
    return NextResponse.json({
      results: [...ibgeResults, ...addresses].slice(0, 10),
      note: "O IBGE fornece o limite municipal oficial. Endereços servem apenas para centralizar o mapa e devem ser conferidos visualmente.",
    }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    console.error("geospatial:search", error);
    return NextResponse.json({ error: "A busca geográfica está temporariamente indisponível. Você ainda pode desenhar ou importar KML/GeoJSON." }, { status: 502 });
  }
}
