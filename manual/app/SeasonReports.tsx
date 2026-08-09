"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { GState, jsPDF } from "jspdf";
import agrofitProductsData from "./agrofit-products.json";
import cultivarsData from "./cultivars.json";
import fertilizerFormulasData from "./fertilizer-formulas.json";
import foliarProductsData from "./foliar-products.json";
import { listRecords, saveRecord } from "./records";

type ReportField = {
  id: string;
  name: string;
  crop: string;
  season: string;
  area: number;
};

type ReportProducer = {
  id: string;
  name: string;
  properties: string;
  area: number;
  fields: ReportField[];
};

type ReportProfile = {
  name: string;
  profession: string;
  council: string;
  registration: string;
  company: string;
  phone: string;
  watermark: string;
  watermarkOpacity: number;
};

type CostCategory =
  | "fertilizantes"
  | "sementes"
  | "herbicidas"
  | "inseticidas"
  | "fungicidas"
  | "nutricao"
  | "mao-de-obra"
  | "equipamentos"
  | "diesel"
  | "colheita"
  | "outros";

type CostUnit =
  | "kg/ha"
  | "t/ha"
  | "L/ha"
  | "mL/ha"
  | "g/ha"
  | "saco/ha"
  | "un./ha"
  | "h/ha"
  | "R$/ha";

type PriceBasis =
  | "R$/kg"
  | "R$/t"
  | "R$/L"
  | "R$/saco"
  | "R$/un."
  | "R$/h"
  | "direto";

type CostItem = {
  id: string;
  category: CostCategory;
  name: string;
  dose: number;
  unit: CostUnit;
  unitPrice: number;
  priceBasis?: PriceBasis;
};

type GrainCrop = "Soja" | "Milho" | "Trigo" | "Canola";

type GrainPrices = Record<GrainCrop, number>;

type ReportPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  description: string;
};

type ImportedCostItem = CostItem & {
  selected: boolean;
  sourceRow: number;
};

type SeasonReport = {
  id: string;
  producerId: string;
  property: string;
  fieldId: string;
  crop: string;
  season: string;
  area: number;
  plantingDate: string;
  harvestDate: string;
  yieldScHa: number;
  salePrice: number;
  grainPrices: GrainPrices;
  notes: string;
  watermark: boolean;
  items: CostItem[];
  photos: ReportPhoto[];
  updatedAt: string;
};

type ReportCatalogOption = {
  name: string;
  detail: string;
};

type CatalogAgrochemical = {
  name: string;
  active: string;
  maker: string;
  type?: string;
};

type CatalogFertilizer = {
  name: string;
  maker: string;
  category: string;
};

type CatalogCultivar = {
  name: string;
  brand: string;
  crop: string;
};

type CatalogFoliar = {
  name: string;
  maker: string;
  category: string;
  composition?: string;
};

type CatalogCultivars = {
  soybean: CatalogCultivar[];
  corn: CatalogCultivar[];
  wheat: CatalogCultivar[];
  canola: CatalogCultivar[];
};

const categories: Array<{
  key: CostCategory;
  label: string;
  short: string;
}> = [
  { key: "fertilizantes", label: "Fertilizantes", short: "Fertilizantes" },
  { key: "sementes", label: "Sementes", short: "Sementes" },
  { key: "herbicidas", label: "Herbicidas", short: "Herbicidas" },
  { key: "inseticidas", label: "Inseticidas", short: "Inseticidas" },
  { key: "fungicidas", label: "Fungicidas", short: "Fungicidas" },
  { key: "nutricao", label: "Nutrição foliar", short: "Nutrição" },
  { key: "mao-de-obra", label: "Mão de obra", short: "Mão de obra" },
  { key: "equipamentos", label: "Máquinas/equipamentos", short: "Máquinas" },
  { key: "diesel", label: "Diesel", short: "Diesel" },
  { key: "colheita", label: "Colheita", short: "Colheita" },
  { key: "outros", label: "Outros custos", short: "Outros" },
];

const costUnits: CostUnit[] = [
  "kg/ha",
  "t/ha",
  "L/ha",
  "mL/ha",
  "g/ha",
  "saco/ha",
  "un./ha",
  "h/ha",
  "R$/ha",
];

const grainCrops: GrainCrop[] = ["Soja", "Milho", "Trigo", "Canola"];
const emptyGrainPrices = (): GrainPrices => ({
  Soja: 0,
  Milho: 0,
  Trigo: 0,
  Canola: 0,
});

const chartColors = [
  "#1d6b50",
  "#9bbf3f",
  "#d8a928",
  "#3d8ca8",
  "#765aa6",
  "#d66e42",
  "#5f7f72",
  "#a85b7c",
  "#708a34",
  "#c38b58",
  "#596c85",
];

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueCatalog(options: ReportCatalogOption[]) {
  return Array.from(
    new Map(
      options.map((option) => [normalizeCatalogText(option.name), option]),
    ).values(),
  ).sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
}

const agrochemicalCatalog = agrofitProductsData as CatalogAgrochemical[];
const fertilizerCatalog = fertilizerFormulasData as CatalogFertilizer[];
const cultivarCatalog = cultivarsData as CatalogCultivars;
const foliarCatalog = foliarProductsData as CatalogFoliar[];

function agrochemicalOptions(pattern: RegExp) {
  return uniqueCatalog(
    agrochemicalCatalog
      .filter((product) =>
        product.type ? pattern.test(normalizeCatalogText(product.type)) : false,
      )
      .map((product) => ({
        name: product.name,
        detail: [product.active, product.maker].filter(Boolean).join(" · "),
      })),
  );
}

const reportCatalogs: Partial<
  Record<CostCategory, ReportCatalogOption[]>
> = {
  fertilizantes: uniqueCatalog(
    fertilizerCatalog.map((product) => ({
      name: product.name,
      detail: `${product.maker} · ${product.category}`,
    })),
  ),
  sementes: uniqueCatalog(
    Object.values(cultivarCatalog)
      .flat()
      .map((cultivar) => ({
        name: cultivar.name,
        detail: `${cultivar.crop} · ${cultivar.brand}`,
      })),
  ),
  herbicidas: agrochemicalOptions(/herbic/),
  inseticidas: agrochemicalOptions(/insetic|acaric/),
  fungicidas: agrochemicalOptions(/fungic/),
  nutricao: uniqueCatalog(
    foliarCatalog.map((product) => ({
      name: product.name,
      detail: [product.composition || product.category, product.maker]
        .filter(Boolean)
        .join(" · "),
    })),
  ),
};

