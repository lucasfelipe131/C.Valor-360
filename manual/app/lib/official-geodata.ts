import {
  normalizePolygon,
  polygonAreaHa,
  simplifyPolygon,
  type GeoPoint,
} from "./field-geometry.ts";

export const BRAZIL_UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

export type GeoBounds = [number, number, number, number];
export function validGeoBounds(bounds: unknown): bounds is GeoBounds {
  return Array.isArray(bounds) && bounds.length === 4 && bounds.every(v => typeof v === "number" && Number.isFinite(v)) &&
    bounds[0] >= -180 && bounds[2] <= 180 && bounds[1] >= -90 && bounds[3] <= 90 &&
    bounds[2] > bounds[0] && bounds[3] > bounds[1] && bounds[2] - bounds[0] <= 2 && bounds[3] - bounds[1] <= 2;
}
function overlapsBounds(points: GeoPoint[], bounds: GeoBounds) {
  return Math.min(...points.map(p=>p.lng)) <= bounds[2] && Math.max(...points.map(p=>p.lng)) >= bounds[0] &&
    Math.min(...points.map(p=>p.lat)) <= bounds[3] && Math.max(...points.map(p=>p.lat)) >= bounds[1];
}
type ReferenceGeometry = {type: "MultiPolygon"; coordinates: number[][][][]};
function referenceGeometry(polygons: GeoPoint[][][]): ReferenceGeometry | undefined {
  const vertices = polygons.flat(2).length;
  if (!vertices || vertices > 2500) return undefined;
  return {type:"MultiPolygon", coordinates:polygons.map(rings=>rings.map(ring=>{
    const coordinates=ring.map(p=>[p.lng,p.lat]);
    if(coordinates.length&&(coordinates[0][0]!==coordinates.at(-1)?.[0]||coordinates[0][1]!==coordinates.at(-1)?.[1]))coordinates.push(coordinates[0]);
    return coordinates;
  }))};
}
export type SigefBoundary = {
  id: string;
  label: string;
  points: GeoPoint[];
  geometry?: ReferenceGeometry;
  registry: string;
  propertyCode: string;
  parcelCode: string;
  municipalityCode: string;
  status: string;
  informedStatus: string;
  approvalDate: string;
  tenure: "particular" | "publico";
  ownerAvailability: "not_provided";
  source: "SIGEF/INCRA · Acervo Fundiário";
  sourceUrl: "https://acervofundiario.incra.gov.br/";
  confidence: "certified_containing_point" | "certified_in_viewport";
};

export type CarBoundary = {
  id: string;
  label: string;
  points: GeoPoint[];
  geometry?: ReferenceGeometry;
  propertyCode: string;
  status: string;
  createdAt: string;
  condition: string;
  uf: string;
  municipality: string;
  municipalityCode: string;
  fiscalModules: string;
  propertyType: string;
  declaredAreaHa: number | null;
  ownerAvailability: "not_provided";
  source: "SICAR · Consulta Pública do CAR";
  sourceUrl: "https://consultapublica.car.gov.br/publico/imoveis/index";
  confidence: "self_declared_containing_point" | "self_declared_in_viewport";
};

const ALLOWED_PROPERTIES = {
  parcela_codigo: "parcelCode",
  codigo_imovel: "propertyCode",
  registro_matricula: "registry",
  codigo_municipio: "municipalityCode",
  status: "status",
  situacao_informada: "informedStatus",
  nome_area: "label",
  data_aprovacao: "approvalDate",
} as const;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeText(value: string | undefined, max = 180) {
  return decodeXml(String(value ?? "").replace(/<[^>]*>/g, "").trim()).slice(0, max);
}

function extractTag(member: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safeText(member.match(new RegExp(`<[^:>]+:${escaped}\\b[^>]*>([\\s\\S]*?)<\\/[^:>]+:${escaped}>`, "i"))?.[1]);
}

