import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ZarcRow = {
  crop: string; cycle: string; soil: string; uf: string; municipality: string;
  managementCode: string; management: string; portaria: string; risks: number[];
};
type CacheEntry = { expiresAt: number; promise: Promise<ZarcRow[]> };

const SOURCES = [
  { safra: "2026/2027", url: "https://dados.agricultura.gov.br/dataset/6d3d141c-885e-41a4-ab7f-dc8ff323b96f/resource/139e5a60-1f43-4cc8-aeab-a35dbbf816c0/download/dados-abertos-tabua-de-risco-safra-2026-2027.csv" },
  { safra: "2025/2026", url: "https://dados.agricultura.gov.br/dataset/6d3d141c-885e-41a4-ab7f-dc8ff323b96f/resource/f9d597f9-0fee-47eb-9344-8642274ca9da/download/dados-abertos-tabua-de-risco-safra-2025-2026.csv" },
];
const SOURCE_PAGE = "https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico";
const globalCache = globalThis as typeof globalThis & { __zarcCache?: Map<string, CacheEntry> };
const cache = globalCache.__zarcCache ?? new Map<string, CacheEntry>();
globalCache.__zarcCache = cache;

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ªº]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function headerKey(value: string) { return normalize(value).replace(/ /g, ""); }
function numeric(value: string) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function* parseCsv(text: string, delimiter: string): Generator<string[]> {
  let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((item) => item.length > 0)) yield row;
      row = [];
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); yield row; }
}

function relevantCrop(name: string) {
  const value = normalize(name);
  return value.includes("soja") || value.includes("trigo") || value.includes("milho");
}

async function loadSource(url: string): Promise<ZarcRow[]> {
  const existing = cache.get(url);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const promise = (async () => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(55000) });
    if (!response.ok) throw new Error(`MAPA respondeu ${response.status}`);
    const text = await response.text();
    const firstLine = text.slice(0, text.indexOf("\n") > 0 ? text.indexOf("\n") : 1000);
    const delimiter = (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ";" : ",";
    const iterator = parseCsv(text.replace(/^\uFEFF/, ""), delimiter);
    const first = iterator.next();
    if (first.done) return [];
    const headers = first.value.map(headerKey);
    const idx = (...names: string[]) => names.map(headerKey).map((name) => headers.indexOf(name)).find((value) => value >= 0) ?? -1;
    const cropIndex = idx("Nome_cultura", "cultura");
    const cycleIndex = idx("Cod_Ciclo", "ciclo");
    const soilIndex = idx("Cod_Solo", "solo");
    const ufIndex = idx("UF");
    const municipalityIndex = idx("municipio", "município");
    const managementCodeIndex = idx("Cod_Outros_Manejos", "cod_manejo");
    const managementIndex = idx("Nome_Outros_Manejos", "manejo");
    const portariaIndex = idx("Portaria");
    const decIndexes = Array.from({ length: 36 }, (_, index) => idx(`dec${index + 1}`));
    if ([cropIndex, cycleIndex, soilIndex, ufIndex, municipalityIndex].some((value) => value < 0)) throw new Error("Formato da Tábua de Risco não reconhecido.");
    const rows: ZarcRow[] = [];
    for (const values of iterator) {
      const crop = values[cropIndex] ?? "";
      if (!relevantCrop(crop)) continue;
      rows.push({
        crop, cycle: values[cycleIndex] ?? "", soil: values[soilIndex] ?? "",
        uf: values[ufIndex] ?? "", municipality: values[municipalityIndex] ?? "",
        managementCode: managementCodeIndex >= 0 ? values[managementCodeIndex] ?? "" : "",
        management: managementIndex >= 0 ? values[managementIndex] ?? "" : "",
        portaria: portariaIndex >= 0 ? values[portariaIndex] ?? "" : "",
        risks: decIndexes.map((column) => column >= 0 ? numeric(values[column] ?? "") : 0),
      });
    }
    return rows;
  })();
  cache.set(url, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, promise });
  promise.catch(() => cache.delete(url));
  return promise;
}

function cropMatches(name: string, target: string) {
  const value = normalize(name);
  if (target === "soja") return value.includes("soja");
  if (target === "trigo") return value.includes("trigo");
  if (!value.includes("milho") || value.includes("consorci")) return false;
  const isSecond = /\b2\s*a?\s*safra\b/.test(value) || value.includes("segunda safra") || value.includes("safrinha");
  if (target === "milho-safrinha") return isSecond;
  return !isSecond && (/\b1\s*a?\s*safra\b/.test(value) || value.includes("primeira safra") || value === "milho");
}

function decDate(dec: number, end = false) {
  const month = Math.floor((dec - 1) / 3) + 1;
  const part = (dec - 1) % 3;
  const day = end ? (part === 0 ? 10 : part === 1 ? 20 : new Date(2025, month, 0).getDate()) : (part === 0 ? 1 : part === 1 ? 11 : 21);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}