function blankReport(producer?: ReportProducer): SeasonReport {
  return {
    id: crypto.randomUUID(),
    producerId: producer?.id ?? "",
    property: producer?.properties ?? "",
    fieldId: producer?.fields?.[0]?.id ?? "",
    crop: producer?.fields?.[0]?.crop || "Soja",
    season: producer?.fields?.[0]?.season || "",
    area: producer?.fields?.[0]?.area || producer?.area || 0,
    plantingDate: "",
    harvestDate: "",
    yieldScHa: 0,
    salePrice: 0,
    grainPrices: emptyGrainPrices(),
    notes: "",
    watermark: true,
    items: [],
    photos: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeReport(report: SeasonReport): SeasonReport {
  return {
    ...report,
    grainPrices: { ...emptyGrainPrices(), ...(report.grainPrices ?? {}) },
    items: Array.isArray(report.items) ? report.items : [],
    photos: Array.isArray(report.photos) ? report.photos : [],
  };
}

function decimal(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function categoryLabel(category: CostCategory) {
  return categories.find((item) => item.key === category)?.label ?? category;
}

function defaultPriceBasis(category: CostCategory, unit: CostUnit): PriceBasis {
  if (unit === "R$/ha") return "direto";
  if (unit === "kg/ha" || unit === "t/ha" || unit === "g/ha") {
    return category === "fertilizantes" ? "R$/t" : "R$/kg";
  }
  if (unit === "L/ha" || unit === "mL/ha") return "R$/L";
  if (unit === "saco/ha") return "R$/saco";
  if (unit === "un./ha") return "R$/un.";
  return "R$/h";
}

function resolvedPriceBasis(item: CostItem) {
  return item.priceBasis ?? defaultPriceBasis(item.category, item.unit);
}

function quantityForPrice(item: CostItem) {
  const basis = resolvedPriceBasis(item);
  if (basis === "direto") return item.dose;
  if (basis === "R$/kg" || basis === "R$/t") {
    const kilograms =
      item.unit === "t/ha"
        ? item.dose * 1000
        : item.unit === "g/ha"
          ? item.dose / 1000
          : item.dose;
    return basis === "R$/t" ? kilograms / 1000 : kilograms;
  }
  if (basis === "R$/L") {
    return item.unit === "mL/ha" ? item.dose / 1000 : item.dose;
  }
  return item.dose;
}

function costPerHa(item: CostItem) {
  if (item.unit === "R$/ha") return Math.max(item.dose, 0);
  const value = quantityForPrice(item) * item.unitPrice;
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function priceUnit(item: CostItem) {
  const basis = resolvedPriceBasis(item);
  return basis === "direto" ? "já informado" : basis;
}

function priceBasisOptions(item: CostItem): PriceBasis[] {
  if (item.unit === "R$/ha") return ["direto"];
  if (item.unit === "kg/ha" || item.unit === "t/ha" || item.unit === "g/ha") {
    return ["R$/t", "R$/kg"];
  }
  if (item.unit === "L/ha" || item.unit === "mL/ha") return ["R$/L"];
  if (item.unit === "saco/ha") return ["R$/saco"];
  if (item.unit === "un./ha") return ["R$/un."];
  return ["R$/h"];
}

function safeDate(value: string) {
  if (!value) return "Não informada";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("pt-BR");
}

function savedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Data não informada"
    : parsed.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function DecimalInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value).replace(".", ","));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value).replace(".", ","));
  }, [editing, value]);

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        setEditing(true);
        if (value === 0) setDraft("");
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^\d*(?:[.,]\d*)?$/.test(next)) return;
        setDraft(next);
        const parsed = Number(next.replace(",", "."));
        if (next && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        setEditing(false);
        const parsed = Number(draft.replace(",", "."));
        const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        onChange(normalized);
        setDraft(String(normalized).replace(".", ","));
      }}
    />
  );
}