function coordinateRings(member: string) {
  const blocks = [...member.matchAll(/<gml:coordinates\b[^>]*>([\s\S]*?)<\/gml:coordinates>/gi)];
  return blocks
    .map((match) => normalizePolygon(match[1].trim().split(/\s+/).map((coordinate) => {
      const [lng, lat] = coordinate.split(",").map(Number);
      return { lat, lng };
    })))
    .filter((points) => points.length >= 3)
    .sort((a, b) => polygonAreaHa(b) - polygonAreaHa(a));
}

function pointInside(point: GeoPoint, polygon: GeoPoint[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat || Number.EPSILON) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function jsonText(value: unknown, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function geoJsonPolygonRings(geometry: unknown): GeoPoint[][][] {
  if (!geometry || typeof geometry !== "object") return [];
  const candidate = geometry as { type?: string; coordinates?: unknown };
  if (candidate.type === "Polygon" && Array.isArray(candidate.coordinates)) {
    const rings = candidate.coordinates.flatMap((rawRing): GeoPoint[][] => {
      if (!Array.isArray(rawRing)) return [];
      const points = normalizePolygon(rawRing.map((coordinate) => {
        const pair = coordinate as [unknown, unknown];
        return { lng: Number(pair?.[0]), lat: Number(pair?.[1]) };
      }));
      return points.length >= 3 ? [points] : [];
    });
    return rings[0] ? [rings] : [];
  }
  if (candidate.type === "MultiPolygon" && Array.isArray(candidate.coordinates)) {
    return candidate.coordinates.flatMap((polygon) =>
      geoJsonPolygonRings({ type: "Polygon", coordinates: polygon }),
    );
  }
  return [];
}

export function parseCarGeoJson(source: string | unknown, point: GeoPoint, bounds?: GeoBounds) {
  if (typeof source === "string" && source.length > 8 * 1024 * 1024) {
    throw new Error("Resposta geográfica acima do limite seguro.");
  }
  const parsed = typeof source === "string" ? JSON.parse(source) as unknown : source;
  if (!parsed || typeof parsed !== "object") throw new Error("GeoJSON do SICAR inválido.");
  const features = Array.isArray((parsed as { features?: unknown[] }).features)
    ? (parsed as { features: unknown[] }).features.slice(0, bounds ? 80 : 12)
    : [];

  return features.flatMap((rawFeature, index): CarBoundary[] => {
    if (!rawFeature || typeof rawFeature !== "object") return [];
    const feature = rawFeature as { id?: unknown; geometry?: unknown; properties?: unknown };
    const properties = feature.properties && typeof feature.properties === "object" && !Array.isArray(feature.properties)
      ? feature.properties as Record<string, unknown>
      : {};
    const polygons = geoJsonPolygonRings(feature.geometry);
    const geometry = bounds ? referenceGeometry(polygons) : undefined;
    if (bounds && !geometry) return [];
    const containingRing = polygons
      .filter((rings) => bounds ? overlapsBounds(rings[0], bounds) : pointInside(point, rings[0]) && !rings.slice(1).some((hole) => pointInside(point, hole)))
      .map((rings) => rings[0])
      .sort((a, b) => polygonAreaHa(b) - polygonAreaHa(a))[0];
    if (!containingRing) return [];

    // Lista fechada: o WFS público não traz nome/CPF e nenhum campo inesperado é propagado.
    const propertyCode = jsonText(properties.cod_imovel, 90);
    const municipality = jsonText(properties.municipio, 100);
    const status = jsonText(properties.status_imovel, 40);
    const rawArea = Number(properties.area);
    return [{
      id: `car-${propertyCode || jsonText(feature.id, 90) || index + 1}`,
      label: propertyCode ? `CAR ${propertyCode}` : `Imóvel CAR ${index + 1}`,
      points: simplifyPolygon(containingRing, 0.45).slice(0, 2_500),
      ...(geometry ? {geometry} : {}),
      propertyCode,
      status,
      createdAt: jsonText(properties.dat_criacao, 40),
      condition: jsonText(properties.condicao, 100),
      uf: jsonText(properties.uf, 2),
      municipality,
      municipalityCode: jsonText(properties.cod_municipio_ibge, 12),
      fiscalModules: jsonText(properties.m_fiscal, 24),
      propertyType: jsonText(properties.tipo_imovel, 40),
      declaredAreaHa: Number.isFinite(rawArea) && rawArea >= 0 ? rawArea : null,
      ownerAvailability: "not_provided",
      source: "SICAR · Consulta Pública do CAR",
      sourceUrl: "https://consultapublica.car.gov.br/publico/imoveis/index",
      confidence: bounds ? "self_declared_in_viewport" : "self_declared_containing_point",
    }];
  });
}

export function parseSigefGml(xml: string, point: GeoPoint, tenure: "particular" | "publico", bounds?: GeoBounds) {
  if (xml.length > 8 * 1024 * 1024) throw new Error("Resposta geográfica acima do limite seguro.");
  const members = xml.match(/<gml:featureMember\b[\s\S]*?<\/gml:featureMember>/gi) ?? [];
  return members.slice(0, bounds ? 80 : members.length).flatMap((member, index): SigefBoundary[] => {
    const points = coordinateRings(member)[0];
    if (!points || !(bounds ? overlapsBounds(points, bounds) : pointInside(point, points))) return [];
    const geometry = bounds ? referenceGeometry((member.match(/<gml:Polygon\b[\s\S]*?<\/gml:Polygon>/gi) ?? []).map(coordinateRings)) : undefined;
    if (bounds && !geometry) return [];
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED_PROPERTIES).map(([source, target]) => [target, extractTag(member, source)]),
    ) as Record<(typeof ALLOWED_PROPERTIES)[keyof typeof ALLOWED_PROPERTIES], string>;
    const parcelCode = allowed.parcelCode || `feature-${index + 1}`;
    return [{
      id: `${tenure}-${parcelCode}`,
      label: allowed.label || "Parcela certificada sem denominação pública",
      points: simplifyPolygon(points, 0.45).slice(0, 2_500),
      ...(geometry ? {geometry} : {}),
      registry: allowed.registry,
      propertyCode: allowed.propertyCode,
      parcelCode: allowed.parcelCode,
      municipalityCode: allowed.municipalityCode,
      status: allowed.status || "CERTIFICADA",
      informedStatus: allowed.informedStatus,
      approvalDate: allowed.approvalDate,
      tenure,
      ownerAvailability: "not_provided",
      source: "SIGEF/INCRA · Acervo Fundiário",
      sourceUrl: "https://acervofundiario.incra.gov.br/",
      confidence: bounds ? "certified_in_viewport" : "certified_containing_point",
    }];
  });
}

