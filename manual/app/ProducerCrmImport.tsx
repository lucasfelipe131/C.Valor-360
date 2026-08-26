"use client";

import { ChangeEvent, useState } from "react";
import { saveRecord } from "./records";

export type CrmCropArea = {
  crop: string;
  areaHa: number;
  propertyName: string;
  season: string;
};

export type CrmPropertyRecord = {
  id: string;
  name: string;
  code: string;
  city: string;
  areaHa: number;
  crops: string[];
  source: string;
};

export type CrmProducer = {
  id: string;
  name: string;
  crmCode?: string;
  document: string;
  phone: string;
  email: string;
  city: string;
  properties: string;
  area: number;
  cultureArea?: number;
  cropAreas?: CrmCropArea[];
  propertyRecords?: CrmPropertyRecord[];
  season?: string;
  cultures?: string[];
  notes: string;
  fields: unknown[];
  mappingStatus?: "pending" | "mapped";
  crmSource?: string;
};

type RawRow = Record<string, unknown>;
type PreviewProducer = CrmProducer & {
  confidence?: number;
  uncertainFields?: string[];
};

type AiImportResponse = {
  sourceSummary?: string;
  confidence?: "alta" | "média" | "baixa";
  warnings?: string[];
  unlinkedProperties?: Array<{ name?: string; code?: string; city?: string; areaHa?: number }>;
  producers?: Array<{
    name?: string;
    crmCode?: string;
    document?: string;
    phone?: string;
    email?: string;
    city?: string;
    properties?: string;
    area?: number;
    cultureArea?: number;
    cropAreas?: Array<{ crop?: string; areaHa?: number; propertyName?: string; season?: string }>;
    propertyRecords?: Array<{ name?: string; code?: string; city?: string; areaHa?: number; crops?: string[] }>;
    season?: string;
    cultures?: string[];
    notes?: string;
    confidence?: number;
    uncertainFields?: string[];
  }>;
  error?: string;
};

const aliases = {
  name: ["nome", "nome completo", "razao social", "cliente", "cliente conglomerado", "conglomerado", "produtor", "contato", "account name", "customer"],
  crmCode: ["codigo", "codigo cliente", "cod cliente", "id cliente", "crm", "crm code"],
  document: ["cpf", "cnpj", "cpf cnpj", "documento", "doc", "document"],
  phone: ["whatsapp", "telefone", "celular", "fone", "mobile", "phone"],
  email: ["email", "e mail", "correio eletronico"],
  city: ["municipio", "cidade", "city", "localidade"],
  state: ["uf", "estado", "state"],
  property: ["propriedade", "fazenda", "propriedade principal", "farm", "unidade produtiva", "imovel rural"],
  propertyCode: ["id propriedade", "codigo propriedade", "cod propriedade", "property id"],
  area: ["area total", "area propriedade", "area explorada", "hectares total", "area atendida", "area"],
  cultureArea: ["area cultura", "area de cultura", "area cultivada", "area plantada", "area agricola", "hectares cultura"],
  cultures: ["cultura", "culturas", "culture", "crop"],
  season: ["safra", "ciclo", "temporada", "season"],
  notes: ["observacoes", "observacao", "notas", "descricao", "notes"],
} as const;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function findValue(row: RawRow, candidates: readonly string[]) {
  const entries = Object.entries(row);
  const exact = entries.find(([key]) => candidates.some((candidate) => normalize(key) === candidate));
  if (exact) return exact[1];
  const partial = entries.find(([key]) => candidates.some((candidate) => normalize(key).includes(candidate)));
  return partial?.[1] ?? "";
}

function findExactValue(row: RawRow, candidates: readonly string[]) {
  const match = Object.entries(row).find(([key]) => candidates.some((candidate) => normalize(key) === candidate));
  return match?.[1] ?? "";
}

function areaNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/\s*(ha|hectares?)\s*$/i, "").replace(/\s/g, "");
  if (!raw) return 0;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, "")) || 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  return Number(normalized.replace(/[^0-9.-]/g, "")) || 0;
}

function splitNameAndCode(value: unknown) {
  const raw = text(value).replace(/\s+/g, " ");
  const match = raw.match(/^(.*?)\s*-\s*(\d{6,})\s*$/);
  if (!match) return { name: raw, crmCode: "" };
  return { name: match[1].trim(), crmCode: match[2] };
}

function cultures(value: unknown) {
  return text(value)
    .split(/[;,/|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

const knownCrops = [
  { name: "Soja", aliases: ["soja"] },
  { name: "Milho", aliases: ["milho", "safrinha"] },
  { name: "Trigo", aliases: ["trigo"] },
  { name: "Canola", aliases: ["canola"] },
  { name: "Arroz", aliases: ["arroz"] },
  { name: "Aveia", aliases: ["aveia"] },
  { name: "Cevada", aliases: ["cevada"] },
  { name: "Feijão", aliases: ["feijao"] },
  { name: "Pastagem", aliases: ["pastagem", "pecuaria"] },
] as const;

function canonicalCrop(value: unknown) {
  const raw = text(value);
  const normalized = normalize(raw);
  const match = knownCrops.find((item) => item.aliases.some((alias) => normalized.includes(alias)));
  return match?.name ?? raw.slice(0, 80);
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSeason(value: unknown) {
  const raw = text(value);
  const labeled = raw.match(/safra\s*:\s*([^\n\r]+)/i);
  if (labeled) return labeled[1].trim().replace(/\s+/g, " ").slice(0, 60);
  const direct = raw.match(/(?:ver[aã]o|inverno)\s*\/?\s*\d{4}(?:[-/]\d{2,4})?|\d{4}\s*\/\s*\d{4}/i);
  return direct?.[0]?.replace(/\s+/g, "") ?? "";
}

function parsePropertyToken(value: unknown) {
  const raw = text(value).replace(/\s+/g, " ");
  if (!raw) return null;
  const idOnly = raw.match(/^(?:id|codigo|cod\.?)?\s*propriedade\s*[-:#]?\s*(\d{4,})$/i);
  if (idOnly) return { name: "Propriedade " + idOnly[1], code: idOnly[1] };
  const named = raw.match(/^(.*?)\s*[-#]\s*(\d{4,})$/);
  if (named && /fazenda|sitio|chacara|estancia|propriedade|area/i.test(named[1])) {
    return { name: named[1].trim(), code: named[2] };
  }
  return { name: raw, code: "" };
}

function propertyRecordsFromRow(
  row: RawRow,
  fileName: string,
  city: string,
  areaHa: number,
  cropList: string[],
) {
  const names = cultures(findExactValue(row, aliases.property));
  const codes = cultures(findExactValue(row, aliases.propertyCode));
  const count = Math.max(names.length, codes.length);
  const records: CrmPropertyRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = parsePropertyToken(names[index] || codes[index]);
    if (!parsed) continue;
    records.push({
      id: crypto.randomUUID(),
      name: parsed.name,
      code: codes[index] || parsed.code,
      city,
      areaHa: count === 1 ? Math.max(0, areaHa) : 0,
      crops: cropList,
      source: fileName,
    });
  }
  return records;
}

function cropAreasFromRow(
  row: RawRow,
  cultureArea: number,
  cropList: string[],
  propertyName: string,
  season: string,
) {
  const results: CrmCropArea[] = [];
  for (const [key, value] of Object.entries(row)) {
    const header = normalize(key);
    const crop = knownCrops.find((item) => item.aliases.some((alias) => header.includes(alias)));
    if (!crop || !/(^| )(area|ha|hectare)( |$)/.test(header)) continue;
    const areaHa = Math.max(0, areaNumber(value));
    if (areaHa) results.push({ crop: crop.name, areaHa, propertyName, season });
  }
  if (!results.length && cultureArea > 0 && cropList.length === 1) {
    results.push({ crop: canonicalCrop(cropList[0]), areaHa: cultureArea, propertyName, season });
  }
  const merged = new Map<string, CrmCropArea>();
  for (const item of results) {
    const key = normalize(item.crop) + "|" + normalize(item.propertyName) + "|" + normalize(item.season);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, areaHa: Math.max(previous.areaHa, item.areaHa) } : item);
  }
  return Array.from(merged.values());
}

function fieldsFromProperties(records: CrmPropertyRecord[], cropAreas: CrmCropArea[], season: string) {
  return records.map((record) => {
    const linked = cropAreas.filter((item) => !item.propertyName || normalize(item.propertyName) === normalize(record.name));
    const linkedArea = linked.reduce((sum, item) => sum + item.areaHa, 0);
    return {
      id: crypto.randomUUID(),
      name: record.name,
      crop: linked.length === 1 ? linked[0].crop : record.crops.length === 1 ? record.crops[0] : "",
      season,
      area: record.areaHa || linkedArea,
      points: [],
      ndviScenes: [],
      crmPropertyCode: record.code,
      crmSource: record.source,
    };
  });
}

function keyOf(producer: Pick<CrmProducer, "name" | "document" | "email" | "phone" | "crmCode">) {
  return normalize(producer.crmCode || producer.document || producer.email || producer.phone || producer.name);
}

function fromRawRow(row: RawRow, fileName: string): PreviewProducer | null {
  const rawName = findValue(row, aliases.name);
  const parsedName = splitNameAndCode(rawName);
  const normalizedName = normalize(parsedName.name);
  if (!parsedName.name || /^(total|subtotal|soma|safra|cliente conglomerado|id propriedade)( |:|$)/.test(normalizedName)) return null;
  const city = text(findValue(row, aliases.city));
  const state = text(findValue(row, aliases.state));
  const fullCity = city && state && !city.toLowerCase().includes(state.toLowerCase()) ? city + "/" + state : city || state;
  const season = parseSeason(findValue(row, aliases.season));
  const sourceCultures = cultures(findExactValue(row, aliases.cultures)).map(canonicalCrop);
  const totalArea = Math.max(0, areaNumber(findExactValue(row, aliases.area)));
  const cultureArea = Math.max(0, areaNumber(findExactValue(row, aliases.cultureArea)));
  const rawProperties = text(findExactValue(row, aliases.property));
  const firstProperty = parsePropertyToken(rawProperties)?.name ?? "";
  const cropAreaList = cropAreasFromRow(row, cultureArea, sourceCultures, firstProperty, season);
  const cropAreaTotal = cropAreaList.reduce((sum, item) => sum + item.areaHa, 0);
  const area = totalArea || cultureArea || cropAreaTotal;
  const propertyRecords = propertyRecordsFromRow(row, fileName, fullCity, area, sourceCultures);
  const cropList = uniqueText([...sourceCultures, ...cropAreaList.map((item) => item.crop)]);
  const uncertainFields = [
    cultureArea > 0 && cropAreaList.length === 0 ? "cultura da área" : "",
    rawProperties && !propertyRecords.length ? "propriedade" : "",
  ].filter(Boolean);
  return {
    id: crypto.randomUUID(),
    name: parsedName.name,
    crmCode: text(findValue(row, aliases.crmCode)) || parsedName.crmCode,
    document: text(findValue(row, aliases.document)),
    phone: text(findValue(row, aliases.phone)),
    email: text(findValue(row, aliases.email)),
    city: fullCity,
    properties: propertyRecords.map((item) => item.name).join("; ") || rawProperties,
    area,
    cultureArea: cultureArea || cropAreaTotal,
    cropAreas: cropAreaList,
    propertyRecords,
    season,
    cultures: cropList,
    notes: [text(findValue(row, aliases.notes)), "Importado de " + fileName + ". Confira os dados antes de mapear os talhões."].filter(Boolean).join(" · "),
    fields: fieldsFromProperties(propertyRecords, cropAreaList, season),
    mappingStatus: "pending",
    crmSource: fileName,
    uncertainFields,
  };
}
function rowsFromWorkbook(workbook: { SheetNames: string[]; Sheets: Record<string, unknown> }, XLSX: typeof import("xlsx"), fileName: string) {
  const result: PreviewProducer[] = [];
  const unlinkedProperties: CrmPropertyRecord[] = [];
  let carriedHeaders: string[] = [];
  let carriedSeason = "";
  let carriedCity = "";
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName] as never, {
      header: 1,
      defval: "",
      raw: true,
    });
    let headers = carriedHeaders;
    for (const values of rows) {
      if (!Array.isArray(values) || !values.some((value) => text(value))) continue;
      const combinedText = values.map((value) => text(value)).join("\n");
      const detectedSeason = parseSeason(combinedText);
      const unitMatch = combinedText.match(/unidade\s*:\s*([^\n\r]+)/i);
      if (detectedSeason) carriedSeason = detectedSeason;
      if (unitMatch) carriedCity = unitMatch[1].trim().replace(/\s+/g, " ").slice(0, 100);

      const normalizedCells = values.map((value) => normalize(text(value)));
      const isHeader = normalizedCells.some((value) =>
        aliases.name.some((alias) => value === alias || value.includes(alias)),
      ) && normalizedCells.some((value) =>
        [...aliases.area, ...aliases.cultureArea, ...aliases.document, ...aliases.phone].some((alias) => value === alias || value.includes(alias)),
      );
      if (isHeader) {
        const firstHeader = normalizedCells[0] ?? "";
        const combinedClientArea = aliases.name.some((alias) => firstHeader.includes(alias))
          && aliases.cultureArea.some((alias) => firstHeader.includes(alias));
        headers = combinedClientArea
          ? ["cliente", "area cultura", ...values.slice(1).map((value, index) => text(value) || "coluna " + (index + 3))]
          : values.map((value, index) => text(value) || "coluna " + (index + 1));
        carriedHeaders = headers;
        continue;
      }

      const first = text(values[0]);
      const standaloneProperty = /^(?:id|codigo|cod\.?)?\s*propriedade\s*[-:#]?\s*\d{4,}$/i.test(first);
      if (standaloneProperty) {
        const parsedProperty = parsePropertyToken(first);
        if (parsedProperty) {
          unlinkedProperties.push({
            id: crypto.randomUUID(),
            name: parsedProperty.name,
            code: parsedProperty.code,
            city: carriedCity,
            areaHa: Math.max(0, areaNumber(values[1])),
            crops: [],
            source: fileName,
          });
        }
        continue;
      }

      const parsedFirst = splitNameAndCode(first);
      const hasCrmPattern = Boolean(parsedFirst.crmCode && parsedFirst.name);
      let row: RawRow = {};
      if (headers.length) {
        row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      } else if (hasCrmPattern) {
        row = { cliente: first, "area cultura": values[1] ?? "" };
      } else {
        continue;
      }

      if (hasCrmPattern) {
        row = {
          cliente: first,
          "area cultura": values[1] ?? "",
          safra: carriedSeason,
          municipio: carriedCity,
          ...row,
        };
      }
      const producer = fromRawRow(row, fileName);
      if (producer) result.push(producer);
    }
  }
  const uniqueProperties = new Map<string, CrmPropertyRecord>();
  for (const property of unlinkedProperties) {
    const key = normalize(property.code || property.name);
    if (key && !uniqueProperties.has(key)) uniqueProperties.set(key, property);
  }
  return { producers: result, unlinkedProperties: Array.from(uniqueProperties.values()) };
}
function mergeAndFilter(items: PreviewProducer[], producers: CrmProducer[]) {
  const existing = new Set(producers.map(keyOf));
  const merged = new Map<string, PreviewProducer>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key || existing.has(key)) continue;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    const cropAreas = new Map<string, CrmCropArea>();
    for (const cropArea of [...(previous.cropAreas ?? []), ...(item.cropAreas ?? [])]) {
      const cropKey = normalize(cropArea.crop) + "|" + normalize(cropArea.propertyName) + "|" + normalize(cropArea.season);
      const current = cropAreas.get(cropKey);
      cropAreas.set(cropKey, current ? { ...current, areaHa: Math.max(current.areaHa, cropArea.areaHa) } : cropArea);
    }
    const propertyRecords = new Map<string, CrmPropertyRecord>();
    for (const property of [...(previous.propertyRecords ?? []), ...(item.propertyRecords ?? [])]) {
      const propertyKey = normalize(property.code || property.name);
      if (propertyKey && !propertyRecords.has(propertyKey)) propertyRecords.set(propertyKey, property);
    }
    const nextCropAreas = Array.from(cropAreas.values());
    const nextProperties = Array.from(propertyRecords.values());
    const season = previous.season || item.season || "";
    const derivedCultureArea = nextCropAreas.reduce((sum, cropArea) => sum + cropArea.areaHa, 0);
    merged.set(key, {
      ...previous,
      ...item,
      name: previous.name || item.name,
      crmCode: previous.crmCode || item.crmCode,
      document: previous.document || item.document,
      phone: previous.phone || item.phone,
      email: previous.email || item.email,
      city: previous.city || item.city,
      properties: nextProperties.map((property) => property.name).join("; ") || previous.properties || item.properties,
      area: Math.max(previous.area, item.area),
      cultureArea: derivedCultureArea || Math.max(previous.cultureArea ?? 0, item.cultureArea ?? 0),
      cropAreas: nextCropAreas,
      propertyRecords: nextProperties,
      season,
      cultures: uniqueText([...(previous.cultures ?? []), ...(item.cultures ?? []), ...nextCropAreas.map((cropArea) => cropArea.crop)]),
      fields: nextProperties.length ? fieldsFromProperties(nextProperties, nextCropAreas, season) : [...previous.fields, ...item.fields],
      notes: previous.notes.length >= item.notes.length ? previous.notes : item.notes,
      uncertainFields: uniqueText([...(previous.uncertainFields ?? []), ...(item.uncertainFields ?? [])]),
    });
  }
  return Array.from(merged.values());
}
function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível abrir o arquivo."));
    reader.readAsDataURL(file);
  });
}