function normalizeLabel(value: unknown) {
  const original = String(value ?? "");
  let repaired = original;
  if (/[ÃÂ]/.test(original)) {
    try {
      repaired = new TextDecoder("utf-8").decode(
        Uint8Array.from(
          Array.from(original).map((character) => character.charCodeAt(0)),
        ),
      );
    } catch {
      repaired = original;
    }
  }
  return repaired
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/r\s*\$/g, "r$")
    .replace(/[^a-z0-9$/]+/g, " ")
    .trim();
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!raw) return 0;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw
      .split(thousandsSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0) {
    const groups = raw.replace("-", "").split(".");
    const looksLikeThousands =
      groups.length > 2 ||
      (groups.length === 2 && groups[1].length === 3 && groups[0] !== "0");
    normalized = looksLikeThousands ? raw.replace(/\./g, "") : raw;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function inferCategory(value: string): CostCategory {
  const text = normalizeLabel(value);
  if (/fert|adub|npk|fosfat|potass/.test(text)) return "fertilizantes";
  if (/semente|cultivar|hibrid/.test(text)) return "sementes";
  if (/herbic/.test(text)) return "herbicidas";
  if (/insetic|acaric/.test(text)) return "inseticidas";
  if (/fungic/.test(text)) return "fungicidas";
  if (/foliar|nutri|bioestimul|inocul/.test(text)) return "nutricao";
  if (/mao de obra|servico|diaria|operador/.test(text)) return "mao-de-obra";
  if (/maquina|equipamento|trator|plantio|pulveriza/.test(text))
    return "equipamentos";
  if (/diesel|combust/.test(text)) return "diesel";
  if (/colheita|frete|secagem/.test(text)) return "colheita";
  return "outros";
}

function inferUnit(value: string, category: CostCategory): CostUnit {
  const text = normalizeLabel(value);
  if (/ml/.test(text)) return "mL/ha";
  if (/(^| )g( |$)/.test(text)) return "g/ha";
  if (/t( |\/)ha|ton/.test(text)) return "t/ha";
  if (/l( |\/)ha|litro/.test(text)) return "L/ha";
  if (/saco|sc( |\/)ha/.test(text)) return "saco/ha";
  if (/hora|h( |\/)ha/.test(text)) return "h/ha";
  if (/unidade|un( |\/)ha/.test(text)) return "un./ha";
  if (/kg/.test(text)) return "kg/ha";
  if (
    category === "mao-de-obra" ||
    category === "equipamentos"
  )
    return "h/ha";
  if (category === "diesel") return "L/ha";
  if (category === "colheita" || category === "outros") return "R$/ha";
  return "kg/ha";
}

const headerAliases = {
  category: ["categoria", "grupo", "classe", "tipo"],
  name: [
    "produto",
    "insumo",
    "descricao",
    "item",
    "servico",
    "manejo",
    "operacao",
  ],
  dose: [
    "dose",
    "quantidade",
    "qtd",
    "consumo",
    "uso ha",
    "quantidade ha",
  ],
  unit: ["unidade", "un", "medida"],
  unitPrice: [
    "preco unitario",
    "valor unitario",
    "custo unitario",
    "preco",
  ],
  costHa: [
    "custo ha",
    "valor ha",
    "custo por ha",
    "valor por ha",
    "r$ ha",
  ],
  total: ["custo total", "valor total", "total"],
};

function matchHeader(label: string, aliases: string[]) {
  if (!label) return false;
  return aliases.some(
    (alias) =>
      label === alias ||
      label.startsWith(`${alias} `) ||
      label.endsWith(` ${alias}`) ||
      label.includes(` ${alias} `),
  );
}

function rowsToImportedItems(rows: unknown[][], area: number) {
  const cleaned = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  const headerIndex = cleaned.slice(0, 30).findIndex((row) => {
    const labels = row.map(normalizeLabel);
    return (
      labels.some((label) => matchHeader(label, headerAliases.name)) &&
      labels.some((label) =>
        [
          ...headerAliases.dose,
          ...headerAliases.unitPrice,
          ...headerAliases.costHa,
          ...headerAliases.total,
        ].some((alias) => matchHeader(label, [alias])),
      )
    );
  });
  if (headerIndex < 0) return [];
  const headers = cleaned[headerIndex].map(normalizeLabel);
  const column = (aliases: string[]) => {
    const exact = headers.findIndex((header) => aliases.includes(header));
    return exact >= 0
      ? exact
      : headers.findIndex((header) => matchHeader(header, aliases));
  };
  const categoryColumn = column(headerAliases.category);
  const nameColumn = column(headerAliases.name);
  const doseColumn = column(headerAliases.dose);
  const unitColumn = column(headerAliases.unit);
  const priceColumn = column(headerAliases.unitPrice);
  const costHaColumn = column(headerAliases.costHa);
  const totalColumn = column(headerAliases.total);
  const doseHeader = doseColumn >= 0 ? headers[doseColumn] : "";
  const priceHeader = priceColumn >= 0 ? headers[priceColumn] : "";
  const doseExplicitlyPerHa = /(?:^| )(?:por )?ha(?: |$)|hectare/.test(
    doseHeader,
  );
  const doseExplicitlyTotal = /total|geral|propriedade|talhao/.test(
    doseHeader,
  );

  return cleaned
    .slice(headerIndex + 1)
    .map((row, index): ImportedCostItem | null => {
      const name = String(row[nameColumn] ?? "").trim();
      if (!name || /^total|subtotal|categoria$/i.test(normalizeLabel(name)))
        return null;
      const category = inferCategory(
        `${row[categoryColumn] ?? ""} ${name}`,
      );
      const importedDose = doseColumn >= 0 ? parseNumber(row[doseColumn]) : 0;
      let dose = importedDose;
      const unit = inferUnit(String(row[unitColumn] ?? ""), category);
      let unitPrice =
        priceColumn >= 0 ? parseNumber(row[priceColumn]) : 0;
      let priceBasis = defaultPriceBasis(category, unit);
      if (unit === "kg/ha" || unit === "t/ha" || unit === "g/ha") {
        if (/\b(?:t|ton|tonelada)\b/.test(priceHeader)) priceBasis = "R$/t";
        else if (/\bkg\b/.test(priceHeader)) priceBasis = "R$/kg";
        else if (category === "fertilizantes" && unitPrice > 0 && unitPrice < 100) {
          priceBasis = "R$/kg";
        }
      }
      const importedCostHa =
        costHaColumn >= 0 ? parseNumber(row[costHaColumn]) : 0;
      const importedTotal =
        totalColumn >= 0 ? parseNumber(row[totalColumn]) : 0;
      const targetCostHa =
        importedCostHa || (area > 0 && importedTotal ? importedTotal / area : 0);

      if (dose > 0 && unit !== "R$/ha" && area > 0) {
        const rawCostHa =
          unitPrice > 0
            ? costPerHa({ id: "", category, name, dose, unit, unitPrice, priceBasis })
            : 0;
        const dividedDose = dose / area;
        const dividedCostHa =
          unitPrice > 0
            ? costPerHa({
                id: "",
                category,
                name,
                dose: dividedDose,
                unit,
                unitPrice,
                priceBasis,
              })
            : 0;
        const dividedMatchesDeclaredTotal =
          targetCostHa > 0 &&
          Math.abs(dividedCostHa - targetCostHa) + 0.01 <
            Math.abs(rawCostHa - targetCostHa);
        const genericTotalQuantity =
          !doseExplicitlyPerHa &&
          /quantidade|qtd|consumo/.test(doseHeader) &&
          totalColumn >= 0 &&
          importedTotal > 0;
        if (
          doseExplicitlyTotal ||
          dividedMatchesDeclaredTotal ||
          genericTotalQuantity
        ) {
          dose = Number(dividedDose.toFixed(6));
        }
      }

      if (doseExplicitlyPerHa) dose = importedDose;

      const calculatedCostHa =
        dose > 0 && unitPrice > 0
          ? costPerHa({ id: "", category, name, dose, unit, unitPrice, priceBasis })
          : 0;
      const declaredCostDiffers =
        targetCostHa > 0 &&
        calculatedCostHa > 0 &&
        Math.abs(calculatedCostHa - targetCostHa) /
          Math.max(targetCostHa, 0.01) >
          0.05;
      if (dose > 0 && unit !== "R$/ha" && targetCostHa > 0 && declaredCostDiffers) {
        const pricedQuantity = quantityForPrice({
          id: "",
          category,
          name,
          dose,
          unit,
          unitPrice,
          priceBasis,
        });
        unitPrice = targetCostHa / Math.max(pricedQuantity, 0.000001);
      }

      if ((!dose || !unitPrice) && targetCostHa > 0) {
        if (dose > 0 && unit !== "R$/ha") {
          const pricedQuantity = quantityForPrice({
            id: "",
            category,
            name,
            dose,
            unit,
            unitPrice,
            priceBasis,
          });
          unitPrice = targetCostHa / Math.max(pricedQuantity, 0.000001);
        } else {
          dose = targetCostHa;
          unitPrice = 0;
          return {
            id: crypto.randomUUID(),
            category,
            name,
            dose,
            unit: "R$/ha",
            unitPrice,
            priceBasis: "direto",
            selected: true,
            sourceRow: headerIndex + index + 2,
          };
        }
      }
      if (!dose && !unitPrice && !targetCostHa) return null;
      return {
        id: crypto.randomUUID(),
        category,
        name,
        dose,
        unit,
        unitPrice,
        priceBasis,
        selected: true,
        sourceRow: headerIndex + index + 2,
      };
    })
    .filter((item): item is ImportedCostItem => Boolean(item));
}

async function readPdfRows(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const rows: string[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned = content.items
      .filter(
        (item): item is typeof item & { str: string; transform: number[] } =>
          "str" in item && "transform" in item && Boolean(item.str.trim()),
      )
      .map((item) => ({
        text: item.str.trim(),
        x: Number(item.transform[4]),
        y: Number(item.transform[5]),
      }));
    const grouped = new Map<number, typeof positioned>();
    positioned.forEach((item) => {
      const key = Math.round(item.y / 3) * 3;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    [...grouped.entries()]
      .sort(([first], [second]) => second - first)
      .forEach(([, line]) =>
        rows.push(line.sort((a, b) => a.x - b.x).map((item) => item.text)),
      );
  }
  return rows;
}

async function readImageRows(file: File, onProgress: (message: string) => void) {
  onProgress("Aplicando OCR na imagem…");
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    langPath: "/tessdata",
    logger: (progress) => {
      if (progress.status === "recognizing text") {
        onProgress(
          `OCR ${Math.round((progress.progress || 0) * 100)}% concluído…`,
        );
      }
    },
  });
  try {
    const result = await worker.recognize(file);
    return result.data.text
      .split(/\r?\n/)
      .map((line) => line.split(/\t|;|\s{2,}/).filter(Boolean));
  } finally {
    await worker.terminate();
  }
}

async function readScannedPdfRows(
  file: File,
  onProgress: (message: string) => void,
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    langPath: "/tessdata",
    logger: (progress) => {
      if (progress.status === "recognizing text") {
        onProgress(
          `OCR ${Math.round((progress.progress || 0) * 100)}% da página atual…`,
        );
      }
    },
  });
  const rows: string[][] = [];
  try {
    const limit = Math.min(pdf.numPages, 5);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      onProgress(`Lendo página digitalizada ${pageNumber} de ${limit}…`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.55 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      result.data.text
        .split(/\r?\n/)
        .map((line) => line.split(/\t|;|\s{2,}/).filter(Boolean))
        .filter((line) => line.length)
        .forEach((line) => rows.push(line));
    }
  } finally {
    await worker.terminate();
  }
  return rows;
}