function sigefWfsUrl(uf: string, tenure: "particular" | "publico", point: GeoPoint, bounds?: GeoBounds) {
  const normalizedUf = uf.toUpperCase();
  if (!BRAZIL_UFS.has(normalizedUf)) throw new Error("UF inválida.");
  const layer = `certificada_sigef_${tenure}_${normalizedUf.toLowerCase()}`;
  const delta = 0.0008;
  const bbox = (bounds ?? [
    point.lng - delta,
    point.lat - delta,
    point.lng + delta,
    point.lat + delta,
  ]).map((value) => value.toFixed(7)).join(",") + ",EPSG:4326";
  const url = new URL("https://acervofundiario.incra.gov.br/i3geo/ogc.php");
  url.searchParams.set("tema", layer);
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "1.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAME", layer);
  url.searchParams.set("BBOX", bbox);
  url.searchParams.set("MAXFEATURES", bounds ? "80" : "12");
  return url;
}

function carWfsUrl(uf: string, point: GeoPoint, bounds?: GeoBounds) {
  const normalizedUf = uf.toUpperCase();
  if (!BRAZIL_UFS.has(normalizedUf)) throw new Error("UF inválida.");
  const delta = 0.0008;
  const bbox = (bounds ?? [
    point.lng - delta,
    point.lat - delta,
    point.lng + delta,
    point.lat + delta,
  ]).map((value) => value.toFixed(7)).join(",") + ",urn:ogc:def:crs:OGC::CRS84";
  const url = new URL("https://geoserver.car.gov.br/geoserver/sicar/wfs");
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", `sicar:sicar_imoveis_${normalizedUf.toLowerCase()}`);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "urn:ogc:def:crs:OGC::CRS84");
  url.searchParams.set("count", bounds ? "80" : "12");
  url.searchParams.set("bbox", bbox);
  return url;
}