export default function ProducerCrmImport({
  producers,
  onImport,
}: {
  producers: CrmProducer[];
  onImport: (items: CrmProducer[]) => void;
}) {
  const [preview, setPreview] = useState<PreviewProducer[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unlinkedProperties, setUnlinkedProperties] = useState<CrmPropertyRecord[]>([]);
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState<"local" | "ai" | "">("");

  async function recognizeWithAi(file: File) {
    if (file.size > 14 * 1024 * 1024) throw new Error("O arquivo precisa ter no máximo 14 MB para a leitura por IA.");
    setReading(true);
    setMessage("A IA está identificando clientes, códigos, propriedades e áreas…");
    setWarnings([]);
    setUnlinkedProperties([]);
    try {
      const response = await fetch("/api/producer-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileData: await fileDataUrl(file) }),
      });
      const data = (await response.json()) as AiImportResponse;
      if (!response.ok) throw new Error(data.error || "A IA não conseguiu ler este arquivo.");
      const aiItems: PreviewProducer[] = (data.producers ?? []).map((item) => {
        const season = text(item.season);
        const sourceCropAreas: CrmCropArea[] = Array.isArray(item.cropAreas)
          ? item.cropAreas.map((cropArea) => ({
              crop: canonicalCrop(cropArea.crop),
              areaHa: Math.max(0, Number(cropArea.areaHa) || 0),
              propertyName: text(cropArea.propertyName),
              season: text(cropArea.season) || season,
            })).filter((cropArea) => cropArea.crop && cropArea.areaHa > 0)
          : [];
        const cropList = uniqueText([
          ...(Array.isArray(item.cultures) ? item.cultures.map(canonicalCrop).filter(Boolean) : []),
          ...sourceCropAreas.map((cropArea) => cropArea.crop),
        ]);
        const cultureArea = Math.max(0, Number(item.cultureArea) || sourceCropAreas.reduce((sum, cropArea) => sum + cropArea.areaHa, 0));
        const rawPropertyRecords: CrmPropertyRecord[] = Array.isArray(item.propertyRecords)
          ? item.propertyRecords.map((property) => {
              const parsed = parsePropertyToken(property.name || property.code);
              return {
                id: crypto.randomUUID(),
                name: parsed?.name || text(property.name),
                code: text(property.code) || parsed?.code || "",
                city: text(property.city) || text(item.city),
                areaHa: Math.max(0, Number(property.areaHa) || 0),
                crops: Array.isArray(property.crops) ? property.crops.map(canonicalCrop).filter(Boolean) : cropList,
                source: file.name,
              };
            }).filter((property) => property.name)
          : [];
        const fallbackProperties = rawPropertyRecords.length ? rawPropertyRecords : propertyRecordsFromRow(
          { propriedade: item.properties ?? "" },
          file.name,
          text(item.city),
          Math.max(0, Number(item.area) || cultureArea),
          cropList,
        );
        const area = Math.max(0, Number(item.area) || cultureArea);
        return {
          id: crypto.randomUUID(),
          name: text(item.name),
          crmCode: text(item.crmCode),
          document: text(item.document),
          phone: text(item.phone),
          email: text(item.email),
          city: text(item.city),
          properties: fallbackProperties.map((property) => property.name).join("; ") || text(item.properties),
          area,
          cultureArea,
          cropAreas: sourceCropAreas,
          propertyRecords: fallbackProperties,
          season,
          cultures: cropList,
          notes: [text(item.notes), "Reconhecido por IA em " + file.name + ". Conferência humana obrigatória."].filter(Boolean).join(" · "),
          fields: fieldsFromProperties(fallbackProperties, sourceCropAreas, season),
          mappingStatus: "pending" as const,
          crmSource: file.name,
          confidence: Number(item.confidence) || 0,
          uncertainFields: Array.isArray(item.uncertainFields) ? item.uncertainFields.map(text).filter(Boolean) : [],
        };
      }).filter((item) => item.name);
      const aiUnlinked: CrmPropertyRecord[] = (data.unlinkedProperties ?? []).map((property) => {
        const parsed = parsePropertyToken(property.name || property.code);
        return {
          id: crypto.randomUUID(),
          name: parsed?.name || text(property.name),
          code: text(property.code) || parsed?.code || "",
          city: text(property.city),
          areaHa: Math.max(0, Number(property.areaHa) || 0),
          crops: [],
          source: file.name,
        };
      }).filter((property) => property.name);
      const imported = mergeAndFilter(aiItems, producers);
      setPreview(imported);
      setUnlinkedProperties(aiUnlinked);
      setSource("ai");
      setWarnings([
        ...(data.warnings ?? []),
        ...(aiUnlinked.length ? [aiUnlinked.length + " propriedade(s) foram reconhecidas, mas ainda não têm produtor vinculado."] : []),
      ]);
      setMessage(imported.length
        ? `${imported.length} produtores reconhecidos por IA (${data.confidence ?? "confiança não informada"}). Revise a prévia antes de importar.`
        : "A leitura terminou, mas não encontrou novos clientes para importar.");
    } finally {
      setReading(false);
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSelectedFile(file);
    setReading(true);
    setMessage("");
    setWarnings([]);
    setUnlinkedProperties([]);
    setPreview([]);
    setSource("");
    setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      if (/\.(pdf|png|jpe?g|webp)$/i.test(lower)) {
        await recognizeWithAi(file);
        return;
      }
      let items: PreviewProducer[] = [];
      let detectedUnlinked: CrmPropertyRecord[] = [];
      if (lower.endsWith(".json")) {
        const parsed = JSON.parse(await file.text()) as unknown;
        const rows = Array.isArray(parsed) ? parsed as RawRow[] : [];
        items = rows.map((row) => fromRawRow(row, file.name)).filter(Boolean) as PreviewProducer[];
      } else if (lower.endsWith(".txt")) {
        const rows = (await file.text()).split(/\r?\n/).map((line) => ({ cliente: line }));
        items = rows.map((row) => fromRawRow(row, file.name)).filter(Boolean) as PreviewProducer[];
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true, cellDates: false });
        const parsedWorkbook = rowsFromWorkbook(workbook, XLSX, file.name);
        items = parsedWorkbook.producers;
        detectedUnlinked = parsedWorkbook.unlinkedProperties;
      }
      const imported = mergeAndFilter(items, producers);
      setUnlinkedProperties(detectedUnlinked);
      if (!imported.length) {
        await recognizeWithAi(file);
        return;
      }
      setPreview(imported);
      setSource("local");
      const missingCropCount = imported.filter((item) => (item.cultureArea ?? 0) > 0 && !(item.cropAreas?.length)).length;
      setWarnings([
        ...(missingCropCount ? [missingCropCount + " produtor(es) têm Área Cultura, mas o arquivo não informa qual é a cultura."] : []),
        ...(detectedUnlinked.length ? [detectedUnlinked.length + " propriedade(s) foram encontradas sem produtor vinculado e ficaram pendentes para conferência."] : []),
      ]);
      setMessage(imported.length + " produtores lidos no próprio dispositivo, com Área Cultura separada da área total e propriedades vinculadas cadastradas automaticamente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ler o arquivo do CRM.");
    } finally {
      setReading(false);
    }
  }

  async function confirm() {
    if (!preview.length) return;
    const items: CrmProducer[] = preview.map(({ confidence: _confidence, uncertainFields: _uncertainFields, ...item }) => item);
    const linkedPropertyCount = items.reduce((sum, item) => sum + (item.propertyRecords?.length ?? 0), 0);
    onImport(items);
    try {
      await saveRecord({
        type: "crm_import",
        title: "Importação de CRM · " + fileName,
        payload: {
          fileName,
          recognition: source === "ai" ? "IA com conferência" : "leitura local",
          producerCount: items.length,
          linkedPropertyCount,
          unlinkedProperties: unlinkedProperties.map((property) => ({ name: property.name, code: property.code, city: property.city, areaHa: property.areaHa })),
          producers: items.map((item) => ({
            id: item.id,
            name: item.name,
            crmCode: item.crmCode,
            totalArea: item.area,
            cultureArea: item.cultureArea,
            cropAreas: item.cropAreas,
            properties: item.propertyRecords?.map((property) => ({ name: property.name, code: property.code, areaHa: property.areaHa })),
          })),
          savedAt: new Date().toISOString(),
        },
      });
      setMessage(items.length + " produtores e " + linkedPropertyCount + " propriedade(s) vinculada(s) foram cadastrados e sincronizados com a conta." + (unlinkedProperties.length ? " " + unlinkedProperties.length + " propriedade(s) sem vínculo ficaram registradas para conferência." : ""));
    } catch (error) {
      setMessage((error instanceof Error ? error.message : "A integração com o VALOR 360 não foi confirmada.") + " Os produtores importados permanecem no workspace para nova tentativa.");
    }
    setPreview([]);
  }
  return (
    <section className="content-panel crm-import">
      <div className="panel-title">
        <div><span className="eyebrow">IMPORTAÇÃO INTELIGENTE DE CRM</span><h2>Excel, CSV, PDF, imagem e relatórios exportados</h2></div>
        <span className="verified-chip">Leitura local + IA</span>
      </div>
      <p>O importador percorre todas as abas, corrige cabeçalhos combinados como Cliente/Conglomerado + Área Cultura e reconhece área total, área de cultura por safra, culturas e propriedades vinculadas. Nenhum cadastro entra sem sua confirmação.</p>
      <div className="crm-privacy-note">
        <b>Backup automático:</b> a carteira confirmada é sincronizada por login. PDF ou planilha usada na IA é processada de forma transitória e não vira arquivo do sistema.
      </div>
      <div className="crm-actions">
        <label className="button secondary file-button">
          {reading ? "Analisando carteira…" : "Escolher carteira de clientes"}
          <input type="file" accept=".csv,.xls,.xlsx,.json,.txt,.pdf,.png,.jpg,.jpeg,.webp,text/csv,application/json,application/pdf,image/*" disabled={reading} onChange={(event) => void readFile(event)} />
        </label>
        {selectedFile && !reading && <button className="button secondary" onClick={() => void recognizeWithAi(selectedFile)}>Revisar com IA</button>}
        {preview.length > 0 && <button className="button primary" onClick={() => void confirm()}>Confirmar {preview.length} produtores</button>}
      </div>
      {message && <p className="crm-message"><b>{fileName && `${fileName}: `}</b>{message}</p>}
      {warnings.length > 0 && <div className="crm-warnings"><b>Pontos para conferir</b>{warnings.slice(0, 6).map((warning) => <span key={warning}>{warning}</span>)}</div>}
      {unlinkedProperties.length > 0 && (
        <div className="crm-warnings">
          <b>Propriedades encontradas sem produtor vinculado</b>
          {unlinkedProperties.slice(0, 6).map((property) => (
            <span key={property.id}>{property.name}{property.code ? " · ID " + property.code : ""}{property.areaHa ? " · " + property.areaHa.toLocaleString("pt-BR") + " ha" : ""}</span>
          ))}
          <small>Essas propriedades não serão atribuídas a um produtor automaticamente sem um vínculo sustentado pelo arquivo.</small>
        </div>
      )}
      {preview.length > 0 && (
        <div className="crm-preview">
          {preview.slice(0, 12).map((item) => (
            <span key={item.id} className={item.uncertainFields?.length ? "needs-review" : ""}>
              <b>{item.name}</b>
              <small>
                {item.crmCode ? "CRM " + item.crmCode + " · " : ""}
                {(item.cultureArea ?? 0) > 0
                  ? "Área Cultura " + (item.cultureArea ?? 0).toLocaleString("pt-BR") + " ha · "
                  : item.area ? "Área " + item.area.toLocaleString("pt-BR") + " ha · " : ""}
                {item.properties || item.city || "Dados básicos reconhecidos"}
              </small>
              {(item.cropAreas?.length ?? 0) > 0 && (
                <em>Por cultura: {item.cropAreas!.map((cropArea) => cropArea.crop + " " + cropArea.areaHa.toLocaleString("pt-BR") + " ha").join(" · ")}</em>
              )}
              {(item.propertyRecords?.length ?? 0) > 0 && (
                <em>{item.propertyRecords!.length} propriedade(s) preparada(s) para cadastro automático</em>
              )}
              {typeof item.confidence === "number" && <em>Confiança {item.confidence}%{item.uncertainFields?.length ? ` · conferir ${item.uncertainFields.join(", ")}` : ""}</em>}
            </span>
          ))}
          {preview.length > 12 && <span><b>+ {preview.length - 12}</b><small>outros cadastros reconhecidos</small></span>}
        </div>
      )}
    </section>
  );
}