export default function SeasonReports({
  producers,
  profile,
  subscriberId,
  allowLegacyMigration = false,
}: {
  producers: ReportProducer[];
  profile: ReportProfile;
  subscriberId: string;
  allowLegacyMigration?: boolean;
}) {
  const [report, setReport] = useState<SeasonReport>(() =>
    blankReport(producers[0]),
  );
  const [savedReports, setSavedReports] = useState<SeasonReport[]>([]);
  const [reportSearch, setReportSearch] = useState("");
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<CostCategory>("fertilizantes");
  const [message, setMessage] = useState("");
  const [photoMessage, setPhotoMessage] = useState("");
  const [importItems, setImportItems] = useState<ImportedCostItem[]>([]);
  const [importStatus, setImportStatus] = useState({
    state: "idle" as "idle" | "reading" | "review" | "error",
    message: "",
    fileName: "",
  });

  useEffect(() => {
    let localReports: SeasonReport[] = [];
    try {
      const storageKey = `mp-season-reports:${subscriberId}`;
      const scoped = localStorage.getItem(storageKey);
      const stored = scoped ?? (allowLegacyMigration ? localStorage.getItem("mp-season-reports") : null);
      if (stored) {
        localReports = (JSON.parse(stored) as SeasonReport[]).map(normalizeReport);
        if (!scoped) localStorage.setItem(storageKey, JSON.stringify(localReports));
      }
      setSavedReports(localReports);
    } catch {
      setSavedReports([]);
    }
    void listRecords("season_report")
      .then((records) => {
        const archived = records
          .map((record) => record.payload as unknown as SeasonReport)
          .filter(
            (item) =>
              item &&
              typeof item.id === "string" &&
              Array.isArray(item.items),
          )
          .map(normalizeReport);
        setSavedReports((current) => {
          const byId = new Map(
            [...archived, ...current].map((item) => [item.id, item]),
          );
          return [...byId.values()].sort((first, second) =>
            second.updatedAt.localeCompare(first.updatedAt),
          );
        });
      })
      .catch(() => {
        // A cópia de edição continua disponível no próprio dispositivo.
      });
  }, [allowLegacyMigration, subscriberId]);

  const producer = producers.find((item) => item.id === report.producerId);
  const field = producer?.fields?.find((item) => item.id === report.fieldId);
  const categoryItems = report.items.filter(
    (item) => item.category === activeCategory,
  );
  const summary = useMemo(() => {
    const byCategory = Object.fromEntries(
      categories.map(({ key }) => [key, 0]),
    ) as Record<CostCategory, number>;
    report.items.forEach((item) => {
      byCategory[item.category] += costPerHa(item);
    });
    const costHa = Object.values(byCategory).reduce(
      (total, value) => total + value,
      0,
    );
    const revenueHa = report.yieldScHa * report.salePrice;
    const marginHa = revenueHa - costHa;
    return {
      byCategory,
      costHa,
      totalCost: costHa * report.area,
      revenueHa,
      totalRevenue: revenueHa * report.area,
      marginHa,
      totalMargin: marginHa * report.area,
      breakEven:
        report.salePrice > 0 ? costHa / report.salePrice : 0,
      costInBags: Object.fromEntries(
        grainCrops.map((crop) => [
          crop,
          report.grainPrices?.[crop] > 0
            ? costHa / report.grainPrices[crop]
            : 0,
        ]),
      ) as Record<GrainCrop, number>,
    };
  }, [report]);
  const composition = useMemo(() => {
    const entries = categories
      .map((category, index) => ({
        ...category,
        value: summary.byCategory[category.key],
        color: chartColors[index % chartColors.length],
      }))
      .filter((entry) => entry.value > 0);
    let accumulated = 0;
    const segments = entries.map((entry) => {
      const start = summary.costHa > 0 ? (accumulated / summary.costHa) * 100 : 0;
      accumulated += entry.value;
      const end = summary.costHa > 0 ? (accumulated / summary.costHa) * 100 : 0;
      return `${entry.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });
    return { entries, gradient: segments.length ? `conic-gradient(${segments.join(", ")})` : "#e7ede9" };
  }, [summary.byCategory, summary.costHa]);
  const matchingSavedReports = useMemo(() => {
    const search = normalizeCatalogText(reportSearch.trim());
    if (!search) return savedReports;
    return savedReports.filter((saved) => {
      const savedProducer = producers.find(
        (item) => item.id === saved.producerId,
      );
      const savedField = savedProducer?.fields?.find(
        (item) => item.id === saved.fieldId,
      );
      return normalizeCatalogText(
        [
          savedProducer?.name,
          saved.property,
          savedField?.name,
          saved.crop,
          saved.season,
        ]
          .filter(Boolean)
          .join(" "),
      ).includes(search);
    });
  }, [producers, reportSearch, savedReports]);
  const visibleSavedReports = showAllSaved
    ? matchingSavedReports
    : matchingSavedReports.slice(0, 6);

  function update(patch: Partial<SeasonReport>) {
    setReport((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  }

  function openSavedReport(saved: SeasonReport) {
    setReport(normalizeReport(saved));
    setMessage("Relatório aberto. Continue o preenchimento e salve novamente ao terminar.");
    window.setTimeout(() => {
      document
        .getElementById("season-report-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  function selectProducer(producerId: string) {
    const next = producers.find((item) => item.id === producerId);
    update({
      producerId,
      property: next?.properties ?? "",
      fieldId: next?.fields?.[0]?.id ?? "",
      crop: next?.fields?.[0]?.crop || report.crop,
      season: next?.fields?.[0]?.season || report.season,
      area: next?.fields?.[0]?.area || next?.area || 0,
    });
  }

  function selectField(fieldId: string) {
    const next = producer?.fields?.find((item) => item.id === fieldId);
    update({
      fieldId,
      crop: next?.crop || report.crop,
      season: next?.season || report.season,
      area: next?.area || report.area,
    });
  }

  function addItem(category: CostCategory) {
    update({
      items: [
        ...report.items,
        {
          id: crypto.randomUUID(),
          category,
          name: "",
          dose: 0,
          unit:
            category === "mao-de-obra" || category === "equipamentos"
              ? "h/ha"
              : category === "diesel"
                ? "L/ha"
                : category === "outros" || category === "colheita"
                  ? "R$/ha"
                  : "kg/ha",
          unitPrice: 0,
          priceBasis: defaultPriceBasis(
            category,
            category === "mao-de-obra" || category === "equipamentos"
              ? "h/ha"
              : category === "diesel"
                ? "L/ha"
                : category === "outros" || category === "colheita"
                  ? "R$/ha"
                  : "kg/ha",
          ),
        },
      ],
    });
  }

  function updateItem(id: string, patch: Partial<CostItem>) {
    update({
      items: report.items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  }

  function updateGrainPrice(crop: GrainCrop, value: number) {
    update({
      grainPrices: { ...emptyGrainPrices(), ...report.grainPrices, [crop]: value },
      ...(report.crop === crop ? { salePrice: value } : {}),
    });
  }

  async function compressPhoto(file: File): Promise<ReportPhoto> {
    if (!file.type.startsWith("image/")) throw new Error("Selecione apenas imagens.");
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("A imagem não pôde ser aberta."));
      image.src = URL.createObjectURL(file);
    });
    const maxWidth = 1400;
    const maxHeight = 1050;
    const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(source.src);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      dataUrl: canvas.toDataURL("image/jpeg", 0.76),
      description: "",
    };
  }

  async function importReportPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    const remaining = Math.max(0, 6 - (report.photos?.length ?? 0));
    if (!remaining) {
      setPhotoMessage("O relatório aceita até 6 fotos por fechamento.");
      return;
    }
    setPhotoMessage("Preparando as fotos…");
    try {
      const photos = await Promise.all(files.slice(0, remaining).map(compressPhoto));
      update({ photos: [...(report.photos ?? []), ...photos] });
      setPhotoMessage(`${photos.length} foto(s) adicionada(s) ao relatório.`);
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "Não foi possível importar as fotos.");
    }
  }

  function updatePhoto(id: string, patch: Partial<ReportPhoto>) {
    update({
      photos: (report.photos ?? []).map((photo) =>
        photo.id === id ? { ...photo, ...patch } : photo,
      ),
    });
  }

  function removeItem(id: string) {
    update({ items: report.items.filter((item) => item.id !== id) });
  }

  async function importCosts(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportItems([]);
    setImportStatus({
      state: "reading",
      message: "Lendo e identificando as colunas…",
      fileName: file.name,
    });
    try {
      let rows: unknown[][] = [];
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "pdf" || file.type === "application/pdf") {
        rows = await readPdfRows(file);
      } else if (file.type.startsWith("image/")) {
        rows = await readImageRows(file, (progress) =>
          setImportStatus({
            state: "reading",
            message: progress,
            fileName: file.name,
          }),
        );
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          cellDates: false,
          raw: true,
        });
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: "",
          });
          rows.push(...sheetRows);
        });
      }
      let parsed = rowsToImportedItems(rows, report.area);
      if (
        !parsed.length &&
        (extension === "pdf" || file.type === "application/pdf")
      ) {
        setImportStatus({
          state: "reading",
          message: "O PDF parece digitalizado. Iniciando OCR…",
          fileName: file.name,
        });
        rows = await readScannedPdfRows(file, (progress) =>
          setImportStatus({
            state: "reading",
            message: progress,
            fileName: file.name,
          }),
        );
        parsed = rowsToImportedItems(rows, report.area);
      }
      if (!parsed.length) {
        throw new Error(
          "Não encontrei uma tabela com produto/serviço e valores. Use cabeçalhos como Produto, Categoria, Dose, Unidade, Preço unitário, Custo/ha ou Total.",
        );
      }
      setImportItems(parsed);
      setImportStatus({
        state: "review",
        message: `${parsed.length} lançamento(s) reconhecido(s). Confira antes de adicionar.`,
        fileName: file.name,
      });
    } catch (error) {
      setImportStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o arquivo.",
        fileName: file.name,
      });
    }
  }

  function updateImportedItem(id: string, patch: Partial<ImportedCostItem>) {
    setImportItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function applyImportedItems() {
    const selected = importItems
      .filter((item) => item.selected && item.name.trim())
      .map(({ selected: _selected, sourceRow: _sourceRow, ...item }) => item);
    if (!selected.length) {
      setImportStatus((current) => ({
        ...current,
        message: "Selecione ao menos um lançamento para adicionar.",
      }));
      return;
    }
    update({ items: [...report.items, ...selected] });
    setActiveCategory(selected[0].category);
    setImportItems([]);
    setImportStatus({
      state: "idle",
      fileName: "",
      message: `${selected.length} lançamento(s) adicionados ao fechamento.`,
    });
  }

  async function saveReport() {
    if (!report.producerId || !report.crop || !report.area) {
      setMessage("Informe produtor, cultura e área antes de salvar.");
      return;
    }
    const saved = {
      ...report,
      updatedAt: new Date().toISOString(),
    };
    const next = [
      saved,
      ...savedReports.filter((item) => item.id !== saved.id),
    ];
    setSavedReports(next);
    localStorage.setItem(`mp-season-reports:${subscriberId}`, JSON.stringify(next));
    setReport(saved);
    setMessage("Salvando fechamento…");
    try {
      await saveRecord({
        id: saved.id,
        type: "season_report",
        title: `${producer?.name || "Produtor"} · ${saved.crop} · ${
          saved.season || "Safra"
        }`,
        producerName: producer?.name,
        payload: saved as unknown as Record<string, unknown>,
      });
      setMessage("Fechamento salvo no histórico deste dispositivo.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Uma cópia permaneceu neste navegador.`
          : "A cópia de edição foi salva, mas o histórico local não respondeu.",
      );
    }
  }

  function addWatermark(doc: jsPDF) {
    if (!report.watermark || !profile.watermark) return;
    try {
      doc.saveGraphicsState();
      doc.setGState(
        new GState({
          opacity: Math.min(Math.max(profile.watermarkOpacity / 100, 0.03), 0.2),
        }),
      );
      doc.addImage(
        profile.watermark,
        profile.watermark.startsWith("data:image/jpeg") ? "JPEG" : "PNG",
        53,
        95,
        104,
        104,
      );
      doc.restoreGraphicsState();
    } catch {
      // O relatório permanece disponível mesmo quando a imagem não for válida.
    }
  }

  function makePdf() {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const producerName = producer?.name || "Produtor não informado";
    let y = 18;

    const newPage = () => {
      doc.addPage();
      addWatermark(doc);
      y = 18;
    };
    const ensure = (height: number) => {
      if (y + height > 282) newPage();
    };
    const line = (label: string, value: string) => {
      ensure(7);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(73, 96, 88);
      doc.text(label.toUpperCase(), 16, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(23, 47, 40);
      doc.text(value || "Não informado", 62, y);
      y += 6;
    };

    addWatermark(doc);
    doc.setFillColor(10, 48, 39);
    doc.roundedRect(12, 10, 186, 30, 4, 4, "F");
    doc.setTextColor(214, 244, 92);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("FECHAMENTO TÉCNICO E FINANCEIRO", 18, 20);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(19);
    doc.text(`${report.crop} · ${report.season || "Safra"}`, 18, 31);
    y = 50;
    line("Produtor", producerName);
    line("Propriedade", report.property);
    line("Talhão", field?.name || "Consolidado da propriedade");
    line("Área", `${decimal(report.area)} ha`);
    line(
      "Período",
      `${safeDate(report.plantingDate)} a ${safeDate(report.harvestDate)}`,
    );
    line(
      "Responsável",
      `${profile.name || "Não informado"} · ${profile.council} ${
        profile.registration || "sem registro informado"
      }`,
    );

    y += 4;
    doc.setFillColor(239, 245, 241);
    doc.roundedRect(12, y - 5, 186, 28, 3, 3, "F");
    const financial = [
      ["Custo/ha", money(summary.costHa)],
      ["Receita/ha", money(summary.revenueHa)],
      ["Margem/ha", money(summary.marginHa)],
      ["Equilíbrio", `${decimal(summary.breakEven)} sc/ha`],
    ];
    financial.forEach(([label, value], index) => {
      const x = 18 + index * 45;
      doc.setTextColor(83, 104, 96);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(label.toUpperCase(), x, y + 3);
      doc.setTextColor(10, 48, 39);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(value, x, y + 12, { maxWidth: 40 });
    });
    y += 34;

    const grainComparisons = grainCrops.filter(
      (crop) => (report.grainPrices?.[crop] ?? 0) > 0,
    );
    if (grainComparisons.length) {
      ensure(18 + grainComparisons.length * 6);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(10, 48, 39);
      doc.setFontSize(10);
      doc.text("Custo equivalente em sacas", 16, y);
      y += 7;
      grainComparisons.forEach((crop) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(45, 68, 61);
        doc.text(`${crop} · ${money(report.grainPrices[crop])}/sc`, 18, y);
        doc.setFont("helvetica", "bold");
        doc.text(`${decimal(summary.costInBags[crop])} sc/ha`, 190, y, {
          align: "right",
        });
        y += 6;
      });
      y += 5;
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(10, 48, 39);
    doc.setFontSize(13);
    doc.text("Custos por categoria", 16, y);
    y += 8;
    categories
      .filter(({ key }) => summary.byCategory[key] > 0)
      .forEach(({ key, label }) => {
        ensure(8);
        doc.setFillColor(247, 250, 248);
        doc.rect(16, y - 5, 178, 8, "F");
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(23, 47, 40);
        doc.text(label, 19, y);
        const share = summary.costHa > 0 ? summary.byCategory[key] / summary.costHa : 0;
        doc.setFillColor(222, 231, 225);
        doc.roundedRect(88, y - 3.2, 55, 2.7, 1.2, 1.2, "F");
        doc.setFillColor(29, 107, 80);
        doc.roundedRect(88, y - 3.2, Math.max(1, 55 * share), 2.7, 1.2, 1.2, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(`${decimal(share * 100, 1)}%`, 148, y);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text(money(summary.byCategory[key]), 190, y, {
          align: "right",
        });
        y += 9;
      });

    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(10, 48, 39);
    doc.text("Itens e manejos", 16, y);
    y += 8;
    report.items.forEach((item) => {
      ensure(15);
      doc.setDrawColor(218, 228, 222);
      doc.line(16, y - 4, 194, y - 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(item.name || "Item não identificado", 18, y, {
        maxWidth: 72,
      });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(79, 99, 92);
      doc.text(categoryLabel(item.category), 18, y + 5);
      doc.setTextColor(23, 47, 40);
      doc.text(`${decimal(item.dose)} ${item.unit}`, 100, y);
      if (item.unit !== "R$/ha") {
        doc.text(
          `${money(item.unitPrice)} ${priceUnit(item).replace("R$", "")}`,
          142,
          y,
          { align: "right" },
        );
      }
      doc.setFont("helvetica", "bold");
      doc.text(money(costPerHa(item)), 191, y, { align: "right" });
      y += 13;
    });

    ensure(34);
    y += 3;
    doc.setFillColor(10, 48, 39);
    doc.roundedRect(12, y - 5, 186, 27, 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`CUSTO TOTAL: ${money(summary.totalCost)}`, 18, y + 3);
    doc.text(`RECEITA BRUTA: ${money(summary.totalRevenue)}`, 18, y + 10);
    doc.setTextColor(214, 244, 92);
    doc.text(`RESULTADO ESTIMADO: ${money(summary.totalMargin)}`, 110, y + 10);
    y += 31;

    if (report.notes.trim()) {
      ensure(30);
      doc.setTextColor(10, 48, 39);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Observações de fechamento", 16, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(45, 68, 61);
      const notes = doc.splitTextToSize(report.notes.trim(), 176);
      doc.text(notes, 16, y);
      y += notes.length * 4 + 8;
    }

    if ((report.photos ?? []).length) {
      (report.photos ?? []).forEach((photo, index) => {
        ensure(112);
        if (index === 0) {
          doc.setTextColor(10, 48, 39);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(13);
          doc.text("Registro fotográfico da lavoura", 16, y);
          y += 8;
        }
        try {
          const properties = doc.getImageProperties(photo.dataUrl);
          const maxWidth = 176;
          const maxHeight = 88;
          const scale = Math.min(
            maxWidth / Math.max(properties.width, 1),
            maxHeight / Math.max(properties.height, 1),
          );
          const width = properties.width * scale;
          const height = properties.height * scale;
          doc.addImage(photo.dataUrl, "JPEG", 16, y, width, height);
          y += height + 5;
          doc.setTextColor(45, 68, 61);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          const caption = doc.splitTextToSize(
            photo.description.trim() || photo.name || `Foto ${index + 1}`,
            176,
          );
          doc.text(caption, 16, y);
          y += caption.length * 4 + 8;
        } catch {
          // Uma imagem inválida não impede a geração do restante do relatório.
        }
      });
    }

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setTextColor(107, 126, 119);
      doc.setFontSize(7);
      doc.text(
        `${profile.company || profile.name || "Responsável técnico"} · Página ${page}/${pages}`,
        16,
        291,
      );
      doc.text(
        `Gerado em ${new Date().toLocaleString("pt-BR")}`,
        194,
        291,
        { align: "right" },
      );
    }
    return doc;
  }

  async function exportPdf() {
    if (!report.producerId || !report.crop || !report.area) {
      setMessage("Informe produtor, cultura e área antes de gerar o PDF.");
      return;
    }
    const fileName = `fechamento-${report.crop}-${report.season || "safra"}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase()
      .replace(/^-|-$/g, "")
      .concat(".pdf");
    const doc = makePdf();
    const blob = doc.output("blob");
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "Fechamento de safra",
          text: `${producer?.name || "Produtor"} · ${report.crop} ${
            report.season
          }`,
          files: [file],
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    doc.save(fileName);
  }

  return (
    <>
      <div className="page-heading season-heading">
        <span className="eyebrow">GESTÃO DA SAFRA</span>
        <h1>Fechamento técnico e financeiro</h1>
        <p>
          Vincule o produtor, registre os manejos por hectare e acompanhe custo,
          receita e margem antes de gerar o relatório.
        </p>
      </div>

      <section className="content-panel season-history season-saved-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">RELATÓRIOS SALVOS</span>
            <h2>Continue de onde parou</h2>
          </div>
          <span>{savedReports.length} relatório(s)</span>
        </div>
        <div className="season-saved-toolbar">
          <label>
            <span>Buscar relatório</span>
            <input
              type="search"
              value={reportSearch}
              onChange={(event) => {
                setReportSearch(event.target.value);
                setShowAllSaved(false);
              }}
              placeholder="Produtor, propriedade, talhão, cultura ou safra"
            />
          </label>
          <button
            className="button primary"
            onClick={() => {
              setReport(blankReport(producers[0]));
              setMessage("");
              document
                .getElementById("season-report-form")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            + Novo relatório
          </button>
        </div>
        {visibleSavedReports.length ? (
          <div className="season-saved-grid">
            {visibleSavedReports.map((saved) => {
              const savedProducer = producers.find(
                (item) => item.id === saved.producerId,
              );
              const savedField = savedProducer?.fields?.find(
                (item) => item.id === saved.fieldId,
              );
              return (
                <button
                  className={saved.id === report.id ? "active" : ""}
                  key={saved.id}
                  onClick={() => openSavedReport(saved)}
                >
                  <span className="season-saved-card-head">
                    <strong>{savedProducer?.name || "Produtor removido"}</strong>
                    <small>{saved.id === report.id ? "Em edição" : "Salvo"}</small>
                  </span>
                  <span className="season-saved-location">
                    {saved.property || "Propriedade não informada"}
                    {savedField?.name ? ` · ${savedField.name}` : ""}
                  </span>
                  <span className="season-saved-tags">
                    <i>{saved.crop}</i>
                    <i>{saved.season || "Safra não informada"}</i>
                    <i>{decimal(saved.area)} ha</i>
                  </span>
                  <span className="season-saved-footer">
                    <small>Atualizado em {savedAt(saved.updatedAt)}</small>
                    <b>Continuar preenchimento</b>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="season-saved-empty">
            {savedReports.length
              ? "Nenhum relatório corresponde à busca."
              : "Nenhum relatório salvo ainda. Preencha a identificação e use Salvar rascunho."}
          </p>
        )}
        {matchingSavedReports.length > 6 && (
          <button
            className="text-button season-show-all"
            onClick={() => setShowAllSaved((current) => !current)}
          >
            {showAllSaved
              ? "Mostrar somente os mais recentes"
              : `Ver todos os ${matchingSavedReports.length} relatórios`}
          </button>
        )}
        <small className="season-storage-note">
          Os relatórios ficam somente neste dispositivo, separados pelo usuário autenticado. Exporte um backup antes de trocar de aparelho.
        </small>
      </section>

      <section
        className="content-panel season-identification"
        id="season-report-form"
      >
        <div className="panel-title">
          <div>
            <span className="eyebrow">1 · IDENTIFICAÇÃO</span>
            <h2>Produtor, área e cultura</h2>
          </div>
          <div className="season-identification-actions">
            <button
              className="button secondary"
              onClick={() => void saveReport()}
            >
              Salvar rascunho
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setReport(blankReport(producers[0]));
                setMessage("");
              }}
            >
              Novo fechamento
            </button>
          </div>
        </div>
        <div className="season-form-grid">
          <label className="field">
            <span>Produtor *</span>
            <select
              value={report.producerId}
              onChange={(event) => selectProducer(event.target.value)}
            >
              <option value="">Selecione</option>
              {producers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Propriedade</span>
            <input
              value={report.property}
              onChange={(event) => update({ property: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Talhão</span>
            <select
              value={report.fieldId}
              onChange={(event) => selectField(event.target.value)}
            >
              <option value="">Consolidado da propriedade</option>
              {producer?.fields?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Cultura *</span>
            <select
              value={report.crop}
              onChange={(event) => {
                const crop = event.target.value;
                update({
                  crop,
                  ...(grainCrops.includes(crop as GrainCrop)
                    ? { salePrice: report.grainPrices?.[crop as GrainCrop] ?? 0 }
                    : {}),
                });
              }}
            >
              {["Soja", "Milho", "Trigo", "Canola", "Arroz", "Outra"].map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            <span>Safra</span>
            <input
              value={report.season}
              onChange={(event) => update({ season: event.target.value })}
              placeholder="Ex.: 2026/2027"
            />
          </label>
          <label className="field">
            <span>Área (ha) *</span>
            <div className="input-wrap">
              <DecimalInput
                ariaLabel="Área em hectares"
                value={report.area}
                onChange={(area) => update({ area })}
              />
              <b>ha</b>
            </div>
          </label>
          <label className="field">
            <span>Plantio</span>
            <input
              type="date"
              value={report.plantingDate}
              onChange={(event) => update({ plantingDate: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Colheita</span>
            <input
              type="date"
              value={report.harvestDate}
              onChange={(event) => update({ harvestDate: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="content-panel season-import">
        <div className="panel-title">
          <div>
            <span className="eyebrow">IMPORTAÇÃO ASSISTIDA</span>
            <h2>Trazer custos de Excel, CSV, PDF ou imagem</h2>
          </div>
          {importItems.length > 0 && (
            <span>
              {importItems.filter((item) => item.selected).length}/
              {importItems.length} selecionados
            </span>
          )}
        </div>
        <div className="season-import-intro">
          <div>
            <strong>Importe e confira antes de lançar</strong>
            <p>
              O sistema procura produto/serviço, categoria, dose, unidade,
              preço unitário, custo por hectare ou valor total. PDFs
              digitalizados passam por OCR.
            </p>
          </div>
          <label className="button primary season-import-button">
            {importStatus.state === "reading" ? "Processando…" : "Escolher arquivo"}
            <input
              type="file"
              disabled={importStatus.state === "reading"}
              accept=".xlsx,.xls,.csv,.tsv,.pdf,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,image/jpeg,image/png"
              onChange={(event) => void importCosts(event)}
            />
          </label>
        </div>
        <div className="import-column-help">
          <span>Colunas recomendadas</span>
          <code>Categoria</code>
          <code>Produto</code>
          <code>Dose</code>
          <code>Unidade</code>
          <code>Preço unitário</code>
          <code>Custo/ha ou Total</code>
        </div>
        {importStatus.message && (
          <p
            className={`season-import-status ${
              importStatus.state === "error" ? "error" : ""
            }`}
          >
            {importStatus.fileName && <b>{importStatus.fileName}: </b>}
            {importStatus.message}
          </p>
        )}
        {importItems.length > 0 && (
          <div className="season-import-review">
            <div className="import-review-actions">
              <label>
                <input
                  type="checkbox"
                  checked={importItems.every((item) => item.selected)}
                  onChange={(event) =>
                    setImportItems((current) =>
                      current.map((item) => ({
                        ...item,
                        selected: event.target.checked,
                      })),
                    )
                  }
                />
                Selecionar todos
              </label>
              <button
                className="text-button"
                onClick={() => {
                  setImportItems([]);
                  setImportStatus({
                    state: "idle",
                    message: "Importação cancelada.",
                    fileName: "",
                  });
                }}
              >
                Cancelar
              </button>
            </div>
            <div className="import-review-grid">
              {importItems.map((item) => (
                <article
                  className={`import-review-card ${
                    item.selected ? "selected" : ""
                  }`}
                  key={item.id}
                >
                  <header>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(event) =>
                          updateImportedItem(item.id, {
                            selected: event.target.checked,
                          })
                        }
                      />
                      Importar linha {item.sourceRow}
                    </label>
                    <span>{money(costPerHa(item))}/ha</span>
                  </header>
                  <label>
                    <span>Categoria</span>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateImportedItem(item.id, {
                          category: event.target.value as CostCategory,
                          priceBasis: defaultPriceBasis(
                            event.target.value as CostCategory,
                            item.unit,
                          ),
                        })
                      }
                    >
                      {categories.map((category) => (
                        <option key={category.key} value={category.key}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="import-name">
                    <span>Produto ou serviço</span>
                    <input
                      value={item.name}
                      onChange={(event) =>
                        updateImportedItem(item.id, {
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Dose/uso por ha</span>
                    <DecimalInput
                      ariaLabel={`Dose importada de ${item.name}`}
                      value={item.dose}
                      onChange={(dose) =>
                        updateImportedItem(item.id, { dose })
                      }
                    />
                  </label>
                  <label>
                    <span>Unidade</span>
                    <select
                      value={item.unit}
                      onChange={(event) =>
                        updateImportedItem(item.id, {
                          unit: event.target.value as CostUnit,
                          priceBasis: defaultPriceBasis(
                            item.category,
                            event.target.value as CostUnit,
                          ),
                        })
                      }
                    >
                      {costUnits.map((unit) => (
                        <option key={unit}>{unit}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Preço unitário</span>
                    <div className="season-price-input">
                      <DecimalInput
                        ariaLabel={`Preço importado de ${item.name}`}
                        value={item.unitPrice}
                        onChange={(unitPrice) =>
                          updateImportedItem(item.id, { unitPrice })
                        }
                      />
                      <select
                        aria-label={`Unidade do preço importado de ${item.name}`}
                        value={resolvedPriceBasis(item)}
                        onChange={(event) =>
                          updateImportedItem(item.id, {
                            priceBasis: event.target.value as PriceBasis,
                          })
                        }
                      >
                        {priceBasisOptions(item).map((basis) => (
                          <option key={basis}>{basis}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                </article>
              ))}
            </div>
            <button
              className="button primary full-button"
              onClick={applyImportedItems}
            >
              Adicionar itens conferidos ao fechamento
            </button>
          </div>
        )}
      </section>

      <section className="content-panel season-costs">
        <div className="panel-title">
          <div>
            <span className="eyebrow">2 · MANEJOS E CUSTOS</span>
            <h2>Lançamentos por hectare</h2>
          </div>
          <strong>{money(summary.costHa)}/ha</strong>
        </div>
        <div className="cost-category-tabs">
          {categories.map((category) => (
            <button
              key={category.key}
              className={activeCategory === category.key ? "active" : ""}
              onClick={() => setActiveCategory(category.key)}
            >
              <span>{category.short}</span>
              <b>{money(summary.byCategory[category.key])}</b>
            </button>
          ))}
        </div>

        {Object.entries(reportCatalogs).map(([category, options]) => (
          <datalist id={`season-catalog-${category}`} key={category}>
            {options?.map((option) => (
              <option
                key={`${category}-${option.name}`}
                value={option.name}
                label={option.detail}
              />
            ))}
          </datalist>
        ))}

        <div className="season-items">
          <div className="season-item-head">
            <span>Produto/serviço</span>
            <span>Dose ou uso/ha</span>
            <span>Preço unitário</span>
            <span>Custo/ha</span>
          </div>
          {categoryItems.map((item) => (
            <div className="season-item-grid" key={item.id}>
              <label>
                <span>Produto ou serviço</span>
                <input
                  list={
                    reportCatalogs[item.category]?.length
                      ? `season-catalog-${item.category}`
                      : undefined
                  }
                  value={item.name}
                  onChange={(event) =>
                    updateItem(item.id, { name: event.target.value })
                  }
                  placeholder={
                    reportCatalogs[item.category]?.length
                      ? "Digite ou selecione do banco"
                      : `Ex.: ${categoryLabel(item.category)}`
                  }
                />
              </label>
              <label>
                <span>Dose ou uso por ha</span>
                <div className="season-dose-input">
                  <DecimalInput
                    ariaLabel={`Dose de ${item.name || "item"}`}
                    value={item.dose}
                    onChange={(dose) => updateItem(item.id, { dose })}
                  />
                  <select
                    value={item.unit}
                    onChange={(event) =>
                      updateItem(item.id, {
                        unit: event.target.value as CostUnit,
                        priceBasis: defaultPriceBasis(
                          item.category,
                          event.target.value as CostUnit,
                        ),
                      })
                    }
                  >
                    {costUnits.map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label>
                <span>Preço unitário</span>
                <div className="season-price-input">
                  <DecimalInput
                    ariaLabel={`Preço de ${item.name || "item"}`}
                    value={item.unitPrice}
                    onChange={(unitPrice) =>
                      updateItem(item.id, { unitPrice })
                    }
                  />
                  <select
                    aria-label={`Unidade do preço de ${item.name || "item"}`}
                    value={resolvedPriceBasis(item)}
                    onChange={(event) =>
                      updateItem(item.id, {
                        priceBasis: event.target.value as PriceBasis,
                      })
                    }
                  >
                    {priceBasisOptions(item).map((basis) => (
                      <option key={basis}>{basis}</option>
                    ))}
                  </select>
                </div>
              </label>
              <div className="season-row-total">
                <span>Custo/ha</span>
                <strong>{money(costPerHa(item))}</strong>
                <button
                  aria-label={`Remover ${item.name || "item"}`}
                  onClick={() => removeItem(item.id)}
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
          {!categoryItems.length && (
            <div className="season-empty-category">
              <strong>Nenhum lançamento em {categoryLabel(activeCategory)}.</strong>
              <p>
                Adicione produto, dose por hectare e preço unitário para compor
                o custo automaticamente.
              </p>
            </div>
          )}
          <button
            className="button secondary add-season-item"
            onClick={() => addItem(activeCategory)}
          >
            + Adicionar em {categoryLabel(activeCategory)}
          </button>
          {reportCatalogs[activeCategory]?.length ? (
            <small className="season-catalog-help">
              Banco conectado: {reportCatalogs[activeCategory]?.length} opções
              disponíveis para seleção.
            </small>
          ) : null}
        </div>
      </section>

      <section className="content-panel season-composition-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">COMPOSIÇÃO DOS CUSTOS</span>
            <h2>Participação por categoria</h2>
          </div>
          <strong>{money(summary.costHa)}/ha</strong>
        </div>
        {composition.entries.length ? (
          <div className="season-composition-grid">
            <div
              className="season-cost-donut"
              style={{ background: composition.gradient }}
              role="img"
              aria-label="Gráfico de composição dos custos por categoria"
            >
              <span>
                <b>{money(summary.costHa)}</b>
                <small>por hectare</small>
              </span>
            </div>
            <div className="season-cost-bars">
              {composition.entries.map((entry) => {
                const percentage = summary.costHa > 0 ? (entry.value / summary.costHa) * 100 : 0;
                return (
                  <div key={entry.key}>
                    <header>
                      <span><i style={{ background: entry.color }} />{entry.label}</span>
                      <b>{decimal(percentage, 1)}% · {money(entry.value)}/ha</b>
                    </header>
                    <span className="season-cost-track">
                      <i style={{ width: `${Math.max(percentage, 1)}%`, background: entry.color }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="season-chart-empty">Adicione custos para gerar o gráfico automaticamente.</p>
        )}
      </section>

      <section className="content-panel season-grain-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">CUSTO EM SACAS POR HECTARE</span>
            <h2>Compare o custo pelo preço dos grãos</h2>
          </div>
          <small>Preencha o preço líquido estimado por saca</small>
        </div>
        <div className="season-grain-grid">
          {grainCrops.map((crop) => (
            <label key={crop} className={report.crop === crop ? "active" : ""}>
              <span>{crop}</span>
              <div className="input-wrap">
                <b>R$</b>
                <DecimalInput
                  ariaLabel={`Preço da saca de ${crop}`}
                  value={report.grainPrices?.[crop] ?? 0}
                  onChange={(value) => updateGrainPrice(crop, value)}
                />
              </div>
              <strong>
                {(report.grainPrices?.[crop] ?? 0) > 0
                  ? `${decimal(summary.costInBags[crop])} sc/ha`
                  : "Informe o preço"}
              </strong>
            </label>
          ))}
        </div>
      </section>

      <section className="season-results-grid">
        <div className="content-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">3 · COLHEITA</span>
              <h2>Produtividade e receita</h2>
            </div>
          </div>
          <div className="season-form-grid harvest-grid">
            <label className="field">
              <span>Produtividade</span>
              <div className="input-wrap">
                <DecimalInput
                  ariaLabel="Produtividade em sacas por hectare"
                  value={report.yieldScHa}
                  onChange={(yieldScHa) => update({ yieldScHa })}
                />
                <b>sc/ha</b>
              </div>
            </label>
            <label className="field">
              <span>Preço da saca</span>
              <div className="input-wrap">
                <b>R$</b>
                <DecimalInput
                  ariaLabel="Preço da saca"
                  value={report.salePrice}
                  onChange={(salePrice) => {
                    if (grainCrops.includes(report.crop as GrainCrop)) {
                      updateGrainPrice(report.crop as GrainCrop, salePrice);
                    } else {
                      update({ salePrice });
                    }
                  }}
                />
              </div>
            </label>
          </div>
          <label className="field season-notes">
            <span>Observações técnicas e aprendizados da safra</span>
            <textarea
              value={report.notes}
              onChange={(event) => update({ notes: event.target.value })}
              placeholder="Ocorrências climáticas, desempenho dos manejos, ajustes para a próxima safra…"
            />
          </label>
        </div>

        <aside className="content-panel season-summary">
          <span className="eyebrow">RESUMO DO FECHAMENTO</span>
          <div>
            <span>Custo por hectare</span>
            <strong>{money(summary.costHa)}</strong>
          </div>
          <div>
            <span>Custo total</span>
            <strong>{money(summary.totalCost)}</strong>
          </div>
          <div>
            <span>Receita bruta/ha</span>
            <strong>{money(summary.revenueHa)}</strong>
          </div>
          <div className={summary.marginHa >= 0 ? "positive" : "negative"}>
            <span>Margem estimada/ha</span>
            <strong>{money(summary.marginHa)}</strong>
          </div>
          <div>
            <span>Ponto de equilíbrio</span>
            <strong>{decimal(summary.breakEven)} sc/ha</strong>
          </div>
          {grainCrops.includes(report.crop as GrainCrop) &&
            (report.grainPrices?.[report.crop as GrainCrop] ?? 0) > 0 && (
              <div>
                <span>Custo em sacas de {report.crop.toLowerCase()}</span>
                <strong>{decimal(summary.costInBags[report.crop as GrainCrop])} sc/ha</strong>
              </div>
            )}
          <label className="watermark-switch">
            <input
              type="checkbox"
              checked={report.watermark}
              onChange={(event) => update({ watermark: event.target.checked })}
            />
            Usar marca d’água do perfil
          </label>
          <button
            className="button secondary full-button"
            onClick={() => void saveReport()}
          >
            Salvar fechamento
          </button>
          <button
            className="button primary full-button"
            onClick={() => void exportPdf()}
          >
            Gerar PDF de fechamento
          </button>
          {message && <p className="season-message">{message}</p>}
        </aside>
      </section>

      <section className="content-panel season-photos-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">REGISTRO FOTOGRÁFICO</span>
            <h2>Fotos da lavoura no relatório técnico</h2>
          </div>
          <span>{(report.photos ?? []).length}/6 fotos</span>
        </div>
        <p>
          Tire uma foto no campo ou importe imagens já salvas. A descrição aparece logo abaixo da foto no PDF.
        </p>
        <div className="season-photo-actions">
          <label className="button primary">
            Tirar foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => void importReportPhotos(event)}
            />
          </label>
          <label className="button secondary">
            Importar fotos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => void importReportPhotos(event)}
            />
          </label>
        </div>
        {photoMessage && <small className="season-message">{photoMessage}</small>}
        {(report.photos ?? []).length > 0 && (
          <div className="season-photo-grid">
            {(report.photos ?? []).map((photo, index) => (
              <article key={photo.id}>
                <img src={photo.dataUrl} alt={photo.description || `Foto ${index + 1} da lavoura`} />
                <label>
                  <span>Descrição da foto</span>
                  <textarea
                    value={photo.description}
                    onChange={(event) => updatePhoto(photo.id, { description: event.target.value })}
                    placeholder="Ex.: Soja em R3, reboleira com pé-de-galinha no lado norte do talhão."
                  />
                </label>
                <button
                  className="text-button"
                  onClick={() => update({ photos: report.photos.filter((item) => item.id !== photo.id) })}
                >
                  Remover foto
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

    </>
  );
}