export async function querySigefAtPoint(
  point: GeoPoint,
  uf: string,
  fetcher: typeof fetch = fetch,
  bounds?: GeoBounds,
) {
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) throw new Error("Latitude inválida.");
  if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) throw new Error("Longitude inválida.");
  if (!BRAZIL_UFS.has(uf.toUpperCase())) throw new Error("UF inválida.");
  if (bounds && !validGeoBounds(bounds)) throw new Error("Área de consulta inválida.");
  const tenures = ["particular", "publico"] as const;
  const settled = await Promise.allSettled(tenures.map(async (tenure) => {
    const response = await fetcher(sigefWfsUrl(uf, tenure, point, bounds), {
      headers: { Accept: "application/gml+xml, application/xml, text/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error(`INCRA respondeu ${response.status}.`);
    const xml = await response.text();
    if (/ServiceException|ExceptionReport/i.test(xml) || !/<(?:wfs:)?FeatureCollection\b/i.test(xml)) {
      throw new Error("O serviço OGC do INCRA retornou uma resposta inválida.");
    }
    return {features:parseSigefGml(xml, point, tenure, bounds),returned:bounds ? (xml.match(/<gml:featureMember\b/g) ?? []).length : 0};
  }));
  const features = settled.flatMap((result) => result.status === "fulfilled" ? result.value.features : []);
  const returned = settled.reduce((sum, result) => sum + (result.status === "fulfilled" ? result.value.returned : 0), 0);
  const failedSources = settled.filter((result) => result.status === "rejected").length;
  return {
    features: features.slice(0, bounds ? 80 : 12),
    limited: Boolean(bounds && (returned >= 80 || returned > features.length || failedSources > 0)),
    status: features.length ? "available" : (bounds ? failedSources > 0 || returned > 0 : failedSources === tenures.length) ? "unavailable" : "no_match",
    failedSources,
  } as const;
}

export async function queryCarAtPoint(
  point: GeoPoint,
  uf: string,
  fetcher: typeof fetch = fetch,
  bounds?: GeoBounds,
) {
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) throw new Error("Latitude inválida.");
  if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) throw new Error("Longitude inválida.");
  if (!BRAZIL_UFS.has(uf.toUpperCase())) throw new Error("UF inválida.");
  if (bounds && !validGeoBounds(bounds)) throw new Error("Área de consulta inválida.");
  try {
    const response = await fetcher(carWfsUrl(uf, point, bounds), {
      headers: { Accept: "application/geo+json, application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error(`SICAR respondeu ${response.status}.`);
    const source = await response.text();
    const features = parseCarGeoJson(source, point, bounds).slice(0, bounds ? 80 : 12);
    const returned = bounds ? (JSON.parse(source).features?.length ?? 0) : 0;
    return {
      features,
      limited: Boolean(bounds && (returned >= 80 || returned > features.length)),
      status: features.length ? "available" : returned > 0 ? "unavailable" : "no_match",
      failedSources: 0,
    } as const;
  } catch {
    return {
      features: [] as CarBoundary[],
      status: "unavailable",
      failedSources: 1,
    } as const;
  }
}