function rangesFor(decendios: number[]) {
  if (!decendios.length) return [];
  const groups: number[][] = [];
  for (const dec of [...decendios].sort((a, b) => a - b)) {
    const current = groups[groups.length - 1];
    if (current && dec === current[current.length - 1] + 1) current.push(dec);
    else groups.push([dec]);
  }
  if (groups.length > 1 && groups[0][0] === 1 && groups[groups.length - 1].at(-1) === 36) {
    const first = groups.shift()!; const last = groups.pop()!; groups.unshift([...last, ...first]);
  }
  return groups.map((group) => `${decDate(group[0])} a ${decDate(group[group.length - 1], true)}`);
}

const cropLabels: Record<string, string> = { soja:"Soja", "milho-verao":"Milho verão · 1ª safra", "milho-safrinha":"Milho safrinha · 2ª safra", trigo:"Trigo" };
const soilLabels: Record<string, string> = { "1":"Arenoso · Tipo 1", "2":"Textura média · Tipo 2", "3":"Argiloso · Tipo 3", "11":"AD1", "12":"AD2", "13":"AD3", "14":"AD4", "15":"AD5", "16":"AD6" };
const cycleLabels: Record<string, string> = { "20":"Grupo I", "21":"Grupo II", "22":"Grupo III", "24":"Grupo IV", "25":"Grupo V", "26":"Grupo VI" };

export async function GET(request: NextRequest) {
  const uf = (request.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
  const municipality = request.nextUrl.searchParams.get("municipality") ?? "";
  const crop = request.nextUrl.searchParams.get("crop") ?? "";
  const soil = request.nextUrl.searchParams.get("soil") ?? "";
  const cycle = request.nextUrl.searchParams.get("cycle") ?? "";
  if (!uf || !municipality || !cropLabels[crop] || !soilLabels[soil] || !cycleLabels[cycle]) return NextResponse.json({ error:"Informe cultura, UF, município, solo e grupo de ciclo." }, { status:400 });

  let matched: ZarcRow[] = []; let usedSafra = "";
  const failures: string[] = [];
  const availableSoils = new Set<string>();
  const availableCycles = new Set<string>();
  for (const source of SOURCES) {
    try {
      const rows = await loadSource(source.url);
      const baseRows = rows.filter((row) => row.uf.toUpperCase() === uf && normalize(row.municipality) === normalize(municipality) && cropMatches(row.crop, crop) && (!row.managementCode || numeric(row.managementCode) === 1 || normalize(row.management).includes("sequeiro")));
      baseRows.forEach((row) => {
        availableSoils.add(String(numeric(row.soil)));
        availableCycles.add(String(numeric(row.cycle)));
      });
      matched = baseRows.filter((row) => String(numeric(row.soil)) === soil && String(numeric(row.cycle)) === cycle);
      if (matched.length) { usedSafra = source.safra; break; }
    } catch (error) { failures.push(error instanceof Error ? error.message : "Falha na fonte oficial"); }
  }
  if (!matched.length) {
    const soilOptions = [...availableSoils].map((value) => soilLabels[value] || value).join(", ");
    const cycleOptions = [...availableCycles].map((value) => cycleLabels[value] || value).join(", ");
    const guidance = availableSoils.size || availableCycles.size ? ` A portaria vigente para este município utiliza solo(s): ${soilOptions || "não informado"}; grupo(s): ${cycleOptions || "não informado"}.` : " Confira o grupo de ciclo e a classe de solo adotados na portaria vigente.";
    const detail = failures.length === SOURCES.length ? " A fonte oficial está temporariamente indisponível." : guidance;
    return NextResponse.json({ error: `Não há janela ZARC encontrada para ${cropLabels[crop]} em ${municipality}/${uf}.${detail}` }, { status:404 });
  }

  const windows = ([20, 30, 40] as const).map((risk) => {
    const allowed = new Set<number>();
    for (const row of matched) row.risks.forEach((value, index) => { if (value > 0 && value <= risk) allowed.add(index + 1); });
    const decendios = [...allowed].sort((a, b) => a - b);
    return { risk, decendios, ranges: rangesFor(decendios) };
  });
  const portarias = [...new Set(matched.map((row) => row.portaria.trim()).filter(Boolean))].slice(0, 4);
  return NextResponse.json({
    cropLabel: cropLabels[crop], municipality: matched[0].municipality, uf, safra: usedSafra,
    soilLabel: soilLabels[soil], cycleLabel: cycleLabels[cycle], management:"Sequeiro",
    portarias, windows, updatedAt: new Date().toISOString(), sourceUrl: SOURCE_PAGE,
  }, { headers:{ "Cache-Control":"public, s-maxage=21600, stale-while-revalidate=86400" } });
}
