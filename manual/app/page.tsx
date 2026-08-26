"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GState, jsPDF } from "jspdf";
import agrofitProducts from "./agrofit-products.json";
import commercialAgrochemicalsData from "./commercial-agrochemicals.json";
import cultivarsData from "./cultivars.json";
import fertilizerFormulasData from "./fertilizer-formulas.json";
import foliarProductsData from "./foliar-products.json";
import FieldMap, { MapPoint } from "./FieldMap";
import FieldInsights, {
  spectralPreviewUrl,
  spectralTileUrl,
  type VegetationIndex,
} from "./FieldInsights";
import AgroMarketPage from "./AgroMarketPage";
import RecordsArchive from "./RecordsArchive";
import SeasonReports from "./SeasonReports";
import ZarcPlanner from "./ZarcPlanner";
import { saveRecord, setRecordOwner, syncLocalRecordsToServer } from "./records";
import AccessPortal, { type AccessSessionUser } from "./AccessPortal";
import AdminAccessPanel from "./AdminAccessPanel";
import ProducerCrmImport from "./ProducerCrmImport";
import NutrientRemovalCalculator from "./NutrientRemovalCalculator";
import PhotoDiagnosis from "./PhotoDiagnosis";
import ProducerLandRegistry, { type LandRegistration } from "./ProducerLandRegistry";
import {
  BRAZIL_UFS,
  estimateRegionalHarvest,
  recommendPlantPopulation,
  type ProductionEnvironment,
} from "./agronomy-planning";

const embeddedInValor360 = process.env.NEXT_PUBLIC_VALOR360_EMBEDDED === "1";

type PageKey =
  | "inicio"
  | "produtores"
  | "solo"
  | "diagnostico"
  | "calculadoras"
  | "bulas"
  | "mercado"
  | "relatorios"
  | "feedback"
  | "administracao"
  | "perfil"
  | "empresa";
type CalcKey =
  | "semeadora"
  | "populacao"
  | "sementes"
  | "colheita"
  | "zoneamento"
  | "pulverizacao"
  | "fertilizante"
  | "reposicao"
  | "cotacao";
type Crop = "Todas" | "Soja" | "Milho" | "Trigo" | "Canola" | "Arroz";
type AreaUnit = "ha" | "alq. paulista" | "alq. mineiro";
type FertilizerDoseUnit = "kg/ha" | "t/ha" | "saco/ha";
type FertilizerPriceUnit = "R$/t" | "R$/saco" | "R$/kg";

const areaUnitFactors: Record<AreaUnit, number> = {
  ha: 1,
  "alq. paulista": 2.42,
  "alq. mineiro": 4.84,
};

function areaToHectares(value: number, unit: AreaUnit) {
  return value * areaUnitFactors[unit];
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const nav: { key: PageKey; label: string; icon: IconName }[] = [
  { key: "inicio", label: "Visão geral", icon: "grid" },
  { key: "produtores", label: "Produtores", icon: "users" },
  { key: "solo", label: "Análises de solo", icon: "layers" },
  { key: "diagnostico", label: "Diagnóstico por foto", icon: "camera" },
  { key: "calculadoras", label: "Calculadoras", icon: "calculator" },
  { key: "bulas", label: "Bulas", icon: "book" },
  { key: "mercado", label: "Mercado e notícias", icon: "chart" },
  { key: "relatorios", label: "Relatórios", icon: "file" },
  { key: "feedback", label: "Feedback", icon: "file" },
  { key: "administracao", label: "Administração", icon: "users" },
  { key: "perfil", label: "Meu perfil", icon: "users" },
];

function isPageKey(value: unknown): value is PageKey {
  return typeof value === "string" &&
    (value === "empresa" || nav.some((item) => item.key === value));
}

type NdviScene = {
  id: string;
  date: string;
  cloud: number;
  tileUrl: string;
  previewUrl: string;
};

type FieldPlot = {
  id: string;
  name: string;
  crop: string;
  season: string;
  area: number;
  points: MapPoint[];
  ndviScenes: NdviScene[];
  registrationId?: string;
};

type Producer = {
  id: string;
  name: string;
  crmCode?: string;
  valor360LegacyExternalKeys?: string[];
  document: string;
  phone: string;
  email: string;
  city: string;
  properties: string;
  area: number;
  cultures?: string[];
  notes: string;
  fields: FieldPlot[];
  registrations?: LandRegistration[];
  mappingStatus?: "pending" | "mapped";
  crmSource?: string;
};

type SoilMetricKey =
  | "ph"
  | "smp"
  | "clay"
  | "organicMatter"
  | "phosphorus"
  | "potassium"
  | "sulfur"
  | "calcium"
  | "magnesium"
  | "aluminum"
  | "hal"
  | "ctc"
  | "baseSaturation"
  | "aluminumSaturation"
  | "boron"
  | "iron"
  | "copper"
  | "zinc"
  | "manganese"
  | "sand"
  | "silt";

type SoilMetricDefinition = {
  key: SoilMetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  group: "Acidez e CTC" | "Macronutrientes" | "Micronutrientes" | "Textura";
  patterns: RegExp[];
};

type SoilSample = {
  id: string;
  code: string;
  label: string;
  depth: string;
  values: Record<SoilMetricKey, string>;
};

type SoilInterpretationStatus = "critical" | "low" | "attention" | "adequate" | "high";

type SoilInterpretationItem = {
  key: SoilMetricKey;
  label: string;
  value: number;
  unit: string;
  status: SoilInterpretationStatus;
  statusLabel: string;
  reason: string;
  action: string;
};

type SoilLinkState =
  | "UNLINKED"
  | "LINKED_TO_CLIENT"
  | "LINKED_TO_PROPERTY"
  | "LINKED_TO_FIELD";

type SoilLinkTarget = {
  producerId: string;
  property: string;
  fieldId: string;
};

type SoilLinkHistoryEntry = {
  version: number;
  action: "LINK" | "CHANGE" | "UNLINK" | "MIGRATE";
  fromState: SoilLinkState;
  toState: SoilLinkState;
  from: SoilLinkTarget;
  to: SoilLinkTarget;
  changedAt: string;
  actorId: string;
  source: "manual-do-agronomo" | "legacy-workspace";
};

type SoilLinkProvenance = {
  source: "document-import" | "manual-do-agronomo" | "legacy-workspace";
  actorId: string;
  changedAt: string;
  reason: "CREATED_UNLINKED" | "USER_CONFIRMED" | "LEGACY_MIGRATION";
  target: SoilLinkTarget;
};

type SoilDraft = {
  id: string;
  recordId: string;
  fileName: string;
  sourceType: "PDF" | "Imagem" | "Câmera";
  importedAt: string;
  sampleDate: string;
  laboratory: string;
  sampleCode: string;
  producerId: string;
  property: string;
  fieldId: string;
  depth: string;
  values: Record<SoilMetricKey, string>;
  rawText: string;
  detectedProducerName?: string;
  documentType?: string;
  extractionWarnings?: string[];
  samples?: SoilSample[];
  activeSampleId?: string;
  phMethod?: string;
  phosphorusMethod?: string;
  regionalReference?: string;
  targetCrop?: string;
  yieldTarget?: string;
  productionSystem?: string;
  linkState: SoilLinkState;
  linkVersion: number;
  linkHistory: SoilLinkHistoryEntry[];
  linkProvenance: SoilLinkProvenance;
};

type SoilAnalysis = SoilDraft & {
  savedAt: string;
};

const soilLinkStates = new Set<SoilLinkState>([
  "UNLINKED",
  "LINKED_TO_CLIENT",
  "LINKED_TO_PROPERTY",
  "LINKED_TO_FIELD",
]);

const soilLinkStateLabels: Record<SoilLinkState, string> = {
  UNLINKED: "Não vinculada",
  LINKED_TO_CLIENT: "Vinculada ao produtor",
  LINKED_TO_PROPERTY: "Vinculada à propriedade",
  LINKED_TO_FIELD: "Vinculada ao talhão",
};

function soilLinkTarget(value: Pick<SoilDraft, "producerId" | "property" | "fieldId">): SoilLinkTarget {
  return {
    producerId: String(value.producerId ?? ""),
    property: String(value.property ?? ""),
    fieldId: String(value.fieldId ?? ""),
  };
}

function soilLinkStateFor(target: SoilLinkTarget): SoilLinkState {
  if (!target.producerId) return "UNLINKED";
  if (target.fieldId) return "LINKED_TO_FIELD";
  if (target.property.trim()) return "LINKED_TO_PROPERTY";
  return "LINKED_TO_CLIENT";
}

function sameSoilLink(
  currentState: SoilLinkState,
  current: SoilLinkTarget,
  nextState: SoilLinkState,
  next: SoilLinkTarget,
) {
  if (currentState !== nextState) return false;
  if (currentState === "UNLINKED") return true;
  return current.producerId === next.producerId &&
    current.property === next.property &&
    current.fieldId === next.fieldId;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeSoilAnalysis(value: SoilAnalysis): SoilAnalysis {
  const target = soilLinkTarget(value);
  const explicitState = soilLinkStates.has(value.linkState)
    ? value.linkState
    : soilLinkStateFor(target);
  const changedAt = value.linkProvenance?.changedAt || value.savedAt || value.importedAt || new Date().toISOString();
  const actorId = value.linkProvenance?.actorId || "";
  const hasGovernedLink = Boolean(
    soilLinkStates.has(value.linkState) &&
    Number.isInteger(value.linkVersion) &&
    Array.isArray(value.linkHistory) &&
    value.linkProvenance?.target,
  );
  if (hasGovernedLink && isUuid(value.recordId)) return value;

  const version = hasGovernedLink
    ? Math.max(0, Number(value.linkVersion))
    : explicitState === "UNLINKED" ? 0 : 1;
  const history = hasGovernedLink
    ? value.linkHistory
    : [{
        version,
        action: "MIGRATE" as const,
        fromState: explicitState,
        toState: explicitState,
        from: target,
        to: target,
        changedAt,
        actorId,
        source: "legacy-workspace" as const,
      }];
  return {
    ...value,
    recordId: isUuid(value.recordId) ? value.recordId : isUuid(value.id) ? value.id : crypto.randomUUID(),
    linkState: explicitState,
    linkVersion: version,
    linkHistory: history,
    linkProvenance: hasGovernedLink
      ? value.linkProvenance
      : {
          source: "legacy-workspace",
          actorId,
          changedAt,
          reason: "LEGACY_MIGRATION",
          target,
        },
  };
}

type SoilImportState = {
  status: "idle" | "processing" | "ready" | "error";
  progress: number;
  message: string;
};

type ProfessionalProfile = {
  name: string;
  email: string;
  profession: "Engenheiro Agrônomo" | "Técnico Agrícola";
  council: "CREA" | "CFTA";
  registration: string;
  company: string;
  phone: string;
  watermark: string;
  watermarkOpacity: number;
};

const initialProfile: ProfessionalProfile = {
  name: "",
  email: "",
  profession: "Engenheiro Agrônomo",
  council: "CREA",
  registration: "",
  company: "",
  phone: "",
  watermark: "",
  watermarkOpacity: 10,
};

const GATE_ONE_COMPANY = {
  name: "Gate One Soluções Digitais",
  legalDescription: "Empresa de soluções e serviços digitais",
  cnpj: "37.192.976/0001-13",
} as const;

function accountStorageKey(base: string, userId: string) {
  return `${base}:${userId}`;
}

function valor360LegacyExternalKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 180);
}

function isLegacyExampleProducer(producer: Producer) {
  const normalize = (value: string | undefined) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
  return (
    normalize(producer.name) === "joao" &&
    normalize(producer.properties) === "propriedade exemplo" &&
    (producer.fields ?? []).some(
      (field) => normalize(field.name) === "area exemplo",
    )
  );
}

const soilMetricDefinitions: SoilMetricDefinition[] = [
  {
    key: "ph",
    label: "pH",
    shortLabel: "pH",
    unit: "",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+pH(?:\s*(?:em|—|-)?\s*(?:H2O|água|CaCl2))?\s*[:=]?\s*(\d{1,2}(?:[,.]\d+)?)/i,
      /\bpH(?:\s*(?:em|—|-)?\s*(?:H2O|água|CaCl2))?\s*[:=]?\s*(\d{1,2}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "smp",
    label: "Índice SMP",
    shortLabel: "SMP",
    unit: "",
    group: "Acidez e CTC",
    patterns: [/\b(?:índice\s*)?SMP\s*[:=]?\s*(\d{1,2}(?:[,.]\d+)?)/i],
  },
  {
    key: "clay",
    label: "Argila",
    shortLabel: "Argila",
    unit: "%",
    group: "Textura",
    patterns: [/\bargila\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i],
  },
  {
    key: "sand",
    label: "Areia",
    shortLabel: "Areia",
    unit: "%",
    group: "Textura",
    patterns: [/\bareia\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i],
  },
  {
    key: "silt",
    label: "Silte",
    shortLabel: "Silte",
    unit: "%",
    group: "Textura",
    patterns: [/\bsilte\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i],
  },
  {
    key: "organicMatter",
    label: "Matéria orgânica",
    shortLabel: "M.O.",
    unit: "%",
    group: "Textura",
    patterns: [
      /\bm[eé]dia\s+(?:mat[eé]ria\s+org[aâ]nica|M\.?\s*O\.?)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\b(?:mat[eé]ria\s+org[aâ]nica|M\.?\s*O\.?)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "phosphorus",
    label: "Fósforo",
    shortLabel: "P",
    unit: "mg/dm³",
    group: "Macronutrientes",
    patterns: [
      /\bm[eé]dia\s+P(?:\s*Mehlich(?:-?1)?)?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
      /\b(?:f[oó]sforo|P(?:\s*Mehlich(?:-?1)?)?)\s*(?:\([^)]*\))?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "potassium",
    label: "Potássio",
    shortLabel: "K",
    unit: "mg/dm³",
    group: "Macronutrientes",
    patterns: [
      /\bm[eé]dia\s+K(?:\s*%)?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
      /\b(?:pot[aá]ssio|K)\s*(?:\([^)]*\))?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "sulfur",
    label: "Enxofre",
    shortLabel: "S",
    unit: "mg/dm³",
    group: "Macronutrientes",
    patterns: [
      /\bm[eé]dia\s+S(?:-SO4)?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
      /\b(?:enxofre|S(?:-SO4)?)\s*(?:\([^)]*\))?\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "calcium",
    label: "Cálcio",
    shortLabel: "Ca",
    unit: "cmolc/dm³",
    group: "Macronutrientes",
    patterns: [
      /\bm[eé]dia\s+Ca(?:\s*%)?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\b(?:c[aá]lcio|Ca)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "magnesium",
    label: "Magnésio",
    shortLabel: "Mg",
    unit: "cmolc/dm³",
    group: "Macronutrientes",
    patterns: [
      /\bm[eé]dia\s+Mg(?:\s*%)?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\b(?:magn[eé]sio|Mg)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "aluminum",
    label: "Alumínio",
    shortLabel: "Al",
    unit: "cmolc/dm³",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+Al\b(?!\s*\+)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /(?<!\+\s)\b(?:alum[ií]nio|Al)\b(?!\s*\+)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "hal",
    label: "H + Al",
    shortLabel: "H+Al",
    unit: "cmolc/dm³",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+H\s*\+\s*Al\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\bH\s*\+\s*Al\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "ctc",
    label: "CTC pH 7,0",
    shortLabel: "CTC",
    unit: "cmolc/dm³",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+CTC(?:\s*(?:a|pH)?\s*7(?:[,.]0)?)?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\bCTC(?:\s*(?:a|pH)?\s*7(?:[,.]0)?)?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "baseSaturation",
    label: "Saturação por bases",
    shortLabel: "V",
    unit: "%",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+V\s*%?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\b(?:satura[cç][aã]o\s+por\s+bases|V\s*%)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "aluminumSaturation",
    label: "Saturação por alumínio",
    shortLabel: "m",
    unit: "%",
    group: "Acidez e CTC",
    patterns: [
      /\bm[eé]dia\s+m\s*%?\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
      /\b(?:satura[cç][aã]o\s+por\s+alum[ií]nio|m\s*%)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i,
    ],
  },
  {
    key: "boron",
    label: "Boro",
    shortLabel: "B",
    unit: "mg/dm³",
    group: "Micronutrientes",
    patterns: [/\b(?:boro|B)\s*[:=]?\s*(\d{1,3}(?:[,.]\d+)?)/i],
  },
  {
    key: "iron",
    label: "Ferro",
    shortLabel: "Fe",
    unit: "mg/dm³",
    group: "Micronutrientes",
    patterns: [/\b(?:ferro|Fe)\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i],
  },
  {
    key: "copper",
    label: "Cobre",
    shortLabel: "Cu",
    unit: "mg/dm³",
    group: "Micronutrientes",
    patterns: [/\b(?:cobre|Cu)\s*[:=]?\s*(\d{1,4}(?:[,.]\d+)?)/i],
  },
  {
    key: "zinc",
    label: "Zinco",
    shortLabel: "Zn",
    unit: "mg/dm³",
    group: "Micronutrientes",
    patterns: [/\b(?:zinco|Zn)\s*[:=]?\s*(\d{1,4}(?:[,.]\d+)?)/i],
  },
  {
    key: "manganese",
    label: "Manganês",
    shortLabel: "Mn",
    unit: "mg/dm³",
    group: "Micronutrientes",
    patterns: [/\b(?:mangan[eê]s|Mn)\s*[:=]?\s*(\d{1,5}(?:[,.]\d+)?)/i],
  },
];

function emptySoilValues(): Record<SoilMetricKey, string> {
  return Object.fromEntries(
    soilMetricDefinitions.map((metric) => [metric.key, ""]),
  ) as Record<SoilMetricKey, string>;
}

type Product = {
  name: string;
  registration: string;
  active: string;
  maker: string;
  type: string;
  crops: string[];
  status: string;
};

type NutrientKey =
  | "N" | "P2O5" | "K2O" | "Ca" | "Mg" | "S"
  | "B" | "Zn" | "Cu" | "Mn" | "Fe" | "Mo";

type FertilizerFormula = {
  id: string;
  name: string;
  maker: string;
  category: string;
  nutrients: Record<NutrientKey, number>;
  technology?: string;
  source?: string;
  note?: string;
  guarantee?: string | null;
};

type CommercialAgrochemical = {
  id: string;
  name: string;
  active: string;
  maker: string;
  source: string;
};

type FoliarProduct = {
  id: string;
  name: string;
  maker: string;
  category: string;
  guarantee: string;
  composition: string;
  description: string;
  source: string;
  note: string;
  verified: boolean;
};

type Cultivar = {
  id: string;
  crop: "Soja" | "Milho" | "Trigo" | "Canola";
  name: string;
  brand: string;
  registrationName: string;
  gmr: number | null;
  cycleDays: number;
  cycleRangeDays: [number, number];
  cycleByMonth?: Record<string, number>;
  cycleEvidence?: "observed" | "official-relative" | "regional-reference";
  officialMaturity?: string;
  thermalSum: number | null;
  thermalStage: string | null;
  cycleClass: string;
  dataBasis: string;
  sourceLabel: string;
  source: string;
  manufacturerSourceLabel?: string;
  manufacturerSource?: string;
};

type CultivarCatalog = {
  soybean: Cultivar[];
  corn: Cultivar[];
  wheat: Cultivar[];
  canola: Cultivar[];
};

const emptyNutrients = (): Record<NutrientKey, number> => ({
  N: 0, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0,
  B: 0, Zn: 0, Cu: 0, Mn: 0, Fe: 0, Mo: 0,
});

const legacyFertilizerFormulas: FertilizerFormula[] = [
  { id: "04-28-08", name: "04-28-08", maker: "Convencional", category: "NPK", nutrients: { ...emptyNutrients(), N: 4, P2O5: 28, K2O: 8 } },
  { id: "05-20-20", name: "05-20-20", maker: "Convencional", category: "NPK", nutrients: { ...emptyNutrients(), N: 5, P2O5: 20, K2O: 20 } },
  { id: "02-20-20", name: "02-20-20", maker: "Convencional", category: "NPK", nutrients: { ...emptyNutrients(), N: 2, P2O5: 20, K2O: 20 } },
  { id: "00-20-20", name: "00-20-20", maker: "Convencional", category: "PK", nutrients: { ...emptyNutrients(), P2O5: 20, K2O: 20 } },
  { id: "MAP", name: "MAP 11-52-00", maker: "Convencional", category: "Fosfatado", nutrients: { ...emptyNutrients(), N: 11, P2O5: 52 } },
  { id: "DAP", name: "DAP 18-46-00", maker: "Convencional", category: "Fosfatado", nutrients: { ...emptyNutrients(), N: 18, P2O5: 46 } },
  { id: "SSP", name: "Superfosfato simples", maker: "Convencional", category: "Fosfatado", nutrients: { ...emptyNutrients(), P2O5: 18, Ca: 18, S: 10 } },
  { id: "TSP", name: "Superfosfato triplo", maker: "Convencional", category: "Fosfatado", nutrients: { ...emptyNutrients(), P2O5: 41, Ca: 10 } },
  { id: "KCL", name: "Cloreto de potássio", maker: "Convencional", category: "Potássico", nutrients: { ...emptyNutrients(), K2O: 60 } },
  { id: "UREIA", name: "Ureia", maker: "Convencional", category: "Nitrogenado", nutrients: { ...emptyNutrients(), N: 45 } },
  { id: "SAM", name: "Sulfato de amônio", maker: "Convencional", category: "Nitrogenado", nutrients: { ...emptyNutrients(), N: 21, S: 24 } },
  { id: "MESZ", name: "MicroEssentials® SZ", maker: "Mosaic", category: "Fosfatado premium", nutrients: { ...emptyNutrients(), N: 12, P2O5: 40, S: 10, Zn: 1 }, technology: "N, P, dois tipos de S e Zn no mesmo grânulo", source: "https://www.cropnutrition.com/microessentials", note: "Garantia de referência internacional; confirme o registro e o rótulo comercializados no Brasil." },
  { id: "MES10", name: "MicroEssentials® S10", maker: "Mosaic", category: "Fosfatado premium", nutrients: { ...emptyNutrients(), N: 12, P2O5: 40, S: 10 }, technology: "Fósforo e enxofre em grânulo uniforme", source: "https://www.cropnutrition.com/microessentials", note: "Confirme disponibilidade e garantia do produto comercializado na sua região." },
  { id: "MES15", name: "MicroEssentials® S15", maker: "Mosaic", category: "Fosfatado premium", nutrients: { ...emptyNutrients(), N: 13, P2O5: 33, S: 15 }, technology: "Enxofre sulfato + elementar", source: "https://www.cropnutrition.com/microessentials", note: "Confirme disponibilidade e garantia do produto comercializado na sua região." },
  { id: "YB042808", name: "YaraBasa™ 04-28-08", maker: "Yara", category: "Complexo multinutriente", nutrients: { ...emptyNutrients(), N: 4, P2O5: 28, K2O: 8 }, technology: "Nutrientes distribuídos em grânulos homogêneos", source: "https://www.yara.com.br/nutricao-de-plantas/produtos/yarabasa/", note: "Macros secundários e micros variam por fórmula/região: edite conforme a garantia da nota ou rótulo." },
  { id: "TOP280", name: "TOP-PHOS® 280 HP", maker: "TIMAC Agro", category: "Fosfatado tecnológico", nutrients: { ...emptyNutrients(), P2O5: 28 }, technology: "CSP® — proteção do fósforo em solos ácidos", source: "https://www.timacagro.com.br/produto/top-phos/", note: "Complete Ca, S e micronutrientes conforme a garantia do lote/ficha comercial." },
  { id: "TOP14K", name: "TOP-PHOS® HP 14K", maker: "TIMAC Agro", category: "NPK tecnológico", nutrients: { ...emptyNutrients(), K2O: 14 }, technology: "CSP® — proteção do fósforo em solos ácidos", source: "https://www.timacagro.com.br/produto/top-phos/", note: "Informe N, P₂O₅, Ca e S conforme a garantia comercial vigente." },
  { id: "INR490", name: "INRIZZA® 490 HP", maker: "TIMAC Agro", category: "Fosfatado tecnológico", nutrients: { ...emptyNutrients() }, technology: "MCZ® — nutrição associada à atividade micorrízica", source: "https://www.timacagro.com.br/produto/inrizza/", note: "Garantias não publicadas na página institucional; preencha conforme rótulo, nota ou ficha comercial." },
  { id: "INR13K", name: "INRIZZA® HP 13K", maker: "TIMAC Agro", category: "NPK tecnológico", nutrients: { ...emptyNutrients(), K2O: 13 }, technology: "MCZ® — nutrição associada à atividade micorrízica", source: "https://www.timacagro.com.br/produto/inrizza/", note: "Informe N, P₂O₅, Ca, S e micros conforme a garantia comercial vigente." },
];

const products = agrofitProducts as Product[];
const fertilizerFormulas = fertilizerFormulasData as FertilizerFormula[];
const commercialAgrochemicals =
  commercialAgrochemicalsData as CommercialAgrochemical[];
const foliarProducts = foliarProductsData as FoliarProduct[];
const cultivarCatalog = cultivarsData as CultivarCatalog;
const AGROFIT_URL =
  "https://agrofit.agricultura.gov.br/agrofit_cons/principal_agrofit_cons";

type ProblemGuide = {
  id: string;
  name: string;
  scientificName: string;
  aliases: string[];
  crops: string[];
  products: Array<{
    name: string;
    active: string;
    registration?: string;
    crops: string;
    source: string;
  }>;
  studies: Array<{
    title: string;
    institution: string;
    year: string;
    source: string;
  }>;
};

type OfficialTarget = {
  id: string;
  scientificName: string;
  commonNames: string;
  label: string;
  source: string;
};

type OfficialTargetProduct = {
  name: string;
  status: string;
  toxicologicalClass: string;
  registrant: string;
  source: string;
};

const problemGuides: ProblemGuide[] = [
  {
    id: "capim-pe-de-galinha",
    name: "Capim-pé-de-galinha",
    scientificName: "Eleusine indica",
    aliases: ["pé de galinha", "capim de pomar", "goosegrass"],
    crops: ["Soja", "Milho", "Trigo", "Canola"],
    products: [
      {
        name: "Dual Gold",
        active: "S-metolacloro",
        registration: "8499",
        crops: "consulte a bula para cultura, modalidade e estádio",
        source: "https://www.syngenta.com.br/sites/g/files/kgtney466/files/media/document/2023/06/14/BULA_DUAL_GOLD_ABRIL_23.pdf",
      },
      {
        name: "Convintro DUO",
        active: "glufosinato de amônio + trifludimoxazina",
        registration: "12425",
        crops: "soja geneticamente compatível, conforme bula",
        source: "https://www.agro.bayer.com.br/marcas/convintro-duo",
      },
      {
        name: "Verdict Ultra",
        active: "haloxifope-P-metílico",
        crops: "consulte culturas e restrições na bula vigente",
        source: "https://www.corteva.com.br/content/dam/dpagco/corteva/la/br/pt/bulas-2025/herbicidas/VERDICTULTRA_Bula.pdf",
      },
    ],
    studies: [
      {
        title: "Manejo químico de capim-pé-de-galinha resistente a herbicidas",
        institution: "Planta Daninha / SciELO",
        year: "2011",
        source: "https://www.scielo.br/j/pd/a/4Rv7PHscmkpCR9JMg65ryNt/?lang=pt",
      },
      {
        title: "Manejo de Eleusine indica resistente ao glyphosate",
        institution: "Pesquisa Agropecuária Brasileira / SciELO",
        year: "2013",
        source: "https://www.scielo.br/j/pab/a/4bRX3CpLBqZRfrB3myWxZ9K/",
      },
    ],
  },
  {
    id: "buva",
    name: "Buva",
    scientificName: "Conyza spp.",
    aliases: ["voadeira", "rabo de foguete", "conyza"],
    crops: ["Soja", "Milho", "Trigo"],
    products: [
      {
        name: "Elevore",
        active: "halauxifeno-metílico",
        registration: "26123",
        crops: "soja e milho, conforme modalidade indicada em bula",
        source: "https://www.corteva.com.br/produtos-e-servicos/protecao-de-cultivos/elevore.html",
      },
      {
        name: "XtendiMax 2",
        active: "dicamba",
        crops: "consulte tecnologia de cultivo e modalidade na bula",
        source: "https://www.agro.bayer.com.br/marcas/xtendimax-2",
      },
    ],
    studies: [
      {
        title: "Manejo de buva resistente ao glifosato",
        institution: "Embrapa",
        year: "2015",
        source: "https://ainfo.cnptia.embrapa.br/digital/bitstream/item/127511/1/ID-41256-FL-8506-manejo-de-buva-resistente-ao-glifosato.pdf",
      },
    ],
  },
  {
    id: "azevem",
    name: "Azevém",
    scientificName: "Lolium multiflorum",
    aliases: ["azevem", "ryegrass", "lolium"],
    crops: ["Soja", "Milho", "Trigo", "Canola"],
    products: [
      {
        name: "Verdict Ultra",
        active: "haloxifope-P-metílico",
        crops: "consulte cultura, estádio e restrições na bula vigente",
        source: "https://www.corteva.com.br/content/dam/dpagco/corteva/la/br/pt/bulas-2025/herbicidas/VERDICTULTRA_Bula.pdf",
      },
      {
        name: "Liberty",
        active: "glufosinato de amônio",
        crops: "somente usos, culturas e tecnologias previstos em bula",
        source: "https://download.basf.com/p1/8a8081c57fd4b609017fe089ad290402/pt/Bula_-_Liberty%C2%AE_Flyer_portugu%C3%AAs.pdf",
      },
    ],
    studies: [
      {
        title: "Manejo de azevém resistente a herbicidas",
        institution: "Embrapa Trigo",
        year: "2015",
        source: "https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1028894/1/azevem.gazziero.2015.pdf",
      },
    ],
  },
  {
    id: "ferrugem-asiatica",
    name: "Ferrugem-asiática da soja",
    scientificName: "Phakopsora pachyrhizi",
    aliases: ["ferrugem da soja", "phakopsora", "ferrugem asiatica"],
    crops: ["Soja"],
    products: [
      {
        name: "Fox Xpro",
        active: "bixafem + protioconazol + trifloxistrobina",
        registration: "24117",
        crops: "soja, conforme bula e estratégia antirresistência",
        source: "https://www.agro.bayer.com.br/marcas/fox-xpro",
      },
      {
        name: "Alade",
        active: "ciproconazol + difenoconazol + azoxistrobina",
        registration: "07521",
        crops: "soja, conforme bula e estratégia antirresistência",
        source: "https://portal.syngenta.com.br/produtos/alade/",
      },
    ],
    studies: [
      {
        title: "Eficiência de fungicidas para ferrugem-asiática — safra 2024/2025",
        institution: "Embrapa Soja / Ensaios Cooperativos",
        year: "2025",
        source: "https://www.embrapa.br/busca-de-publicacoes/-/publicacao/1177349/eficiencia-de-fungicidas-para-o-controle-da-ferrugem-asiatica-da-soja-phakopsora-pachyrhizi-na-safra-20242025-resultados-sumarizados-dos-ensaios-cooperativos",
      },
    ],
  },
  {
    id: "percevejos-soja",
    name: "Percevejos da soja",
    scientificName: "Euschistus heros, Nezara viridula e Piezodorus guildinii",
    aliases: ["percevejo marrom", "percevejo verde", "percevejo pequeno"],
    crops: ["Soja"],
    products: [
      {
        name: "Engeo Pleno S",
        active: "tiametoxam + lambda-cialotrina",
        registration: "6105",
        crops: "soja; confirme alvo, dose e intervalo na bula",
        source: "https://portal.syngenta.com.br/produtos/engeo-pleno-soja/",
      },
      {
        name: "Expedition",
        active: "sulfoxaflor + lambda-cialotrina",
        registration: "28219",
        crops: "soja; confirme alvo, dose e intervalo na bula",
        source: "https://www.corteva.com.br/produtos-e-servicos/protecao-de-cultivos/expedition.html",
      },
    ],
    studies: [
      {
        title: "Ensaios cooperativos para controle do complexo de percevejos",
        institution: "Embrapa Soja",
        year: "2019",
        source: "https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1113935/1/CT1543.pdf",
      },
    ],
  },
  {
    id: "lagarta-cartucho",
    name: "Lagarta-do-cartucho",
    scientificName: "Spodoptera frugiperda",
    aliases: ["lagarta do cartucho", "spodoptera", "cartucho do milho"],
    crops: ["Milho"],
    products: [
      {
        name: "Ampligo Pro",
        active: "clorantraniliprole + lambda-cialotrina",
        registration: "3916",
        crops: "milho; confirme alvo e momento de aplicação na bula",
        source: "https://www.syngenta.com.br/sites/g/files/kgtney466/files/media/document/2025/09/08/AMPLIGO_Bula%20Completa_24.04.2025.pdf",
      },
      {
        name: "Exalt",
        active: "espinetoram",
        registration: "14314",
        crops: "milho; confirme alvo e momento de aplicação na bula",
        source: "https://www.corteva.com.br/produtos-e-servicos/protecao-de-cultivos/Exalt.html",
      },
    ],
    studies: [
      {
        title: "Manejo da lagarta-do-cartucho em sistemas de produção integrados",
        institution: "Embrapa",
        year: "2023",
        source: "https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1159228/1/Manejo-de-lagarta-do-cartucho-em-sistemas-de-producao-integrados.pdf",
      },
    ],
  },
];

const sprayCatalogOptions = Array.from(
  new Map(
    [
      ...products.map((product) => ({
        name: product.name,
        detail: `${product.active} · ${product.maker}`,
      })),
      ...commercialAgrochemicals.map((product) => ({
        name: product.name,
        detail: `${product.active} · ${product.maker}`,
      })),
      ...foliarProducts.map((product) => ({
        name: product.name,
        detail: `${product.composition || product.category} · ${product.maker}`,
      })),
    ].map((product) => [normalizeCatalogName(product.name), product]),
  ).values(),
).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

function normalizeCatalogName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/®|™/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const agrofitProductsByName = new Map(
  products.flatMap((product) =>
    product.name
      .split(";")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [normalizeCatalogName(name), product] as const),
  ),
);

function normalizeOcrText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/®/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findProductFromOcr(text: string): Product | null {
  const normalizedText = ` ${normalizeOcrText(text)} `;
  if (normalizedText.trim().length < 3) return null;

  const ranked = products
    .map((product) => {
      const normalizedName = normalizeOcrText(product.name);
      const nameTokens = normalizedName
        .split(" ")
        .filter((token) => token.length >= 3);
      const activeTokens = normalizeOcrText(product.active)
        .split(" ")
        .filter((token) => token.length >= 6);
      let score = normalizedText.includes(` ${normalizedName} `) ? 50 : 0;
      score += nameTokens.filter((token) =>
        normalizedText.includes(` ${token} `),
      ).length * 8;
      score += activeTokens.filter((token) =>
        normalizedText.includes(` ${token} `),
      ).length * 3;
      if (
        normalizedText.includes(
          ` ${normalizeOcrText(product.maker)} `,
        )
      ) {
        score += 2;
      }
      return { product, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score >= 8 ? ranked[0].product : null;
}

function parseLabToken(token: string | undefined) {
  if (!token || /^(?:n\.?\s*s\.?|ns|-|—)$/i.test(token.trim())) return null;
  const value = Number(token.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function extractTechSoloSamples(text: string) {
  if (!/(?:TECH\s*SOLO|TECHSOLO|TECNOLOGIA\s+EM\s+AN[AÁ]LISE\s+DE\s+SOLO)/i.test(text)) {
    return [] as SoilSample[];
  }
  const sampleMap = new Map<string, SoilSample>();
  let section: "chemical" | "complement" | "physical" | "" = "";
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[|;]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  function ensureSample(code: string, depth: string, label: string) {
    const id = `techsolo-${code}-${depth.replace(/\D/g, "-")}`;
    const current = sampleMap.get(code) ?? {
      id,
      code,
      label: label || code,
      depth: depth ? `${depth.replace(/\s/g, "")} cm` : "",
      values: emptySoilValues(),
    };
    sampleMap.set(code, current);
    return current;
  }

  rows.forEach((line) => {
    if (/Resultado\s+de\s+An[aá]lise\s+Qu[ií]mica/i.test(line)) section = "chemical";
    else if (/Resultados?\s+Complementares?/i.test(line)) section = "complement";
    else if (/An[aá]lise\s+F[ií]sica|Resultados?\s+de\s+B\s+Cu/i.test(line)) section = "physical";

    const row = line.match(
      /^\s*(\d{4,8})\s+(\d{1,3}\s*[-–]\s*\d{1,3})\s*(?:cm)?\s*[-–]\s*(.*?)\s+((?:n\.?\s*s\.?|[-+]?\d+(?:[.,]\d+)?)(?:\s+(?:n\.?\s*s\.?|[-+]?\d+(?:[.,]\d+)?)){3,})$/i,
    );
    if (!row || !section) return;
    const [, code, depth, label, rawValues] = row;
    const tokens = rawValues.match(/n\.?\s*s\.?|[-+]?\d+(?:[.,]\d+)?/gi) ?? [];
    const sample = ensureSample(code, depth, `${depth} cm · ${label}`);
    const setValue = (key: SoilMetricKey, value: number | null, conversion = 1) => {
      if (value === null) return;
      sample.values[key] = soilNumberText(value * conversion);
    };

    if (section === "chemical" && tokens.length >= 13) {
      const phH2O = parseLabToken(tokens[0]);
      const phCaCl2 = parseLabToken(tokens[2]);
      setValue("ph", phH2O ?? phCaCl2);
      setValue("smp", parseLabToken(tokens[1]));
      setValue("phosphorus", parseLabToken(tokens[4]));
      setValue("sulfur", parseLabToken(tokens[6]));
      setValue("potassium", parseLabToken(tokens[7]), 39.1);
      setValue("calcium", parseLabToken(tokens[9]), 0.1);
      setValue("magnesium", parseLabToken(tokens[10]), 0.1);
      setValue("aluminum", parseLabToken(tokens[11]), 0.1);
      setValue("hal", parseLabToken(tokens[12]), 0.1);
      setValue("organicMatter", parseLabToken(tokens[13]), 0.1);
    }
    if (section === "complement" && tokens.length >= 5) {
      setValue("ctc", parseLabToken(tokens[2]), 0.1);
      setValue("baseSaturation", parseLabToken(tokens[3]));
      setValue("aluminumSaturation", parseLabToken(tokens[4]));
    }
    if (section === "physical" && tokens.length >= 10) {
      setValue("boron", parseLabToken(tokens[0]));
      setValue("copper", parseLabToken(tokens[1]));
      setValue("iron", parseLabToken(tokens[2]));
      setValue("manganese", parseLabToken(tokens[3]));
      setValue("zinc", parseLabToken(tokens[4]));
      const clay = parseLabToken(tokens[8]);
      const silt = parseLabToken(tokens[9]);
      if ((clay ?? 0) > 0) setValue("clay", clay, 0.1);
      if ((silt ?? 0) > 0) setValue("silt", silt, 0.1);
    }
  });

  return [...sampleMap.values()].filter(
    (sample) => Object.values(sample.values).filter(Boolean).length >= 3,
  );
}

function extractSoilValues(text: string) {
  const techSoloSamples = extractTechSoloSamples(text);
  if (techSoloSamples.length) {
    return soilMetricDefinitions.flatMap((metric) => {
      const value = techSoloSamples[0].values[metric.key];
      return value
        ? [{ key: metric.key, label: metric.shortLabel, value, unit: metric.unit }]
        : [];
    });
  }
  const solanaliseRows = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("__SOLANALISE_ROW__"));
  if (solanaliseRows.length) {
    const samples = new Map<string, Partial<Record<SoilMetricKey, number>>>();
    solanaliseRows.forEach((line) => {
      const fields = Object.fromEntries(
        line
          .split("\t")
          .slice(1)
          .map((field) => {
            const separator = field.indexOf("=");
            return separator > 0
              ? [field.slice(0, separator), field.slice(separator + 1)]
              : [field, ""];
          }),
      );
      const control = fields.control || `amostra-${samples.size + 1}`;
      const current = samples.get(control) ?? {};
      Object.entries(fields).forEach(([key, rawValue]) => {
        if (key === "control" || key === "depth") return;
        const numeric = Number(String(rawValue).replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(numeric)) return;
        let value = numeric;
        if (key === "potassium") value = numeric * 391;
        if (key === "organicMatter") value = numeric / 10;
        current[key as SoilMetricKey] = value;
      });
      samples.set(control, current);
    });

    const values = new Map<SoilMetricKey, number[]>();
    samples.forEach((sample) => {
      Object.entries(sample).forEach(([key, value]) => {
        if (!Number.isFinite(value)) return;
        values.set(key as SoilMetricKey, [
          ...(values.get(key as SoilMetricKey) ?? []),
          value as number,
        ]);
      });
    });
    const extracted = soilMetricDefinitions.flatMap((metric) => {
      const found = values.get(metric.key) ?? [];
      if (!found.length) return [];
      const average = found.reduce((total, value) => total + value, 0) / found.length;
      return [{
        key: metric.key,
        label: metric.shortLabel,
        value: average.toLocaleString("pt-BR", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }),
        unit: metric.unit,
      }];
    });
    if (extracted.length) return extracted;
  }

  const compact = text
    .replace(/[|;]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n");

  return soilMetricDefinitions.flatMap((metric) => {
    const match = metric.patterns
      .map((pattern) => compact.match(pattern))
      .find((candidate) => candidate?.[1]);
    return match?.[1]
      ? [{
          key: metric.key,
          label: metric.shortLabel,
          value: match[1].replace(".", ","),
          unit: metric.unit,
        }]
      : [];
  });
}

function matchSoilText(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractSoilMetadata(text: string) {
  const producer = matchSoilText(text, [
    /\bNome\s*:\s*([^\n\r]{2,80}?)(?=\s{3,}|\bMunic[ií]pio\s*:|$)/im,
    /\bProdutor\s*:\s*([^\n\r]{2,80}?)(?=\s{3,}|\bAno\s*:|$)/im,
    /\bCliente\s*:\s*([^\n\r]{2,80}?)(?=\s{3,}|\bData\s*:|$)/im,
  ]);
  const property = matchSoilText(text, [
    /\b(?:Fazenda|Propriedade)\s*:\s*([^\n\r]{2,80}?)(?=\s{3,}|\bM[eé]dia\b|$)/im,
  ]);
  const field = matchSoilText(text, [
    /\b(?:Talh[aã]o|Campo)\s*:\s*([^\n\r]{1,60}?)(?=\s{3,}|\bM[eé]dia\b|$)/im,
  ]);
  const sampleCode = matchSoilText(text, [
    /__SOLANALISE_ROW__[^\n]*\bcontrol=([^\t\n]+)/im,
    /\b(?:C[oó]digo\s+da\s+amostra|Amostra|Identifica[cç][aã]o)\s*:\s*([^\n\r]{1,50})/im,
  ]);
  const depth = matchSoilText(text, [
    /__SOLANALISE_ROW__[^\n]*\bdepth=(\d{1,3}\s*-\s*\d{1,3})/im,
    /\b(?:Profundidade|Camada)\s*:\s*(\d{1,3}\s*(?:-|–|a)\s*\d{1,3}\s*cm)/im,
    /\b(\d{1,3}\s*(?:-|–|a)\s*\d{1,3}\s*cm)\b/im,
  ]);
  const laboratory =
    matchSoilText(text, [
      /\bLaborat[oó]rio\s*:\s*([^\n\r]{2,80})/im,
      /\bLab\.?\s*:\s*([^\n\r]{2,80})/im,
    ]) ||
    (/SOLANALISE|solanalise\.com\.br/i.test(text)
      ? "Solanálise Central de Análises Ltda."
      : /agriculturaprecisao@cvale\.com\.br/i.test(text)
      ? "C.Vale · Agricultura de Precisão"
      : "");
  const dateText = matchSoilText(text, [
    /\bData\s+Entrada\s*:\s*(\d{2}\/\d{2}\/\d{4})/im,
    /\b(?:Data\s+da\s+coleta|Data\s+da\s+amostra|Recebimento|Emiss[aã]o)\s*:\s*(\d{2}\/\d{2}\/\d{4})/im,
    /\b(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}/im,
  ]);
  const sampleDate = dateText
    ? dateText.split("/").reverse().join("-")
    : localDateValue();
  const isPrecision =
    /\b(?:taxa de aplica[cç][aã]o|agricultura de precis[aã]o|M[eé]dia\s+[PK]|K%\s+na\s+CTC)\b/i.test(
      text,
    );
  const warnings: string[] = [];
  if (isPrecision) {
    warnings.push(
      "Foram priorizadas as médias do talhão; as faixas espaciais devem ser conferidas no mapa original.",
    );
  }
  const solanaliseSampleCount = new Set(
    [...text.matchAll(/__SOLANALISE_ROW__[^\n]*\bcontrol=([^\t\n]+)/g)].map(
      (match) => match[1],
    ),
  ).size;
  if (solanaliseSampleCount > 1) {
    warnings.push(
      `${solanaliseSampleCount} amostras foram reconhecidas; os indicadores exibidos são as médias do laudo.`,
    );
  }
  if (solanaliseSampleCount) {
    warnings.push(
      "No padrão Solanálise, K foi convertido de cmolc/dm³ para mg/dm³ e M.O. de g/dm³ para %.",
    );
  }
  if (!laboratory) {
    warnings.push("Laboratório não identificado automaticamente.");
  }
  return {
    producer,
    property,
    field,
    sampleCode,
    depth,
    laboratory,
    sampleDate,
    documentType: isPrecision
      ? "Relatório de agricultura de precisão"
      : "Análise laboratorial de solo",
    warnings,
  };
}

function buildSoilDraft(
  fileName: string,
  sourceType: SoilDraft["sourceType"],
  text: string,
): SoilDraft {
  const values = emptySoilValues();
  const metadata = extractSoilMetadata(text);
  const techSoloSamples = extractTechSoloSamples(text);
  extractSoilValues(text).forEach((metric) => {
    values[metric.key] = metric.value;
  });
  const firstTechSoloSample = techSoloSamples[0];
  const isTechSolo = techSoloSamples.length > 0;
  const analysisId = crypto.randomUUID();
  const importedAt = new Date().toISOString();
  const initialTarget = {
    producerId: "",
    property: metadata.property,
    fieldId: "",
  } satisfies SoilLinkTarget;

  return {
    id: analysisId,
    recordId: analysisId,
    fileName,
    sourceType,
    importedAt,
    sampleDate: metadata.sampleDate,
    laboratory: metadata.laboratory || (isTechSolo ? "TechSolo · Agricultura de Precisão" : ""),
    sampleCode: firstTechSoloSample?.code || metadata.sampleCode || metadata.field,
    producerId: "",
    property: metadata.property,
    fieldId: "",
    depth: firstTechSoloSample?.depth || metadata.depth || "0–20 cm",
    values: firstTechSoloSample?.values ?? values,
    rawText: text,
    detectedProducerName: metadata.producer,
    documentType: metadata.documentType,
    extractionWarnings: isTechSolo
      ? [
          ...metadata.warnings.filter((warning) => !/Laborat[oó]rio não identificado/i.test(warning)),
          `${techSoloSamples.length} amostras/profundidades TechSolo foram separadas sem calcular médias.`,
          "Unidades TechSolo normalizadas: K de mmolc/dm³ para mg/dm³; Ca, Mg, Al, H+Al e CTC para cmolc/dm³; M.O. de g/dm³ para %.",
        ]
      : metadata.warnings,
    samples: techSoloSamples,
    activeSampleId: firstTechSoloSample?.id || "",
    phMethod: isTechSolo ? "CaCl2 (quando H2O não solicitado)" : "Não identificado",
    phosphorusMethod: isTechSolo ? "Resina" : "Não identificado",
    regionalReference: "CQFS-RS/SC",
    targetCrop: "Soja",
    yieldTarget: "",
    productionSystem: "Plantio direto",
    linkState: "UNLINKED",
    linkVersion: 0,
    linkHistory: [],
    linkProvenance: {
      source: "document-import",
      actorId: "",
      changedAt: importedAt,
      reason: "CREATED_UNLINKED",
      target: initialTarget,
    },
  };
}

type StructuredSoilResponse = {
  laboratory?: string;
  reportNumber?: string;
  producer?: string;
  property?: string;
  sampleDate?: string;
  documentType?: string;
  phMethod?: string;
  phosphorusMethod?: string;
  confidence?: "alta" | "média" | "baixa";
  warnings?: string[];
  samples?: Array<{
    id?: string;
    code?: string;
    label?: string;
    depth?: string;
    values?: Partial<Record<SoilMetricKey, number | null>>;
  }>;
};

function soilNumberText(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function mergeStructuredSoilDraft(
  draft: SoilDraft,
  structured: StructuredSoilResponse,
) {
  const samples = (structured.samples ?? []).map((sample, index) => {
    const values = emptySoilValues();
    Object.entries(sample.values ?? {}).forEach(([key, value]) => {
      if (key in values) values[key as SoilMetricKey] = soilNumberText(value);
    });
    const code = sample.code?.trim() || `Amostra ${index + 1}`;
    return {
      id: sample.id?.trim() || `${draft.id}-sample-${index + 1}`,
      code,
      label: sample.label?.trim() || code,
      depth: sample.depth?.trim() || draft.depth,
      values,
    } satisfies SoilSample;
  });
  const activeSample = samples[0];
  const warnings = [
    ...(draft.extractionWarnings ?? []),
    ...(structured.warnings ?? []),
  ].filter((warning, index, list) => warning && list.indexOf(warning) === index);
  if (structured.confidence && structured.confidence !== "alta") {
    warnings.push(
      `Confiança da leitura estruturada: ${structured.confidence}. Revise a tabela original antes de salvar.`,
    );
  }
  return {
    ...draft,
    laboratory: structured.laboratory?.trim() || draft.laboratory,
    sampleCode: activeSample?.code || structured.reportNumber?.trim() || draft.sampleCode,
    property: structured.property?.trim() || draft.property,
    sampleDate: structured.sampleDate?.trim() || draft.sampleDate,
    depth: activeSample?.depth || draft.depth,
    values: activeSample?.values ?? draft.values,
    detectedProducerName: structured.producer?.trim() || draft.detectedProducerName,
    documentType: structured.documentType?.trim() || draft.documentType,
    extractionWarnings: warnings,
    samples,
    activeSampleId: activeSample?.id || "",
    phMethod: structured.phMethod?.trim() || draft.phMethod,
    phosphorusMethod: structured.phosphorusMethod?.trim() || draft.phosphorusMethod,
  } satisfies SoilDraft;
}

function parseSoilNumber(value: string | undefined) {
  if (!value?.trim()) return null;
  const compact = value.replace(/\s/g, "");
  const parsed = Number(
    compact.includes(",")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact,
  );
  return Number.isFinite(parsed) ? parsed : null;
}

const soilStatusLabels: Record<SoilInterpretationStatus, string> = {
  critical: "Crítico",
  low: "Baixo",
  attention: "Pode melhorar",
  adequate: "Bom",
  high: "Alto",
};

function soilInterpretationItem(
  draft: SoilDraft,
  key: SoilMetricKey,
  status: SoilInterpretationStatus,
  reason: string,
  action: string,
) {
  const definition = soilMetricDefinitions.find((metric) => metric.key === key);
  const value = parseSoilNumber(draft.values[key]);
  if (!definition || value === null) return null;
  return {
    key,
    label: definition.label,
    value,
    unit: definition.unit,
    status,
    statusLabel: soilStatusLabels[status],
    reason,
    action,
  } satisfies SoilInterpretationItem;
}

function interpretSoilDraft(draft: SoilDraft) {
  const crop = draft.targetCrop || "a cultura informada";
  const system = draft.productionSystem || "o sistema de manejo";
  const values = Object.fromEntries(
    soilMetricDefinitions.map((metric) => [metric.key, parseSoilNumber(draft.values[metric.key])]),
  ) as Record<SoilMetricKey, number | null>;
  const items: SoilInterpretationItem[] = [];
  const add = (
    key: SoilMetricKey,
    status: SoilInterpretationStatus,
    reason: string,
    action: string,
  ) => {
    const item = soilInterpretationItem(draft, key, status, reason, action);
    if (item) items.push(item);
  };

  if (values.ph !== null) {
    const calciumChloride = /cacl|cloreto/i.test(draft.phMethod || "");
    const low = calciumChloride ? 5 : 5.5;
    const target = calciumChloride ? 5.5 : 6;
    if (values.ph < low - 0.4) add("ph", "critical", `Acidez elevada para leitura em ${draft.phMethod || "método não identificado"}.`, "Priorizar avaliação de calagem com o índice tampão, profundidade amostrada e PRNT do corretivo.");
    else if (values.ph < low) add("ph", "low", "Acidez pode limitar raízes e disponibilidade de nutrientes.", "Calcular necessidade de calagem pela referência regional; conferir alumínio, V% e camada subsuperficial.");
    else if (values.ph < target) add("ph", "attention", "Faixa intermediária; a decisão depende da cultura e do sistema.", `Reavaliar a meta de pH para ${crop} e evitar correção automática sem método regional.`);
    else if (values.ph <= target + 0.6) add("ph", "adequate", "Faixa geralmente favorável à disponibilidade de nutrientes.", "Manter monitoramento e evitar elevar o pH sem necessidade demonstrada.");
    else add("ph", "high", "pH acima da faixa-alvo pode reduzir disponibilidade de alguns micronutrientes.", "Suspender nova calagem até confirmar o histórico e observar Zn, Mn, Fe e B.");
  }

  if (values.organicMatter !== null) {
    if (values.organicMatter < 1.5) add("organicMatter", "critical", "Estoque muito baixo de matéria orgânica.", `Intensificar palhada, rotação e plantas de cobertura; reduzir revolvimento em ${system}.`);
    else if (values.organicMatter < 2.5) add("organicMatter", "low", "Baixa contribuição para CTC, estrutura e ciclagem.", "Aumentar diversidade de raízes, cobertura permanente e retorno de resíduos.");
    else if (values.organicMatter < 3.5) add("organicMatter", "attention", "Nível intermediário, com espaço para ganho de estabilidade.", "Conservar palhada e acompanhar tendência ao longo das safras.");
    else if (values.organicMatter <= 6) add("organicMatter", "adequate", "Bom suporte à estrutura e ciclagem do solo.", "Preservar o sistema de rotação e evitar perdas por erosão.");
    else add("organicMatter", "high", "Teor elevado; pode ser característica do solo e do manejo.", "Manter e interpretar N e S considerando a mineralização potencial.");
  }

  if (values.phosphorus !== null) {
    const resin = /resina/i.test(draft.phosphorusMethod || "");
    const clay = values.clay;
    const pLow = resin ? 8 : clay !== null && clay > 40 ? 6 : clay !== null && clay > 20 ? 9 : 12;
    const pGood = resin ? 20 : pLow * 2;
    if (values.phosphorus < pLow * 0.6) add("phosphorus", "critical", `P muito baixo para o método ${draft.phosphorusMethod || "não identificado"}.`, `Planejar correção gradual e adubação de arranque para ${crop}, separando construção de fertilidade da manutenção pela produtividade.`);
    else if (values.phosphorus < pLow) add("phosphorus", "low", "Disponibilidade de P abaixo da faixa desejável.", `Priorizar P na linha ou estratégia de correção compatível com ${system}; recalcular pela expectativa de rendimento.`);
    else if (values.phosphorus < pGood) add("phosphorus", "attention", "Faixa intermediária de P.", "Usar adubação de manutenção e acompanhar resposta, método e teor de argila.");
    else if (values.phosphorus <= pGood * 2.5) add("phosphorus", "adequate", "P em faixa suficiente para planejamento de manutenção.", "Repor exportação estimada pela produtividade e monitorar o histórico.");
    else add("phosphorus", "high", "P elevado; nova construção de teor tende a ter baixa prioridade.", "Evitar aplicações corretivas adicionais e trabalhar com manutenção baseada em exportação.");
  }

  if (values.potassium !== null) {
    const ctc = values.ctc ?? 10;
    const kLow = ctc < 5 ? 45 : ctc < 15 ? 60 : 90;
    const kGood = ctc < 5 ? 90 : ctc < 15 ? 120 : 180;
    if (values.potassium < kLow * 0.6) add("potassium", "critical", "K muito baixo em relação à capacidade de retenção estimada.", `Corrigir com prioridade para ${crop}; em solo arenoso ou dose alta, parcelar para reduzir perdas e salinidade.`);
    else if (values.potassium < kLow) add("potassium", "low", "K abaixo da faixa desejável.", "Somar correção e manutenção pela exportação, observando CTC, textura e risco de lixiviação.");
    else if (values.potassium < kGood) add("potassium", "attention", "K em faixa intermediária.", "Ajustar manutenção à produtividade-alvo e conferir K% da CTC quando disponível.");
    else if (values.potassium <= kGood * 2) add("potassium", "adequate", "K em faixa suficiente para manutenção.", "Repor exportação e evitar concentração excessiva próxima à semente.");
    else add("potassium", "high", "K elevado pode aumentar risco de consumo de luxo e desequilíbrio com Ca/Mg.", "Reduzir construção de teor e revisar relações entre bases antes de nova aplicação alta.");
  }

  if (values.sulfur !== null) {
    const importance = /canola|trigo|milho/i.test(crop) ? "A demanda da cultura torna o acompanhamento especialmente importante." : "A necessidade depende de cultura, matéria orgânica e perfil.";
    if (values.sulfur < 5) add("sulfur", "low", `S baixo. ${importance}`, "Confirmar a camada de 20–40 cm e considerar fonte sulfatada no plano de adubação.");
    else if (values.sulfur < 10) add("sulfur", "attention", `S intermediário. ${importance}`, "Cruzar com matéria orgânica, histórico e análise foliar antes de corrigir.");
    else if (values.sulfur <= 30) add("sulfur", "adequate", "Disponibilidade de S em faixa geralmente satisfatória.", "Manter reposição coerente com as fontes usadas e a exportação.");
    else add("sulfur", "high", "S elevado pode refletir fonte recente ou acúmulo no perfil.", "Investigar histórico, condutividade e movimentação no perfil; não aplicar por rotina.");
  }

  ([
    ["calcium", 2, 4, "Ca", "Se baixo junto com pH/V%, escolher corretivo conforme a necessidade de Ca e Mg."],
    ["magnesium", 0.5, 1, "Mg", "Se baixo, avaliar corretivo dolomítico; não decidir apenas pela relação Ca/Mg."],
  ] as const).forEach(([key, low, good, name, action]) => {
    const value = values[key];
    if (value === null) return;
    if (value < low) add(key, value < low * 0.5 ? "critical" : "low", `${name} abaixo da faixa de suficiência geral.`, action);
    else if (value < good) add(key, "attention", `${name} em faixa intermediária.`, "Ajustar somente se a cultura, a saturação por bases e o perfil confirmarem necessidade.");
    else add(key, "adequate", `${name} em faixa geralmente adequada.`, "Manter equilíbrio e evitar decisões baseadas apenas na relação entre bases.");
  });

  if (values.aluminum !== null) {
    if (values.aluminum > 1) add("aluminum", "critical", "Al trocável alto, com risco de restrição radicular.", "Priorizar correção da acidez e confirmar o problema nas camadas do perfil.");
    else if (values.aluminum > 0.3) add("aluminum", "low", "Presença de Al merece atenção agronômica.", "Cruzar com pH, m%, V% e cálcio; calcular corretivo pela referência regional.");
    else add("aluminum", "adequate", "Al trocável baixo ou ausente.", "Manter acompanhamento, principalmente em subsuperfície.");
  }

  if (values.baseSaturation !== null) {
    if (values.baseSaturation < 40) add("baseSaturation", "critical", "Baixa ocupação da CTC por bases.", "Revisar necessidade de calagem e a distribuição de Ca, Mg e K.");
    else if (values.baseSaturation < 60) add("baseSaturation", "attention", "V% intermediário; pode melhorar conforme a cultura.", "Definir a meta regional de V% antes de calcular qualquer correção.");
    else if (values.baseSaturation <= 80) add("baseSaturation", "adequate", "Boa saturação por bases para muitas culturas.", "Manter e evitar elevar sem necessidade demonstrada.");
    else add("baseSaturation", "high", "V% alto; nova calagem pode induzir desequilíbrios.", "Suspender correção automática e verificar pH e micronutrientes.");
  }

  if (values.aluminumSaturation !== null) {
    if (values.aluminumSaturation > 20) add("aluminumSaturation", "critical", "m% alto e potencialmente limitante às raízes.", "Corrigir acidez com prioridade e avaliar a subsuperfície.");
    else if (values.aluminumSaturation > 10) add("aluminumSaturation", "attention", "m% exige acompanhamento.", "Cruzar com tolerância da cultura, pH e Al trocável.");
    else add("aluminumSaturation", "adequate", "Baixa saturação por alumínio.", "Manter monitoramento no perfil.");
  }

  ([
    ["boron", 0.2, 0.4, 0.8, "B", "Confirmar método e análise foliar; B tem faixa estreita entre deficiência e excesso."],
    ["zinc", 0.5, 1, 5, "Zn", "Confirmar pH e histórico; escolher via e dose com cuidado para evitar acúmulo."],
    ["copper", 0.4, 0.8, 3, "Cu", "Confirmar método e matéria orgânica antes de qualquer correção."],
    ["manganese", 2.5, 5, 30, "Mn", "Cruzar com pH, drenagem e sintomas; disponibilidade muda muito com o ambiente."],
    ["iron", 10, 30, 100, "Fe", "Investigar pH e drenagem; deficiência em campo deve ser confirmada visual e foliarmente."],
  ] as const).forEach(([key, low, good, high, name, action]) => {
    const value = values[key];
    if (value === null) return;
    if (value < low) add(key, "low", `${name} abaixo da faixa geral de referência.`, action);
    else if (value < good) add(key, "attention", `${name} em faixa intermediária.`, action);
    else if (value <= high) add(key, "adequate", `${name} em faixa geralmente adequada.`, "Manter monitoramento e evitar aplicação sem necessidade comprovada.");
    else add(key, "high", `${name} elevado para a faixa geral.`, "Não aplicar por rotina; revisar método, histórico e risco de toxicidade/antagonismo.");
  });

  return items;
}

function linkSoilDraftToProducer(draft: SoilDraft, producers: Producer[]) {
  const detectedName = normalizeCatalogName(draft.detectedProducerName ?? "");
  if (!detectedName) return draft;
  const producer = producers.find((item) => {
    const registered = normalizeCatalogName(item.name);
    return (
      registered === detectedName ||
      registered.includes(detectedName) ||
      detectedName.includes(registered)
    );
  });
  if (!producer) return draft;
  const detectedField = normalizeCatalogName(draft.sampleCode);
  const field = producer.fields.find((item) => {
    const registered = normalizeCatalogName(item.name);
    return (
      registered === detectedField ||
      registered.includes(detectedField) ||
      detectedField.includes(registered)
    );
  });
  return {
    ...draft,
    producerId: producer.id,
    property: draft.property || producer.properties,
    fieldId: field?.id ?? "",
  };
}

async function extractPdfText(
  file: File,
  onProgress: (progress: number) => void,
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned = content.items
      .filter(
        (item): item is typeof item & { str: string; transform: number[] } =>
          "str" in item && "transform" in item && Boolean(item.str.trim()),
      )
      .map((item) => ({
        text: item.str.trim(),
        a: Number(item.transform[0]),
        b: Number(item.transform[1]),
        x: Number(item.transform[4]),
        y: Number(item.transform[5]),
      }));
    const verticalCount = positioned.filter(
      (item) => Math.abs(item.b) > Math.abs(item.a),
    ).length;
    const isRotated = verticalCount > positioned.length / 2;
    const grouped = new Map<number, typeof positioned>();
    positioned.forEach((item) => {
      const axis = isRotated ? item.x : item.y;
      const key = Math.round(axis * 2) / 2;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    const visualLines = [...grouped.entries()]
      .sort(([first], [second]) => second - first)
      .map(([axis, items]) => ({
        axis,
        items: items.sort((first, second) =>
          isRotated ? second.y - first.y : first.x - second.x,
        ),
      }));
    const textLines = visualLines.map((line) =>
      line.items.map((item) => item.text).join("\t"),
    );

    if (isRotated && /SOLANALISE/i.test(positioned.map((item) => item.text).join(" "))) {
      const headerLines = visualLines.filter((line) =>
        line.items.some((item) => item.text === "Controle"),
      );
      const primaryHeader = headerLines.find((line) => {
        const labels = line.items.map((item) => item.text);
        return labels.includes("Ca+Mg") && labels.includes("MO") && labels.includes("V%");
      });
      const relationHeader = headerLines.find((line) => {
        const labels = line.items.map((item) => item.text);
        return labels.includes("Ca/Mg") && labels.includes("SMP");
      });
      const tables: Array<{
        header: (typeof visualLines)[number] | undefined;
        lowerAxis: number;
        definitions: Array<{ label: string; key: SoilMetricKey }>;
      }> = [
        {
          header: primaryHeader,
          lowerAxis: relationHeader?.axis ?? -Infinity,
          definitions: [
            { label: "Ca", key: "calcium" },
            { label: "Mg", key: "magnesium" },
            { label: "K", key: "potassium" },
            { label: "Al", key: "aluminum" },
            { label: "H + Al", key: "hal" },
            { label: "T", key: "ctc" },
            { label: "MO", key: "organicMatter" },
            { label: "B", key: "boron" },
            { label: "S", key: "sulfur" },
            { label: "Fe", key: "iron" },
            { label: "Mn", key: "manganese" },
            { label: "Cu", key: "copper" },
            { label: "Zn", key: "zinc" },
            { label: "P", key: "phosphorus" },
            { label: "m", key: "aluminumSaturation" },
            { label: "V%", key: "baseSaturation" },
            { label: "Areia", key: "sand" },
            { label: "Silte", key: "silt" },
            { label: "Argila", key: "clay" },
          ],
        },
        {
          header: relationHeader,
          lowerAxis: -Infinity,
          definitions: [
            { label: "H O", key: "ph" },
            { label: "SMP", key: "smp" },
          ],
        },
      ];
      const syntheticRows: string[] = [];
      tables.forEach(({ header, lowerAxis, definitions }) => {
        if (!header) return;
        const anchors = definitions.flatMap((definition) => {
          const item = header.items.find((candidate) => candidate.text === definition.label);
          return item ? [{ ...definition, position: item.y }] : [];
        }).sort((first, second) => second.position - first.position);
        if (!anchors.length) return;
        visualLines
          .filter(
            (line) =>
              line.axis < header.axis - 2 &&
              line.axis > lowerAxis + 2 &&
              line.items.some((item) => /^\d{4,}\/\d{4}$/.test(item.text)),
          )
          .forEach((line) => {
            const control = line.items.find((item) => /^\d{4,}\/\d{4}$/.test(item.text))?.text;
            if (!control) return;
            const depth = line.items.find((item) => /^\d{1,3}\s*-\s*\d{1,3}$/.test(item.text))?.text;
            const fields = new Map<string, string>();
            line.items.forEach((item) => {
              const tokens = item.text.match(/\d+(?:[,.]\d+)?/g) ?? [];
              if (!tokens.length || item.text.includes("/") || /^\d{1,3}\s*-\s*\d{1,3}$/.test(item.text)) return;
              const nearestIndex = anchors.reduce(
                (best, anchor, index) =>
                  Math.abs(anchor.position - item.y) <
                  Math.abs(anchors[best].position - item.y)
                    ? index
                    : best,
                0,
              );
              if (Math.abs(anchors[nearestIndex].position - item.y) > 13) return;
              tokens.forEach((token, tokenIndex) => {
                const anchor = anchors[nearestIndex + tokenIndex];
                if (anchor) fields.set(anchor.key, token);
              });
            });
            if (fields.size) {
              syntheticRows.push(
                [
                  "__SOLANALISE_ROW__",
                  `control=${control}`,
                  ...(depth ? [`depth=${depth}`] : []),
                  ...[...fields.entries()].map(([key, value]) => `${key}=${value}`),
                ].join("\t"),
              );
            }
          });
      });
      textLines.push(...syntheticRows);
    }
    pages.push(textLines.join("\n"));
    onProgress(Math.round((pageNumber / document.numPages) * 45));
  }

  const digitalText = pages.join("\n").trim();
  if (digitalText.replace(/\s+/g, "").length >= 40) return digitalText;

  const { createWorker, OEM } = await import("tesseract.js");
  const maxPages = Math.min(document.numPages, 8);
  const ocrPages: string[] = [];
  let currentPage = 0;
  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    langPath: "/tessdata",
    logger: ({ progress }) => {
      const pageProgress = (currentPage + progress) / Math.max(maxPages, 1);
      onProgress(Math.min(98, Math.round(45 + pageProgress * 53)));
    },
  });

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      currentPage = pageNumber - 1;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;
      const result = await worker.recognize(canvas, { rotateAuto: true });
      ocrPages.push(result.data.text.trim());
    }
  } finally {
    await worker.terminate();
  }

  return ocrPages.join("\n");
}

async function prepareSoilImage(file: File) {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível abrir a imagem do laudo."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("A imagem do laudo não pôde ser preparada."));
    element.src = original;
  });
  const maxSide = 2400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não conseguiu preparar o laudo.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function requestStructuredSoilAnalysis(
  file: File,
  rawText: string,
  includeImage: boolean,
) {
  const image = includeImage ? await prepareSoilImage(file) : undefined;
  const response = await fetch("/api/soil-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, rawText, image }),
  });
  const payload = (await response.json()) as StructuredSoilResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || "A leitura inteligente não pôde ser concluída.");
  return payload;
}

const manuals = [
  {
    maker: "John Deere",
    model: "Biblioteca de plantadeiras",
    detail: "Manuais técnicos, guias rápidos e publicações por linha.",
    href: "https://www.deere.com.br/pt/pe%C3%A7as-e-servi%C3%A7os/manuais-e-treinamento/manuais/",
  },
  {
    maker: "Vence Tudo",
    model: "PA Pantográfica",
    detail: "Sementes, discos, engrenagens, patinagem e aferição.",
    href: "https://vencetudo.ind.br/storage/produtos/arquivo-1978-20240402114121660c191107c01.pdf",
  },
  {
    maker: "Vence Tudo",
    model: "Pampeana Trigo",
    detail: "Regulagem e aferição para culturas de inverno.",
    href: "https://vencetudo.ind.br/storage/produtos/arquivo-1905-20231120160844655baebc57a1c.pdf",
  },
  {
    maker: "Tatu Marchesan",
    model: "Ultra Flex Classic",
    detail: "Tabelas iniciais de adubo/semente e calibração em campo.",
    href: "https://www.marchesan.com.br/uploads/produtos/manual/0501093823-%20S-0124%20-%20REV-00%20-%20ULTRA%20FLEX%20CLASSIC.pdf",
  },
  {
    maker: "Tatu Marchesan",
    model: "PST Plus",
    detail: "Recâmbio de engrenagens, distribuição e profundidade.",
    href: "https://marchesan.com.br/uploads/produtos/manual/0501090733%20-%20PST%20PLUS%20-%20REV-04%20-%200621.pdf",
  },
  {
    maker: "KUHN",
    model: "Portal MyKUHN",
    detail: "Acesso aos manuais do operador conforme número da máquina.",
    href: "https://www.kuhnbrasil.com.br/acesse-o-manual-do-operador",
  },
  {
    maker: "Massey Ferguson",
    model: "MF 600",
    detail: "Plantio de grãos finos e grossos, regulagens e especificações.",
    href: "https://www.masseyferguson.com/pt_br/product/seeders-planters/mf-600.html",
  },
] as const;

type IconName =
  | "grid"
  | "users"
  | "map"
  | "layers"
  | "calculator"
  | "book"
  | "file"
  | "camera"
  | "seed"
  | "spray"
  | "flask"
  | "arrow"
  | "search"
  | "check"
  | "menu"
  | "plus"
  | "close"
  | "external"
  | "leaf"
  | "chart"
  | "cloud";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
    calculator: <><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    camera: <><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z"/><circle cx="12" cy="13" r="4"/></>,
    seed: <><path d="M20 4c-8 0-14 4-14 11 0 3 2 5 5 5 7 0 9-8 9-16Z"/><path d="M4 21c3-6 7-9 13-13"/></>,
    spray: <><path d="M3 15h13l3 3v2H5a2 2 0 0 1-2-2z"/><path d="M5 15V8h8l3 7M7 8V5h5v3M18 7l3-2M18 10h4M18 13l3 2"/><circle cx="7" cy="20" r="1.5"/><circle cx="16" cy="20" r="1.5"/></>,
    flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 16h9"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    leaf: <><path d="M4 20C6 10 12 5 21 3c-1 9-6 15-15 16"/><path d="M5 20c4-6 8-10 14-14"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="m3 8 6-5 6 8 6-6"/></>,
    cloud: <><path d="M17.5 19H7a5 5 0 1 1 1.2-9.85A6.5 6.5 0 0 1 20 12.5 3.5 3.5 0 0 1 17.5 19Z"/><path d="M8 22v-1M12 22v-1M16 22v-1"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <img
        className={compact ? "brand-symbol" : "brand-lockup"}
        src={
          compact
            ? "/manual-do-agronomo-simbolo.svg"
            : "/manual-do-agronomo-branco.svg"
        }
        alt={compact ? "" : "Manual do Agrônomo"}
        aria-hidden={compact ? true : undefined}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  unitOptions,
  onUnitChange,
  min = 0,
  max,
  step = "any",
  readOnly = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  unitOptions?: string[];
  onUnitChange?: (value: string) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(
    Number.isFinite(value) ? String(value).replace(".", ",") : "",
  );
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(
        Number.isFinite(value) ? String(value).replace(".", ",") : "",
      );
    }
  }, [value, editing]);

  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          readOnly={readOnly}
          data-min={min}
          data-max={max}
          data-step={step}
          onFocus={() => {
            if (readOnly) return;
            setEditing(true);
            if (value === 0) setDraft("");
          }}
          onChange={(event) => {
            if (readOnly) return;
            const next = event.target.value;
            const numericPattern =
              min < 0 ? /^-?\d*(?:[.,]\d*)?$/ : /^\d*(?:[.,]\d*)?$/;
            if (!numericPattern.test(next)) return;
            setDraft(next);
            const parsed = Number(next.replace(",", "."));
            if (next !== "" && next !== "-" && Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => {
            if (readOnly) return;
            setEditing(false);
            if (draft === "") {
              onChange(0);
              setDraft("0");
              return;
            }
            const parsed = Number(draft.replace(",", "."));
            const bounded = Math.min(
              max ?? Number.POSITIVE_INFINITY,
              Math.max(min, Number.isFinite(parsed) ? parsed : 0),
            );
            onChange(bounded);
            setDraft(String(bounded).replace(".", ","));
          }}
        />
        {unit && unitOptions?.length && onUnitChange ? (
          <select
            className="unit-select"
            value={unit}
            aria-label={`Unidade de ${label}`}
            onChange={(event) => onUnitChange(event.target.value)}
          >
            {unitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          unit && <b>{unit}</b>
        )}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "tel";
  readOnly?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`metric ${emphasis ? "metric-emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SprayItem = {
  id: number;
  product: string;
  dose: number;
  unit: "L/ha" | "mL/ha" | "kg/ha" | "g/ha";
};

type QuoteItem = {
  id: number;
  product: string;
  quantity: number;
  unit: "un." | "kg" | "L" | "saco" | "t";
  systemPrice: number;
  discount: number;
};

function quoteUnitPrice(item: QuoteItem) {
  return item.systemPrice * (1 - Math.min(Math.max(item.discount, 0), 100) / 100);
}

function quoteItemTotal(item: QuoteItem) {
  return item.quantity * quoteUnitPrice(item);
}

function currency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function doseTotal(item: SprayItem, area: number) {
  const total = item.dose * area;
  if (item.unit === "L/ha") return `${formatDecimal(total)} L`;
  if (item.unit === "mL/ha") {
    return total >= 1000
      ? `${formatDecimal(total / 1000)} L`
      : `${formatNumber(total)} mL`;
  }
  if (item.unit === "kg/ha") return `${formatDecimal(total)} kg`;
  return total >= 1000
    ? `${formatDecimal(total / 1000)} kg`
    : `${formatNumber(total)} g`;
}

function recommendationText(
  producer: string,
  property: string,
  cropName: string,
  target: string,
  area: number,
  sprayVolume: number,
  items: SprayItem[],
) {
  const lines = items
    .filter((item) => item.product.trim())
    .map(
      (item) =>
        `• ${item.product.trim()}: ${item.dose.toLocaleString("pt-BR")} ${item.unit} (${doseTotal(item, area)} para ${area.toLocaleString("pt-BR")} ha)`,
    );
  return [
    `RECOMENDAÇÃO DE PULVERIZAÇÃO`,
    producer ? `Produtor: ${producer}` : "",
    property ? `Propriedade/talhão: ${property}` : "",
    cropName ? `Cultura: ${cropName}` : "",
    target ? `Alvo/objetivo: ${target}` : "",
    `Área: ${area.toLocaleString("pt-BR")} ha`,
    `Volume de calda: ${sprayVolume.toLocaleString("pt-BR")} L/ha`,
    "",
    ...lines,
    "",
    "Confirmar bula vigente, registro para cultura/alvo, condições de aplicação e receituário agronômico.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export default function Home() {
  const [accessUser, setAccessUser] = useState<AccessSessionUser | null>(null);
  const [activePage, setActivePage] = useState<PageKey>("inicio");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [calc, setCalc] = useState<CalcKey>("semeadora");
  const [crop, setCrop] = useState<Crop>("Todas");
  const [query, setQuery] = useState("");
  const [photoMode, setPhotoMode] = useState<"solo" | "produto" | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoStatus, setPhotoStatus] = useState<
    "idle" | "processing" | "ready" | "error"
  >("idle");
  const [photoProgress, setPhotoProgress] = useState(0);
  const [photoText, setPhotoText] = useState("");
  const [photoMatch, setPhotoMatch] = useState<Product | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [profile, setProfile] = useState<ProfessionalProfile>(initialProfile);
  const [soilDraft, setSoilDraft] = useState<SoilDraft | null>(null);
  const [soilAnalyses, setSoilAnalyses] = useState<SoilAnalysis[]>([]);
  const [soilImport, setSoilImport] = useState<SoilImportState>({
    status: "idle",
    progress: 0,
    message: "",
  });
  const [accountReady, setAccountReady] = useState(false);
  const [workspaceSync, setWorkspaceSync] = useState<
    "loading" | "saving" | "saved" | "attention" | "offline"
  >("loading");

  const [population, setPopulation] = useState(70000);
  const [spacing, setSpacing] = useState(45);
  const [germination, setGermination] = useState(95);
  const [fieldSurvival, setFieldSurvival] = useState(92);
  const [slippage, setSlippage] = useState(5);
  const [bagSeeds, setBagSeeds] = useState(60000);
  const [testDistance, setTestDistance] = useState(20);
  const [testRows, setTestRows] = useState(1);
  const [wheelCircumference, setWheelCircumference] = useState(2.35);

  const [seedArea, setSeedArea] = useState(120);
  const [seedPopulation, setSeedPopulation] = useState(300000);
  const [seedMargin, setSeedMargin] = useState(3);
  const [seedBag, setSeedBag] = useState(200000);

  const [sprayArea, setSprayArea] = useState(120);
  const [sprayVolume, setSprayVolume] = useState(100);
  const [tankVolume, setTankVolume] = useState(3000);
  const [productDose, setProductDose] = useState(0.5);
  const [sprayProducer, setSprayProducer] = useState("");
  const [sprayPhone, setSprayPhone] = useState("");
  const [sprayProperty, setSprayProperty] = useState("");
  const [sprayCrop, setSprayCrop] = useState("Soja");
  const [sprayTarget, setSprayTarget] = useState("");
  const [sprayNotes, setSprayNotes] = useState("");
  const [sprayItems, setSprayItems] = useState<SprayItem[]>([
    { id: 1, product: "Nativo", dose: 0.5, unit: "L/ha" },
    { id: 2, product: "Engeo Pleno", dose: 250, unit: "mL/ha" },
  ]);

  const [fertArea, setFertArea] = useState(120);
  const [fertRate, setFertRate] = useState(250);
  const [fertBag, setFertBag] = useState(50);

  const visibleNav = nav.filter(
    (item) => item.key !== "administracao" || (!embeddedInValor360 && accessUser?.role === "admin"),
  );

  useEffect(() => {
    setRecordOwner(accessUser?.id ?? "");
  }, [accessUser]);

  useEffect(() => {
    document.documentElement.classList.toggle("valor360-embedded", embeddedInValor360);
    return () => document.documentElement.classList.remove("valor360-embedded");
  }, []);

  useEffect(() => {
    const requestedPage = new URL(window.location.href).searchParams.get("page");
    if (isPageKey(requestedPage)) setActivePage(requestedPage);

    const receiveNavigation = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data as { type?: unknown; page?: unknown } | null;
      if (message?.type !== "valor360:navigate" || !isPageKey(message.page)) return;
      setActivePage(message.page);
      setMobileMenu(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("message", receiveNavigation);
    return () => window.removeEventListener("message", receiveNavigation);
  }, []);

  useEffect(() => {
    if (!accessUser) {
      setAccountReady(false);
      return;
    }
    let cancelled = false;
    const loadAccount = async () => {
      setAccountReady(false);
      setWorkspaceSync("loading");
      const producerKey = accountStorageKey("mp-producers", accessUser.id);
      const profileKey = accountStorageKey("mp-professional-profile", accessUser.id);
      const soilKey = accountStorageKey("mp-soil-analyses", accessUser.id);
      const mayMigrateLegacy = !embeddedInValor360 && accessUser.role === "admin";
      const savedProducers = localStorage.getItem(producerKey) ??
        (mayMigrateLegacy ? localStorage.getItem("mp-producers") : null);
      const savedProfile = localStorage.getItem(profileKey) ??
        (mayMigrateLegacy ? localStorage.getItem("mp-professional-profile") : null);
      const savedSoilAnalyses = localStorage.getItem(soilKey) ??
        (mayMigrateLegacy ? localStorage.getItem("mp-soil-analyses") : null);

      const normalizeProducerItems = (items: Producer[]) => items
        .filter((producer) => !isLegacyExampleProducer(producer))
        .map((producer) => {
          const legacyExternalKeys = Array.from(new Set([
            ...(Array.isArray(producer.valor360LegacyExternalKeys)
              ? producer.valor360LegacyExternalKeys
              : []),
            valor360LegacyExternalKey(producer.name),
          ].filter(Boolean))).slice(0, 20);
          return {
            ...producer,
            valor360LegacyExternalKeys: legacyExternalKeys,
            cultures: Array.isArray(producer.cultures) ? producer.cultures : [],
            registrations: Array.isArray(producer.registrations) ? producer.registrations : [],
            fields: Array.isArray(producer.fields)
              ? producer.fields.map((field) => ({
                  ...field,
                  points: Array.isArray(field.points) ? field.points : [],
                  ndviScenes: Array.isArray(field.ndviScenes) ? field.ndviScenes : [],
                  season: /^2026\/27$/i.test(field.season ?? "") ? "" : field.season,
                }))
              : [],
          };
        });

      let nextProducers: Producer[] = [];
      let nextSoilAnalyses: SoilAnalysis[] = [];
      let localProfile: Partial<ProfessionalProfile> = {};
      let integrationNeedsAttention = false;
      try {
        if (savedProducers) {
          nextProducers = normalizeProducerItems(JSON.parse(savedProducers) as Producer[]);
        }
        if (savedProfile) localProfile = JSON.parse(savedProfile) as Partial<ProfessionalProfile>;
        if (savedSoilAnalyses) {
          nextSoilAnalyses = (JSON.parse(savedSoilAnalyses) as SoilAnalysis[])
            .map(normalizeSoilAnalysis);
        }
      } catch (error) {
        console.warn("Não foi possível recuperar todos os dados locais desta conta.", error);
      }

      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok) throw new Error("Sincronização indisponível");
        const remote = (await response.json()) as {
          producers?: Producer[];
          soilAnalyses?: SoilAnalysis[];
          professionalProfile?: Partial<ProfessionalProfile>;
          hasData?: boolean;
        };
        if (remote.hasData) {
          nextProducers = normalizeProducerItems(Array.isArray(remote.producers) ? remote.producers : []);
          nextSoilAnalyses = (Array.isArray(remote.soilAnalyses) ? remote.soilAnalyses : [])
            .map(normalizeSoilAnalysis);
          if (remote.professionalProfile && typeof remote.professionalProfile === "object" && Object.keys(remote.professionalProfile).length) {
            localProfile = { ...localProfile, ...remote.professionalProfile };
          }
        } else if (nextProducers.length || nextSoilAnalyses.length || Object.keys(localProfile).length) {
          const migration = await fetch("/api/workspace", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ producers: nextProducers, soilAnalyses: nextSoilAnalyses, professionalProfile: localProfile }),
          });
          const migrationResult = (await migration.json().catch(() => ({}))) as {
            error?: string;
            integration?: { configured?: boolean; failed?: number; skipped?: number; truncated?: boolean };
          };
          if (!migration.ok) throw new Error("Falha ao criar backup inicial");
          integrationNeedsAttention = migrationResult.integration?.configured === false ||
            Number(migrationResult.integration?.failed ?? 0) > 0 ||
            Number(migrationResult.integration?.skipped ?? 0) > 0 ||
            migrationResult.integration?.truncated === true;
        }
        setWorkspaceSync(integrationNeedsAttention ? "attention" : "saved");
      } catch (error) {
        console.warn("A nuvem não respondeu; usando o cache deste aparelho.", error);
        setWorkspaceSync("offline");
      }

      if (embeddedInValor360) {
        try {
          const response = await fetch("/api/technical/bootstrap", { cache: "no-store" });
          if (!response.ok) throw new Error("Carteira do VALOR 360 indisponível");
          const payload = (await response.json()) as { producers?: Producer[] };
          const incoming = normalizeProducerItems(
            Array.isArray(payload.producers) ? payload.producers : [],
          );
          const currentById = new Map(nextProducers.map((producer) => [producer.id, producer]));
          const incomingIds = new Set(incoming.map((producer) => producer.id));
          nextProducers = [
            ...incoming.map((producer) => {
              const current = currentById.get(producer.id);
              if (!current) return producer;
              return {
                ...producer,
                ...current,
                name: producer.name || current.name,
                crmCode: producer.crmCode || current.crmCode,
                phone: producer.phone || current.phone,
                email: producer.email || current.email,
                city: current.city || producer.city,
                properties: current.properties || producer.properties,
                area: current.area || producer.area,
                cultures: Array.from(new Set([
                  ...(producer.cultures ?? []),
                  ...(current.cultures ?? []),
                ])),
                notes: Array.from(new Set([current.notes, producer.notes].filter(Boolean))).join("\n"),
                fields: current.fields ?? [],
                registrations: current.registrations ?? [],
                crmSource: "VALOR 360",
              };
            }),
            ...nextProducers.filter((producer) => !incomingIds.has(producer.id)),
          ];
        } catch (error) {
          console.warn("A carteira comercial não pôde ser conciliada agora.", error);
        }
      }

      if (cancelled) return;
      const nextProfile: ProfessionalProfile = {
        ...initialProfile,
        ...localProfile,
        name: accessUser.displayName,
        email: accessUser.email ?? "",
      };
      setProducers(nextProducers);
      setSoilAnalyses(nextSoilAnalyses);
      setProfile(nextProfile);
      localStorage.setItem(producerKey, JSON.stringify(nextProducers));
      localStorage.setItem(profileKey, JSON.stringify(nextProfile));
      localStorage.setItem(soilKey, JSON.stringify(nextSoilAnalyses));
      setAccountReady(true);
      void syncLocalRecordsToServer().catch((error) => {
        console.warn("O histórico local será sincronizado com a nuvem em uma próxima tentativa.", error);
      });
    };
    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [accessUser]);

  useEffect(() => {
    if (!accountReady || !accessUser) return;
    localStorage.setItem(
      accountStorageKey("mp-producers", accessUser.id),
      JSON.stringify(producers),
    );
    localStorage.setItem(
      accountStorageKey("mp-soil-analyses", accessUser.id),
      JSON.stringify(soilAnalyses),
    );
    localStorage.setItem(
      accountStorageKey("mp-professional-profile", accessUser.id),
      JSON.stringify(profile),
    );
    setWorkspaceSync("saving");
    const timer = window.setTimeout(() => {
      void fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ producers, soilAnalyses, professionalProfile: profile }),
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => ({}))) as {
            integration?: { configured?: boolean; failed?: number; skipped?: number; truncated?: boolean };
          };
          if (!response.ok) throw new Error("Falha na sincronização");
          const integrationNeedsAttention = result.integration?.configured === false ||
            Number(result.integration?.failed ?? 0) > 0 ||
            Number(result.integration?.skipped ?? 0) > 0 ||
            result.integration?.truncated === true;
          setWorkspaceSync(integrationNeedsAttention ? "attention" : "saved");
        })
        .catch(() => setWorkspaceSync("offline"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [producers, soilAnalyses, profile, accountReady, accessUser]);


  useEffect(() => {
    if (!accessUser) return;
    void fetch("/api/access/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "page_view", pageKey: activePage }),
    });
  }, [accessUser, activePage]);

  useEffect(() => {
    if (!accessUser || activePage !== "calculadoras") return;
    void fetch("/api/access/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "calculator_view",
        pageKey: `calculadoras:${calc}`,
      }),
    });
  }, [accessUser, activePage, calc]);

  const planter = useMemo(() => {
    const rowSpacing = Math.max(spacing, 0.1) / 100;
    const targetPlantsMeter = (population * rowSpacing) / 10000;
    const establishment = Math.max(
      (germination / 100) * (fieldSurvival / 100),
      0.01,
    );
    const rawSeedsMeter = targetPlantsMeter / establishment;
    const seedsMeter = rawSeedsMeter * (1 + slippage / 100);
    const seedsHa = (seedsMeter * 10000) / rowSpacing;
    return {
      targetPlantsMeter,
      seedsMeter,
      seedsHa,
      distance: seedsMeter > 0 ? 100 / seedsMeter : 0,
      bagsHa: bagSeeds > 0 ? seedsHa / bagSeeds : 0,
      expectedTest: seedsMeter * testDistance * testRows,
      wheelTurns:
        wheelCircumference > 0 ? testDistance / wheelCircumference : 0,
    };
  }, [
    spacing,
    population,
    germination,
    fieldSurvival,
    slippage,
    bagSeeds,
    testDistance,
    testRows,
    wheelCircumference,
  ]);

  const filteredProducts = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("pt-BR");
    return products.filter((product) => {
      const inCrop =
        crop === "Todas" ||
        (product.crops as readonly string[]).includes(crop);
      const inSearch =
        !text ||
        [
          product.name,
          product.registration,
          product.maker,
          product.type,
          product.active,
          product.crops.join(" "),
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(text);
      return inCrop && inSearch;
    });
  }, [crop, query]);

  function goTo(page: PageKey) {
    setActivePage(page);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function signOut() {
    await fetch("/api/access/session", { method: "DELETE" }).catch(() => undefined);
    window.location.reload();
  }

  async function saveProfessionalProfile() {
    if (!accessUser) throw new Error("Sessão expirada.");
    const next = {
      ...profile,
      name: accessUser.displayName,
      email: accessUser.email ?? "",
    };
    localStorage.setItem(
      accountStorageKey("mp-professional-profile", accessUser.id),
      JSON.stringify(next),
    );
    setProfile(next);
    await saveRecord({
      type: "system_change",
      title: "Perfil profissional atualizado",
      payload: {
        profession: next.profession,
        council: next.council,
        registration: next.registration,
        company: next.company,
        phone: next.phone,
        hasWatermark: Boolean(next.watermark),
        savedAt: new Date().toISOString(),
      },
    });
  }

  function openCamera(mode: "solo" | "produto") {
    setPhotoMode(mode);
    setPhotoStatus("idle");
    setPhotoName("");
    setPhotoPreview("");
    setPhotoText("");
    setPhotoMatch(null);
    setPhotoProgress(0);
    window.setTimeout(() => photoInput.current?.click(), 30);
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const selectedMode = photoMode;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoName(file.name);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoStatus("processing");
    setPhotoProgress(3);
    setPhotoText("");
    setPhotoMatch(null);
    event.target.value = "";

    let worker: Awaited<
      ReturnType<(typeof import("tesseract.js"))["createWorker"]>
    > | null = null;

    try {
      const { createWorker, OEM } = await import("tesseract.js");
      worker = await createWorker("por", OEM.LSTM_ONLY, {
        langPath: "/tessdata",
        logger: ({ progress }) => {
          setPhotoProgress(
            Math.min(99, Math.max(4, Math.round(progress * 100))),
          );
        },
      });
      const result = await worker.recognize(file, { rotateAuto: true });
      const recognizedText = result.data.text.trim();
      const match =
        selectedMode === "produto"
          ? findProductFromOcr(recognizedText)
          : null;

      setPhotoText(recognizedText);
      setPhotoMatch(match);
      if (selectedMode === "solo") {
        let nextDraft = buildSoilDraft(file.name, "Câmera", recognizedText);
        let intelligentMessage = "";
        try {
          setSoilImport({
            status: "processing",
            progress: 96,
            message: "Separando amostras, métodos e unidades do laboratório…",
          });
          const structured = await requestStructuredSoilAnalysis(file, recognizedText, true);
          nextDraft = mergeStructuredSoilDraft(nextDraft, structured);
          intelligentMessage = nextDraft.samples?.length
            ? ` ${nextDraft.samples.length} amostras/profundidades separadas.`
            : "";
        } catch (error) {
          nextDraft.extractionWarnings = [
            ...(nextDraft.extractionWarnings ?? []),
            error instanceof Error
              ? `${error.message} A extração local foi mantida para revisão.`
              : "A leitura inteligente não respondeu; a extração local foi mantida.",
          ];
        }
        setSoilDraft(linkSoilDraftToProducer(nextDraft, producers));
        setSoilImport({
          status: "ready",
          progress: 100,
          message: `${Object.values(nextDraft.values).filter(Boolean).length} indicadores reconhecidos.${intelligentMessage} Confira os valores antes de salvar.`,
        });
      }
      if (match) {
        setCrop("Todas");
        setQuery(match.name);
      }
      setPhotoProgress(100);
      setPhotoStatus("ready");
    } catch (error) {
      console.error("Falha ao reconhecer a imagem", error);
      setPhotoStatus("error");
    } finally {
      await worker?.terminate();
    }
  }

  async function importSoilFile(file: File) {
    setSoilImport({
      status: "processing",
      progress: 3,
      message:
        file.type === "application/pdf"
          ? "Lendo as páginas do PDF…"
          : "Reconhecendo os dados da imagem…",
    });

    let worker: Awaited<
      ReturnType<(typeof import("tesseract.js"))["createWorker"]>
    > | null = null;

    try {
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLocaleLowerCase("pt-BR").endsWith(".pdf");
      let recognizedText = "";

      if (isPdf) {
        recognizedText = await extractPdfText(file, (progress) =>
          setSoilImport((current) => ({ ...current, progress })),
        );
        if (recognizedText.replace(/\s+/g, "").length < 20) {
          throw new Error(
            "Não foi possível obter texto legível deste PDF, mesmo após a leitura por imagem. Tente fotografar o laudo com boa luz.",
          );
        }
      } else {
        const { createWorker, OEM } = await import("tesseract.js");
        worker = await createWorker("por", OEM.LSTM_ONLY, {
          langPath: "/tessdata",
          logger: ({ progress }) => {
            setSoilImport((current) => ({
              ...current,
              progress: Math.min(98, Math.max(4, Math.round(progress * 100))),
            }));
          },
        });
        const result = await worker.recognize(file, { rotateAuto: true });
        recognizedText = result.data.text.trim();
      }

      let nextDraft = buildSoilDraft(
        file.name,
        isPdf ? "PDF" : "Imagem",
        recognizedText,
      );
      let intelligentMessage = "";
      try {
        setSoilImport({
          status: "processing",
          progress: 96,
          message: "Identificando laboratório, amostras, métodos e unidades…",
        });
        const structured = await requestStructuredSoilAnalysis(
          file,
          recognizedText,
          !isPdf,
        );
        nextDraft = mergeStructuredSoilDraft(nextDraft, structured);
        intelligentMessage = nextDraft.samples?.length
          ? ` ${nextDraft.samples.length} amostras/profundidades foram separadas.`
          : "";
      } catch (error) {
        nextDraft.extractionWarnings = [
          ...(nextDraft.extractionWarnings ?? []),
          error instanceof Error
            ? `${error.message} A leitura local foi mantida para revisão.`
            : "A leitura inteligente não respondeu; a extração local foi mantida.",
        ];
      }
      const detected = Object.values(nextDraft.values).filter(Boolean).length;
      setSoilDraft(linkSoilDraftToProducer(nextDraft, producers));
      setSoilImport({
        status: "ready",
        progress: 100,
        message: detected
          ? `${detected} indicadores reconhecidos.${intelligentMessage} Confira os valores, métodos e unidades.`
          : "Arquivo lido. Preencha os indicadores que não foram reconhecidos automaticamente.",
      });
    } catch (error) {
      console.error("Falha ao importar análise de solo", error);
      setSoilImport({
        status: "error",
        progress: 0,
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível ler este arquivo. Tente outra imagem ou PDF.",
      });
    } finally {
      await worker?.terminate();
    }
  }

  const pageTitle = activePage === "empresa"
    ? GATE_ONE_COMPANY.name
    : nav.find((item) => item.key === activePage)?.label ?? "";

  return (
    <AccessPortal onUser={setAccessUser}>
    <div className="app-shell">
      <aside className="sidebar">
        {embeddedInValor360 ? (
          <div className="embedded-product-brand">
            <span>VALOR 360</span>
            <strong>INTELIGÊNCIA AGRONÔMICA</strong>
          </div>
        ) : <Brand />}
        <nav className="side-nav" aria-label="Navegação principal">
          {visibleNav.map((item) => (
            <button
              key={item.key}
              className={activePage === item.key ? "active" : ""}
              onClick={() => goTo(item.key)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-status">
          <span className="status-dot" />
          <div>
            <strong>{embeddedInValor360 ? "Núcleo técnico" : "Base técnica"}</strong>
            <small>{embeddedInValor360 ? "Operando dentro do VALOR 360" : "Fontes oficiais conectadas"}</small>
          </div>
        </div>
        <button
          type="button"
          className={`developer-signature ${activePage === "empresa" ? "active" : ""}`}
          onClick={() => goTo("empresa")}
          aria-label={`Conhecer a ${GATE_ONE_COMPANY.name}`}
        >
          <img src="/gate-one-pro-server.png" alt="" />
          <div>
            <span>Desenvolvido por</span>
            <strong>{GATE_ONE_COMPANY.name}</strong>
          </div>
          <Icon name="arrow" size={14} />
        </button>
        <div className="profile">
          <div className="avatar">
            {(accessUser?.displayName || profile.name || "RT")
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </div>
          <div>
            <strong>{accessUser?.displayName || profile.name || "Responsável técnico"}</strong>
            <span>{accessUser?.role === "admin" ? "Administrador" : profile.profession}</span>
          </div>
          <button className="profile-logout" onClick={() => void signOut()} title="Sair do sistema">Sair</button>
        </div>
      </aside>

      <header className="mobile-header">
        {embeddedInValor360 ? <div className="embedded-mobile-brand">V360</div> : <Brand compact />}
        <div className="mobile-title">
          <strong>{embeddedInValor360 ? "Inteligência Agronômica" : "Manual do Agrônomo"}</strong>
          <span>{pageTitle}</span>
        </div>
        <button
          className="icon-button"
          onClick={() => setMobileMenu((value) => !value)}
          aria-label={mobileMenu ? "Fechar menu" : "Abrir menu"}
        >
          <Icon name={mobileMenu ? "close" : "menu"} />
        </button>
      </header>

      {mobileMenu && (
        <div className="mobile-menu">
          {visibleNav.map((item) => (
            <button
              key={item.key}
              className={activePage === item.key ? "active" : ""}
              onClick={() => goTo(item.key)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
          {!embeddedInValor360 && <button
            className={activePage === "empresa" ? "active" : ""}
            onClick={() => goTo("empresa")}
          >
            <Icon name="external" />
            Gate One Soluções Digitais
          </button>}
        </div>
      )}

      <main className="main">
        {activePage === "inicio" && (
          <Dashboard
            goTo={goTo}
            onCamera={openCamera}
            setCalc={setCalc}
            producers={producers}
            analyses={soilAnalyses}
            profile={profile}
            subscriberId={accessUser?.id ?? ""}
          />
        )}
        {activePage === "calculadoras" && (
          <Calculators
            active={calc}
            setActive={setCalc}
            planter={planter}
            values={{
              population,
              spacing,
              germination,
              fieldSurvival,
              slippage,
              bagSeeds,
              testDistance,
              testRows,
              wheelCircumference,
              seedArea,
              seedPopulation,
              seedMargin,
              seedBag,
              sprayArea,
              sprayVolume,
              tankVolume,
              productDose,
              fertArea,
              fertRate,
              fertBag,
            }}
            setters={{
              setPopulation,
              setSpacing,
              setGermination,
              setFieldSurvival,
              setSlippage,
              setBagSeeds,
              setTestDistance,
              setTestRows,
              setWheelCircumference,
              setSeedArea,
              setSeedPopulation,
              setSeedMargin,
              setSeedBag,
              setSprayArea,
              setSprayVolume,
              setTankVolume,
              setProductDose,
              setFertArea,
              setFertRate,
              setFertBag,
            }}
            recommendation={{
              producer: sprayProducer,
              setProducer: setSprayProducer,
              phone: sprayPhone,
              setPhone: setSprayPhone,
              property: sprayProperty,
              setProperty: setSprayProperty,
              crop: sprayCrop,
              setCrop: setSprayCrop,
              target: sprayTarget,
              setTarget: setSprayTarget,
              notes: sprayNotes,
              setNotes: setSprayNotes,
              items: sprayItems,
              setItems: setSprayItems,
            }}
            profile={profile}
            analyses={soilAnalyses}
            producers={producers}
          />
        )}
        {activePage === "bulas" && (
          <LabelsPage
            query={query}
            setQuery={setQuery}
            filtered={filteredProducts}
            onCamera={() => openCamera("produto")}
          />
        )}
        {activePage === "mercado" && <AgroMarketPage />}
        {activePage === "diagnostico" && <PhotoDiagnosis />}
        {activePage === "solo" && (
          <SoilPage
            onCamera={() => openCamera("solo")}
            onFile={importSoilFile}
            draft={soilDraft}
            setDraft={setSoilDraft}
            importState={soilImport}
            producers={producers}
            profile={profile}
            analyses={soilAnalyses}
            linkActorId={accessUser?.id ?? ""}
            onSave={(analysis) => {
              const analysisProducer = producers.find(
                (item) => item.id === analysis.producerId,
              );
              const analysisField = analysisProducer?.fields.find(
                (item) => item.id === analysis.fieldId,
              );
              setSoilAnalyses((current) => [
                analysis,
                ...current.filter((item) => item.id !== analysis.id),
              ]);
              setSoilImport({
                status: "ready",
                progress: 100,
                message: "Salvando a análise conferida…",
              });
              void saveRecord({
                id: analysis.recordId,
                type: "soil_analysis",
                title: `${analysisProducer?.name || "Análise de solo"} · ${
                  analysisField?.name || analysis.property || "Área não informada"
                }`,
                producerName: analysisProducer?.name,
                payload: analysis as unknown as Record<string, unknown>,
              })
                .then(() =>
                  setSoilImport({
                    status: "ready",
                    progress: 100,
                    message: "Análise conferida e sincronizada com a nuvem desta conta.",
                  }),
                )
                .catch((error) =>
                  setSoilImport({
                    status: "ready",
                    progress: 100,
                    message:
                      error instanceof Error
                        ? error.message
                        : "A análise continua no cache deste aparelho; a sincronização será tentada novamente.",
                  }),
                );
            }}
            onClear={() => {
              setSoilDraft(null);
              setSoilImport({ status: "idle", progress: 0, message: "" });
            }}
          />
        )}
        {activePage === "produtores" && (
          <ProducersPage
            producers={producers}
            setProducers={setProducers}
            syncStatus={workspaceSync}
            onSyncAttention={() => setWorkspaceSync("attention")}
            onUse={(producer) => {
              setSprayProducer(producer.name);
              setSprayPhone(producer.phone);
              setSprayProperty(producer.properties);
              setCalc("pulverizacao");
              goTo("calculadoras");
            }}
          />
        )}
        {activePage === "relatorios" && (
          <>
            <SeasonReports
              producers={producers}
              profile={profile}
              subscriberId={accessUser?.id ?? ""}
              allowLegacyMigration={accessUser?.role === "admin"}
            />
            <RecordsArchive />
          </>
        )}
        {activePage === "administracao" && accessUser?.role === "admin" && (
          <AdminAccessPanel />
        )}
        {activePage === "feedback" && <FeedbackPage />}
        {activePage === "perfil" && (
          <ProfessionalPage
            profile={profile}
            setProfile={setProfile}
            onSave={saveProfessionalProfile}
          />
        )}
        {activePage === "empresa" && (
          <GateOneCompanyPage onBack={() => goTo("inicio")} />
        )}
      </main>

      <button
        type="button"
        className="mobile-company-signature"
        onClick={() => goTo("empresa")}
      >
        <span>Desenvolvido por</span>
        <strong>{GATE_ONE_COMPANY.name}</strong>
        <Icon name="arrow" size={14} />
      </button>

      <nav className="bottom-nav" aria-label="Navegação móvel">
        {[
          nav.find((item) => item.key === "inicio"),
          nav.find((item) => item.key === "produtores"),
          nav.find((item) => item.key === "diagnostico"),
          nav.find((item) => item.key === "calculadoras"),
        ].filter(Boolean).map((item) => (
          <button
            key={item!.key}
            className={activePage === item!.key ? "active" : ""}
            onClick={() => goTo(item!.key)}
          >
            <Icon name={item!.icon} size={21} />
            <span>{item!.label.replace("Análises de ", "")}</span>
          </button>
        ))}
        <button onClick={() => setMobileMenu(true)}>
          <Icon name="menu" size={21} />
          <span>Mais</span>
        </button>
      </nav>

      <input
        ref={photoInput}
        className="hidden-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPhoto}
      />

      {photoMode && (photoStatus !== "idle" || photoName) && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPhotoMode(null)}
        >
          <section
            className="camera-result"
            role="dialog"
            aria-modal="true"
            aria-label="Resultado da captura"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setPhotoMode(null)}
              aria-label="Fechar"
            >
              <Icon name="close" />
            </button>
            <div className="photo-preview">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="Imagem capturada" />
              ) : (
                <Icon name="camera" size={36} />
              )}
            </div>
            <span className="eyebrow">
              {photoMode === "solo" ? "LEITURA DE LAUDO" : "BUSCA DE BULA"}
            </span>
            <h2>
              {photoStatus === "processing"
                ? `Lendo a imagem… ${photoProgress}%`
                : photoStatus === "error"
                  ? "Não foi possível ler esta foto"
                  : photoMode === "produto" && photoMatch
                    ? "Produto localizado"
                    : "Leitura concluída"}
            </h2>
            <p className="muted">{photoName}</p>
            {photoStatus === "processing" ? (
              <div className="progress-line">
                <i style={{ width: `${photoProgress}%` }} />
              </div>
            ) : photoStatus === "error" ? (
              <div className="analysis-preview warning">
                <div>
                  <span>Foto sem leitura</span>
                  <strong>Tente novamente com mais luz e sem reflexos</strong>
                </div>
                <p>
                  Mantenha o rótulo ou o laudo preenchendo a imagem e fotografe
                  o texto de frente.
                </p>
              </div>
            ) : photoMode === "solo" ? (
              <div className="analysis-preview">
                <div>
                  <span>Texto reconhecido no aparelho</span>
                  <strong>
                    {extractSoilValues(photoText).length
                      ? `${extractSoilValues(photoText).length} indicadores encontrados`
                      : "Laudo pronto para conferência"}
                  </strong>
                </div>
                {extractSoilValues(photoText).length ? (
                  <div className="ocr-values">
                    {extractSoilValues(photoText).map((item) => (
                      <span key={item.label}>
                        {item.label} <b>{item.value}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="ocr-excerpt">
                  {photoText
                    ? photoText.replace(/\s+/g, " ").slice(0, 240)
                    : "Nenhum texto foi reconhecido. Confira a nitidez da foto."}
                </p>
              </div>
            ) : (
              <div className="analysis-preview">
                <div>
                  <span>
                    {photoMatch ? "Correspondência no catálogo" : "Texto reconhecido"}
                  </span>
                  <strong>
                    {photoMatch
                      ? `${photoMatch.name} · ${photoMatch.maker}`
                      : "Produto ainda não localizado no catálogo"}
                  </strong>
                </div>
                <p>
                  {photoMatch
                    ? `${photoMatch.active}. Confirme a indicação de uso e a bula vigente na fonte oficial.`
                    : photoText
                      ? photoText.replace(/\s+/g, " ").slice(0, 240)
                      : "Nenhum texto foi reconhecido. Tente aproximar o nome comercial ou o número de registro."}
                </p>
                {photoMatch ? (
                  <a
                    className="ocr-source"
                    href={AGROFIT_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir fonte oficial
                    <Icon name="external" size={16} />
                  </a>
                ) : null}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => openCamera(photoMode)}
              >
                Tirar outra foto
              </button>
              <button
                className="button primary"
                disabled={photoStatus === "processing"}
                onClick={() => {
                  setPhotoMode(null);
                  goTo(photoMode === "solo" ? "solo" : "bulas");
                }}
              >
                {photoMode === "produto" && photoMatch
                  ? "Ver no catálogo"
                  : "Continuar"}
                <Icon name="arrow" size={18} />
              </button>
            </div>
            <small className="legal-note">
              A leitura ocorre no navegador. Sempre confira texto, unidades,
              produto, registro e bula oficial antes de usar o resultado.
            </small>
          </section>
        </div>
      )}
    </div>
    </AccessPortal>
  );
}

function weatherCondition(code = -1) {
  if (code === 0) return "Céu limpo";
  if ([1, 2].includes(code)) return "Poucas nuvens";
  if (code === 3) return "Nublado";
  if ([45, 48].includes(code)) return "Neblina";
  if ([51, 53, 55, 56, 57].includes(code)) return "Garoa";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Chuva";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Neve";
  if ([95, 96, 99].includes(code)) return "Temporal";
  return "Condição variável";
}

function windDirection(degrees = 0) {
  const directions = ["N", "NNE", "NE", "ENE", "L", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return directions[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

function weatherHour(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function Dashboard({
  goTo,
  onCamera,
  setCalc,
  producers,
  analyses,
  profile,
  subscriberId,
}: {
  goTo: (page: PageKey) => void;
  onCamera: (mode: "solo" | "produto") => void;
  setCalc: (calc: CalcKey) => void;
  producers: Producer[];
  analyses: SoilAnalysis[];
  profile: ProfessionalProfile;
  subscriberId: string;
}) {
  type WeatherData = {
    city?: string;
    region?: string;
    country?: string;
    source?: "open-meteo";
    sourceUrl?: string;
    sourceNote?: string;
    timezone?: string;
    elevation?: number;
    updatedAt?: string;
    current?: {
      time?: string;
      temperature_2m?: number;
      relative_humidity_2m?: number;
      apparent_temperature?: number;
      precipitation?: number;
      rain?: number;
      wind_speed_10m?: number;
      wind_direction_10m?: number;
      wind_gusts_10m?: number;
      weather_code?: number;
      cloud_cover?: number;
      surface_pressure?: number;
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      relative_humidity_2m?: number[];
      precipitation_probability?: number[];
      precipitation?: number[];
      weather_code?: number[];
      wind_speed_10m?: number[];
      wind_gusts_10m?: number[];
      soil_temperature_0cm?: number[];
      soil_moisture_0_to_1cm?: number[];
      et0_fao_evapotranspiration?: number[];
      vapour_pressure_deficit?: number[];
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      precipitation_sum?: number[];
      wind_speed_10m_max?: number[];
      wind_gusts_10m_max?: number[];
      wind_direction_10m_dominant?: number[];
      uv_index_max?: number[];
      precipitation_hours?: number[];
      et0_fao_evapotranspiration?: number[];
      sunrise?: string[];
      sunset?: string[];
    };
    agronomic?: {
      rain_last_24h?: number;
      rain_next_24h?: number;
      water_balance_today?: number;
      next_rain?: { time: string; probability: number; amount: number } | null;
      application?: {
        status: "favorable" | "attention" | "avoid";
        reasons: string[];
        best_window: { start: string; end: string; hours: number } | null;
        criteria: string;
      };
      alerts?: Array<{ level: "attention" | "high"; label: string }>;
    };
  };
  const [greeting, setGreeting] = useState("Olá");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [weatherMessage, setWeatherMessage] = useState("");
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite");
    try {
      const cached = sessionStorage.getItem("mp-weather-session");
      const coordinates = sessionStorage.getItem("mp-weather-coordinates");
      const parsed = cached ? JSON.parse(cached) as { data?: WeatherData; savedAt?: number } : null;
      if (parsed?.data && parsed.savedAt && Date.now() - parsed.savedAt < 30 * 60 * 1000) {
        setWeather(parsed.data);
        setWeatherStatus("ready");
        reportAccessLocation(parsed.data);
      } else if (coordinates) {
        const { latitude, longitude } = JSON.parse(coordinates) as { latitude: number; longitude: number };
        if (parsed?.data) setWeather(parsed.data);
        setWeatherStatus("loading");
        void loadWeather(latitude, longitude).catch(() => {
          if (parsed?.data) setWeatherStatus("ready");
          else setShowLocationPrompt(true);
        });
      } else if (!sessionStorage.getItem("mp-location-prompted")) {
        setShowLocationPrompt(true);
      }
    } catch {
      setShowLocationPrompt(true);
    }
  }, [subscriberId]);

  function reportAccessLocation(data: WeatherData) {
    const locationKey = `mp-access-location-reported:${subscriberId}`;
    if (!subscriberId || !data.city || sessionStorage.getItem(locationKey)) return;
    sessionStorage.setItem(locationKey, "1");
    void fetch("/api/access/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "access_location",
        pageKey: "inicio",
        detail: {
          city: data.city,
          region: data.region ?? "",
          country: data.country ?? "",
        },
      }),
    }).catch(() => sessionStorage.removeItem(locationKey));
  }

  async function loadWeather(latitude: number, longitude: number) {
    const params = new URLSearchParams({
      latitude: latitude.toFixed(5),
      longitude: longitude.toFixed(5),
    });
    const response = await fetch(`/api/weather?${params.toString()}`);
    if (!response.ok) throw new Error(`Previsão indisponível (${response.status})`);
    const data = (await response.json()) as WeatherData;
    setWeather(data);
    setWeatherStatus("ready");
    sessionStorage.setItem("mp-weather-session", JSON.stringify({ data, savedAt: Date.now() }));
    sessionStorage.setItem("mp-weather-coordinates", JSON.stringify({ latitude, longitude }));
    reportAccessLocation(data);
  }

  function requestLocation() {
    setShowLocationPrompt(false);
    sessionStorage.setItem("mp-location-prompted", "1");
    if (!navigator.geolocation) {
      setWeatherStatus("error");
      setWeatherMessage("Este navegador não oferece localização.");
      return;
    }
    setWeatherStatus("loading");
    setWeatherMessage("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void loadWeather(coords.latitude, coords.longitude).catch((error) => {
          setWeatherStatus("error");
          setWeatherMessage(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar a previsão.",
          );
        });
      },
      () => {
        setWeatherStatus("error");
        setWeatherMessage(
          "Localização não autorizada. Você pode tentar novamente pelo cartão de clima.",
        );
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
    );
  }

  const firstName = profile.name.trim().split(/\s+/)[0] || "profissional";
  const mappedFields = producers.flatMap((producer) => producer.fields ?? []);
  const mappedArea = mappedFields.reduce(
    (total, field) => total + (Number(field.area) || 0),
    0,
  );
  const weatherToday = weather?.daily;
  const hourlyStart = Math.max(
    0,
    weather?.hourly?.time?.findIndex((time) => time >= (weather?.current?.time ?? "")) ?? 0,
  );
  const hourlyForecast = (weather?.hourly?.time ?? [])
    .map((time, index) => ({ time, index }))
    .slice(hourlyStart)
    .filter((_, index) => index % 3 === 0)
    .slice(0, 6);
  const application = weather?.agronomic?.application;
  const applicationLabel = application?.status === "favorable"
    ? "Favorável agora"
    : application?.status === "avoid"
      ? "Evite agora"
      : "Exige atenção";
  const agendaProducer = producers[0];
  const agendaField = agendaProducer?.fields?.[0];
  const agendaItems = agendaProducer
    ? [
        ["Atualizar imagens NDVI", `${agendaProducer.name}${agendaField ? ` · ${agendaField.name}` : " · cadastrar talhão"}`, "ALTA"],
        ["Revisar análise de solo", `${agendaProducer.name} · próxima análise`, "MÉDIA"],
        ["Preparar fechamento", `${agendaProducer.name} · próxima safra`, "NORMAL"],
      ]
    : [
        ["Cadastrar o primeiro produtor", "Comece seu espaço técnico", "INÍCIO"],
        ["Completar o perfil profissional", "Dados para relatórios e recomendações", "INÍCIO"],
        ["Importar uma análise de solo", "PDF, foto ou câmera", "INÍCIO"],
      ];

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{greeting}, {firstName} · SEU COPILOTO TÉCNICO</span>
          <h1>Do campo à decisão, tudo no mesmo lugar.</h1>
          <p>
            Capture informações, interprete dados agronômicos e transforme cada
            leitura em uma recomendação técnica segura.
          </p>
          <div className="decision-flow" aria-label="Fluxo de trabalho">
            <button onClick={() => onCamera("solo")}>
              <span>01</span>
              <b>Capturar</b>
              <small>Foto ou PDF</small>
            </button>
            <i><Icon name="arrow" size={15} /></i>
            <button onClick={() => goTo("solo")}>
              <span>02</span>
              <b>Interpretar</b>
              <small>Solo e talhão</small>
            </button>
            <i><Icon name="arrow" size={15} /></i>
            <button onClick={() => goTo("calculadoras")}>
              <span>03</span>
              <b>Decidir</b>
              <small>Calcular e recomendar</small>
            </button>
          </div>
          <div className="hero-actions">
            <button className="button primary" onClick={() => onCamera("solo")}>
              <Icon name="camera" size={18} />
              Fotografar análise
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setCalc("semeadora");
                goTo("calculadoras");
              }}
            >
              <Icon name="seed" size={18} />
              Regular semeadora
            </button>
          </div>
        </div>
        <div className="field-visual" aria-hidden="true">
          <img
            className="hero-brand-symbol"
            src="/manual-do-agronomo-simbolo.svg"
            alt=""
          />
          <div className="field-grid" />
          <div className="field-label">
            <i />
            <span>TALHÃO PRECISO · MONITORAMENTO ATIVO</span>
          </div>
          <strong>{formatDecimal(mappedArea, 1)} ha</strong>
          <small>área vinculada aos produtores</small>
        </div>
      </section>

      <section className="stats-grid">
        <Metric label="Produtores ativos" value={String(producers.length)} />
        <Metric label="Áreas vinculadas" value={String(mappedFields.length)} />
        <Metric label="Análises salvas" value={String(analyses.length)} />
        <Metric
          label="Área mapeada"
          value={`${formatDecimal(mappedArea, 1)} ha`}
          emphasis
        />
      </section>

      <section className="dashboard-weather">
        <article className="weather-card">
          <div className="weather-card-head">
            <span className="weather-icon"><Icon name="cloud" size={24} /></span>
            <div>
              <span className="eyebrow">PAINEL METEOROLÓGICO DO CAMPO</span>
              {weatherStatus === "ready" && weather?.city && (
                <p className="weather-location">
                  {weather.city}
                  {weather.region ? ` · ${weather.region}` : ""}
                  {weather.elevation ? ` · ${formatDecimal(weather.elevation, 0)} m` : ""}
                </p>
              )}
              <h2>
                {weatherStatus === "ready"
                  ? `${formatDecimal(weather?.current?.temperature_2m ?? 0, 1)} °C · ${weatherCondition(weather?.current?.weather_code)}`
                  : weatherStatus === "loading"
                    ? "Atualizando previsão…"
                    : "Ative a previsão local"}
              </h2>
              {weatherStatus === "ready" && (
                <small className="weather-updated">
                  Sensação {formatDecimal(weather?.current?.apparent_temperature ?? 0, 1)} °C
                  {weather?.current?.time ? ` · observado às ${weatherHour(weather.current.time)}` : ""}
                </small>
              )}
            </div>
            {weatherStatus !== "loading" && (
              <button className="button secondary" onClick={requestLocation}>
                Atualizar localização
              </button>
            )}
          </div>
          {weatherStatus === "ready" && (
            <>
              <div className="weather-now-grid">
                <span>
                  <b>{weather?.current?.relative_humidity_2m ?? 0}%</b>
                  Umidade do ar
                </span>
                <span>
                  <b>
                    {formatDecimal(weather?.current?.wind_speed_10m ?? 0, 1)} km/h {windDirection(weather?.current?.wind_direction_10m)}
                  </b>
                  Vento agora
                </span>
                <span>
                  <b>{formatDecimal(weather?.current?.wind_gusts_10m ?? 0, 1)} km/h</b>
                  Rajadas
                </span>
                <span>
                  <b>{weather?.current?.cloud_cover ?? 0}%</b>
                  Nebulosidade
                </span>
                <span>
                  <b>{formatDecimal(weather?.agronomic?.rain_last_24h ?? 0, 1)} mm</b>
                  Chuva nas últimas 24h
                </span>
                <span>
                  <b>{formatDecimal(weather?.agronomic?.rain_next_24h ?? 0, 1)} mm</b>
                  Chuva nas próximas 24h
                </span>
                <span>
                  <b>{formatDecimal(weatherToday?.et0_fao_evapotranspiration?.[0] ?? 0, 1)} mm</b>
                  ET₀ de hoje
                </span>
                <span>
                  <b className={(weather?.agronomic?.water_balance_today ?? 0) < 0 ? "weather-negative" : ""}>
                    {formatDecimal(weather?.agronomic?.water_balance_today ?? 0, 1)} mm
                  </b>
                  Balanço chuva − ET₀
                </span>
              </div>

              <div className="weather-operation-grid">
                <div className={`weather-operation ${application?.status ?? "attention"}`}>
                  <div>
                    <span className="eyebrow">INDICADOR DE PULVERIZAÇÃO</span>
                    <strong>{applicationLabel}</strong>
                  </div>
                  <p>
                    {application?.reasons?.length
                      ? application.reasons.join(" · ")
                      : "Vento, umidade, temperatura e chuva dentro dos critérios indicativos."}
                  </p>
                  {application?.best_window && (
                    <small>
                      Melhor janela nas próximas 24h: {weatherHour(application.best_window.start)}–{weatherHour(application.best_window.end)} ({application.best_window.hours}h)
                    </small>
                  )}
                </div>
                <div className="weather-next-rain">
                  <span className="eyebrow">PRÓXIMA CHUVA RELEVANTE</span>
                  <strong>
                    {weather?.agronomic?.next_rain
                      ? `${new Date(weather.agronomic.next_rain.time).toLocaleDateString("pt-BR", { weekday: "short" })}, ${weatherHour(weather.agronomic.next_rain.time)}`
                      : "Sem sinal nas próximas 48h"}
                  </strong>
                  <small>
                    {weather?.agronomic?.next_rain
                      ? `${weather.agronomic.next_rain.probability}% de chance · ${formatDecimal(weather.agronomic.next_rain.amount, 1)} mm/h estimado`
                      : "Consulte novamente antes das operações sensíveis."}
                  </small>
                </div>
              </div>

              {(weather?.agronomic?.alerts?.length ?? 0) > 0 && (
                <div className="weather-alerts" aria-label="Alertas meteorológicos">
                  {weather?.agronomic?.alerts?.map((alert) => (
                    <span className={alert.level} key={alert.label}>{alert.label}</span>
                  ))}
                </div>
              )}

              <div className="weather-section-title">
                <div>
                  <span className="eyebrow">PRÓXIMAS HORAS</span>
                  <strong>Janela horária para decisões rápidas</strong>
                </div>
                <small>Intervalos de 3 horas</small>
              </div>
              <div className="weather-hours">
                {hourlyForecast.map(({ time, index }) => (
                  <div key={time}>
                    <strong>{weatherHour(time)}</strong>
                    <span>{formatDecimal(weather?.hourly?.temperature_2m?.[index] ?? 0, 0)} °C</span>
                    <small>{weatherCondition(weather?.hourly?.weather_code?.[index])}</small>
                    <small>{weather?.hourly?.precipitation_probability?.[index] ?? 0}% · {formatDecimal(weather?.hourly?.precipitation?.[index] ?? 0, 1)} mm</small>
                    <small>Vento {formatDecimal(weather?.hourly?.wind_speed_10m?.[index] ?? 0, 0)} km/h</small>
                  </div>
                ))}
              </div>

              <div className="weather-section-title">
                <div>
                  <span className="eyebrow">7 DIAS</span>
                  <strong>Previsão e tendência</strong>
                </div>
                <small>1–3 dias: maior confiança · 4–7: tendência</small>
              </div>
              <div className="weather-days">
                {(weatherToday?.time ?? []).slice(0, 7).map((date, index) => (
                  <div key={date}>
                    <strong>
                      {index === 0
                        ? "Hoje"
                        : new Date(`${date}T12:00:00`).toLocaleDateString(
                            "pt-BR",
                            { weekday: "short" },
                          )}
                    </strong>
                    <span>
                      {formatDecimal(
                        weatherToday?.temperature_2m_min?.[index] ?? 0,
                        0,
                      )}
                      ° /{" "}
                      {formatDecimal(
                        weatherToday?.temperature_2m_max?.[index] ?? 0,
                        0,
                      )}
                      °
                    </span>
                    <small>
                      {weatherCondition(weatherToday?.weather_code?.[index])}
                    </small>
                    <small>
                      {weatherToday?.precipitation_probability_max?.[index] ?? 0}% · {formatDecimal(weatherToday?.precipitation_sum?.[index] ?? 0, 1)} mm
                    </small>
                    <small>
                      Vento até {formatDecimal(weatherToday?.wind_speed_10m_max?.[index] ?? 0, 0)} km/h
                    </small>
                  </div>
                ))}
              </div>
              <small className="weather-source">
                {weather?.sourceUrl ? (
                  <a href={weather.sourceUrl} target="_blank" rel="noreferrer">
                    Dados meteorológicos: Open-Meteo
                  </a>
                ) : (
                  "Previsão meteorológica local"
                )}
                {weather?.sourceNote ? ` · ${weather.sourceNote}` : ""}
                {application?.criteria ? ` · ${application.criteria}` : ""}
                {weather?.updatedAt ? ` · painel atualizado ${new Date(weather.updatedAt).toLocaleString("pt-BR")}` : ""}
              </small>
            </>
          )}
          {weatherStatus === "error" && (
            <p className="weather-error">{weatherMessage}</p>
          )}
        </article>
      </section>

      <div className="section-heading">
        <div>
          <span className="eyebrow">ATALHOS DE CAMPO</span>
          <h2>O que você precisa fazer agora?</h2>
        </div>
      </div>
      <section className="quick-grid">
        <button
          className="quick-card lime"
          onClick={() => {
            setCalc("semeadora");
            goTo("calculadoras");
          }}
        >
          <span className="quick-icon"><Icon name="seed" /></span>
          <div>
            <strong>Regular semeadora</strong>
            <small>Sementes/m, patinagem e aferição</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button className="quick-card" onClick={() => onCamera("solo")}>
          <span className="quick-icon"><Icon name="camera" /></span>
          <div>
            <strong>Ler análise de solo</strong>
            <small>Fotografe ou importe um laudo</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button className="quick-card diagnosis-quick-card" onClick={() => goTo("diagnostico")}>
          <span className="quick-icon"><Icon name="leaf" /></span>
          <div>
            <strong>Diagnosticar por foto</strong>
            <small>Nutrição, doenças, insetos e daninhas</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button className="quick-card" onClick={() => onCamera("produto")}>
          <span className="quick-icon"><Icon name="book" /></span>
          <div>
            <strong>Encontrar bula</strong>
            <small>Nome, cultura ou foto do produto</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button
          className="quick-card"
          onClick={() => {
            setCalc("pulverizacao");
            goTo("calculadoras");
          }}
        >
          <span className="quick-icon"><Icon name="spray" /></span>
          <div>
            <strong>Calcular aplicação</strong>
            <small>Calda, tanques e produto total</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button className="quick-card" onClick={() => goTo("produtores")}>
          <span className="quick-icon"><Icon name="users" /></span>
          <div>
            <strong>Gerenciar produtores</strong>
            <small>Propriedades, talhões, mapas e NDVI</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button className="quick-card" onClick={() => goTo("relatorios")}>
          <span className="quick-icon"><Icon name="file" /></span>
          <div>
            <strong>Gerar relatório</strong>
            <small>Fechamento técnico e histórico da safra</small>
          </div>
          <Icon name="arrow" />
        </button>
      </section>

      <section className="dashboard-columns">
        <article className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">AGENDA TÉCNICA</span>
              <h3>Próximas atividades</h3>
            </div>
            <span className="badge">{agendaItems.length} ITENS</span>
          </div>
          {agendaItems.map(([title, detail, priority]) => (
            <div className="task-row" key={title}>
              <i />
              <div><strong>{title}</strong><span>{detail}</span></div>
              <small>{priority}</small>
            </div>
          ))}
        </article>
        <article className="panel source-panel">
          <span className="eyebrow">CONFIANÇA DA BASE</span>
          <h3>Fontes técnicas verificadas</h3>
          <p>
            Agrofit/MAPA para registros e bulas; bibliotecas oficiais dos
            fabricantes para operação e regulagem.
          </p>
          <div className="source-list">
            <div><Icon name="check" /><span><strong>Agrofit</strong><small>consulta pública do MAPA</small></span></div>
            <div><Icon name="check" /><span><strong>11 portfólios</strong><small>fabricantes de foliares e biológicos</small></span></div>
            <div><Icon name="check" /><span><strong>5 culturas</strong><small>soja, milho, trigo, canola e arroz</small></span></div>
          </div>
        </article>
      </section>

      {showLocationPrompt && (
        <div className="location-prompt-backdrop" role="presentation">
          <section
            className="location-prompt"
            role="dialog"
            aria-modal="true"
            aria-label="Permissão de localização"
          >
            <span className="weather-icon"><Icon name="map" size={26} /></span>
            <span className="eyebrow">PREVISÃO PARA A SUA ÁREA</span>
            <h2>Usar sua localização?</h2>
            <p>
              O app usa a posição para consultar temperatura, vento e previsão
              de chuva. As coordenadas não são salvas; apenas cidade, estado e
              país aproximados podem compor as métricas de acesso.
            </p>
            <button className="button primary full-button" onClick={requestLocation}>
              Permitir localização
            </button>
            <button
              className="button secondary full-button"
              onClick={() => {
                sessionStorage.setItem("mp-location-prompted", "1");
                setShowLocationPrompt(false);
              }}
            >
              Agora não
            </button>
          </section>
        </div>
      )}
    </>
  );
}

type PlanterResult = {
  targetPlantsMeter: number;
  seedsMeter: number;
  seedsHa: number;
  distance: number;
  bagsHa: number;
  expectedTest: number;
  wheelTurns: number;
};

function Calculators({
  active,
  setActive,
  planter,
  values,
  setters,
  recommendation,
  profile,
  analyses,
  producers,
}: {
  active: CalcKey;
  setActive: (value: CalcKey) => void;
  planter: PlanterResult;
  values: Record<string, number>;
  setters: Record<string, (value: number) => void>;
  recommendation: {
    producer: string;
    setProducer: (value: string) => void;
    phone: string;
    setPhone: (value: string) => void;
    property: string;
    setProperty: (value: string) => void;
    crop: string;
    setCrop: (value: string) => void;
    target: string;
    setTarget: (value: string) => void;
    notes: string;
    setNotes: (value: string) => void;
    items: SprayItem[];
    setItems: (value: SprayItem[]) => void;
  };
  profile: ProfessionalProfile;
  analyses: SoilAnalysis[];
  producers: Producer[];
}) {
  const [fertFormulaId, setFertFormulaId] = useState(
    fertilizerFormulas[0]?.id ?? "",
  );
  const [fertSearch, setFertSearch] = useState("");
  const [fertCustom, setFertCustom] = useState(false);
  const [fertCustomName, setFertCustomName] = useState("Minha fórmula");
  const [fertNutrients, setFertNutrients] =
    useState<Record<NutrientKey, number>>(fertilizerFormulas[0].nutrients);
  const [fertEfficiency, setFertEfficiency] = useState(100);
  const [fertPrice, setFertPrice] = useState(0);
  const [seedAreaUnit, setSeedAreaUnit] = useState<AreaUnit>("ha");
  const [sprayAreaUnit, setSprayAreaUnit] = useState<AreaUnit>("ha");
  const [fertAreaUnit, setFertAreaUnit] = useState<AreaUnit>("ha");
  const [fertDoseUnit, setFertDoseUnit] =
    useState<FertilizerDoseUnit>("kg/ha");
  const [fertPriceUnit, setFertPriceUnit] =
    useState<FertilizerPriceUnit>("R$/t");
  const [comparisonSearch, setComparisonSearch] = useState("");
  const [showAllFertilizers, setShowAllFertilizers] = useState(false);
  const [comparisonMode, setComparisonMode] =
    useState<"same-dose" | "nutrient-target">("same-dose");
  const [comparisonNutrient, setComparisonNutrient] =
    useState<"N" | "P2O5" | "K2O">("P2O5");
  const [comparisonTarget, setComparisonTarget] = useState(60);
  const [comparisonIds, setComparisonIds] = useState<string[]>([
    fertilizerFormulas[0]?.id,
    fertilizerFormulas.find((item) => item.name.includes("YARABASA"))?.id,
    fertilizerFormulas.find((item) => item.name.includes("MICROESSENTIALS"))?.id,
    fertilizerFormulas.find((item) => item.name.includes("TOP PHOS"))?.id,
  ].filter(Boolean) as string[]);
  const [comparisonPricesPerTon, setComparisonPricesPerTon] = useState<
    Record<string, number>
  >({});
  const [harvestCrop, setHarvestCrop] =
    useState<Cultivar["crop"]>("Soja");
  const [harvestCultivarId, setHarvestCultivarId] = useState(
    cultivarCatalog.soybean[0]?.id ?? "",
  );
  const [plantingDate, setPlantingDate] = useState("");
  const [harvestGmr, setHarvestGmr] = useState(5.9);
  const [harvestCycleDays, setHarvestCycleDays] = useState(128);
  const [harvestAdjustment, setHarvestAdjustment] = useState(7);
  const [expectedEffectiveRain, setExpectedEffectiveRain] = useState(0);
  const [pivotEfficiency, setPivotEfficiency] = useState(85);
  const [planningUf, setPlanningUf] = useState("RS");
  const [planningMunicipality, setPlanningMunicipality] = useState("São Luiz Gonzaga");
  const [planningProducerId, setPlanningProducerId] = useState("");
  const [planningMunicipalities, setPlanningMunicipalities] = useState<Array<{ id: number; nome: string }>>([]);
  const [planningMunicipalitiesStatus, setPlanningMunicipalitiesStatus] = useState<"loading" | "ready" | "cached" | "error">("loading");
  const [planningLatitude, setPlanningLatitude] = useState<number | null>(null);
  const [planningLatitudeStatus, setPlanningLatitudeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [idealPopulationCrop, setIdealPopulationCrop] = useState<Cultivar["crop"]>("Soja");
  const [idealPopulationCultivarId, setIdealPopulationCultivarId] = useState(
    cultivarCatalog.soybean[0]?.id ?? "",
  );
  const [idealPopulationDate, setIdealPopulationDate] = useState("");
  const [productionEnvironment, setProductionEnvironment] = useState<ProductionEnvironment>("medio");
  const [yieldGapPercent, setYieldGapPercent] = useState(15);
  const [idealGermination, setIdealGermination] = useState(90);
  const [idealEmergence, setIdealEmergence] = useState(88);
  const [idealSpacing, setIdealSpacing] = useState(45);
  const [quoteProducer, setQuoteProducer] = useState("");
  const [quoteProperty, setQuoteProperty] = useState("");
  const [quoteDueDate, setQuoteDueDate] = useState("");
  const [quotePayment, setQuotePayment] = useState("Condição a combinar");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteWatermark, setQuoteWatermark] = useState(true);
  const [recordMessage, setRecordMessage] = useState("");
  const [planterCrop, setPlanterCrop] = useState<"Milho" | "Soja" | "Trigo" | "Canola">("Milho");
  const [planterInputMode, setPlanterInputMode] = useState<"population" | "meter">("population");
  const [meterTarget, setMeterTarget] = useState(3.15);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([
    {
      id: 1,
      product: "Fertilizante 04-28-08",
      quantity: 100,
      unit: "saco",
      systemPrice: 165,
      discount: 5,
    },
    {
      id: 2,
      product: "Semente de soja",
      quantity: 20,
      unit: "un.",
      systemPrice: 720,
      discount: 3,
    },
  ]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `mp-planning-municipalities-v1-${planningUf}`;
    setPlanningMunicipalitiesStatus("loading");
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const items = JSON.parse(cached) as Array<{ id: number; nome: string }>;
        if (Array.isArray(items) && items.length) {
          setPlanningMunicipalities(items);
          setPlanningMunicipalitiesStatus("cached");
        }
      }
    } catch {
      localStorage.removeItem(cacheKey);
    }
    fetch(`/api/municipalities?uf=${encodeURIComponent(planningUf)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Municípios indisponíveis")))
      .then((data: { municipalities?: Array<{ id: number; nome: string }> }) => {
        if (cancelled) return;
        const items = Array.isArray(data.municipalities) ? data.municipalities : [];
        setPlanningMunicipalities(items);
        setPlanningMunicipalitiesStatus("ready");
        localStorage.setItem(cacheKey, JSON.stringify(items));
      })
      .catch(() => {
        if (!cancelled) setPlanningMunicipalitiesStatus((current) => current === "cached" ? "cached" : "error");
      });
    return () => { cancelled = true; };
  }, [planningUf]);

  useEffect(() => {
    const normalizedMunicipality = normalizeOcrText(planningMunicipality);
    const match = planningMunicipalities.find((item) =>
      normalizeOcrText(item.nome) === normalizedMunicipality,
    );
    if (!match) {
      setPlanningLatitude(null);
      setPlanningLatitudeStatus("idle");
      return;
    }
    let cancelled = false;
    setPlanningLatitude(null);
    setPlanningLatitudeStatus("loading");
    fetch(`/api/geospatial/ibge-boundary?code=${match.id}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Centroide indisponível")))
      .then((data: { centroid?: { lat?: number } }) => {
        if (cancelled) return;
        const latitude = Number(data.centroid?.lat);
        if (!Number.isFinite(latitude)) throw new Error("Centroide indisponível");
        setPlanningLatitude(latitude);
        setPlanningLatitudeStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPlanningLatitude(null);
        setPlanningLatitudeStatus("error");
      });
    return () => { cancelled = true; };
  }, [planningMunicipalities, planningMunicipality]);

  function applyProducerLocation(producerId: string) {
    setPlanningProducerId(producerId);
    const producer = producers.find((item) => item.id === producerId);
    if (!producer?.city) return;
    const match = producer.city.trim().match(/^(.+?)(?:\s*[,/\-–—]\s*)([A-Za-z]{2})$/);
    if (match) {
      setPlanningMunicipality(match[1].trim());
      setPlanningUf(match[2].toUpperCase());
      return;
    }
    setPlanningMunicipality(producer.city.trim());
  }

  const planterPresets = {
    Milho: { population: 70000, spacing: 45, germination: 95, survival: 92, bagSeeds: 60000 },
    Soja: { population: 300000, spacing: 45, germination: 90, survival: 90, bagSeeds: 200000 },
    Trigo: { population: 3200000, spacing: 17, germination: 85, survival: 85, bagSeeds: 5000000 },
    Canola: { population: 500000, spacing: 34, germination: 90, survival: 80, bagSeeds: 1500000 },
  } as const;

  function applyPlanterCrop(nextCrop: keyof typeof planterPresets) {
    const preset = planterPresets[nextCrop];
    setPlanterCrop(nextCrop);
    setters.setPopulation(preset.population);
    setters.setSpacing(preset.spacing);
    setters.setGermination(preset.germination);
    setters.setFieldSurvival(preset.survival);
    setters.setBagSeeds(preset.bagSeeds);
    setMeterTarget((preset.population * (preset.spacing / 100)) / 10000);
  }

  function changePlanterMode(mode: "population" | "meter") {
    setPlanterInputMode(mode);
    if (mode === "meter") {
      setMeterTarget((values.population * (values.spacing / 100)) / 10000);
    }
  }

  function changePlantsPerMeter(value: number) {
    const safeValue = Math.max(0, value);
    setMeterTarget(safeValue);
    const rowSpacing = Math.max(values.spacing, 0.1) / 100;
    setters.setPopulation(Math.round((safeValue * 10000) / rowSpacing));
  }

  function changePlanterSpacing(value: number) {
    const safeSpacing = Math.max(0.1, value);
    setters.setSpacing(safeSpacing);
    if (planterInputMode === "meter") {
      setters.setPopulation(Math.round((meterTarget * 10000) / (safeSpacing / 100)));
    }
  }
  const selectedFertilizer =
    fertilizerFormulas.find((item) => item.id === fertFormulaId) ??
    fertilizerFormulas[0];
  const nutrientKeys: NutrientKey[] = [
    "N", "P2O5", "K2O", "Ca", "Mg", "S", "B", "Zn", "Cu", "Mn", "Fe", "Mo",
  ];
  const nutrientLabel: Record<NutrientKey, string> = {
    N: "N", P2O5: "P₂O₅", K2O: "K₂O", Ca: "Ca", Mg: "Mg", S: "S",
    B: "B", Zn: "Zn", Cu: "Cu", Mn: "Mn", Fe: "Fe", Mo: "Mo",
  };
  const activeFertName = fertCustom ? fertCustomName : selectedFertilizer.name;
  const activeFertNutrients = fertCustom
    ? fertNutrients
    : selectedFertilizer.nutrients;
  const normalizedFertSearch = normalizeOcrText(fertSearch);
  const filteredFertilizerFormulas = fertilizerFormulas.filter((item) =>
    normalizeOcrText(
      `${item.name} ${item.maker} ${item.category} ${item.technology || ""}`,
    ).includes(normalizedFertSearch),
  );
  const visibleFertilizerFormulas = filteredFertilizerFormulas.slice(
    0,
    showAllFertilizers ? 30 : 8,
  );
  const comparisonFormulas = comparisonIds
    .map((id) => fertilizerFormulas.find((item) => item.id === id))
    .filter(Boolean) as FertilizerFormula[];
  const comparisonOptions = fertilizerFormulas
    .filter(
      (item) =>
        !comparisonIds.includes(item.id) &&
        normalizeOcrText(`${item.name} ${item.maker}`).includes(
          normalizeOcrText(comparisonSearch),
        ),
    )
    .slice(0, 8);
  const suppliedNutrientKeys = nutrientKeys.filter(
    (key) => activeFertNutrients[key] > 0,
  );
  const seedAreaHa = areaToHectares(values.seedArea, seedAreaUnit);
  const sprayAreaHa = areaToHectares(values.sprayArea, sprayAreaUnit);
  const fertAreaHa = areaToHectares(values.fertArea, fertAreaUnit);
  const fertRateKgHa =
    fertDoseUnit === "kg/ha"
      ? values.fertRate
      : fertDoseUnit === "t/ha"
        ? values.fertRate * 1000
        : values.fertRate * Math.max(values.fertBag, 0);
  const fertPricePerKg =
    fertPriceUnit === "R$/t"
      ? fertPrice / 1000
      : fertPriceUnit === "R$/kg"
        ? fertPrice
        : fertPrice / Math.max(values.fertBag, 1);
  const pointsPerHa =
    (activeFertNutrients.N + activeFertNutrients.P2O5 + activeFertNutrients.K2O) *
    fertRateKgHa / 100;
  const effectivePoints = pointsPerHa * fertEfficiency / 100;
  const activeCultivars =
    harvestCrop === "Soja"
      ? cultivarCatalog.soybean
      : harvestCrop === "Milho"
        ? cultivarCatalog.corn
        : harvestCrop === "Trigo"
          ? cultivarCatalog.wheat
          : cultivarCatalog.canola;
  const selectedCultivar =
    activeCultivars.find((item) => item.id === harvestCultivarId) ??
    activeCultivars[0];
  const harvestEstimate = useMemo(() => selectedCultivar
    ? estimateRegionalHarvest({
        crop: harvestCrop,
        cultivar: {
          ...selectedCultivar,
          cycleDays: harvestCycleDays,
        },
        plantingDate,
        municipality: planningMunicipality,
        uf: planningUf,
        latitude: planningLatitude,
        harvestConditionDays: harvestAdjustment,
      })
    : null, [
      harvestAdjustment,
      harvestCrop,
      harvestCycleDays,
      plantingDate,
      planningMunicipality,
      planningLatitude,
      planningUf,
      selectedCultivar,
    ]);
  const resolvedHarvestCycleDays =
    harvestEstimate?.physiologicalCycleDays ?? harvestCycleDays;
  const cornThermalSum =
    harvestCrop === "Milho"
      ? selectedCultivar?.thermalSum ??
        Math.round(Math.max(1, resolvedHarvestCycleDays) * 12.5)
      : 0;
  const cornWaterDemand =
    harvestCrop === "Milho"
      ? Math.round(
          Math.min(
            700,
            Math.max(400, Math.max(1, resolvedHarvestCycleDays) * 4.6),
          ),
        )
      : 0;
  const cornPivotNet = Math.round(
    Math.max(0, cornWaterDemand - Math.max(0, expectedEffectiveRain)),
  );
  const cornPivotGross = Math.round(
    cornPivotNet /
      Math.max(0.5, Math.min(1, Math.max(0, pivotEfficiency) / 100)),
  );
  const idealPopulationCultivars =
    idealPopulationCrop === "Soja"
      ? cultivarCatalog.soybean
      : idealPopulationCrop === "Milho"
        ? cultivarCatalog.corn
        : idealPopulationCrop === "Trigo"
          ? cultivarCatalog.wheat
          : cultivarCatalog.canola;
  const idealPopulationCultivar =
    idealPopulationCultivars.find((item) => item.id === idealPopulationCultivarId)
    ?? idealPopulationCultivars[0];
  const idealPopulationResult = useMemo(() => recommendPlantPopulation({
    crop: idealPopulationCrop,
    cultivar: idealPopulationCultivar,
    plantingDate: idealPopulationDate,
    municipality: planningMunicipality,
    uf: planningUf,
    latitude: planningLatitude,
    environment: productionEnvironment,
    yieldGapPercent,
    germinationPercent: idealGermination,
    emergencePercent: idealEmergence,
    spacingCm: idealSpacing,
  }), [
    idealEmergence,
    idealGermination,
    idealPopulationCrop,
    idealPopulationCultivar,
    idealPopulationDate,
    idealSpacing,
    planningMunicipality,
    planningLatitude,
    planningUf,
    productionEnvironment,
    yieldGapPercent,
  ]);

  function chooseIdealPopulationCrop(nextCrop: Cultivar["crop"]) {
    const list = nextCrop === "Soja"
      ? cultivarCatalog.soybean
      : nextCrop === "Milho"
        ? cultivarCatalog.corn
        : nextCrop === "Trigo"
          ? cultivarCatalog.wheat
          : cultivarCatalog.canola;
    const spacingByCrop: Record<Cultivar["crop"], number> = {
      Soja: 45, Milho: 45, Trigo: 17, Canola: 25,
    };
    setIdealPopulationCrop(nextCrop);
    setIdealPopulationCultivarId(list[0]?.id ?? "");
    setIdealSpacing(spacingByCrop[nextCrop]);
  }

  function chooseHarvestCrop(nextCrop: Cultivar["crop"]) {
    const list =
      nextCrop === "Soja"
        ? cultivarCatalog.soybean
        : nextCrop === "Milho"
          ? cultivarCatalog.corn
          : nextCrop === "Trigo"
            ? cultivarCatalog.wheat
            : cultivarCatalog.canola;
    const cultivar = list[0];
    setHarvestCrop(nextCrop);
    setHarvestCultivarId(cultivar?.id ?? "");
    setHarvestCycleDays(cultivar?.cycleDays ?? 130);
    setHarvestGmr(cultivar?.gmr ?? cultivar?.thermalSum ?? 0);
  }

  function changeAreaUnit(
    value: number,
    currentUnit: AreaUnit,
    nextUnit: AreaUnit,
    setter: (next: number) => void,
    setUnit: (next: AreaUnit) => void,
  ) {
    setter(
      Number(
        (
          (value * areaUnitFactors[currentUnit]) /
          areaUnitFactors[nextUnit]
        ).toFixed(4),
      ),
    );
    setUnit(nextUnit);
  }

  function changeFertilizerDoseUnit(nextUnit: FertilizerDoseUnit) {
    const nextValue =
      nextUnit === "kg/ha"
        ? fertRateKgHa
        : nextUnit === "t/ha"
          ? fertRateKgHa / 1000
          : fertRateKgHa / Math.max(values.fertBag, 1);
    setters.setFertRate(Number(nextValue.toFixed(4)));
    setFertDoseUnit(nextUnit);
  }

  function changeFertilizerPriceUnit(nextUnit: FertilizerPriceUnit) {
    const nextValue =
      nextUnit === "R$/t"
        ? fertPricePerKg * 1000
        : nextUnit === "R$/kg"
          ? fertPricePerKg
          : fertPricePerKg * Math.max(values.fertBag, 1);
    setFertPrice(Number(nextValue.toFixed(4)));
    setFertPriceUnit(nextUnit);
  }

  function selectFertilizer(id: string) {
    const formula = fertilizerFormulas.find((item) => item.id === id);
    if (!formula) return;
    setFertFormulaId(id);
    setFertCustom(false);
    setFertNutrients({ ...formula.nutrients });
  }

  function toggleComparison(id: string) {
    setComparisonIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id].slice(-4),
    );
    setComparisonSearch("");
  }

  function fertilizerComparisonMetrics(formula: FertilizerFormula) {
    const rateKgHa =
      comparisonMode === "nutrient-target"
        ? formula.nutrients[comparisonNutrient] > 0
          ? (comparisonTarget * 100) / formula.nutrients[comparisonNutrient]
          : 0
        : fertRateKgHa;
    const nutrientKg = (key: NutrientKey) =>
      (formula.nutrients[key] * rateKgHa) / 100;
    const pointsNpk =
      nutrientKg("N") + nutrientKg("P2O5") + nutrientKg("K2O");
    const pricePerTon = comparisonPricesPerTon[formula.id] ?? 0;
    const costHa = (rateKgHa * pricePerTon) / 1000;
    const costPerPoint = pointsNpk > 0 ? costHa / pointsNpk : 0;
    return {
      rateKgHa,
      nutrientKg,
      pointsNpk,
      pricePerTon,
      costHa,
      costPerPoint,
    };
  }

  const quoteSubtotal = quoteItems.reduce(
    (total, item) => total + item.quantity * item.systemPrice,
    0,
  );
  const quoteTotal = quoteItems.reduce(
    (total, item) => total + quoteItemTotal(item),
    0,
  );
  const quoteDiscount = quoteSubtotal - quoteTotal;

  function updateQuoteItem(id: number, patch: Partial<QuoteItem>) {
    setQuoteItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function persistQuote() {
    const validItems = quoteItems.filter((item) => item.product.trim());
    if (!validItems.length) {
      setRecordMessage("Adicione ao menos um produto antes de salvar.");
      return;
    }
    setRecordMessage("Salvando cotação…");
    try {
      await saveRecord({
        type: "quote",
        title: `Cotação · ${quoteProducer || "Produtor não informado"}`,
        producerName: quoteProducer,
        payload: {
          producer: quoteProducer,
          property: quoteProperty,
          dueDate: quoteDueDate,
          payment: quotePayment,
          notes: quoteNotes,
          items: validItems.map((item) => ({
            ...item,
            finalUnitPrice: quoteUnitPrice(item),
            finalTotal: quoteItemTotal(item),
          })),
          subtotal: quoteSubtotal,
          discount: quoteDiscount,
          total: quoteTotal,
          savedAt: new Date().toISOString(),
        },
      });
      setRecordMessage("Cotação salva no histórico em nuvem desta conta.");
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    }
  }

  async function persistSprayRecommendation() {
    const validItems = recommendation.items.filter((item) => item.product.trim());
    if (!validItems.length) {
      setRecordMessage("Adicione ao menos um produto antes de salvar.");
      return;
    }
    setRecordMessage("Salvando recomendação…");
    try {
      await saveRecord({
        type: "spray_recommendation",
        title: `Pulverização · ${recommendation.producer || recommendation.crop}`,
        producerName: recommendation.producer,
        payload: {
          producer: recommendation.producer,
          property: recommendation.property,
          crop: recommendation.crop,
          target: recommendation.target,
          notes: recommendation.notes,
          areaHa: sprayAreaHa,
          sprayVolumeLHa: values.sprayVolume,
          tankVolumeL: values.tankVolume,
          items: validItems,
          savedAt: new Date().toISOString(),
        },
      });
      setRecordMessage("Recomendação salva no histórico em nuvem desta conta.");
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    }
  }

  async function persistFertilizerComparison() {
    if (!comparisonFormulas.length) {
      setRecordMessage("Escolha ao menos uma fórmula para salvar o comparativo.");
      return;
    }
    setRecordMessage("Salvando comparativo…");
    try {
      await saveRecord({
        type: "fertilizer_comparison",
        title: `Comparativo de fertilizantes · ${new Date().toLocaleDateString("pt-BR")}`,
        payload: {
          mode: comparisonMode,
          nutrient: comparisonNutrient,
          targetKgHa: comparisonTarget,
          referenceDoseKgHa: fertRateKgHa,
          formulas: comparisonFormulas.map((formula) => {
            const metrics = fertilizerComparisonMetrics(formula);
            return {
              id: formula.id,
              name: formula.name,
              maker: formula.maker,
              category: formula.category,
              nutrients: formula.nutrients,
              doseKgHa: metrics.rateKgHa,
              pricePerTon: metrics.pricePerTon,
              costHa: metrics.costHa,
              pointsNpk: metrics.pointsNpk,
              costPerPointNpk: metrics.costPerPoint,
            };
          }),
          savedAt: new Date().toISOString(),
        },
      });
      setRecordMessage("Comparativo salvo no histórico em nuvem desta conta.");
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    }
  }

  function makeQuotePdf() {
    const doc = new jsPDF();
    const validItems = quoteItems.filter((item) => item.product.trim());
    const issuedAt = new Date();
    const formattedDueDate = quoteDueDate
      ? new Date(`${quoteDueDate}T12:00:00`).toLocaleDateString("pt-BR")
      : "Não informada";

    doc.setFillColor(15, 55, 46);
    doc.rect(0, 0, 210, 31, "F");
    doc.setTextColor(239, 248, 243);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("COTAÇÃO DE INSUMOS", 16, 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      profile.company || profile.name || "Responsável comercial",
      16,
      23,
    );

    if (quoteWatermark && profile.watermark) {
      try {
        doc.saveGraphicsState();
        doc.setGState(new GState({ opacity: profile.watermarkOpacity / 100 }));
        doc.addImage(
          profile.watermark,
          profile.watermark.startsWith("data:image/jpeg") ? "JPEG" : "PNG",
          52,
          82,
          106,
          106,
          undefined,
          "FAST",
        );
        doc.restoreGraphicsState();
      } catch {
        // A proposta continua válida se o navegador não reconhecer a imagem.
      }
    }

    doc.setTextColor(30, 53, 47);
    doc.setFontSize(8.5);
    doc.text(
      `Emissão: ${issuedAt.toLocaleDateString("pt-BR")}  ·  Vencimento: ${formattedDueDate}`,
      16,
      41,
    );
    const details = [
      ["Cliente / produtor", quoteProducer || "Não informado"],
      ["Propriedade", quoteProperty || "Não informada"],
      ["Condição de pagamento", quotePayment || "Não informada"],
      ["Data de vencimento", formattedDueDate],
      [
        "Responsável",
        `${profile.name || "Não informado"}${profile.registration ? ` · ${profile.council} ${profile.registration}` : ""}`,
      ],
    ];
    let detailY = 51;
    details.forEach(([label, value], index) => {
      const x = index % 2 === 0 ? 16 : 108;
      if (index % 2 === 0 && index > 0) detailY += 16;
      doc.setTextColor(102, 119, 113);
      doc.setFontSize(7.5);
      doc.text(label.toUpperCase(), x, detailY);
      doc.setTextColor(22, 45, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(value, x, detailY + 6, { maxWidth: 82 });
      doc.setFont("helvetica", "normal");
    });

    const drawQuoteTableHeader = (top: number) => {
      doc.setFillColor(228, 238, 233);
      doc.rect(16, top - 7, 178, 11, "F");
      doc.setTextColor(45, 68, 61);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.6);
      doc.text("PRODUTO", 19, top);
      doc.text("VOLUME FINAL", 107, top, { align: "center" });
      doc.text("VALOR UNITÁRIO", 154, top, { align: "right" });
      doc.text("PREÇO FINAL", 190, top, { align: "right" });
    };

    let y = 106;
    drawQuoteTableHeader(y);
    y += 11;

    validItems.forEach((item, index) => {
      if (y > 250) {
        doc.addPage();
        y = 24;
        drawQuoteTableHeader(y);
        y += 11;
      }
      doc.setFillColor(index % 2 ? 248 : 242, 250, 247);
      doc.rect(16, y - 6, 178, 14, "F");
      doc.setTextColor(25, 48, 41);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(item.product, 19, y + 1, { maxWidth: 68 });
      doc.setFont("helvetica", "normal");
      doc.text(
        `${item.quantity.toLocaleString("pt-BR")} ${item.unit}`,
        107,
        y + 1,
        { align: "center" },
      );
      doc.setFontSize(7.5);
      doc.text(`${currency(quoteUnitPrice(item))}/${item.unit}`, 154, y + 1, {
        align: "right",
      });
      doc.setFont("helvetica", "bold");
      doc.text(currency(quoteItemTotal(item)), 190, y + 1, { align: "right" });
      y += 15;
    });
    if (y > 258) {
      doc.addPage();
      y = 24;
    }
    y += 5;
    doc.setDrawColor(205, 219, 212);
    doc.line(110, y, 194, y);
    y += 8;
    doc.setTextColor(15, 55, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("TOTAL FINAL", 142, y);
    doc.text(currency(quoteTotal), 194, y, { align: "right" });

    if (quoteNotes.trim()) {
      y += 14;
      if (y > 260) {
        doc.addPage();
        y = 24;
      }
      doc.setFontSize(8);
      doc.setTextColor(91, 108, 102);
      doc.text("OBSERVAÇÕES", 16, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(35, 57, 50);
      doc.text(doc.splitTextToSize(quoteNotes, 178), 16, y + 6);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(105, 118, 112);
    doc.text(
      `${profile.name || "Profissional não informado"}${profile.registration ? ` · ${profile.council} ${profile.registration}` : ""}`,
      16,
      280,
    );
    doc.text(
      [profile.company, profile.phone, profile.email].filter(Boolean).join(" · ") ||
        "Complete os dados profissionais em Meu perfil.",
      16,
      286,
    );
    return doc;
  }

  async function downloadQuote() {
    if (!quoteDueDate) return;
    const safeName =
      quoteProducer
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "cliente";
    const fileName = `cotacao-insumos-${safeName}.pdf`;
    const doc = makeQuotePdf();
    const file = new File([doc.output("blob")], fileName, {
      type: "application/pdf",
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "Cotação de insumos",
          text: `Cotação de insumos para ${quoteProducer || "o produtor"}.`,
          files: [file],
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    doc.save(fileName);
  }

  function makeRecommendationPdf() {
    const doc = new jsPDF();
    const validItems = recommendation.items.filter((item) =>
      item.product.trim(),
    );
    doc.setFillColor(6, 20, 18);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor(213, 244, 92);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("VALOR 360", 16, 15);
    doc.setTextColor(239, 248, 243);
    doc.setFontSize(11);
    doc.text("Recomendação de pulverização", 16, 24);
    if (profile.watermark) {
      try {
        doc.saveGraphicsState();
        doc.setGState(new GState({ opacity: profile.watermarkOpacity / 100 }));
        doc.addImage(
          profile.watermark,
          profile.watermark.startsWith("data:image/jpeg") ? "JPEG" : "PNG",
          52,
          78,
          106,
          106,
          undefined,
          "FAST",
        );
        doc.restoreGraphicsState();
      } catch {
        // O relatório continua válido mesmo quando a imagem não puder ser incorporada.
      }
    }
    doc.setTextColor(25, 45, 39);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Emitido em ${new Date().toLocaleDateString("pt-BR")} · documento para conferência técnica`,
      16,
      42,
    );
    const details = [
      ["Produtor", recommendation.producer || "Não informado"],
      ["Propriedade / talhão", recommendation.property || "Não informado"],
      ["Cultura", recommendation.crop || "Não informada"],
      ["Alvo / objetivo", recommendation.target || "Não informado"],
      ["Área", `${sprayAreaHa.toLocaleString("pt-BR")} ha`],
      [
        "Volume de calda",
        `${values.sprayVolume.toLocaleString("pt-BR")} L/ha`,
      ],
    ];
    let y = 53;
    details.forEach(([label, value], index) => {
      const x = index % 2 === 0 ? 16 : 108;
      if (index % 2 === 0 && index > 0) y += 16;
      doc.setTextColor(95, 112, 106);
      doc.setFontSize(8);
      doc.text(label.toUpperCase(), x, y);
      doc.setTextColor(15, 35, 30);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(value, x, y + 6, { maxWidth: 82 });
      doc.setFont("helvetica", "normal");
    });
    y += 23;
    doc.setDrawColor(210, 220, 215);
    doc.line(16, y, 194, y);
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 35, 30);
    doc.setFontSize(12);
    doc.text("Produtos e doses", 16, y);
    y += 9;
    validItems.forEach((item, index) => {
      doc.setFillColor(index % 2 ? 246 : 239, 248, 244);
      doc.roundedRect(16, y - 5, 178, 16, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(item.product, 20, y + 1, { maxWidth: 75 });
      doc.setFont("helvetica", "normal");
      doc.text(`${item.dose.toLocaleString("pt-BR")} ${item.unit}`, 104, y + 1);
      doc.text(doseTotal(item, sprayAreaHa), 160, y + 1, {
        align: "right",
      });
      y += 19;
    });
    if (recommendation.notes.trim()) {
      doc.setFont("helvetica", "bold");
      doc.text("Observações", 16, y + 2);
      doc.setFont("helvetica", "normal");
      const noteLines = doc.splitTextToSize(recommendation.notes, 178);
      doc.text(noteLines, 16, y + 9);
      y += noteLines.length * 5 + 14;
    }
    doc.setFillColor(248, 246, 226);
    doc.roundedRect(16, Math.min(y, 248), 178, 27, 2, 2, "F");
    doc.setTextColor(95, 72, 15);
    doc.setFontSize(8.5);
    doc.text(
      doc.splitTextToSize(
        "Antes da aplicação, conferir registro vigente para cultura, alvo, dose, modalidade, intervalo de segurança, condições climáticas, compatibilidade e receituário agronômico.",
        168,
      ),
      21,
      Math.min(y, 248) + 8,
    );
    doc.setTextColor(105, 118, 112);
    doc.text(
      `Responsável técnico: ${profile.name || "Não informado"} · ${profile.council} ${profile.registration || "não informado"}`,
      16,
      281,
    );
    doc.text(
      `${profile.company || "Empresa não informada"} · ${profile.email || "E-mail não informado"} · Base: Agrofit/MAPA`,
      16,
      287,
    );
    return doc;
  }

  function downloadRecommendation() {
    const fileName = "recomendacao-pulverizacao.pdf";
    makeRecommendationPdf().save(fileName);
  }

  async function shareRecommendation() {
    const doc = makeRecommendationPdf();
    const blob = doc.output("blob");
    const file = new File([blob], "recomendacao-pulverizacao.pdf", {
      type: "application/pdf",
    });
    const text = recommendationText(
      recommendation.producer,
      recommendation.property,
      recommendation.crop,
      recommendation.target,
      sprayAreaHa,
      values.sprayVolume,
      recommendation.items,
    );
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "Recomendação de pulverização",
          text,
          files: [file],
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    doc.save(file.name);
    const phone = recommendation.phone.replace(/\D/g, "");
    window.open(
      `https://wa.me/${phone ? phone.startsWith("55") ? phone : `55${phone}` : ""}?text=${encodeURIComponent(`${text}\n\nO PDF foi gerado. Anexe o arquivo baixado nesta conversa.`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const calcCards: {
    key: CalcKey;
    title: string;
    description: string;
    icon: IconName;
    tag?: string;
    group: "Pulverização" | "Fertilizantes" | "Plantabilidade" | "Custos";
  }[] = [
    {
      key: "semeadora",
      title: "Regulagem de semeadora",
      description: "População, sementes por metro, patinagem e teste de coleta.",
      icon: "seed",
      tag: "NOVO",
      group: "Plantabilidade",
    },
    {
      key: "populacao",
      title: "População ideal",
      description: "Faixa técnica por material, local, ambiente e yield gap.",
      icon: "users",
      tag: "NOVO",
      group: "Plantabilidade",
    },
    {
      key: "sementes",
      title: "Demanda de sementes",
      description: "Quantidade total, margem técnica e número de embalagens.",
      icon: "layers",
      group: "Plantabilidade",
    },
    {
      key: "colheita",
      title: "Previsão de colheita",
      description: "Data de plantio, cultivar, GMR/ciclo e janela estimada.",
      icon: "leaf",
      tag: "NOVO",
      group: "Plantabilidade",
    },
    {
      key: "zoneamento",
      title: "Zoneamento ZARC",
      description: "Melhor época de semeadura por município, solo, ciclo e risco.",
      icon: "map",
      tag: "NOVO",
      group: "Plantabilidade",
    },
    {
      key: "pulverizacao",
      title: "Pulverização",
      description: "Volume de calda, número de tanques e produto necessário.",
      icon: "spray",
      group: "Pulverização",
    },
    {
      key: "fertilizante",
      title: "Fertilizantes",
      description: "Dose por hectare, quantidade total e sacaria.",
      icon: "flask",
      group: "Fertilizantes",
    },
    {
      key: "reposicao",
      title: "Extração e exportação",
      description: "Produtividade, demanda de nutrientes e comparação de fórmulas.",
      icon: "leaf",
      tag: "NOVO",
      group: "Fertilizantes",
    },
    {
      key: "cotacao",
      title: "Cotação de insumos",
      description: "Preço de sistema, desconto por produto e proposta em PDF.",
      icon: "file",
      tag: "NOVO",
      group: "Custos",
    },
  ];
  const calculatorGroups = (["Pulverização", "Fertilizantes", "Plantabilidade", "Custos"] as const).map((group) => ({
    group,
    description: group === "Pulverização"
      ? "Calda, tanques e quantidade de produto"
      : group === "Fertilizantes"
        ? "Nutrição e reposição de nutrientes"
        : group === "Plantabilidade"
          ? "Sementes, implantação, ZARC e planejamento da colheita"
          : "Orçamento e decisão financeira",
    cards: calcCards.filter((card) => card.group === group),
  }));

  const planningLocationFields = (
    <>
      {producers.length > 0 && (
        <label className="field">
          <span>Preencher com produtor do Manual</span>
          <select value={planningProducerId} onChange={(event) => applyProducerLocation(event.target.value)}>
            <option value="">Local informado manualmente</option>
            {producers.map((producer) => (
              <option key={producer.id} value={producer.id}>
                {producer.name}{producer.city ? ` · ${producer.city}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>UF</span>
        <select value={planningUf} onChange={(event) => {
          setPlanningUf(event.target.value);
          setPlanningMunicipality("");
          setPlanningProducerId("");
        }}>
          {BRAZIL_UFS.map((uf) => <option key={uf}>{uf}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Município</span>
        <input
          list="planning-municipalities"
          value={planningMunicipality}
          onChange={(event) => {
            setPlanningMunicipality(event.target.value);
            setPlanningProducerId("");
          }}
          placeholder={planningMunicipalitiesStatus === "loading" ? "Carregando municípios…" : "Digite ou selecione"}
        />
        <datalist id="planning-municipalities">
          {planningMunicipalities.map((municipality) => <option key={municipality.id} value={municipality.nome} />)}
        </datalist>
        <small>
          {planningMunicipalitiesStatus === "ready" || planningMunicipalitiesStatus === "cached"
            ? `${planningMunicipalities.length} municípios do IBGE · ${planningLatitudeStatus === "ready" && planningLatitude !== null
                ? `latitude aproximada ${planningLatitude.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}° resolvida pelo centroide`
                : planningLatitudeStatus === "loading"
                  ? "resolvendo centroide municipal…"
                  : "selecione o nome oficial para usar o proxy de latitude"}`
            : planningMunicipalitiesStatus === "error"
              ? "Lista do IBGE indisponível; informe o município e valide manualmente."
              : "Carregando lista oficial do IBGE…"}
        </small>
      </label>
    </>
  );

  async function persistCurrentCalculator() {
    const card = calcCards.find((item) => item.key === active);
    const controls = Array.from(
      document.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("main input:not([type='file']), main select, main textarea"),
    ).map((control, index) => {
      const label = control.closest("label")?.querySelector("span")?.textContent?.trim();
      return {
        field: label || control.getAttribute("aria-label") || control.name || `campo-${index + 1}`,
        value: control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control.value,
      };
    });
    const resultText = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main .result-card, main .nutrient-removal-module, main .zarc-result",
      ),
    )
      .map((element) => element.innerText.trim())
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20000);
    setRecordMessage("Salvando cálculo na nuvem…");
    try {
      await saveRecord({
        type: "calculator",
        title: `${card?.title || "Calculadora"} · ${new Date().toLocaleString("pt-BR")}`,
        producerName: recommendation.producer,
        payload: {
          calculator: active,
          inputs: controls,
          sharedValues: values,
          planterResult: active === "semeadora" ? planter : undefined,
          resultText,
          savedAt: new Date().toISOString(),
        },
      });
      setRecordMessage("Cálculo salvo no histórico em nuvem desta conta.");
    } catch (error) {
      setRecordMessage(error instanceof Error ? error.message : "Falha ao salvar o cálculo.");
    }
  }
  return (
    <>
      <div className="page-heading page-heading-actions">
        <div>
          <span className="eyebrow">FERRAMENTAS DE CAMPO</span>
          <h1>Calculadoras</h1>
          <p>
            Resultados instantâneos, unidades visíveis e memória de cálculo para
            conferência.
          </p>
        </div>
        <button className="button primary" onClick={() => void persistCurrentCalculator()}>
          Salvar cálculo atual
        </button>
      </div>
      {recordMessage && <p className="record-message calculator-record-message">{recordMessage}</p>}
      <section className="calculator-groups" aria-label="Grupos de calculadoras">
        {calculatorGroups.map(({ group, description, cards }) => (
          <article className="calculator-group" key={group}>
            <div className="calculator-group-title">
              <span>{group}</span>
              <small>{description}</small>
            </div>
            <div className="calc-selector">
              {cards.map((card) => (
                <button
                  key={card.key}
                  className={active === card.key ? "active" : ""}
                  onClick={() => setActive(card.key)}
                >
                  <span className="calc-card-icon"><Icon name={card.icon} /></span>
                  <div>
                    <strong>{card.title}</strong>
                    <small>{card.description}</small>
                  </div>
                  {card.tag && <b className="new-tag">{card.tag}</b>}
                  <span className="open-calc"><Icon name="arrow" size={18} /></span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      {active === "semeadora" && (
        <section className="calculator-workspace">
          <div className="calculator-form">
            <div className="calc-title">
              <span className="calc-card-icon"><Icon name="seed" /></span>
              <div>
                <span className="eyebrow">PLANTABILIDADE</span>
                <h2>Regulagem de semeadora</h2>
              </div>
            </div>
            <div className="formula-note">
              <Icon name="check" size={18} />
              <span>
                Corrige população por germinação, sobrevivência estimada no
                campo e patinagem.
              </span>
            </div>
            <div className="planter-mode-panel">
              <label className="field">
                <span>Cultura</span>
                <div className="input-wrap">
                  <select value={planterCrop} onChange={(event) => applyPlanterCrop(event.target.value as keyof typeof planterPresets)}>
                    {Object.keys(planterPresets).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <small>O preset preenche valores iniciais; ajuste conforme cultivar, lote e ambiente.</small>
              </label>
              <div className="planter-mode-choice" role="radiogroup" aria-label="Forma de cálculo da população">
                <button type="button" role="radio" aria-checked={planterInputMode === "population"} className={planterInputMode === "population" ? "active" : ""} onClick={() => changePlanterMode("population")}>Informar população</button>
                <button type="button" role="radio" aria-checked={planterInputMode === "meter"} className={planterInputMode === "meter" ? "active" : ""} onClick={() => changePlanterMode("meter")}>Informar plantas por metro</button>
              </div>
            </div>
            <div className="field-grid-form">
              {planterInputMode === "population" ? (
                <NumberField label="População final desejada" value={values.population} onChange={setters.setPopulation} unit="plantas/ha" step={1000} />
              ) : (
                <NumberField label="Plantas finais por metro linear" value={meterTarget} onChange={changePlantsPerMeter} unit="plantas/m" step={0.1} />
              )}
              <NumberField label="Espaçamento entre linhas" value={values.spacing} onChange={changePlanterSpacing} unit="cm" step={1} />
              <NumberField label="Germinação do lote" value={values.germination} onChange={setters.setGermination} unit="%" max={100} />
              <NumberField label="Sobrevivência no campo" value={values.fieldSurvival} onChange={setters.setFieldSurvival} unit="%" />
              <NumberField label="Correção por patinagem" value={values.slippage} onChange={setters.setSlippage} unit="%" />
              <NumberField label="Sementes por embalagem" value={values.bagSeeds} onChange={setters.setBagSeeds} unit="sementes" step={1000} />
            </div>
            <div className="subsection-title">
              <div><span>Teste de aferição</span><small>Simule a coleta em uma ou mais linhas</small></div>
            </div>
            <div className="field-grid-form three">
              <NumberField label="Distância do teste" value={values.testDistance} onChange={setters.setTestDistance} unit="m" />
              <NumberField label="Linhas coletadas" value={values.testRows} onChange={setters.setTestRows} unit="linhas" step={1} />
              <NumberField label="Perímetro da roda" value={values.wheelCircumference} onChange={setters.setWheelCircumference} unit="m" step={0.01} />
            </div>
          </div>
          <aside className="result-card">
            <span className="eyebrow">REGULAGEM-ALVO</span>
            <Metric label="Distribuição corrigida" value={`${planter.seedsMeter.toFixed(2)} sementes/m`} emphasis />
            <div className="result-grid">
              <Metric label="População final" value={`${formatNumber(values.population)} plantas/ha`} />
              <Metric label="Plantas finais/m" value={planter.targetPlantsMeter.toFixed(2)} />
              <Metric label="Distância média" value={`${planter.distance.toFixed(1)} cm`} />
              <Metric label="Sementes/ha" value={formatNumber(planter.seedsHa)} />
              <Metric label="Embalagens/ha" value={planter.bagsHa.toFixed(2)} />
            </div>
            <div className="test-result">
              <span>Conferência estática</span>
              <strong>
                Colete aproximadamente {Math.round(planter.expectedTest)} sementes
              </strong>
              <p>
                Em {values.testRows} linha(s), após {planter.wheelTurns.toFixed(1)} voltas
                da roda para simular {values.testDistance} m.
              </p>
            </div>
            <ol className="checklist">
              <li><i>1</i><span>Abasteça e percorra alguns metros para carregar os dosadores.</span></li>
              <li><i>2</i><span>Faça a coleta, conte e compare linha por linha.</span></li>
              <li><i>3</i><span>Confirme no solo: profundidade, duplas, falhas e fechamento.</span></li>
            </ol>
            <small className="legal-note">
              A tabela do fabricante inicia a regulagem; a aferição real confirma
              o ajuste. Repita ao trocar lote, tratamento, disco ou área.
            </small>
          </aside>
        </section>
      )}

      {active === "populacao" && idealPopulationCultivar && (
        <section className="calculator-workspace population-workspace">
          <div className="calculator-form">
            <div className="calc-title">
              <span className="calc-card-icon"><Icon name="users" /></span>
              <div>
                <span className="eyebrow">PLANTABILIDADE · CENÁRIO AGRONÔMICO</span>
                <h2>População ideal por material e ambiente</h2>
              </div>
            </div>
            <div className="formula-note">
              <Icon name="check" size={18} />
              <span>
                A calculadora cruza a base de materiais do Manual com cultura,
                macrorregião, época, ambiente produtivo e yield gap informado pelo
                agrônomo. Como o cadastro não possui população oficial por cultivar,
                o resultado é uma faixa técnica de partida — não um número atribuído
                ao fabricante.
              </span>
            </div>
            <div className="field-grid-form">
              <label className="field">
                <span>Cultura</span>
                <select value={idealPopulationCrop} onChange={(event) => chooseIdealPopulationCrop(event.target.value as Cultivar["crop"])}>
                  <option>Soja</option><option>Milho</option><option>Trigo</option><option>Canola</option>
                </select>
              </label>
              <label className="field">
                <span>Cultivar ou híbrido</span>
                <select value={idealPopulationCultivarId} onChange={(event) => setIdealPopulationCultivarId(event.target.value)}>
                  {idealPopulationCultivars.map((cultivar) => (
                    <option key={cultivar.id} value={cultivar.id}>{cultivar.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Data prevista de plantio</span>
                <input type="date" value={idealPopulationDate} onChange={(event) => setIdealPopulationDate(event.target.value)} />
                <small>Usada apenas para classificar o cenário de época; confira a janela no ZARC.</small>
              </label>
              {planningLocationFields}
              <label className="field">
                <span>Ambiente produtivo</span>
                <select value={productionEnvironment} onChange={(event) => setProductionEnvironment(event.target.value as ProductionEnvironment)}>
                  <option value="restritivo">Restritivo · limitações conhecidas</option>
                  <option value="medio">Médio · histórico estável</option>
                  <option value="alto">Alto potencial · manejo intensivo</option>
                </select>
                <small>Cenário informado pelo agrônomo; não é classificação automática do talhão.</small>
              </label>
              <NumberField
                label="Yield gap estimado"
                value={yieldGapPercent}
                onChange={setYieldGapPercent}
                unit="%"
                min={0}
                max={80}
                step={1}
              />
              <NumberField label="Germinação do lote" value={idealGermination} onChange={setIdealGermination} unit="%" min={1} max={100} step={1} />
              <NumberField label="Emergência esperada no campo" value={idealEmergence} onChange={setIdealEmergence} unit="%" min={1} max={100} step={1} />
              <NumberField label="Espaçamento entre linhas" value={idealSpacing} onChange={setIdealSpacing} unit="cm" min={5} max={100} step={1} />
            </div>
            <div className="cultivar-data-card population-material-card">
              <div><span>Material selecionado</span><strong>{idealPopulationCultivar.brand} · {idealPopulationCultivar.cycleClass}</strong></div>
              <small>{idealPopulationCultivar.dataBasis}</small>
              <a href={idealPopulationCultivar.source} target="_blank" rel="noreferrer">
                Fonte técnica do material: {idealPopulationCultivar.sourceLabel}
                <Icon name="external" size={13} />
              </a>
            </div>
          </div>
          <aside className="result-card population-result">
            <span className="eyebrow">FAIXA PARA VALIDAÇÃO NO TALHÃO</span>
            <Metric
              label="Alvo de plantas finais"
              value={`${formatNumber(idealPopulationResult.finalTarget)} plantas/ha`}
              emphasis
            />
            <div className="result-grid">
              <Metric label="Faixa sugerida" value={`${formatNumber(idealPopulationResult.finalMin)}–${formatNumber(idealPopulationResult.finalMax)} plantas/ha`} />
              <Metric label="Sementes para distribuir" value={`${formatNumber(idealPopulationResult.seedsPerHa)} sementes/ha`} />
              <Metric label="Sementes por metro" value={idealPopulationResult.seedsPerMeter.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} />
              <Metric label="Plantas finais por metro" value={idealPopulationResult.finalPlantsPerMeter.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} />
              <Metric label="Estabelecimento usado" value={`${idealPopulationResult.establishmentPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} />
              <Metric label="Espaçamento geral de referência" value={`${idealPopulationResult.spacingRangeCm[0]}–${idealPopulationResult.spacingRangeCm[1]} cm`} />
            </div>
            <div className="planning-breakdown">
              <span>Como o alvo foi composto</span>
              <ul>{idealPopulationResult.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}</ul>
            </div>
            <div className="planning-warnings">
              <strong>Validação agronômica obrigatória</strong>
              <ul>{idealPopulationResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
            <small className="legal-note">
              Faça aferição de distribuição, profundidade, duplas e falhas. Quando
              houver recomendação populacional oficial do obtentor para o material e
              município, ela prevalece sobre esta aproximação.
            </small>
          </aside>
        </section>
      )}

      {active === "sementes" && (
        <section className="calculator-workspace compact-workspace">
          <div className="calculator-form">
            <div className="calc-title"><span className="calc-card-icon"><Icon name="layers" /></span><div><span className="eyebrow">PLANEJAMENTO</span><h2>Demanda de sementes</h2></div></div>
            <div className="field-grid-form">
              <NumberField
                label="Área a semear"
                value={values.seedArea}
                onChange={setters.setSeedArea}
                unit={seedAreaUnit}
                unitOptions={["ha", "alq. paulista", "alq. mineiro"]}
                onUnitChange={(unit) =>
                  changeAreaUnit(
                    values.seedArea,
                    seedAreaUnit,
                    unit as AreaUnit,
                    setters.setSeedArea,
                    setSeedAreaUnit,
                  )
                }
              />
              <NumberField label="População de semeadura" value={values.seedPopulation} onChange={setters.setSeedPopulation} unit="sementes/ha" step={1000} />
              <NumberField label="Margem técnica" value={values.seedMargin} onChange={setters.setSeedMargin} unit="%" />
              <NumberField label="Sementes por embalagem" value={values.seedBag} onChange={setters.setSeedBag} unit="sementes" step={1000} />
            </div>
          </div>
          <aside className="result-card">
            <span className="eyebrow">RESULTADO</span>
            <Metric label="Sementes necessárias" value={formatNumber(seedAreaHa * values.seedPopulation * (1 + values.seedMargin / 100))} emphasis />
            <Metric label="Embalagens" value={`${Math.ceil((seedAreaHa * values.seedPopulation * (1 + values.seedMargin / 100)) / Math.max(values.seedBag, 1))} un.`} />
            <Metric label="Margem incluída" value={`${values.seedMargin.toFixed(1)}%`} />
          </aside>
        </section>
      )}

      {active === "colheita" && (
        <section className="calculator-workspace harvest-workspace">
          <div className="calculator-form">
            <div className="calc-title">
              <span className="calc-card-icon"><Icon name="leaf" /></span>
              <div>
                <span className="eyebrow">PLANEJAMENTO DA SAFRA</span>
                <h2>Estimativa de colheita</h2>
              </div>
            </div>
            <div className="formula-note">
              <Icon name="check" size={18} />
              <span>
                A data é decomposta em ciclo-base do material + ajuste da
                macrorregião + proxy de latitude do centroide municipal + ajuste da
                época + dias pós-maturação. Município e UF vêm do IBGE, sem fingir
                precisão climática: confira microclima, altitude, adaptação e ZARC.
              </span>
            </div>
            <div className="field-grid-form">
              <label className="field">
                <span>Cultura</span>
                <select
                  value={harvestCrop}
                  onChange={(event) =>
                    chooseHarvestCrop(
                      event.target.value as Cultivar["crop"],
                    )
                  }
                >
                  <option>Soja</option>
                  <option>Milho</option>
                  <option>Trigo</option>
                  <option>Canola</option>
                </select>
              </label>
              <label className="field">
                <span>Cultivar</span>
                <select
                  value={harvestCultivarId}
                  onChange={(event) => {
                    const cultivar = activeCultivars.find(
                      (item) => item.id === event.target.value,
                    );
                    setHarvestCultivarId(event.target.value);
                    if (cultivar) {
                      setHarvestCycleDays(cultivar.cycleDays);
                      setHarvestGmr(
                        cultivar.gmr ?? cultivar.thermalSum ?? 0,
                      );
                    }
                  }}
                >
                  {activeCultivars.map((cultivar) => (
                    <option key={cultivar.id} value={cultivar.id}>
                      {cultivar.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Data de plantio *</span>
                <div className="input-wrap">
                  <input
                    type="date"
                    value={plantingDate}
                    onChange={(event) => setPlantingDate(event.target.value)}
                  />
                </div>
              </label>
              {planningLocationFields}
              {(harvestCrop === "Soja" || harvestCrop === "Milho") && (
                <NumberField
                  label={
                    harvestCrop === "Soja"
                      ? "Grupo de maturidade relativa (GMR)"
                      : "Soma térmica da cultivar"
                  }
                  value={harvestCrop === "Milho" ? cornThermalSum : harvestGmr}
                  onChange={(value) => {
                    setHarvestGmr(value);
                  }}
                  unit={harvestCrop === "Soja" ? "GMR" : "GD"}
                  step={harvestCrop === "Soja" ? 0.1 : 1}
                  readOnly
                />
              )}
              <NumberField
                label="Ciclo-base do cadastro"
                value={harvestCycleDays}
                onChange={setHarvestCycleDays}
                unit="dias"
                step={1}
                readOnly
              />
              {harvestCrop === "Milho" && (
                <>
                  <NumberField
                    label="Chuva efetiva estimada no ciclo"
                    value={expectedEffectiveRain}
                    onChange={setExpectedEffectiveRain}
                    unit="mm"
                    step={5}
                  />
                  <NumberField
                    label="Eficiência estimada do pivô"
                    value={pivotEfficiency}
                    onChange={setPivotEfficiency}
                    unit="%"
                    min={50}
                    max={100}
                    step={1}
                  />
                </>
              )}
              <NumberField
                label="Ajuste até condição de colheita"
                value={harvestAdjustment}
                onChange={setHarvestAdjustment}
                unit="dias"
                step={1}
              />
            </div>
            {selectedCultivar && (
              <div className="cultivar-data-card">
                <div>
                  <span>Base automática</span>
                  <strong>
                    {selectedCultivar.brand} · {selectedCultivar.cycleClass}
                  </strong>
                </div>
                <div className="cultivar-data-grid">
                  {selectedCultivar.officialMaturity && (
                    <p>
                      <b>Referência oficial</b>
                      {selectedCultivar.officialMaturity}
                    </p>
                  )}
                  {selectedCultivar.gmr !== null && (
                    <p>
                      <b>GMR</b>
                      {selectedCultivar.gmr.toLocaleString("pt-BR", {
                        minimumFractionDigits: 1,
                      })}
                    </p>
                  )}
                  {harvestCrop === "Milho" && (
                    <p>
                      <b>Soma térmica</b>
                      {cornThermalSum.toLocaleString("pt-BR")} GD{" "}
                      {selectedCultivar.thermalSum !== null
                        ? selectedCultivar.thermalStage
                        : "até a maturidade fisiológica · estimativa pelo ciclo"}
                    </p>
                  )}
                  <p>
                    <b>
                      {selectedCultivar.cycleEvidence === "observed"
                        ? "Faixa observada"
                        : "Faixa de planejamento"}
                    </b>
                    {selectedCultivar.cycleRangeDays[0]}–{selectedCultivar.cycleRangeDays[1]} dias
                  </p>
                </div>
                <small>{selectedCultivar.dataBasis}</small>
                <a
                  href={selectedCultivar.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fonte: {selectedCultivar.sourceLabel}
                  <Icon name="external" size={13} />
                </a>
                {selectedCultivar.manufacturerSource &&
                  selectedCultivar.manufacturerSourceLabel && (
                    <a
                      href={selectedCultivar.manufacturerSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Obtentor: {selectedCultivar.manufacturerSourceLabel}
                      <Icon name="external" size={13} />
                    </a>
                  )}
              </div>
            )}
            <div className="zarc-boundary-note">
              <Icon name="map" size={17} />
              <p><b>ZARC define janela e risco de semeadura — não o ciclo da cultivar.</b> Use a calculadora ZARC para validar se a data é indicada no município; use esta tela apenas para estimar o período de colheita.</p>
            </div>
          </div>
          <aside className="result-card harvest-result">
            <span className="eyebrow">JANELA ESTIMADA</span>
            <Metric
              label="Data central"
              value={
                harvestEstimate
                  ? harvestEstimate.central.toLocaleDateString("pt-BR")
                  : "Informe o plantio"
              }
              emphasis
            />
            <div className="result-grid">
              <Metric
                label="Início da janela"
                value={
                  harvestEstimate
                    ? harvestEstimate.start.toLocaleDateString("pt-BR")
                    : "—"
                }
              />
              <Metric
                label="Fim da janela"
                value={
                  harvestEstimate
                    ? harvestEstimate.end.toLocaleDateString("pt-BR")
                    : "—"
                }
              />
              <Metric
                label="Cultivar"
                value={selectedCultivar?.name ?? "Personalizada"}
              />
              <Metric
                label="Classe de ciclo"
                value={selectedCultivar?.cycleClass ?? "—"}
              />
              <Metric
                label="Ciclo-base"
                value={`${harvestEstimate?.baseCycleDays ?? harvestCycleDays} dias`}
              />
              <Metric
                label="Ajuste regional"
                value={harvestEstimate ? `${harvestEstimate.regionalAdjustmentDays >= 0 ? "+" : ""}${harvestEstimate.regionalAdjustmentDays} dias · ${harvestEstimate.region}` : "—"}
              />
              <Metric
                label="Proxy de latitude municipal"
                value={harvestEstimate && harvestEstimate.municipalityLatitude !== null
                  ? `${harvestEstimate.municipalityAdjustmentDays >= 0 ? "+" : ""}${harvestEstimate.municipalityAdjustmentDays} dias · ${harvestEstimate.municipalityLatitude.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}°`
                  : "0 dias · centroide não resolvido"}
              />
              <Metric
                label="Ajuste pela época"
                value={harvestEstimate ? `${harvestEstimate.seasonAdjustmentDays >= 0 ? "+" : ""}${harvestEstimate.seasonAdjustmentDays} dias` : "—"}
              />
              <Metric
                label="Pós-maturação informado"
                value={`+${Math.max(0, harvestAdjustment)} dias`}
              />
              <Metric
                label="Intervalo total usado"
                value={harvestEstimate ? `${harvestEstimate.startCycleDays}–${harvestEstimate.endCycleDays} dias` : "—"}
              />
              {harvestCrop === "Milho" && (
                <>
                  <Metric
                    label="Demanda hídrica estimada"
                    value={`${cornWaterDemand.toLocaleString("pt-BR")} mm/ciclo`}
                  />
                  <Metric
                    label="Lâmina líquida do pivô"
                    value={`${cornPivotNet.toLocaleString("pt-BR")} mm`}
                  />
                  <Metric
                    label="Lâmina bruta no pivô"
                    value={`${cornPivotGross.toLocaleString("pt-BR")} mm`}
                  />
                  <Metric label="Pico crítico VT–R3" value="5,7–6,5 mm/dia" />
                </>
              )}
            </div>
            {harvestEstimate && (
              <>
                <div className="planning-breakdown">
                  <span>Memória do cálculo</span>
                  <strong>
                    {harvestEstimate.baseCycleDays} {harvestEstimate.regionalAdjustmentDays >= 0 ? "+" : "−"} {Math.abs(harvestEstimate.regionalAdjustmentDays)} {harvestEstimate.municipalityAdjustmentDays >= 0 ? "+" : "−"} {Math.abs(harvestEstimate.municipalityAdjustmentDays)} {harvestEstimate.seasonAdjustmentDays >= 0 ? "+" : "−"} {Math.abs(harvestEstimate.seasonAdjustmentDays)} + {harvestEstimate.harvestConditionDays} = {harvestEstimate.centralCycleDays} dias
                  </strong>
                  <small>Época: {harvestEstimate.seasonBasis}. Local: {harvestEstimate.location} · ajuste por {harvestEstimate.region}.</small>
                </div>
                <div className="planning-warnings">
                  <strong>Premissas e alertas</strong>
                  <ul>{harvestEstimate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              </>
            )}
            <small className="legal-note">
              Estimativa de planejamento. No milho, RM/GM, GDU e dias não são
              tratados como a mesma grandeza. Quando há ensaio regional por época,
              o ciclo é ajustado ao mês de plantio; nos demais casos, a tela mostra
              explicitamente que os dias são referência regional. O ZARC não
              informa o ciclo e não é usado para fabricar uma data de colheita. Temperatura,
              disponibilidade hídrica, sanidade e perda de umidade podem antecipar
              ou alongar a colheita. A necessidade hídrica usa a faixa técnica de
              400–700 mm por ciclo e varia com o ciclo estimado do híbrido; a lâmina
              do pivô desconta a chuva efetiva informada e considera a eficiência do
              equipamento. Não substitui balanço hídrico, sensor de solo ou projeto
              de irrigação.
            </small>
          </aside>
        </section>
      )}

      {active === "zoneamento" && <ZarcPlanner />}

      {active === "pulverizacao" && (
        <>
          <section className="calculator-workspace spray-workspace">
            <div className="calculator-form">
              <div className="calc-title"><span className="calc-card-icon"><Icon name="spray" /></span><div><span className="eyebrow">APLICAÇÃO E ENVIO</span><h2>Recomendação de pulverização</h2></div></div>
              <div className="field-grid-form">
                <TextField label="Produtor" value={recommendation.producer} onChange={recommendation.setProducer} placeholder="Nome do produtor" />
                <TextField label="WhatsApp do produtor" value={recommendation.phone} onChange={recommendation.setPhone} placeholder="55 55 99999-9999" type="tel" />
                <TextField label="Propriedade ou talhão" value={recommendation.property} onChange={recommendation.setProperty} placeholder="Ex.: Talhão Norte" />
                <TextField label="Cultura" value={recommendation.crop} onChange={recommendation.setCrop} placeholder="Ex.: Soja" />
                <TextField label="Alvo ou objetivo" value={recommendation.target} onChange={recommendation.setTarget} placeholder="Ex.: doenças de final de ciclo" />
                <NumberField
                  label="Área"
                  value={values.sprayArea}
                  onChange={setters.setSprayArea}
                  unit={sprayAreaUnit}
                  unitOptions={["ha", "alq. paulista", "alq. mineiro"]}
                  onUnitChange={(unit) =>
                    changeAreaUnit(
                      values.sprayArea,
                      sprayAreaUnit,
                      unit as AreaUnit,
                      setters.setSprayArea,
                      setSprayAreaUnit,
                    )
                  }
                />
                <NumberField label="Volume de calda" value={values.sprayVolume} onChange={setters.setSprayVolume} unit="L/ha" />
                <NumberField label="Capacidade do tanque" value={values.tankVolume} onChange={setters.setTankVolume} unit="L" />
              </div>
              <div className="subsection-title spray-list-title">
                <div><span>Produtos da recomendação</span><small>Pesquise defensivos, foliares e biológicos; confirme a unidade no rótulo ou bula</small></div>
                <button
                  className="button small secondary"
                  onClick={() =>
                    recommendation.setItems([
                      ...recommendation.items,
                      {
                        id: Date.now(),
                        product: "",
                        dose: 0,
                        unit: "L/ha",
                      },
                    ])
                  }
                >
                  <Icon name="plus" size={16} /> Adicionar produto
                </button>
              </div>
              <div className="spray-items">
                {recommendation.items.map((item) => (
                  <div className="spray-item" key={item.id}>
                    <label className="field product-field">
                      <span>Produto</span>
                      <div className="input-wrap">
                        <input
                          list="agrofit-product-list"
                          value={item.product}
                          placeholder="Digite a marca, ingrediente ou fabricante"
                          onChange={(event) =>
                            recommendation.setItems(
                              recommendation.items.map((current) =>
                                current.id === item.id
                                  ? { ...current, product: event.target.value }
                                  : current,
                              ),
                            )
                          }
                        />
                      </div>
                    </label>
                    <NumberField
                      label="Dose"
                      value={item.dose}
                      onChange={(dose) =>
                        recommendation.setItems(
                          recommendation.items.map((current) =>
                            current.id === item.id
                              ? { ...current, dose }
                              : current,
                          ),
                        )
                      }
                      step={0.01}
                    />
                    <label className="field">
                      <span>Unidade</span>
                      <div className="input-wrap">
                        <select
                          value={item.unit}
                          onChange={(event) =>
                            recommendation.setItems(
                              recommendation.items.map((current) =>
                                current.id === item.id
                                  ? {
                                      ...current,
                                      unit: event.target.value as SprayItem["unit"],
                                    }
                                  : current,
                              ),
                            )
                          }
                        >
                          <option>L/ha</option>
                          <option>mL/ha</option>
                          <option>kg/ha</option>
                          <option>g/ha</option>
                        </select>
                      </div>
                    </label>
                    <div className="spray-total">
                      <span>Total na área</span>
                      <strong>{doseTotal(item, sprayAreaHa)}</strong>
                    </div>
                    <button
                      className="remove-item"
                      aria-label={`Remover ${item.product || "produto"}`}
                      disabled={recommendation.items.length === 1}
                      onClick={() =>
                        recommendation.setItems(
                          recommendation.items.filter(
                            (current) => current.id !== item.id,
                          ),
                        )
                      }
                    >
                      <Icon name="close" size={17} />
                    </button>
                  </div>
                ))}
              </div>
              <datalist id="agrofit-product-list">
                {sprayCatalogOptions.map((product) => (
                  <option
                    key={`${product.name}-${product.detail}`}
                    value={product.name}
                    label={product.detail}
                  />
                ))}
              </datalist>
              <label className="field notes-field">
                <span>Observações e condições de aplicação</span>
                <textarea
                  value={recommendation.notes}
                  onChange={(event) => recommendation.setNotes(event.target.value)}
                  placeholder="Horário, condições climáticas, sequência de mistura e orientações ao produtor…"
                />
              </label>
            </div>
            <aside className="result-card spray-result-card">
              <span className="eyebrow">RESUMO DA OPERAÇÃO</span>
              <Metric label="Calda total" value={`${formatNumber(sprayAreaHa * values.sprayVolume)} L`} emphasis />
              <div className="result-grid">
                <Metric label="Tanques" value={`${Math.ceil((sprayAreaHa * values.sprayVolume) / Math.max(values.tankVolume, 1))}`} />
                <Metric label="Área/tanque" value={`${(values.tankVolume / Math.max(values.sprayVolume, 1)).toFixed(1)} ha`} />
              </div>
              <div className="recommendation-preview">
                <span>Mensagem pronta</span>
                <p>{recommendation.items.filter((item) => item.product.trim()).map((item) => `${item.product} ${item.dose.toLocaleString("pt-BR")} ${item.unit}`).join(" + ") || "Adicione ao menos um produto."}</p>
              </div>
              <button
                className="button secondary full-button"
                onClick={() => void persistSprayRecommendation()}
              >
                Salvar recomendação
              </button>
              <button className="button primary full-button" onClick={downloadRecommendation}>
                <Icon name="file" size={18} /> Gerar PDF
              </button>
              <button className="button whatsapp full-button" onClick={shareRecommendation}>
                Compartilhar no WhatsApp
                <Icon name="arrow" size={18} />
              </button>
              <small className="legal-note">O PDF é um rascunho técnico para conferência. Use somente produtos, doses e condições registrados na bula vigente e formalize o receituário quando aplicável.</small>
              {recordMessage && <small className="record-message">{recordMessage}</small>}
            </aside>
          </section>
        </>
      )}

      {active === "fertilizante" && (
        <div className="fertilizer-module">
          <section className="calculator-workspace fertilizer-workspace">
            <div className="calculator-form">
              <div className="calc-title"><span className="calc-card-icon"><Icon name="flask" /></span><div><span className="eyebrow">NUTRIÇÃO E COMPARAÇÃO</span><h2>Calculadora de fertilizantes</h2></div></div>
              <div className="formula-note"><Icon name="check" size={18} /><span>Garantias em % m/m. Os resultados mostram kg de nutriente por hectare e na área total.</span></div>
              <label className="search-box fertilizer-search">
                <Icon name="search" size={18} />
                <input value={fertSearch} onChange={(event) => setFertSearch(event.target.value)} placeholder="Buscar fórmula, marca ou tecnologia…" />
              </label>
              <div className="fertilizer-catalog">
                {visibleFertilizerFormulas.map((item) => (
                    <button key={item.id} className={!fertCustom && fertFormulaId === item.id ? "active" : ""} onClick={() => selectFertilizer(item.id)}>
                      <span>{item.maker}</span><strong>{item.name}</strong><small>{item.category}</small>
                    </button>
                  ))}
                <button className={fertCustom ? "active custom-formula-card" : "custom-formula-card"} onClick={() => setFertCustom(true)}>
                  <span>PERSONALIZADO</span><strong><Icon name="plus" size={15} /> Criar fórmula</strong><small>Macro e micronutrientes editáveis</small>
                </button>
              </div>
              <div className="fertilizer-catalog-caption">
                <div>
                  <span>
                    Exibindo {visibleFertilizerFormulas.length} de{" "}
                    {filteredFertilizerFormulas.length} fórmulas encontradas
                  </span>
                  <small>
                    As {fertilizerFormulas.length} formulações do material
                    técnico permanecem disponíveis pela busca.
                  </small>
                </div>
                {filteredFertilizerFormulas.length > 8 && (
                  <button
                    className="text-button"
                    onClick={() => setShowAllFertilizers((value) => !value)}
                  >
                    {showAllFertilizers ? "Mostrar menos" : "Mostrar mais"}
                  </button>
                )}
              </div>
              {fertCustom && (
                <TextField label="Nome da fórmula personalizada" value={fertCustomName} onChange={setFertCustomName} placeholder="Ex.: Fórmula produtor 05-25-15 + micros" />
              )}
              <div className="field-grid-form three">
                <NumberField
                  label="Área"
                  value={values.fertArea}
                  onChange={setters.setFertArea}
                  unit={fertAreaUnit}
                  unitOptions={["ha", "alq. paulista", "alq. mineiro"]}
                  onUnitChange={(unit) =>
                    changeAreaUnit(
                      values.fertArea,
                      fertAreaUnit,
                      unit as AreaUnit,
                      setters.setFertArea,
                      setFertAreaUnit,
                    )
                  }
                />
                <NumberField
                  label="Dose planejada"
                  value={values.fertRate}
                  onChange={setters.setFertRate}
                  unit={fertDoseUnit}
                  unitOptions={["kg/ha", "t/ha", "saco/ha"]}
                  onUnitChange={(unit) =>
                    changeFertilizerDoseUnit(unit as FertilizerDoseUnit)
                  }
                />
                <NumberField label="Peso da embalagem" value={values.fertBag} onChange={setters.setFertBag} unit="kg" />
                <NumberField
                  label="Preço informado"
                  value={fertPrice}
                  onChange={setFertPrice}
                  unit={fertPriceUnit}
                  unitOptions={["R$/t", "R$/saco", "R$/kg"]}
                  onUnitChange={(unit) =>
                    changeFertilizerPriceUnit(unit as FertilizerPriceUnit)
                  }
                  step={fertPriceUnit === "R$/t" ? 10 : 0.01}
                />
                <NumberField label="Eficiência ajustada" value={fertEfficiency} onChange={setFertEfficiency} unit="%" max={200} />
              </div>
              <div className="subsection-title"><div><span>Garantias da fórmula (%)</span><small>Edite ao criar uma fórmula ou para conferir a garantia do lote</small></div></div>
              <div className="nutrient-input-grid">
                {nutrientKeys.map((key) => (
                  <NumberField
                    key={key}
                    label={nutrientLabel[key]}
                    value={activeFertNutrients[key]}
                    onChange={(value) => {
                      if (!fertCustom) setFertCustom(true);
                      setFertNutrients({ ...activeFertNutrients, [key]: value });
                    }}
                    unit="%"
                    step={key === "B" || key === "Zn" || key === "Cu" || key === "Mn" || key === "Fe" || key === "Mo" ? 0.01 : 0.1}
                  />
                ))}
              </div>
              {!fertCustom && (selectedFertilizer.guarantee || selectedFertilizer.technology || selectedFertilizer.note) && (
                <div className="technology-note">
                  <div>
                    <span>Garantia informada</span>
                    <strong>{selectedFertilizer.guarantee || selectedFertilizer.technology || "Formulação mineral"}</strong>
                  </div>
                  {selectedFertilizer.note && <p>{selectedFertilizer.note}</p>}
                  {selectedFertilizer.source?.startsWith("http") ? (
                    <a href={selectedFertilizer.source} target="_blank" rel="noreferrer">Fonte do fabricante <Icon name="external" size={15} /></a>
                  ) : (
                    selectedFertilizer.source && <small>{selectedFertilizer.source}</small>
                  )}
                </div>
              )}
            </div>
            <aside className="result-card fertilizer-results">
              <span className="eyebrow">FORNECIMENTO POR HECTARE</span>
              <h3>{activeFertName}</h3>
              <Metric label="Pontos NPK/ha" value={`${pointsPerHa.toFixed(1)} pontos`} emphasis />
              <div className="nutrient-results">
                {suppliedNutrientKeys.map((key) => (
                  <div key={key} className={activeFertNutrients[key] > 0 ? "supplied" : ""}>
                    <span>{nutrientLabel[key]}</span>
                    <strong>{formatDecimal(activeFertNutrients[key] * fertRateKgHa / 100)}</strong>
                    <small>kg/ha</small>
                  </div>
                ))}
                {!suppliedNutrientKeys.length && (
                  <p className="no-nutrient-result">
                    Informe as garantias da fórmula para calcular o fornecimento.
                  </p>
                )}
              </div>
              <div className="result-grid">
                <Metric label="Pontos ajustados" value={effectivePoints.toFixed(1)} />
                <Metric label="Custo/ha" value={fertPrice > 0 ? currency(fertPricePerKg * fertRateKgHa) : "Informe o preço"} />
                <Metric label="Quantidade total" value={`${formatNumber(fertAreaHa * fertRateKgHa)} kg`} />
                <Metric label="Embalagens" value={`${Math.ceil(fertAreaHa * fertRateKgHa / Math.max(values.fertBag, 1))} un.`} />
              </div>
              <small className="legal-note">“Pontos” = kg/ha de N + P₂O₅ + K₂O. Eficiência ajustada é um cenário do usuário, não uma garantia de resposta ou produtividade.</small>
            </aside>
          </section>

          <section className="fertilizer-comparison">
            <div className="comparison-heading">
              <div>
                <span className="eyebrow">COMPARAÇÃO COMPACTA</span>
                <h2>Fertilizantes lado a lado</h2>
                <p>
                  {comparisonMode === "same-dose" ? (
                    <>
                      Todos calculados na mesma dose de{" "}
                      <b>
                        {values.fertRate.toLocaleString("pt-BR")} {fertDoseUnit}
                      </b>{" "}
                      ({fertRateKgHa.toLocaleString("pt-BR")} kg/ha).
                    </>
                  ) : (
                    <>
                      Compare a dose necessária de cada fórmula para entregar a
                      mesma meta de nutriente por hectare.
                    </>
                  )}
                </p>
              </div>
              <span className="comparison-limit">
                {comparisonIds.length}/4 selecionados
              </span>
            </div>

            <div className="comparison-method">
              <div className="comparison-mode">
                <button
                  className={comparisonMode === "same-dose" ? "active" : ""}
                  onClick={() => setComparisonMode("same-dose")}
                >
                  Mesma dose
                </button>
                <button
                  className={
                    comparisonMode === "nutrient-target" ? "active" : ""
                  }
                  onClick={() => setComparisonMode("nutrient-target")}
                >
                  Mesma meta nutricional
                </button>
              </div>
              {comparisonMode === "nutrient-target" && (
                <div className="comparison-target-fields">
                  <label>
                    <span>Nutriente-alvo</span>
                    <select
                      value={comparisonNutrient}
                      onChange={(event) =>
                        setComparisonNutrient(
                          event.target.value as "N" | "P2O5" | "K2O",
                        )
                      }
                    >
                      <option value="N">N</option>
                      <option value="P2O5">P₂O₅</option>
                      <option value="K2O">K₂O</option>
                    </select>
                  </label>
                  <NumberField
                    label="Meta por hectare"
                    value={comparisonTarget}
                    onChange={setComparisonTarget}
                    unit="kg/ha"
                  />
                </div>
              )}
            </div>

            <div className="comparison-add">
              <label className="search-box">
                <Icon name="search" size={18} />
                <input
                  value={comparisonSearch}
                  onChange={(event) => setComparisonSearch(event.target.value)}
                  placeholder="Adicionar fórmula ao comparativo…"
                />
              </label>
              {comparisonSearch.trim() && (
                <div className="comparison-search-results">
                  {comparisonOptions.map((formula) => (
                    <button
                      key={formula.id}
                      onClick={() => toggleComparison(formula.id)}
                    >
                      <span>
                        <strong>{formula.name}</strong>
                        <small>{formula.maker} · {formula.category}</small>
                      </span>
                      <Icon name="plus" size={17} />
                    </button>
                  ))}
                  {!comparisonOptions.length && (
                    <span className="comparison-no-result">
                      Nenhuma outra fórmula encontrada.
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="comparison-card-grid">
              {comparisonFormulas.map((formula) => {
                const metrics = fertilizerComparisonMetrics(formula);
                const kg = metrics.nutrientKg;
                const secondary = nutrientKeys.filter(
                  (key) =>
                    !["N", "P2O5", "K2O"].includes(key) &&
                    formula.nutrients[key] > 0,
                );
                return (
                  <article className="comparison-card" key={formula.id}>
                    <header>
                      <div>
                        <span>{formula.maker}</span>
                        <h3>{formula.name}</h3>
                        <small>{formula.category}</small>
                      </div>
                      <button
                        onClick={() => toggleComparison(formula.id)}
                        aria-label={`Remover ${formula.name} do comparativo`}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </header>
                    <div className="comparison-points">
                      <span>
                        {comparisonMode === "nutrient-target"
                          ? `Dose para ${formatDecimal(comparisonTarget, 0)} kg de ${nutrientLabel[comparisonNutrient]}`
                          : "Pontos NPK/ha"}
                      </span>
                      <strong>
                        {comparisonMode === "nutrient-target"
                          ? metrics.rateKgHa > 0
                            ? `${formatDecimal(metrics.rateKgHa, 1)} kg/ha`
                            : "Não fornece"
                          : formatDecimal(metrics.pointsNpk, 1)}
                      </strong>
                    </div>
                    <label className="field comparison-price-field">
                      <span>Preço do fertilizante</span>
                      <div className="input-wrap">
                        <b>R$</b>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={10}
                          value={metrics.pricePerTon || ""}
                          onChange={(event) =>
                            setComparisonPricesPerTon((current) => ({
                              ...current,
                              [formula.id]: Math.max(
                                0,
                                Number(event.target.value) || 0,
                              ),
                            }))
                          }
                          placeholder="0,00"
                        />
                        <b>/t</b>
                      </div>
                    </label>
                    <div className="comparison-npk comparison-costs">
                      <div>
                        <span>Dose comparada</span>
                        <strong>{formatDecimal(metrics.rateKgHa, 1)}</strong>
                        <small>kg/ha</small>
                      </div>
                      <div>
                        <span>Custo/ha</span>
                        <strong>
                          {metrics.pricePerTon > 0
                            ? currency(metrics.costHa)
                            : "—"}
                        </strong>
                        <small>na dose calculada</small>
                      </div>
                      <div>
                        <span>Custo/ponto NPK</span>
                        <strong>
                          {metrics.pricePerTon > 0 && metrics.pointsNpk > 0
                            ? currency(metrics.costPerPoint)
                            : "—"}
                        </strong>
                        <small>R$/kg de N + P₂O₅ + K₂O</small>
                      </div>
                    </div>
                    <div className="comparison-npk">
                      {(["N", "P2O5", "K2O"] as NutrientKey[]).map((key) => (
                        <div key={key}>
                          <span>{nutrientLabel[key]}</span>
                          <strong>{formatDecimal(kg(key), 1)}</strong>
                          <small>kg/ha</small>
                        </div>
                      ))}
                    </div>
                    <div className="comparison-secondary">
                      <span>Outros nutrientes</span>
                      {secondary.length ? (
                        <div>
                          {secondary.map((key) => (
                            <small key={key}>
                              <b>{nutrientLabel[key]}</b>{" "}
                              {formatDecimal(kg(key), 2)} kg/ha
                            </small>
                          ))}
                        </div>
                      ) : (
                        <p>Nenhum outro nutriente informado na garantia.</p>
                      )}
                    </div>
                    <footer>
                      <Icon name="flask" size={16} />
                      <span>{formula.technology || "Formulação convencional"}</span>
                    </footer>
                  </article>
                );
              })}
              {!comparisonFormulas.length && (
                <div className="comparison-empty">
                  <Icon name="flask" size={30} />
                  <strong>Escolha até quatro fertilizantes</strong>
                  <p>A busca acima adiciona somente os produtos que você deseja comparar.</p>
                </div>
              )}
            </div>
            <small className="comparison-disclaimer">
              Informe o preço por tonelada de cada produto. O custo por ponto
              divide o custo/ha pelos kg/ha somados de N + P₂O₅ + K₂O; nutrientes
              secundários permanecem visíveis, mas não entram nesse divisor.
              Tecnologias comerciais não são convertidas em eficiência sem
              validação técnica específica.
            </small>
            <div className="comparison-save">
              <button
                className="button secondary"
                onClick={() => void persistFertilizerComparison()}
              >
                Salvar comparativo
              </button>
              {recordMessage && <small className="record-message">{recordMessage}</small>}
            </div>
          </section>
        </div>
      )}

      {active === "reposicao" && <NutrientRemovalCalculator analyses={analyses} producers={producers} />}

      {active === "cotacao" && (
        <section className="calculator-workspace quote-workspace">
          <div className="calculator-form">
            <div className="calc-title">
              <span className="calc-card-icon"><Icon name="file" /></span>
              <div>
                <span className="eyebrow">PROPOSTA COMERCIAL</span>
                <h2>Cotação de insumos</h2>
              </div>
            </div>
            <div className="formula-note">
              <Icon name="check" size={18} />
              <span>
                O desconto é aplicado individualmente sobre o preço de sistema.
                O PDF usa somente a identidade profissional e empresarial.
              </span>
            </div>
            <div className="field-grid-form">
              <TextField
                label="Cliente / produtor"
                value={quoteProducer}
                onChange={setQuoteProducer}
                placeholder="Nome do cliente ou produtor"
              />
              <TextField
                label="Propriedade"
                value={quoteProperty}
                onChange={setQuoteProperty}
                placeholder="Ex.: Fazenda Boa Vista"
              />
              <TextField
                label="Condição de pagamento"
                value={quotePayment}
                onChange={setQuotePayment}
                placeholder="Ex.: 30/60 dias"
              />
              <label className="field">
                <span>Data de vencimento *</span>
                <div className="input-wrap">
                  <input
                    type="date"
                    value={quoteDueDate}
                    required
                    aria-required="true"
                    onChange={(event) => setQuoteDueDate(event.target.value)}
                  />
                </div>
              </label>
            </div>
            <div className="subsection-title quote-list-title">
              <div>
                <span>Produtos da cotação</span>
                <small>Cadastre quantidade, unidade, preço de sistema e desconto</small>
              </div>
              <button
                className="button small secondary"
                onClick={() =>
                  setQuoteItems([
                    ...quoteItems,
                    {
                      id: Date.now(),
                      product: "",
                      quantity: 1,
                      unit: "un.",
                      systemPrice: 0,
                      discount: 0,
                    },
                  ])
                }
              >
                <Icon name="plus" size={16} /> Adicionar produto
              </button>
            </div>
            <div className="quote-items">
              {quoteItems.map((item) => (
                <div className="quote-item" key={item.id}>
                  <label className="field quote-product-field">
                    <span>Produto</span>
                    <div className="input-wrap">
                      <input
                        value={item.product}
                        list="quote-product-list"
                        placeholder="Nome do insumo"
                        onChange={(event) =>
                          updateQuoteItem(item.id, { product: event.target.value })
                        }
                      />
                    </div>
                  </label>
                  <NumberField
                    label="Quantidade"
                    value={item.quantity}
                    onChange={(quantity) => updateQuoteItem(item.id, { quantity })}
                    step={0.01}
                  />
                  <label className="field">
                    <span>Unidade</span>
                    <select
                      value={item.unit}
                      onChange={(event) =>
                        updateQuoteItem(item.id, {
                          unit: event.target.value as QuoteItem["unit"],
                        })
                      }
                    >
                      <option value="un.">un.</option>
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                      <option value="saco">saco</option>
                      <option value="t">t</option>
                    </select>
                  </label>
                  <NumberField
                    label="Preço de sistema"
                    value={item.systemPrice}
                    onChange={(systemPrice) =>
                      updateQuoteItem(item.id, { systemPrice })
                    }
                    unit={`R$/${item.unit}`}
                    step={0.01}
                  />
                  <NumberField
                    label="Desconto"
                    value={item.discount}
                    onChange={(discount) =>
                      updateQuoteItem(item.id, { discount })
                    }
                    unit="%"
                    max={100}
                    step={0.1}
                  />
                  <div className="quote-line-total">
                    <span>Preço final</span>
                    <strong>{currency(quoteUnitPrice(item))}</strong>
                    <small>Total: {currency(quoteItemTotal(item))}</small>
                  </div>
                  <button
                    className="remove-item"
                    aria-label={`Remover ${item.product || "produto"}`}
                    disabled={quoteItems.length === 1}
                    onClick={() =>
                      setQuoteItems(
                        quoteItems.filter((current) => current.id !== item.id),
                      )
                    }
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              ))}
            </div>
            <datalist id="quote-product-list">
              {fertilizerFormulas.map((formula) => (
                <option key={`fert-${formula.id}`} value={formula.name} />
              ))}
              {products.slice(0, 800).map((product) => (
                <option
                  key={`quote-${product.registration}-${product.name}`}
                  value={product.name}
                />
              ))}
            </datalist>
            <label className="field notes-field">
              <span>Observações comerciais</span>
              <textarea
                value={quoteNotes}
                onChange={(event) => setQuoteNotes(event.target.value)}
                placeholder="Frete, prazo de entrega, disponibilidade, vencimentos…"
              />
            </label>
          </div>
          <aside className="result-card quote-result-card">
            <span className="eyebrow">RESUMO DA COTAÇÃO</span>
            <Metric label="Total final" value={currency(quoteTotal)} emphasis />
            <div className="result-grid">
              <Metric label="Preço de sistema" value={currency(quoteSubtotal)} />
              <Metric label="Desconto concedido" value={currency(quoteDiscount)} />
            </div>
            <div className="quote-summary-list">
              {quoteItems.filter((item) => item.product.trim()).map((item) => (
                <div key={`summary-${item.id}`}>
                  <span>{item.product}</span>
                  <strong>{currency(quoteItemTotal(item))}</strong>
                </div>
              ))}
            </div>
            <label className="quote-watermark-toggle">
              <input
                type="checkbox"
                checked={quoteWatermark}
                disabled={!profile.watermark}
                onChange={(event) => setQuoteWatermark(event.target.checked)}
              />
              <span>
                Usar marca d’água da empresa
                <small>
                  {profile.watermark
                    ? "A intensidade definida no perfil será aplicada."
                    : "Adicione a marca em Meu perfil para habilitar."}
                </small>
              </span>
            </label>
            <button
              className="button secondary full-button"
              onClick={() => void persistQuote()}
            >
              Salvar cotação
            </button>
            <button
              className="button primary full-button"
              disabled={!quoteDueDate}
              onClick={downloadQuote}
            >
              <Icon name="file" size={18} /> Gerar PDF da cotação
            </button>
            {!quoteDueDate && (
              <small className="legal-note">
                Preencha a data de vencimento para liberar o PDF.
              </small>
            )}
            <small className="legal-note">
              O arquivo usa um cabeçalho comercial próprio. Ele apresenta
              o volume final, o valor unitário e o preço final de cada item,
              além da empresa e do responsável configurados em Meu perfil.
            </small>
            {recordMessage && <small className="record-message">{recordMessage}</small>}
          </aside>
        </section>
      )}

      <section className="manuals-section">
        <div className="section-heading">
          <div><span className="eyebrow">BIBLIOTECA TÉCNICA</span><h2>Manuais de fabricantes</h2></div>
          <small>Links oficiais · confira sempre o modelo e o número de série</small>
        </div>
        <div className="manual-grid">
          {manuals.map((manual) => (
            <a key={`${manual.maker}-${manual.model}`} href={manual.href} target="_blank" rel="noreferrer">
              <div className="manual-logo">{manual.maker.slice(0, 2).toUpperCase()}</div>
              <div><span>{manual.maker}</span><strong>{manual.model}</strong><small>{manual.detail}</small></div>
              <Icon name="external" size={18} />
            </a>
          ))}
        </div>
      </section>
    </>
  );
}

function LabelsPage({
  query,
  setQuery,
  filtered,
  onCamera,
}: {
  query: string;
  setQuery: (value: string) => void;
  filtered: Product[];
  onCamera: () => void;
}) {
  const [catalog, setCatalog] =
    useState<"all" | "agrofit" | "commercial" | "foliar" | "problem">("all");
  const [officialTargets, setOfficialTargets] = useState<OfficialTarget[]>([]);
  const [officialTargetCount, setOfficialTargetCount] = useState(0);
  const [officialTargetTotal, setOfficialTargetTotal] = useState(2000);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<OfficialTarget | null>(null);
  const [targetProducts, setTargetProducts] = useState<OfficialTargetProduct[]>([]);
  const [targetProductLoading, setTargetProductLoading] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [showAllTargetProducts, setShowAllTargetProducts] = useState(false);
  const normalizedQuery = normalizeOcrText(query);
  const visibleProducts =
    (catalog === "all" || catalog === "agrofit") && query.trim() ? filtered.slice(0, 60) : [];
  const commercialMatches = query.trim()
    ? commercialAgrochemicals.filter((item) =>
        normalizeOcrText(
          `${item.name} ${item.active} ${item.maker}`,
        ).includes(normalizedQuery),
      )
    : [];
  const visibleCommercial =
    catalog === "all" || catalog === "commercial" ? commercialMatches.slice(0, 80) : [];
  const foliarMatches = query.trim()
    ? foliarProducts.filter((item) =>
        normalizeOcrText(
          `${item.name} ${item.maker} ${item.category} ${item.guarantee} ${item.composition} ${item.description}`,
        ).includes(normalizedQuery),
      )
    : [];
  const visibleFoliar =
    catalog === "all" || catalog === "foliar" ? foliarMatches.slice(0, 80) : [];
  const visibleProblems =
    catalog === "problem" && query.trim()
      ? problemGuides.filter((problem) =>
          normalizeOcrText(
            `${problem.name} ${problem.scientificName} ${problem.aliases.join(" ")} ${problem.crops.join(" ")}`,
          ).includes(normalizedQuery),
        )
      : [];

  useEffect(() => {
    if (catalog !== "problem" || normalizedQuery.length < 2) {
      setOfficialTargets([]);
      setOfficialTargetCount(0);
      setTargetError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTargetLoading(true);
      setTargetError("");
      setSelectedTarget(null);
      setTargetProducts([]);
      void fetch(`/api/agro/targets?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as {
            items?: OfficialTarget[];
            count?: number;
            totalTargets?: number;
            error?: string;
          };
          if (!response.ok) throw new Error(data.error || "Falha ao consultar os alvos.");
          setOfficialTargets(data.items ?? []);
          setOfficialTargetCount(data.count ?? 0);
          setOfficialTargetTotal(data.totalTargets ?? 2000);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setOfficialTargets([]);
          setOfficialTargetCount(0);
          setTargetError(error instanceof Error ? error.message : "Falha ao consultar os alvos.");
        })
        .finally(() => setTargetLoading(false));
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalog, normalizedQuery, query]);

  async function openOfficialTarget(target: OfficialTarget) {
    setSelectedTarget(target);
    setTargetProducts([]);
    setTargetError("");
    setTargetProductLoading(true);
    setShowAllTargetProducts(false);
    setIncludeUnavailable(false);
    try {
      const response = await fetch(`/api/agro/targets?id=${encodeURIComponent(target.id)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        products?: OfficialTargetProduct[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Falha ao consultar os produtos.");
      setTargetProducts(data.products ?? []);
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : "Falha ao consultar os produtos.");
    } finally {
      setTargetProductLoading(false);
    }
  }

  const selectableTargetProducts = targetProducts.filter((product) =>
    includeUnavailable
      ? true
      : normalizeOcrText(product.status).startsWith("liberado"),
  );
  const visibleTargetProducts = selectableTargetProducts.slice(
    0,
    showAllTargetProducts ? selectableTargetProducts.length : 60,
  );
  const resultCount =
    catalog === "all"
      ? filtered.length + commercialMatches.length + foliarMatches.length
      : catalog === "agrofit"
      ? filtered.length
      : catalog === "commercial"
        ? commercialMatches.length
        : catalog === "foliar"
          ? foliarMatches.length
          : officialTargetCount + visibleProblems.length;
  const catalogTotal =
    catalog === "all"
      ? products.length + commercialAgrochemicals.length + foliarProducts.length
      : catalog === "agrofit"
      ? products.length
      : catalog === "commercial"
        ? commercialAgrochemicals.length
        : catalog === "foliar"
          ? foliarProducts.length
          : officialTargetTotal;

  return (
    <>
      <div className="page-heading labels-simple-heading">
        <span className="eyebrow">BASE TÉCNICA PESQUISÁVEL</span>
        <h1>Qual produto você procura?</h1>
        <p>
          Pesquise defensivos, nutrição foliar e biológicos por marca,
          ingrediente ou pelo problema observado na lavoura.
        </p>
      </div>
      <div className="catalog-tabs" role="tablist" aria-label="Fonte do catálogo">
        <button
          className={catalog === "all" ? "active" : ""}
          onClick={() => setCatalog("all")}
        >
          Todos
        </button>
        <button
          className={catalog === "agrofit" ? "active" : ""}
          onClick={() => setCatalog("agrofit")}
        >
          Agrofit / MAPA
        </button>
        <button
          className={catalog === "commercial" ? "active" : ""}
          onClick={() => setCatalog("commercial")}
        >
          Agroquímicos
        </button>
        <button
          className={catalog === "foliar" ? "active" : ""}
          onClick={() => setCatalog("foliar")}
        >
          Nutrição foliar
        </button>
        <button
          className={catalog === "problem" ? "active" : ""}
          onClick={() => setCatalog("problem")}
        >
          Problema / alvo
        </button>
      </div>
      <section className="label-search-hero">
        <label className="search-box search-box-large">
          <Icon name="search" size={24} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              catalog === "problem"
                ? "Ex.: pé de galinha, buva, ferrugem, percevejo…"
                : catalog === "foliar"
                ? "Ex.: Biotrop, ICL, Utrisha N, boro…"
                : catalog === "agrofit"
                ? "Ex.: glifosato, ingrediente, fabricante ou registro…"
                : "Ex.: Nativo, Engeo Pleno, glifosato…"
            }
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Limpar busca">
              <Icon name="close" size={18} />
            </button>
          )}
        </label>
        <button className="camera-search-button" onClick={onCamera}>
          <Icon name="camera" size={20} />
          <span>Buscar pela foto do rótulo</span>
        </button>
      </section>
      <section className="catalog-trust">
        <div>
          <strong>{catalogTotal.toLocaleString("pt-BR")} {catalog === "problem" ? "alvos oficiais" : "produtos"}</strong>
          <span>
            {catalog === "all"
              ? "busca combinada nas fontes oficiais, comerciais e de nutrição"
              : catalog === "problem"
              ? "pragas, doenças, plantas daninhas, nematoides e outros problemas"
              : catalog === "agrofit"
              ? "catálogo importado da base pública oficial"
              : catalog === "commercial"
                ? "marcas e concentrações para pesquisa rápida"
                : "portfólios pesquisados em fontes das fabricantes"}
          </span>
        </div>
        <div>
          <strong>Conteúdo utilizado</strong>
          <span>
            {catalog === "all"
              ? "marca, registro, ingrediente, fabricante, composição e garantia"
              : catalog === "problem"
              ? "nome comum, científico, sinônimos, situação, empresa e classificação"
              : catalog === "commercial"
              ? "marca, ingrediente ativo e concentração"
              : catalog === "foliar"
                ? "composição, garantia publicada e fonte"
                : "registro, ingrediente, cultura e fabricante"}
          </span>
        </div>
        <a href={AGROFIT_URL} target="_blank" rel="noreferrer">
          Consulta oficial <Icon name="external" size={17} />
        </a>
      </section>
      {query.trim() && (
        <div className="results-meta">
          <span>{resultCount} {catalog === "problem" ? "alvos encontrados" : "produtos encontrados"}</span>
          <small>
            {targetLoading && catalog === "problem"
              ? "consultando base oficial…"
              : `mostrando os primeiros ${
                  catalog === "all"
                    ? visibleProducts.length + visibleCommercial.length + visibleFoliar.length
                    : catalog === "agrofit"
                    ? visibleProducts.length
                    : catalog === "commercial"
                      ? visibleCommercial.length
                      : catalog === "foliar"
                        ? visibleFoliar.length
                        : officialTargets.length + visibleProblems.length
                }`}
          </small>
        </div>
      )}
      <section className="product-grid">
        {(catalog === "all" || catalog === "agrofit") && visibleProducts.map((product) => (
          <article key={`${product.registration}-${product.name}`}>
            <div className="product-top">
              <span className={`type-tag type-${slug(product.type)}`}>{product.type}</span>
              <span>Registro {product.registration}</span>
            </div>
            <h3>{product.name}</h3>
            <p>{product.active}</p>
            <div className="crop-list">
              {product.crops.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className="source-caption">
              <Icon name="check" size={15} />
              {product.maker}
            </div>
            <a href={AGROFIT_URL} target="_blank" rel="noreferrer">
              Abrir consulta oficial
              <Icon name="external" size={17} />
            </a>
          </article>
        ))}
        {(catalog === "all" || catalog === "commercial") &&
          visibleCommercial.map((product) => (
            <article key={product.id}>
              <div className="product-top">
                <span className="type-tag">AGROQUÍMICO</span>
                <span>{product.maker}</span>
              </div>
              <h3>{product.name}</h3>
              <p>{product.active}</p>
              <div className="source-caption">
                <Icon name="check" size={15} />
                {product.maker}
              </div>
              <a href={AGROFIT_URL} target="_blank" rel="noreferrer">
                Conferir bula vigente
                <Icon name="external" size={17} />
              </a>
            </article>
          ))}
        {(catalog === "all" || catalog === "foliar") &&
          visibleFoliar.map((product) => (
            <article key={product.id}>
              <div className="product-top">
                <span className="type-tag">{product.category}</span>
                <span>{product.maker}</span>
              </div>
              <h3>{product.name}</h3>
              {product.composition && <p>{product.composition}</p>}
              {product.description && <small>{product.description}</small>}
              <div
                className={`source-caption ${
                  product.guarantee ? "" : "warning-caption"
                }`}
              >
                <Icon name={product.guarantee ? "check" : "book"} size={15} />
                {product.guarantee
                  ? `Garantia: ${product.guarantee}`
                  : "Garantia completa não publicada na página consultada"}
              </div>
              <small>{product.note}</small>
              {product.source && (
                <a href={product.source} target="_blank" rel="noreferrer">
                  Abrir fonte do fabricante
                  <Icon name="external" size={17} />
                </a>
              )}
            </article>
          ))}
        {catalog === "problem" && selectedTarget && (
          <article className="problem-guide-card official-target-expanded">
            <div className="product-top">
              <span className="type-tag">CONSULTA OFICIAL DO ALVO</span>
              <button className="text-button" onClick={() => setSelectedTarget(null)}>Fechar</button>
            </div>
            <h3>{selectedTarget.commonNames || selectedTarget.scientificName}</h3>
            <p className="problem-scientific-name">{selectedTarget.scientificName}</p>
            <div className="official-target-summary">
              <span><b>{targetProducts.filter((item) => normalizeOcrText(item.status).startsWith("liberado")).length}</b> liberados ou com restrição</span>
              <span><b>{targetProducts.length}</b> vínculos encontrados</span>
              <label><input type="checkbox" checked={includeUnavailable} onChange={(event) => setIncludeUnavailable(event.target.checked)} /> Incluir suspensos e cancelados</label>
            </div>
            {targetProductLoading && <div className="target-loading">Consultando produtos vinculados na base oficial…</div>}
            {!targetProductLoading && targetError && <div className="admin-message">{targetError}</div>}
            {!targetProductLoading && visibleTargetProducts.length > 0 && (
              <div className="official-target-products">
                {visibleTargetProducts.map((product, index) => {
                  const localProduct = agrofitProductsByName.get(normalizeCatalogName(product.name));
                  return (
                    <div className="problem-product" key={`${product.name}-${product.registrant}-${index}`}>
                      <div>
                        <b>{product.name}</b>
                        <span>{localProduct?.active || product.registrant}</span>
                        <small>
                          {product.status} · {product.toxicologicalClass}
                          {localProduct?.registration ? ` · Registro MAPA ${localProduct.registration}` : ""}
                        </small>
                        {localProduct?.crops.length ? <small>Culturas no catálogo MAPA: {localProduct.crops.join(", ")}</small> : null}
                      </div>
                      {product.source ? (
                        <a href={product.source} target="_blank" rel="noreferrer">Abrir cadastro <Icon name="external" size={16} /></a>
                      ) : <span className="target-no-link">Sem link ativo</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {!targetProductLoading && selectableTargetProducts.length > 60 && !showAllTargetProducts && (
              <button className="button secondary" onClick={() => setShowAllTargetProducts(true)}>Mostrar todos os {selectableTargetProducts.length} produtos</button>
            )}
            {!targetProductLoading && !targetError && selectableTargetProducts.length === 0 && (
              <div className="target-loading">Nenhum produto liberado foi encontrado para este alvo. Ative “Incluir suspensos e cancelados” para conferir todo o histórico.</div>
            )}
            <div className="problem-warning">A vinculação vem da consulta oficial da ADAPAR. Antes de recomendar, confirme no Agrofit/MAPA a cultura, modalidade, dose, estádio, restrições e vigência do registro.</div>
          </article>
        )}
        {catalog === "problem" && officialTargets.map((target) => (
          <article className={`problem-guide-card official-target-card ${selectedTarget?.id === target.id ? "selected" : ""}`} key={`official-${target.id}`}>
            <div className="product-top">
              <span className="type-tag">ALVO OFICIAL</span>
              <span>ADAPAR</span>
            </div>
            <h3>{target.commonNames || target.scientificName}</h3>
            <p className="problem-scientific-name">{target.scientificName}</p>
            <div className="card-actions">
              <button className="button secondary" onClick={() => void openOfficialTarget(target)}>Ver produtos registrados</button>
              <a href={target.source} target="_blank" rel="noreferrer">Ficha do alvo <Icon name="external" size={16} /></a>
            </div>
          </article>
        ))}
        {catalog === "problem" &&
          visibleProblems.map((problem) => (
            <article className="problem-guide-card" key={problem.id}>
              <div className="product-top">
                <span className="type-tag">PROBLEMA / ALVO</span>
                <span>{problem.crops.join(" · ")}</span>
              </div>
              <h3>{problem.name}</h3>
              <p className="problem-scientific-name">{problem.scientificName}</p>
              <div className="problem-guide-section">
                <strong>Produtos com fonte de registro/bula</strong>
                {problem.products.map((product) => (
                  <div className="problem-product" key={`${problem.id}-${product.name}`}>
                    <div>
                      <b>{product.name}</b>
                      <span>{product.active}</span>
                      <small>
                        {product.registration ? `Registro ${product.registration} · ` : ""}
                        {product.crops}
                      </small>
                    </div>
                    <a href={product.source} target="_blank" rel="noreferrer">
                      Conferir fonte <Icon name="external" size={16} />
                    </a>
                  </div>
                ))}
              </div>
              <div className="problem-guide-section">
                <strong>Trabalhos técnicos</strong>
                {problem.studies.map((study) => (
                  <a
                    className="problem-study"
                    href={study.source}
                    target="_blank"
                    rel="noreferrer"
                    key={`${problem.id}-${study.title}`}
                  >
                    <span>{study.title}</span>
                    <small>{study.institution} · {study.year}</small>
                    <Icon name="external" size={16} />
                  </a>
                ))}
              </div>
              <div className="problem-warning">
                Confirme no Agrofit se cultura, alvo, modalidade e registro continuam vigentes antes de recomendar.
              </div>
            </article>
          ))}
        {query.trim() && resultCount === 0 && (
          <div className="empty-state">
            <Icon name="search" size={34} />
            <strong>{catalog === "problem" ? "Nenhum alvo encontrado" : "Nenhum produto encontrado"}</strong>
            <p>
              {catalog === "problem"
                ? targetError || "Tente o nome comum, científico ou outro sinônimo do alvo."
                : "Tente parte da marca, ingrediente ativo ou número do registro."}
            </p>
          </div>
        )}
      </section>
      <p className="disclaimer">
        Preços, prazos e condições comerciais não são exibidos. Para defensivos,
        confirme a bula e o registro vigente; para fertilizantes, inoculantes e
        biológicos, confirme a garantia e a recomendação no rótulo comercializado.
      </p>
    </>
  );
}

function SoilPage({
  onCamera,
  onFile,
  draft,
  setDraft,
  importState,
  producers,
  profile,
  analyses,
  linkActorId,
  onSave,
  onClear,
}: {
  onCamera: () => void;
  onFile: (file: File) => void;
  draft: SoilDraft | null;
  setDraft: (draft: SoilDraft | null) => void;
  importState: SoilImportState;
  producers: Producer[];
  profile: ProfessionalProfile;
  analyses: SoilAnalysis[];
  linkActorId: string;
  onSave: (analysis: SoilAnalysis) => void;
  onClear: () => void;
}) {
  const selectedProducer = producers.find(
    (producer) => producer.id === draft?.producerId,
  );
  const selectedField = selectedProducer?.fields.find(
    (field) => field.id === draft?.fieldId,
  );
  const recognizedCount = draft
    ? Object.values(draft.values).filter((value) => value.trim()).length
    : 0;
  const interpretation = draft ? interpretSoilDraft(draft) : [];
  const goodIndicators = interpretation.filter((item) => item.status === "adequate");
  const improvementIndicators = interpretation.filter((item) =>
    ["critical", "low", "attention"].includes(item.status),
  );
  const highIndicators = interpretation.filter((item) => item.status === "high");
  const priorityIndicators = interpretation.filter((item) =>
    ["critical", "low"].includes(item.status),
  );
  const selectedLinkTarget = draft ? soilLinkTarget(draft) : null;
  const selectedLinkState = selectedLinkTarget
    ? soilLinkStateFor(selectedLinkTarget)
    : "UNLINKED";
  const committedLinkTarget = draft?.linkProvenance?.target ?? selectedLinkTarget;
  const hasPendingLinkChange = Boolean(
    draft && selectedLinkTarget && committedLinkTarget &&
    !sameSoilLink(
      draft.linkState,
      committedLinkTarget,
      selectedLinkState,
      selectedLinkTarget,
    ),
  );

  function updateDraft(patch: Partial<SoilDraft>) {
    if (draft) setDraft({ ...draft, ...patch });
  }

  function updateMetric(key: SoilMetricKey, value: string) {
    if (!draft) return;
    const cleaned = value.replace(/[^\d,.-]/g, "");
    setDraft({
      ...draft,
      values: {
        ...draft.values,
        [key]: cleaned,
      },
      samples: draft.samples?.map((sample) =>
        sample.id === draft.activeSampleId
          ? { ...sample, values: { ...sample.values, [key]: cleaned } }
          : sample,
      ),
    });
  }

  function selectSample(sampleId: string) {
    if (!draft) return;
    const sample = draft.samples?.find((item) => item.id === sampleId);
    if (!sample) return;
    setDraft({
      ...draft,
      activeSampleId: sample.id,
      sampleCode: sample.code,
      depth: sample.depth,
      values: { ...sample.values },
    });
  }

  function selectProducer(producerId: string) {
    if (!draft) return;
    const producer = producers.find((item) => item.id === producerId);
    setDraft({
      ...draft,
      producerId,
      property: producer?.properties ?? "",
      fieldId: "",
    });
  }

  function confirmLink() {
    if (!draft) return;
    const next = soilLinkTarget(draft);
    const nextState = soilLinkStateFor(next);
    if (nextState === "UNLINKED") return;
    const previous = draft.linkProvenance?.target ?? soilLinkTarget(draft);
    const previousState = draft.linkState;
    const changedAt = new Date().toISOString();
    const version = Math.max(0, Number(draft.linkVersion) || 0) + 1;
    const entry: SoilLinkHistoryEntry = {
      version,
      action: previousState === "UNLINKED" ? "LINK" : "CHANGE",
      fromState: previousState,
      toState: nextState,
      from: previous,
      to: next,
      changedAt,
      actorId: linkActorId,
      source: "manual-do-agronomo",
    };
    setDraft({
      ...draft,
      linkState: nextState,
      linkVersion: version,
      linkHistory: [...draft.linkHistory, entry],
      linkProvenance: {
        source: "manual-do-agronomo",
        actorId: linkActorId,
        changedAt,
        reason: "USER_CONFIRMED",
        target: next,
      },
    });
  }

  function unlinkAnalysis() {
    if (!draft || draft.linkState === "UNLINKED") return;
    const previous = draft.linkProvenance?.target ?? soilLinkTarget(draft);
    const next = {
      producerId: "",
      property: draft.property,
      fieldId: "",
    } satisfies SoilLinkTarget;
    const changedAt = new Date().toISOString();
    const version = Math.max(0, Number(draft.linkVersion) || 0) + 1;
    const entry: SoilLinkHistoryEntry = {
      version,
      action: "UNLINK",
      fromState: draft.linkState,
      toState: "UNLINKED",
      from: previous,
      to: next,
      changedAt,
      actorId: linkActorId,
      source: "manual-do-agronomo",
    };
    setDraft({
      ...draft,
      producerId: "",
      fieldId: "",
      linkState: "UNLINKED",
      linkVersion: version,
      linkHistory: [...draft.linkHistory, entry],
      linkProvenance: {
        source: "manual-do-agronomo",
        actorId: linkActorId,
        changedAt,
        reason: "USER_CONFIRMED",
        target: next,
      },
    });
  }

  function saveAnalysis() {
    if (!draft || hasPendingLinkChange) return;
    onSave({
      ...draft,
      savedAt: new Date().toISOString(),
    });
  }

  function makeSoilAnalysisPdf() {
    if (!draft) return null;
    const items = interpretSoilDraft(draft);
    const producer = producers.find((item) => item.id === draft.producerId);
    const field = producer?.fields.find((item) => item.id === draft.fieldId);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 16;
    let y = 0;

    const addHeader = () => {
      doc.setFillColor(15, 55, 46);
      doc.rect(0, 0, pageWidth, 31, "F");
      doc.setTextColor(239, 248, 243);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("ANÁLISE E INTERPRETAÇÃO DE SOLO", margin, 13);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(
        `${profile.name || "Responsável técnico"}${profile.registration ? ` · ${profile.council} ${profile.registration}` : ""}`,
        margin,
        22,
      );
      doc.text(`VALOR 360 · ${new Date().toLocaleDateString("pt-BR")}`, pageWidth - margin, 22, { align: "right" });
      y = 41;
    };
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - 17) return;
      doc.addPage();
      addHeader();
    };
    const line = (label: string, value: string, x: number, width: number) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(94, 112, 106);
      doc.setFontSize(7);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(28, 49, 43);
      doc.setFontSize(9);
      doc.text(value || "Não informado", x, y + 5, { maxWidth: width });
    };

    addHeader();
    if (profile.watermark) {
      try {
        doc.saveGraphicsState();
        doc.setGState(new GState({ opacity: Math.min(Math.max(profile.watermarkOpacity / 100, 0.03), 0.16) }));
        doc.addImage(
          profile.watermark,
          profile.watermark.startsWith("data:image/jpeg") ? "JPEG" : "PNG",
          55,
          95,
          100,
          100,
          undefined,
          "FAST",
        );
        doc.restoreGraphicsState();
      } catch {
        // A análise continua exportável se a imagem local não puder ser incorporada.
      }
    }

    line("Produtor", producer?.name || draft.detectedProducerName || "Não vinculado", margin, 82);
    line("Propriedade / talhão", `${draft.property || "Não informada"}${field ? ` · ${field.name}` : ""}`, 108, 86);
    y += 15;
    line("Laboratório", draft.laboratory || draft.fileName, margin, 82);
    line("Amostra / profundidade", `${draft.sampleCode || "Sem código"} · ${draft.depth || "Sem profundidade"}`, 108, 86);
    y += 15;
    line("Contexto agronômico", `${draft.targetCrop || "Cultura não informada"}${draft.yieldTarget ? ` · meta ${draft.yieldTarget}` : ""} · ${draft.productionSystem || "Sistema não informado"}`, margin, 178);
    y += 14;

    doc.setDrawColor(205, 219, 212);
    doc.line(margin, y, pageWidth - margin, y);
    y += 9;
    doc.setTextColor(15, 55, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Indicadores interpretados", margin, y);
    y += 8;

    items.forEach((item) => {
      ensureSpace(25);
      const statusColor: [number, number, number] = item.status === "adequate"
        ? [70, 133, 76]
        : item.status === "high"
          ? [164, 104, 36]
          : [180, 73, 57];
      doc.setFillColor(244, 247, 245);
      doc.roundedRect(margin, y - 4, 178, 21, 2, 2, "F");
      doc.setTextColor(28, 49, 43);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(`${item.label} · ${item.value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${item.unit}`, margin + 4, y + 2, { maxWidth: 105 });
      doc.setTextColor(...statusColor);
      doc.text(item.statusLabel, pageWidth - margin - 4, y + 2, { align: "right" });
      doc.setTextColor(73, 91, 84);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.3);
      doc.text(doc.splitTextToSize(`${item.reason} Manejo: ${item.action}`, 168).slice(0, 2), margin + 4, y + 8);
      y += 25;
    });

    ensureSpace(32);
    doc.setTextColor(15, 55, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Plano preliminar por prioridade", margin, y);
    y += 8;
    const priorities = items.filter((item) => ["critical", "low"].includes(item.status)).slice(0, 6);
    if (!priorities.length) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(58, 85, 75);
      doc.setFontSize(8.5);
      doc.text("Sem limitação crítica entre os indicadores preenchidos. Trabalhar com manutenção e monitoramento.", margin, y, { maxWidth: 178 });
      y += 13;
    } else {
      priorities.forEach((item, index) => {
        ensureSpace(18);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(28, 49, 43);
        doc.setFontSize(8.5);
        doc.text(`${index + 1}. ${item.label} · ${item.statusLabel}`, margin, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(73, 91, 84);
        doc.setFontSize(7.5);
        const lines = doc.splitTextToSize(item.action, 174).slice(0, 2);
        doc.text(lines, margin + 4, y + 5);
        y += 8 + lines.length * 4;
      });
    }

    ensureSpace(26);
    doc.setFillColor(248, 246, 226);
    doc.roundedRect(margin, y, 178, 22, 2, 2, "F");
    doc.setTextColor(95, 72, 15);
    doc.setFontSize(7.3);
    doc.text(
      doc.splitTextToSize(
        "Documento técnico para conferência. Doses finais de corretivos e fertilizantes exigem método do laboratório, referência regional vigente, PRNT, cultura, produtividade e responsabilidade do profissional habilitado.",
        168,
      ),
      margin + 5,
      y + 7,
    );
    return doc;
  }

  function exportSoilPdf() {
    const doc = makeSoilAnalysisPdf();
    if (!doc || !draft) return;
    const safeName = (draft.sampleCode || draft.property || "analise-solo")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    doc.save(`${safeName || "analise-solo"}.pdf`);
  }

  function printSoilAnalysis() {
    const doc = makeSoilAnalysisPdf();
    if (!doc) return;
    const url = URL.createObjectURL(doc.output("blob"));
    const popup = window.open(url, "_blank");
    if (!popup) {
      URL.revokeObjectURL(url);
      return;
    }
    popup.opener = null;
    window.setTimeout(() => {
      popup.print();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 900);
  }

  return (
    <>
      <div className="page-heading labels-heading">
        <div>
          <span className="eyebrow">FERTILIDADE</span>
          <h1>Importação de análises de solo</h1>
          <p>
            Importe o laudo, confira cada valor reconhecido e vincule a análise
            ao produtor e ao talhão correto.
          </p>
        </div>
        <button className="button secondary" onClick={onCamera}>
          <Icon name="camera" size={18} />
          Fotografar análise
        </button>
      </div>

      <section className="soil-import-layout">
        <div className="soil-import-card">
          <div className="soil-import-heading">
            <span className="capture-icon"><Icon name="file" size={25} /></span>
            <div>
              <span className="eyebrow">NOVA IMPORTAÇÃO</span>
              <h2>Selecione o laudo do laboratório</h2>
              <p>PDF digital, JPG, PNG ou foto tirada pelo celular.</p>
            </div>
          </div>
          <label className="soil-file-drop">
            <input
              type="file"
              accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = "";
              }}
            />
            <Icon name="plus" size={21} />
            <span>
              <strong>Importar arquivo</strong>
              <small>Toque para procurar no aparelho</small>
            </span>
          </label>
          <button className="soil-camera-button" onClick={onCamera}>
            <Icon name="camera" size={20} />
            <span>
              <strong>Usar a câmera</strong>
              <small>Melhor para laudos impressos</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
          {importState.status !== "idle" && (
            <div
              className={`soil-import-status ${importState.status}`}
              role="status"
            >
              <Icon
                name={importState.status === "error" ? "close" : "check"}
                size={17}
              />
              <div>
                <strong>
                  {importState.status === "processing"
                    ? `Processando arquivo · ${importState.progress}%`
                    : importState.status === "error"
                      ? "Importação não concluída"
                      : "Arquivo lido"}
                </strong>
                <span>{importState.message}</span>
              </div>
              {importState.status === "processing" && (
                <i style={{ width: `${importState.progress}%` }} />
              )}
            </div>
          )}
        </div>

        <aside className="soil-import-guide">
          <span className="eyebrow">CONFERÊNCIA SEGURA</span>
          <h3>O sistema prepara; o agrônomo confirma</h3>
          <ol>
            <li><i>1</i><span><b>Importe</b> a tabela completa e legível.</span></li>
            <li><i>2</i><span><b>Revise</b> números, vírgulas, unidades e profundidade.</span></li>
            <li><i>3</i><span><b>Vincule</b> produtor, propriedade e talhão.</span></li>
            <li><i>4</i><span><b>Salve</b> somente após comparar com o laudo original.</span></li>
          </ol>
          <p>
            A leitura automática não interpreta recomendação de calagem ou
            adubação sem a confirmação do método e da referência regional.
          </p>
        </aside>
      </section>

      {draft && (
        <section className="soil-review">
          <div className="soil-review-header">
            <div>
              <span className="eyebrow">REVISÃO DO LAUDO</span>
              <h2>{draft.fileName}</h2>
              <p>
                {draft.sourceType} · {recognizedCount} de{" "}
                {soilMetricDefinitions.length} indicadores preenchidos
              </p>
            </div>
            <span className="review-required">
              <Icon name="check" size={15} />
              Conferência obrigatória
            </span>
          </div>

          <div className="soil-detection-summary">
            <div>
              <span>Tipo reconhecido</span>
              <strong>
                {draft.documentType || "Análise de solo"}
              </strong>
            </div>
            <div>
              <span>Produtor lido no documento</span>
              <strong>
                {draft.detectedProducerName || "Não identificado"}
              </strong>
            </div>
            {draft.extractionWarnings?.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>

          {Boolean(draft.samples?.length) && (
            <div className="soil-sample-selector">
              <div>
                <span className="eyebrow">AMOSTRAS RECONHECIDAS</span>
                <strong>Selecione a linha que deseja revisar e interpretar</strong>
              </div>
              <nav aria-label="Amostras do laudo">
                {draft.samples?.map((sample) => (
                  <button
                    key={sample.id}
                    className={sample.id === draft.activeSampleId ? "active" : ""}
                    onClick={() => selectSample(sample.id)}
                  >
                    <b>{sample.label}</b>
                    <small>{sample.depth || "profundidade não lida"}</small>
                  </button>
                ))}
              </nav>
            </div>
          )}

          <div className="soil-identification-grid">
            <label className="field">
              <span>Produtor</span>
              <select
                value={draft.producerId}
                onChange={(event) => selectProducer(event.target.value)}
              >
                <option value="">Selecione o produtor</option>
                {producers.map((producer) => (
                  <option key={producer.id} value={producer.id}>
                    {producer.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label="Propriedade"
              value={draft.property}
              onChange={(property) => updateDraft({ property })}
              placeholder="Nome da propriedade"
            />
            <label className="field">
              <span>Talhão</span>
              <select
                value={draft.fieldId}
                onChange={(event) => updateDraft({ fieldId: event.target.value })}
              >
                <option value="">Selecione ou cadastre no produtor</option>
                {selectedProducer?.fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Data da amostragem</span>
              <input
                type="date"
                value={draft.sampleDate}
                onChange={(event) =>
                  updateDraft({ sampleDate: event.target.value })
                }
              />
            </label>
            <TextField
              label="Laboratório"
              value={draft.laboratory}
              onChange={(laboratory) => updateDraft({ laboratory })}
              placeholder="Nome do laboratório"
            />
            <TextField
              label="Código da amostra"
              value={draft.sampleCode}
              onChange={(sampleCode) => updateDraft({ sampleCode })}
              placeholder="Código no laudo"
            />
            <TextField
              label="Profundidade"
              value={draft.depth}
              onChange={(depth) => updateDraft({ depth })}
              placeholder="Ex.: 0–20 cm"
            />
            <TextField
              label="Método do pH"
              value={draft.phMethod || ""}
              onChange={(phMethod) => updateDraft({ phMethod })}
              placeholder="Ex.: H₂O ou CaCl₂"
            />
            <TextField
              label="Método do fósforo"
              value={draft.phosphorusMethod || ""}
              onChange={(phosphorusMethod) => updateDraft({ phosphorusMethod })}
              placeholder="Ex.: Mehlich-1 ou resina"
            />
            {selectedField && (
              <div className="soil-field-link">
                <span>Área vinculada</span>
                <strong>{selectedField.name}</strong>
                <small>
                  {selectedField.area.toLocaleString("pt-BR")} ha ·{" "}
                  {selectedField.crop || "cultura não informada"}
                </small>
              </div>
            )}
          </div>

          <section className={`soil-link-governance ${draft.linkState.toLocaleLowerCase("pt-BR")}`}>
            <div className="soil-link-summary">
              <span>Vínculo auditável</span>
              <strong>{soilLinkStateLabels[draft.linkState]}</strong>
              <small>
                Versão {draft.linkVersion} · as medições e o laudo original não são alterados pelo vínculo.
              </small>
              {hasPendingLinkChange && (
                <p>
                  Há uma seleção pendente para {soilLinkStateLabels[selectedLinkState].toLocaleLowerCase("pt-BR")}. Confirme o vínculo antes de salvar.
                </p>
              )}
            </div>
            <div className="soil-link-actions">
              <button
                type="button"
                className="button secondary"
                onClick={confirmLink}
                disabled={selectedLinkState === "UNLINKED" || !hasPendingLinkChange}
              >
                {draft.linkState === "UNLINKED" ? "Vincular análise" : "Alterar vínculo"}
              </button>
              {draft.linkState !== "UNLINKED" && (
                <button
                  type="button"
                  className="button secondary danger"
                  onClick={unlinkAnalysis}
                >
                  Desvincular
                </button>
              )}
            </div>
            {draft.linkHistory.length > 0 && (
              <details className="soil-link-history">
                <summary>Ver histórico do vínculo ({draft.linkHistory.length})</summary>
                <ol>
                  {[...draft.linkHistory].reverse().map((entry) => (
                    <li key={`${entry.version}-${entry.changedAt}-${entry.action}`}>
                      <b>v{entry.version} · {entry.action}</b>
                      <span>{soilLinkStateLabels[entry.fromState]} → {soilLinkStateLabels[entry.toState]}</span>
                      <time>{new Date(entry.changedAt).toLocaleString("pt-BR")}</time>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>

          <section className="soil-context-panel">
            <div>
              <span className="eyebrow">CONTEXTO PARA O MANEJO</span>
              <h3>Personalize a interpretação</h3>
              <p>As faixas mudam com método, região, cultura, produtividade e sistema.</p>
            </div>
            <label className="field">
              <span>Cultura-alvo</span>
              <select
                value={draft.targetCrop || "Soja"}
                onChange={(event) => updateDraft({ targetCrop: event.target.value })}
              >
                {['Soja', 'Milho', 'Trigo', 'Canola', 'Arroz irrigado', 'Pastagem', 'Outra'].map((crop) => (
                  <option key={crop} value={crop}>{crop}</option>
                ))}
              </select>
            </label>
            <TextField
              label="Produtividade-alvo"
              value={draft.yieldTarget || ""}
              onChange={(yieldTarget) => updateDraft({ yieldTarget })}
              placeholder="Ex.: 75 sc/ha"
            />
            <label className="field">
              <span>Sistema</span>
              <select
                value={draft.productionSystem || "Plantio direto"}
                onChange={(event) => updateDraft({ productionSystem: event.target.value })}
              >
                {['Plantio direto', 'Convencional', 'Irrigado', 'Integração lavoura-pecuária', 'Pastagem'].map((system) => (
                  <option key={system} value={system}>{system}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Referência regional</span>
              <select
                value={draft.regionalReference || "CQFS-RS/SC"}
                onChange={(event) => updateDraft({ regionalReference: event.target.value })}
              >
                <option value="CQFS-RS/SC">CQFS-RS/SC</option>
                <option value="IAC-SP">IAC-SP</option>
                <option value="Revisão manual">Revisão manual</option>
              </select>
            </label>
          </section>

          <div className="soil-metric-groups">
            {(
              [
                "Acidez e CTC",
                "Macronutrientes",
                "Micronutrientes",
                "Textura",
              ] as SoilMetricDefinition["group"][]
            ).map((group) => (
              <section key={group} className="soil-metric-group">
                <div className="soil-group-title">
                  <h3>{group}</h3>
                  <span>
                    {
                      soilMetricDefinitions.filter(
                        (metric) =>
                          metric.group === group &&
                          (draft.values[metric.key] ?? "").trim(),
                      ).length
                    }{" "}
                    preenchidos
                  </span>
                </div>
                <div className="soil-metric-grid">
                  {soilMetricDefinitions
                    .filter((metric) => metric.group === group)
                    .map((metric) => (
                      <label
                        key={metric.key}
                        className={
                          draft.values[metric.key]
                            ? "soil-metric-field detected"
                            : "soil-metric-field"
                        }
                      >
                        <span>
                          <b>{metric.shortLabel}</b>
                          <small>{metric.unit || "índice"}</small>
                        </span>
                        <input
                          inputMode="decimal"
                          value={draft.values[metric.key] ?? ""}
                          onChange={(event) =>
                            updateMetric(metric.key, event.target.value)
                          }
                          placeholder="—"
                          aria-label={`${metric.label} em ${metric.unit || "índice"}`}
                        />
                      </label>
                    ))}
                </div>
              </section>
            ))}
          </div>

          {interpretation.length > 0 && (
            <section className="soil-interpretation">
              <header>
                <div>
                  <span className="eyebrow">DIAGNÓSTICO DE FERTILIDADE</span>
                  <h2>O que está bom e o que pode melhorar</h2>
                  <p>
                    {draft.sampleCode || "Amostra selecionada"} · {draft.depth} · {draft.targetCrop || "cultura não informada"}
                    {draft.yieldTarget ? ` · meta ${draft.yieldTarget}` : ""}
                  </p>
                </div>
                <div className="soil-score-summary">
                  <span><b>{goodIndicators.length}</b> bons</span>
                  <span><b>{improvementIndicators.length}</b> a melhorar</span>
                  <span><b>{highIndicators.length}</b> altos</span>
                </div>
              </header>

              <div className="soil-indicator-list">
                {interpretation.map((item) => (
                  <article key={item.key} className={`soil-indicator ${item.status}`}>
                    <div className="soil-indicator-value">
                      <span>{item.label}</span>
                      <strong>{item.value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</strong>
                      <small>{item.unit || "índice"}</small>
                    </div>
                    <div className="soil-indicator-reading">
                      <b>{item.statusLabel}</b>
                      <p>{item.reason}</p>
                      <small>{item.action}</small>
                    </div>
                  </article>
                ))}
              </div>

              <div className="soil-management-plan">
                <div>
                  <span className="eyebrow">MANEJO DE CORREÇÃO PERSONALIZADO</span>
                  <h3>Plano preliminar por prioridade</h3>
                </div>
                {priorityIndicators.length ? (
                  <ol>
                    {priorityIndicators.slice(0, 6).map((item, index) => (
                      <li key={`priority-${item.key}`}>
                        <i>{index + 1}</i>
                        <div>
                          <strong>{item.label} · {item.statusLabel}</strong>
                          <p>{item.action}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="soil-plan-ok">
                    <Icon name="check" size={21} />
                    <div><strong>Sem limitação crítica nos indicadores preenchidos</strong><p>Trabalhe com manutenção pela produtividade e confirme os itens não solicitados no laudo.</p></div>
                  </div>
                )}
                <div className="soil-management-stages">
                  <div><b>Antes do plantio</b><span>Confirmar método, unidade, profundidade, histórico de corretivos e produtividade-alvo.</span></div>
                  <div><b>Na adubação</b><span>Separar correção de teor, manutenção pela exportação e segurança de aplicação.</span></div>
                  <div><b>Durante a cultura</b><span>Validar limitações com raízes, sintomas, análise foliar e distribuição no talhão.</span></div>
                </div>
              </div>
              <small className="soil-interpretation-note">
                Triagem técnica baseada nos valores preenchidos e em faixas gerais. A dose final de calcário, gesso ou fertilizante exige confirmação do método do laboratório, recomendação regional vigente, PRNT, cultura, produtividade e responsabilidade do profissional habilitado. N não é classificado por análise rotineira de solo; use histórico, matéria orgânica, cultura anterior e diagnóstico da cultura.
              </small>
            </section>
          )}

          <details className="soil-raw-text">
            <summary>Ver texto extraído para conferência</summary>
            <pre>{draft.rawText || "Nenhum texto reconhecido."}</pre>
          </details>

          <div className="soil-review-actions">
            <button className="button secondary" onClick={onClear}>
              Descartar importação
            </button>
            <button className="button secondary" onClick={exportSoilPdf} disabled={recognizedCount === 0}>
              <Icon name="file" size={18} /> Exportar PDF
            </button>
            <button className="button secondary" onClick={printSoilAnalysis} disabled={recognizedCount === 0}>
              Imprimir
            </button>
            <button
              className="button primary"
              onClick={saveAnalysis}
              disabled={recognizedCount === 0 || hasPendingLinkChange}
            >
              <Icon name="check" size={18} />
              Conferir e salvar análise
            </button>
          </div>
          <small className="legal-note soil-legal-note">
            {hasPendingLinkChange
              ? "Confirme Vincular análise, Alterar vínculo ou Desvincular antes de salvar. "
              : ""}
            Compare cada campo com o documento original. Métodos de extração,
            unidades e classes de interpretação variam entre laboratórios e regiões.
          </small>
        </section>
      )}

      <section className="soil-flow compact">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FLUXO ORGANIZADO</span>
            <h2>Do arquivo ao histórico do talhão</h2>
          </div>
        </div>
        <div className="flow-steps">
          {[
            ["01", "Importação", "PDF digital ou imagem do laudo"],
            ["02", "Extração", "Indicadores localizados no documento"],
            ["03", "Revisão", "Números, unidades e profundidade"],
            ["04", "Vínculo", "Produtor, propriedade e talhão"],
            ["05", "Histórico", "Base pronta para comparação futura"],
          ].map(([n, title, description]) => (
            <div key={n}><i>{n}</i><strong>{title}</strong><span>{description}</span></div>
          ))}
        </div>
      </section>
      <section className="panel recent-soil">
        <div className="panel-title">
          <div>
            <span className="eyebrow">HISTÓRICO REAL</span>
            <h3>Análises conferidas</h3>
          </div>
          <span className="history-count">
            {analyses.length} {analyses.length === 1 ? "análise" : "análises"}
          </span>
        </div>
        {analyses.length ? (
          analyses.map((analysis) => {
            const producer = producers.find(
              (item) => item.id === analysis.producerId,
            );
            const field = producer?.fields.find(
              (item) => item.id === analysis.fieldId,
            );
            return (
              <button
                className="soil-row"
                key={analysis.id}
                onClick={() => setDraft(normalizeSoilAnalysis({ ...analysis }))}
              >
                <span className="soil-icon"><Icon name="layers" /></span>
                <div>
                  <strong>
                    {field?.name || analysis.sampleCode || "Análise sem talhão"}
                  </strong>
                  <small>
                    {producer?.name || "Produtor não vinculado"} ·{" "}
                    {analysis.laboratory || analysis.fileName} · {analysis.depth}
                  </small>
                  <span className={`soil-link-state ${analysis.linkState.toLocaleLowerCase("pt-BR")}`}>
                    {soilLinkStateLabels[analysis.linkState]} · v{analysis.linkVersion}
                  </span>
                </div>
                <time>
                  {new Date(`${analysis.sampleDate}T12:00:00`).toLocaleDateString(
                    "pt-BR",
                  )}
                </time>
                <Icon name="arrow" size={18} />
              </button>
            );
          })
        ) : (
          <div className="soil-empty-history">
            <Icon name="layers" size={30} />
            <strong>Nenhuma análise salva</strong>
            <p>As análises conferidas aparecerão aqui, sem dados demonstrativos.</p>
          </div>
        )}
      </section>
    </>
  );
}

function ProducersPage({
  producers,
  setProducers,
  syncStatus,
  onSyncAttention,
  onUse,
}: {
  producers: Producer[];
  setProducers: (items: Producer[]) => void;
  syncStatus: "loading" | "saving" | "saved" | "attention" | "offline";
  onSyncAttention: () => void;
  onUse: (producer: Producer) => void;
}) {
  const empty: Producer = {
    id: "",
    name: "",
    crmCode: "",
    document: "",
    phone: "",
    email: "",
    city: "",
    properties: "",
    area: 0,
    cultures: [],
    notes: "",
    fields: [],
    registrations: [],
  };
  const [draft, setDraft] = useState<Producer>(empty);
  const [editing, setEditing] = useState(false);
  const [openProducerId, setOpenProducerId] = useState("");
  const [selectedProducerId, setSelectedProducerId] = useState("");
  const visible = producers;
  const selectedProducer =
    visible.find((producer) => producer.id === selectedProducerId) ?? visible[0] ?? null;

  function save() {
    if (!draft.name.trim()) return;
    const item = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      cultures: Array.isArray(draft.cultures) ? draft.cultures : [],
      registrations: Array.isArray(draft.registrations) ? draft.registrations : [],
    };
    setProducers(
      draft.id
        ? producers.map((producer) => (producer.id === draft.id ? item : producer))
        : [item, ...producers],
    );
    void saveRecord({
      type: "producer_change",
      title: `${draft.id ? "Produtor atualizado" : "Produtor cadastrado"} · ${item.name}`,
      producerName: item.name,
      payload: {
        producerId: item.id,
        crmCode: item.crmCode,
        city: item.city,
        property: item.properties,
        areaHa: item.area,
        savedAt: new Date().toISOString(),
      },
    }).catch(onSyncAttention);
    setDraft(empty);
    setEditing(false);
  }

  return (
    <>
      <div className="page-heading page-heading-actions">
        <div>
          <span className="eyebrow">BASE DE CLIENTES</span>
          <h1>Produtores</h1>
          <p>Cadastre contatos e propriedades uma vez e reutilize os dados nos atendimentos e relatórios.</p>
        </div>
        <button className="button primary" onClick={() => setEditing(true)}>
          <Icon name="plus" size={18} /> Novo produtor
        </button>
      </div>

      <section className="producer-toolbar producer-cloud-toolbar">
        <span>{producers.length} clientes cadastrados</span>
        <span className={"cloud-sync-badge " + syncStatus}><Icon name="cloud" size={17} />{{ loading: "Carregando dados da nuvem…", saving: "Salvando na nuvem…", saved: "Backup e integração VAL atualizados", attention: "Backup salvo; integração VAL requer atenção", offline: "Sem nuvem: usando cache local" }[syncStatus]}</span>
      </section>

      <ProducerCrmImport
        producers={producers}
        onImport={(items) =>
          setProducers([
            ...(items as unknown as Producer[]),
            ...producers,
          ])
        }
      />

      {editing && (
        <section className="content-panel producer-form">
          <div className="panel-title">
            <div><span className="eyebrow">CADASTRO SIMPLES</span><h2>{draft.id ? "Editar produtor" : "Novo produtor"}</h2></div>
            <button className="icon-button" onClick={() => { setDraft(empty); setEditing(false); }}><Icon name="close" /></button>
          </div>
          <div className="form-grid">
            <TextField label="Nome do produtor *" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Nome completo ou razão social" />
            <TextField label="Código no CRM" value={draft.crmCode ?? ""} onChange={(crmCode) => setDraft({ ...draft, crmCode })} placeholder="Código interno do cliente" />
            <TextField label="CPF/CNPJ" value={draft.document} onChange={(document) => setDraft({ ...draft, document })} placeholder="Opcional" />
            <TextField label="WhatsApp" type="tel" value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} placeholder="(55) 99999-9999" />
            <TextField label="E-mail" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} placeholder="produtor@email.com" />
            <TextField label="Município/UF" value={draft.city} onChange={(city) => setDraft({ ...draft, city })} placeholder="São Luiz Gonzaga/RS" />
            <TextField label="Propriedade principal" value={draft.properties} onChange={(properties) => setDraft({ ...draft, properties })} placeholder="Fazenda / grupo de propriedades" />
            <NumberField label="Área atendida" value={draft.area} onChange={(area) => setDraft({ ...draft, area })} unit="ha" />
            <TextField label="Observações" value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} placeholder="Perfil, culturas e pontos importantes" />
          </div>
          <div className="form-actions">
            <button className="button secondary" onClick={() => { setDraft(empty); setEditing(false); }}>Cancelar</button>
            <button className="button primary" disabled={!draft.name.trim()} onClick={save}><Icon name="check" size={18} /> Salvar produtor</button>
          </div>
        </section>
      )}

      <section className="content-panel producer-selection-panel">
        <label className="field producer-select-field">
          <span>Buscar e selecionar produtor</span>
          <div className="input-wrap">
            <select
              value={selectedProducer?.id ?? ""}
              onChange={(event) => setSelectedProducerId(event.target.value)}
            >
              {!visible.length && <option value="">Nenhum produtor cadastrado</option>}
              {visible.map((producer) => (
                <option key={producer.id} value={producer.id}>
                  {producer.name + (producer.city ? " · " + producer.city : "")}
                </option>
              ))}
            </select>
          </div>
          <small>A carteira permanece recolhida; somente o produtor escolhido é exibido.</small>
        </label>

        {selectedProducer ? (
          <article className="producer-card producer-card-selected">
            <div className="producer-card-head"><div className="avatar">{selectedProducer.name.slice(0, 2).toUpperCase()}</div><div><h3>{selectedProducer.name}</h3><span>{selectedProducer.city || "Município não informado"}</span></div>{selectedProducer.mappingStatus === "pending" && <b className="mapping-pending">MAPA PENDENTE</b>}</div>
            <div className="producer-facts">
              <span><b>{selectedProducer.area.toLocaleString("pt-BR")} ha</b>Área atendida</span>
              <span><b>{selectedProducer.fields?.length ?? 0}</b>Áreas mapeadas</span>
              <span><b>{selectedProducer.registrations?.length ?? 0}</b>Matrículas</span>
            </div>
            <p><b>{selectedProducer.properties || "Propriedade não informada"}</b></p>
            <p>{selectedProducer.phone || "WhatsApp não informado"}{selectedProducer.email ? " · " + selectedProducer.email : ""}</p>
            <div className="card-actions">
              <button onClick={() => setOpenProducerId(selectedProducer.id)}>Matrículas, áreas e NDVI</button>
              <button onClick={() => onUse(selectedProducer)}>Criar recomendação</button>
              <button onClick={() => { setDraft(selectedProducer); setEditing(true); }}>Editar</button>
            </div>
          </article>
        ) : (
          <div className="empty-state"><Icon name="users" size={32} /><h3>Sua base de clientes começa aqui</h3><p>Importe a carteira ou cadastre o primeiro produtor.</p></div>
        )}
      </section>

      {openProducerId && (
        <ProducerFieldsPanel
          producer={producers.find((producer) => producer.id === openProducerId) ?? producers[0]}
          onClose={() => setOpenProducerId("")}
          onChange={(nextProducer) =>
            setProducers(
              producers.map((producer) =>
                producer.id === nextProducer.id
                  ? {
                      ...nextProducer,
                      mappingStatus: nextProducer.fields.some(
                        (field) => field.points.length >= 3,
                      )
                        ? "mapped"
                        : nextProducer.mappingStatus,
                    }
                  : producer,
              ),
            )
          }
        />
      )}
    </>
  );
}

function calculatePolygonArea(points: MapPoint[]) {
  if (points.length < 3) return 0;
  const meanLat =
    points.reduce((total, point) => total + point.lat, 0) / points.length;
  const metersPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const metersPerLat = 110540;
  let twiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const x1 = point.lng * metersPerLng;
    const y1 = point.lat * metersPerLat;
    const x2 = next.lng * metersPerLng;
    const y2 = next.lat * metersPerLat;
    twiceArea += x1 * y2 - x2 * y1;
  });
  return Math.abs(twiceArea) / 2 / 10000;
}

function ndviTileUrl(itemId: string) {
  return spectralTileUrl(itemId, "NDVI");
}

function ndviPreviewUrl(itemId: string) {
  return spectralPreviewUrl(itemId, "NDVI");
}

function ProducerFieldsPanel({
  producer,
  onChange,
  onClose,
}: {
  producer: Producer;
  onChange: (producer: Producer) => void;
  onClose: () => void;
}) {
  const fields = producer.fields ?? [];
  const [activeFieldId, setActiveFieldId] = useState(fields[0]?.id ?? "");
  const [manualLat, setManualLat] = useState(-28.41);
  const [manualLng, setManualLng] = useState(-54.96);
  const [ndviStart, setNdviStart] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return localDateValue(date);
  });
  const [ndviEnd, setNdviEnd] = useState(() => localDateValue());
  const [ndviLoading, setNdviLoading] = useState(false);
  const [ndviError, setNdviError] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [spectralIndex, setSpectralIndex] =
    useState<VegetationIndex>("NDVI");
  const activeField =
    fields.find((field) => field.id === activeFieldId) ?? fields[0];
  const activeScene =
    activeField?.ndviScenes.find((scene) => scene.id === selectedSceneId) ??
    activeField?.ndviScenes[0];

  function updateField(patch: Partial<FieldPlot>) {
    if (!activeField) return;
    onChange({
      ...producer,
      fields: fields.map((field) =>
        field.id === activeField.id ? { ...field, ...patch } : field,
      ),
    });
  }

  function updatePoints(points: MapPoint[]) {
    updateField({
      points,
      area: points.length >= 3 ? Number(calculatePolygonArea(points).toFixed(2)) : activeField?.area ?? 0,
      ndviScenes: [],
    });
    setSelectedSceneId("");
  }

  function addField() {
    const field: FieldPlot = {
      id: crypto.randomUUID(),
      name: `Área ${fields.length + 1}`,
      crop: "Soja",
      season: "",
      area: 0,
      points: [],
      ndviScenes: [],
    };
    onChange({ ...producer, fields: [...fields, field] });
    setActiveFieldId(field.id);
    setSelectedSceneId("");
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setNdviError("A localização não está disponível neste navegador.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        updatePoints([
          ...(activeField?.points ?? []),
          {
            lat: Number(coords.latitude.toFixed(6)),
            lng: Number(coords.longitude.toFixed(6)),
          },
        ]),
      () =>
        setNdviError(
          "Não foi possível obter a localização. Verifique a permissão do navegador.",
        ),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function importGeoJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const geometry =
          data.type === "FeatureCollection"
            ? data.features?.[0]?.geometry
            : data.type === "Feature"
              ? data.geometry
              : data;
        const coordinates =
          geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;
        if (!Array.isArray(coordinates)) throw new Error("Polígono não encontrado");
        const isClosed =
          coordinates.length > 1 &&
          coordinates[0]?.[0] === coordinates.at(-1)?.[0] &&
          coordinates[0]?.[1] === coordinates.at(-1)?.[1];
        const points = coordinates
          .slice(0, isClosed ? -1 : undefined)
          .map(([lng, lat]: [number, number]) => ({ lat, lng }))
          .filter(
            (point: MapPoint) =>
              Number.isFinite(point.lat) && Number.isFinite(point.lng),
          );
        if (points.length < 3) throw new Error("Polígono incompleto");
        updatePoints(points);
        setNdviError("");
      } catch {
        setNdviError(
          "O arquivo precisa conter um polígono GeoJSON válido em longitude/latitude.",
        );
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function loadNdvi() {
    if (!activeField || activeField.points.length < 3) {
      setNdviError("Cadastre pelo menos três pontos para buscar o NDVI.");
      return;
    }
    if (!ndviStart || !ndviEnd) {
      setNdviError("Informe o período de busca das imagens.");
      return;
    }
    if (ndviStart > ndviEnd) {
      setNdviError("A data inicial precisa ser anterior à data final.");
      return;
    }
    setNdviLoading(true);
    setNdviError("");
    try {
      const lats = activeField.points.map((point) => point.lat);
      const lngs = activeField.points.map((point) => point.lng);
      const response = await fetch(
        "https://planetarycomputer.microsoft.com/api/stac/v1/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collections: ["sentinel-2-l2a"],
            bbox: [
              Math.min(...lngs),
              Math.min(...lats),
              Math.max(...lngs),
              Math.max(...lats),
            ],
            datetime: `${ndviStart}T00:00:00Z/${ndviEnd}T23:59:59Z`,
            limit: 18,
            query: { "eo:cloud_cover": { lt: 35 } },
            sortby: [{ field: "properties.datetime", direction: "desc" }],
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Consulta satelital indisponível (${response.status})`);
      }
      const data = (await response.json()) as {
        features?: Array<{
          id: string;
          properties?: {
            datetime?: string;
            "eo:cloud_cover"?: number;
          };
        }>;
      };
      const bestSceneByDate = new Map<
        string,
        NonNullable<typeof data.features>[number]
      >();
      for (const item of data.features ?? []) {
        const date = item.properties?.datetime?.slice(0, 10);
        if (!date) continue;
        const current = bestSceneByDate.get(date);
        const cloud = Number(item.properties?.["eo:cloud_cover"] ?? 100);
        const currentCloud = Number(
          current?.properties?.["eo:cloud_cover"] ?? 100,
        );
        if (!current || cloud < currentCloud) bestSceneByDate.set(date, item);
      }
      const scenes = Array.from(bestSceneByDate.values())
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          date: item.properties?.datetime ?? "",
          cloud: Number(item.properties?.["eo:cloud_cover"] ?? 0),
          tileUrl: ndviTileUrl(item.id),
          previewUrl: ndviPreviewUrl(item.id),
        }));
      if (!scenes.length) {
        setNdviError(
          "Nenhuma cena Sentinel-2 com menos de 35% de nuvens foi encontrada nesse período.",
        );
        return;
      }
      updateField({ ndviScenes: scenes });
      setSelectedSceneId(scenes[0].id);
    } catch (error) {
      setNdviError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar as imagens neste momento.",
      );
    } finally {
      setNdviLoading(false);
    }
  }

  if (!activeField) {
    return (
      <section className="content-panel fields-panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">PRODUTOR · {producer.name}</span>
            <h2>Áreas e monitoramento</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <Icon name="close" />
          </button>
      </div>
      <ProducerLandRegistry
        producerName={producer.name}
        registrations={producer.registrations ?? []}
        fields={fields}
        onRegistrationsChange={(registrations) =>
          onChange({ ...producer, registrations })
        }
        onFieldsChange={(items) =>
          onChange({
            ...producer,
            fields: items.map((item) => {
              const previous = fields.find((field) => field.id === item.id);
              return {
                ...previous,
                ...item,
                season: previous?.season ?? "",
                ndviScenes: previous?.ndviScenes ?? [],
              };
            }),
          })
        }
      />
      <div className="empty-state">
          <Icon name="map" size={34} />
          <strong>Nenhuma área vinculada</strong>
          <p>Crie o primeiro talhão dentro deste produtor.</p>
          <button className="button primary" onClick={addField}>
            <Icon name="plus" size={17} /> Nova área
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="content-panel fields-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PRODUTOR · {producer.name}</span>
          <h2>Áreas, coordenadas e NDVI</h2>
        </div>
        <button className="icon-button" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <ProducerLandRegistry
        producerName={producer.name}
        registrations={producer.registrations ?? []}
        fields={fields}
        onRegistrationsChange={(registrations) =>
          onChange({ ...producer, registrations })
        }
        onFieldsChange={(items) =>
          onChange({
            ...producer,
            fields: items.map((item) => {
              const previous = fields.find((field) => field.id === item.id);
              return {
                ...previous,
                ...item,
                season: previous?.season ?? "",
                ndviScenes: previous?.ndviScenes ?? [],
              };
            }),
          })
        }
      />
      <div className="field-tabs">
        {fields.map((field) => (
          <button
            key={field.id}
            className={field.id === activeField.id ? "active" : ""}
            onClick={() => {
              setActiveFieldId(field.id);
              setSelectedSceneId(field.ndviScenes[0]?.id ?? "");
              setSpectralIndex("NDVI");
              setNdviError("");
            }}
          >
            <strong>{field.name}</strong>
            <small>{field.area.toLocaleString("pt-BR")} ha · {field.crop}</small>
          </button>
        ))}
        <button className="add-field-tab" onClick={addField}>
          <Icon name="plus" size={16} /> Nova área
        </button>
      </div>
      <div className="field-manager-grid">
        <div className="field-map-column">
          <FieldMap
            points={activeField.points}
            onChange={updatePoints}
            referencePolygons={(producer.registrations ?? [])
              .filter((registration) => registration.id === activeField.registrationId)
              .map((registration) => ({
                id: registration.id,
                label: `Matrícula ${registration.number || registration.propertyName}`,
                points: registration.points,
              }))}
            ndviTileUrl={
              activeScene
                ? spectralTileUrl(activeScene.id, spectralIndex)
                : undefined
            }
          />
          <div className="map-legend">
            <span><i className="ndvi-low" /> {spectralIndex} baixo</span>
            <span><i className="ndvi-mid" /> intermediário</span>
            <span><i className="ndvi-high" /> alto</span>
            <small>
              {activeScene
                ? `${spectralIndex} · Sentinel-2 · ${new Date(activeScene.date).toLocaleDateString("pt-BR")} · nuvens ${activeScene.cloud.toFixed(1)}%`
                : "Mapa cadastral; selecione uma cena para sobrepor o índice."}
            </small>
          </div>
        </div>
        <div className="field-data-column">
          <div className="field-grid-form">
            <TextField
              label="Nome da área"
              value={activeField.name}
              onChange={(name) => updateField({ name })}
            />
            <TextField
              label="Cultura"
              value={activeField.crop}
              onChange={(crop) => updateField({ crop })}
            />
            <TextField
              label="Safra"
              value={activeField.season}
              onChange={(season) => updateField({ season })}
            />
            <NumberField
              label="Área calculada"
              value={activeField.area}
              onChange={(area) => updateField({ area })}
              unit="ha"
            />
          </div>
          <div className="coordinate-actions">
            <button className="button secondary" onClick={useCurrentLocation}>
              <Icon name="map" size={17} /> Usar GPS
            </button>
            <label className="button secondary file-button">
              Importar GeoJSON
              <input type="file" accept=".geojson,.json,application/geo+json" onChange={importGeoJson} />
            </label>
          </div>
          <div className="manual-coordinate">
            <NumberField label="Latitude" value={manualLat} onChange={setManualLat} min={-90} max={90} />
            <NumberField label="Longitude" value={manualLng} onChange={setManualLng} min={-180} max={180} />
            <button
              className="button secondary"
              onClick={() =>
                updatePoints([
                  ...activeField.points,
                  { lat: manualLat, lng: manualLng },
                ])
              }
            >
              <Icon name="plus" size={16} /> Adicionar ponto
            </button>
          </div>
          <div className="coordinate-list">
            {activeField.points.map((point, index) => (
              <div key={`${point.lat}-${point.lng}-${index}`}>
                <b>P{index + 1}</b>
                <span>{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</span>
                <button
                  aria-label={`Remover ponto ${index + 1}`}
                  onClick={() =>
                    updatePoints(
                      activeField.points.filter((_, pointIndex) => pointIndex !== index),
                    )
                  }
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="ndvi-controls">
            <div>
              <span className="eyebrow">SENTINEL-2 · HISTÓRICO</span>
              <h3>Buscar imagens NDVI</h3>
              <p>Use períodos diferentes para comparar safras e anos.</p>
            </div>
            <div className="field-grid-form">
              <label className="field">
                <span>Data inicial</span>
                <div className="input-wrap">
                  <input type="date" value={ndviStart} onChange={(event) => setNdviStart(event.target.value)} />
                </div>
              </label>
              <label className="field">
                <span>Data final</span>
                <div className="input-wrap">
                  <input type="date" value={ndviEnd} onChange={(event) => setNdviEnd(event.target.value)} />
                </div>
              </label>
            </div>
            <button className="button primary full-button" disabled={ndviLoading} onClick={loadNdvi}>
              {ndviLoading ? "Consultando satélite…" : "Atualizar imagens NDVI"}
            </button>
            {ndviError && <p className="field-error">{ndviError}</p>}
            <div className="ndvi-scenes">
              {activeField.ndviScenes.map((scene) => (
                <button
                  key={scene.id}
                  className={activeScene?.id === scene.id ? "active" : ""}
                  onClick={() => setSelectedSceneId(scene.id)}
                >
                  <img src={scene.previewUrl} alt={`NDVI de ${scene.date}`} />
                  <span>
                    <strong>{new Date(scene.date).toLocaleDateString("pt-BR")}</strong>
                    <small>Nuvens {scene.cloud.toFixed(1)}%</small>
                  </span>
                </button>
              ))}
            </div>
            <small className="legal-note">
              Índice calculado com bandas B08 e B04 do Sentinel-2 L2A. As cenas
              devem ser conferidas quanto a nuvens, sombras e recorte antes de
              qualquer decisão agronômica.
            </small>
          </div>
          <FieldInsights
            producerName={producer.name}
            fieldName={activeField.name}
            points={activeField.points}
            scenes={activeField.ndviScenes}
            activeScene={activeScene}
            index={spectralIndex}
            onIndexChange={setSpectralIndex}
          />
        </div>
      </div>
    </section>
  );
}

type FeedbackItem = {
  id: string;
  category: "suggestion" | "problem";
  module: string;
  title: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  adminNote?: string;
  createdAt: string;
};

function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackItem["category"]>("suggestion");
  const [moduleKey, setModuleKey] = useState("inicio");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  async function loadFeedback() {
    setLoading(true);
    try {
      const response = await fetch("/api/feedback", { cache: "no-store" });
      const data = (await response.json()) as { feedback?: FeedbackItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os feedbacks.");
      setItems(data.feedback ?? []);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Não foi possível carregar os feedbacks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFeedback();
  }, []);

  async function submitFeedback() {
    setSending(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, module: moduleKey, title, message }),
      });
      const data = (await response.json()) as { feedback?: FeedbackItem; error?: string };
      if (!response.ok || !data.feedback) {
        throw new Error(data.error || "Não foi possível enviar o feedback.");
      }
      setTitle("");
      setMessage("");
      setStatusMessage("Feedback enviado ao administrador.");
      await loadFeedback();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Não foi possível enviar o feedback.");
    } finally {
      setSending(false);
    }
  }

  const statusLabels: Record<FeedbackItem["status"], string> = {
    open: "Recebido",
    in_progress: "Em análise",
    resolved: "Resolvido",
  };

  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">CANAL DIRETO COM A EQUIPE</span>
        <h1>Sugestões e problemas</h1>
        <p>Envie melhorias ou relate algo que precisa ser corrigido. O feedback fica vinculado à sua conta e chega diretamente ao painel administrativo.</p>
      </div>
      <section className="feedback-layout">
        <div className="content-panel feedback-form">
          <div className="panel-title">
            <div><span className="eyebrow">NOVO FEEDBACK</span><h2>Como podemos melhorar?</h2></div>
          </div>
          <div className="feedback-kind" role="group" aria-label="Tipo de feedback">
            <button className={category === "suggestion" ? "active" : ""} onClick={() => setCategory("suggestion")}>
              <Icon name="leaf" size={18} /> Sugestão
            </button>
            <button className={category === "problem" ? "active problem" : ""} onClick={() => setCategory("problem")}>
              <Icon name="close" size={18} /> Problema
            </button>
          </div>
          <div className="form-grid">
            <label className="field"><span>Módulo relacionado</span><select value={moduleKey} onChange={(event) => setModuleKey(event.target.value)}>{nav.filter((item) => !["feedback", "administracao", "perfil"].includes(item.key)).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <TextField label="Título" value={title} onChange={setTitle} placeholder="Resumo em uma frase" />
          </div>
          <label className="field"><span>Descrição *</span><textarea value={message} maxLength={5000} onChange={(event) => setMessage(event.target.value)} placeholder={category === "problem" ? "Conte o que aconteceu, o que esperava e em qual etapa ocorreu." : "Explique sua ideia e como ela ajudaria no trabalho de campo."} /></label>
          <div className="feedback-submit">
            <small>{message.length}/5000 caracteres</small>
            <button className="button primary" disabled={sending || !title.trim() || message.trim().length < 10} onClick={() => void submitFeedback()}>
              {sending ? "Enviando…" : "Enviar ao administrador"}
            </button>
          </div>
          {statusMessage && <p className="record-message">{statusMessage}</p>}
        </div>
        <aside className="content-panel feedback-history">
          <div className="panel-title"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Meus envios</h2></div>{loading && <small>Atualizando…</small>}</div>
          <div className="feedback-list">
            {items.map((item) => (
              <article key={item.id}>
                <div><span className={`feedback-status ${item.status}`}>{statusLabels[item.status]}</span><small>{new Date(item.createdAt).toLocaleDateString("pt-BR")}</small></div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{item.category === "problem" ? "Problema" : "Sugestão"} · {nav.find((entry) => entry.key === item.module)?.label || item.module || "Geral"}</small>
                {item.adminNote && <blockquote><b>Retorno do administrador</b>{item.adminNote}</blockquote>}
              </article>
            ))}
            {!loading && !items.length && <div className="feedback-empty"><Icon name="check" size={26} /><strong>Nenhum feedback enviado</strong><p>Seus próximos envios aparecerão aqui com o andamento.</p></div>}
          </div>
        </aside>
      </section>
    </>
  );
}

function ProfessionalPage({
  profile,
  setProfile,
  onSave,
}: {
  profile: ProfessionalProfile;
  setProfile: (profile: ProfessionalProfile) => void;
  onSave: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  function uploadWatermark(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 2_000_000) {
      event.target.value = "";
      setSaveError("Use uma imagem PNG ou JPG de até 2 MB.");
      return;
    }
    setSaveError("");
    const reader = new FileReader();
    reader.onload = () => setProfile({ ...profile, watermark: String(reader.result) });
    reader.readAsDataURL(file);
  }
  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar o perfil.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">IDENTIDADE PROFISSIONAL</span>
        <h1>Meu perfil e relatórios</h1>
        <p>Estes dados identificam o responsável técnico e serão aplicados automaticamente aos documentos.</p>
      </div>
      <div className="profile-layout">
        <section className="content-panel">
          <div className="panel-title"><div><span className="eyebrow">DADOS PROFISSIONAIS</span><h2>Responsável técnico</h2></div><span className="verified-chip"><Icon name="check" size={14} /> Perfil vinculado à conta</span></div>
          <div className="form-grid">
            <TextField label="Nome do assinante" value={profile.name} onChange={() => undefined} readOnly hint="Preenchido automaticamente pelo cadastro de acesso." />
            <TextField label="E-mail de acesso" value={profile.email} onChange={() => undefined} readOnly hint="Vinculado à conta autenticada." />
            <label className="field"><span>Profissão</span><select value={profile.profession} onChange={(event) => setProfile({ ...profile, profession: event.target.value as ProfessionalProfile["profession"] })}><option>Engenheiro Agrônomo</option><option>Técnico Agrícola</option></select></label>
            <label className="field"><span>Conselho</span><select value={profile.council} onChange={(event) => setProfile({ ...profile, council: event.target.value as ProfessionalProfile["council"] })}><option>CREA</option><option>CFTA</option></select></label>
            <TextField label={`Registro no ${profile.council}`} value={profile.registration} onChange={(registration) => setProfile({ ...profile, registration })} placeholder="Número e UF" />
            <TextField label="Empresa" value={profile.company} onChange={(company) => setProfile({ ...profile, company })} placeholder="Empresa ou atuação autônoma" />
            <TextField label="Telefone profissional" type="tel" value={profile.phone} onChange={(phone) => setProfile({ ...profile, phone })} />
          </div>
          <div className="form-actions"><button className="button primary" disabled={saving} onClick={() => void save()}><Icon name="check" size={18} /> {saving ? "Salvando…" : saved ? "Dados salvos" : "Salvar perfil"}</button></div>
          {saveError && <p className="field-error">{saveError}</p>}
        </section>
        <section className="content-panel">
          <div className="panel-title"><div><span className="eyebrow">PERSONALIZAÇÃO</span><h2>Marca d’água da empresa</h2></div></div>
          <label className="watermark-upload">
            {profile.watermark ? <img src={profile.watermark} alt="Marca d’água configurada" /> : <><Icon name="camera" size={28} /><b>Adicionar logotipo</b><span>PNG ou JPG com fundo transparente</span></>}
            <input type="file" accept="image/png,image/jpeg" onChange={uploadWatermark} />
          </label>
          <NumberField label="Intensidade da marca d’água" value={profile.watermarkOpacity} onChange={(watermarkOpacity) => setProfile({ ...profile, watermarkOpacity })} unit="%" min={3} max={25} />
          {profile.watermark && <button className="text-button danger" onClick={() => setProfile({ ...profile, watermark: "" })}>Remover marca d’água</button>}
          <div className="report-preview">
            {profile.watermark && <img src={profile.watermark} alt="" />}
            <span>VALOR 360</span><h3>Relatório técnico</h3><p>{profile.name || "Nome do profissional"}</p><small>{profile.council} {profile.registration || "registro"} · {profile.company || "empresa"}</small>
          </div>
        </section>
      </div>
      <section className="access-note"><Icon name="check" size={20} /><div><b>Personalização automática ativa</b><p>Nome e e-mail vêm do acesso autenticado. Os demais dados profissionais são sincronizados na nuvem desta conta e aplicados automaticamente em relatórios, cotações e recomendações.</p></div></section>
    </>
  );
}

function GateOneCompanyPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="page-heading company-heading">
        <span className="eyebrow">TECNOLOGIA APLICADA AO NEGÓCIO</span>
        <h1>{GATE_ONE_COMPANY.name}</h1>
        <p>{GATE_ONE_COMPANY.legalDescription}, responsável pelo desenvolvimento e evolução do Manual do Agrônomo.</p>
      </div>
      <section className="company-hero">
        <div className="company-mark" aria-hidden="true">
          <img src="/gate-one-pro-server.png" alt="" />
        </div>
        <div>
          <span className="eyebrow">SOBRE A EMPRESA</span>
          <h2>Soluções digitais que transformam processos em produtos simples de usar.</h2>
          <p>Desenvolvemos sistemas, automações e integrações digitais sob medida, com foco em operação, gestão e experiência do usuário.</p>
          <dl className="company-facts">
            <div><dt>Razão de atuação</dt><dd>{GATE_ONE_COMPANY.legalDescription}</dd></div>
            <div><dt>CNPJ</dt><dd>{GATE_ONE_COMPANY.cnpj}</dd></div>
            <div><dt>Produto</dt><dd>Manual do Agrônomo</dd></div>
          </dl>
        </div>
      </section>
      <section className="company-services">
        {[
          ["Desenvolvimento de software", "Aplicativos e sistemas web pensados para a rotina real de cada operação."],
          ["Automação e integrações", "Conexão entre dados, plataformas e tarefas para reduzir trabalho manual."],
          ["Soluções sob medida", "Produtos digitais personalizados conforme o processo e a identidade do negócio."],
          ["Suporte e evolução", "Acompanhamento contínuo para corrigir, aperfeiçoar e ampliar cada solução."],
        ].map(([title, description]) => (
          <article key={title}>
            <span><Icon name="check" size={18} /></span>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <section className="company-product-note">
        <div>
          <span className="eyebrow">PRODUTO GATE ONE</span>
          <h2>Manual do Agrônomo</h2>
          <p>Uma plataforma técnica criada para centralizar decisões agronômicas, análises, diagnósticos e relatórios com identidade profissional própria para cada assinante.</p>
        </div>
        <button className="button primary" onClick={onBack}>
          Voltar ao aplicativo
          <Icon name="arrow" size={17} />
        </button>
      </section>
    </>
  );
}

function SimplePage({
  eyebrow,
  title,
  description,
  cards,
}: {
  eyebrow: string;
  title: string;
  description: string;
  cards: string[][];
}) {
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <section className="simple-grid">
        {cards.map(([name, detail], index) => (
          <button key={name} className={index === cards.length - 1 ? "add-card" : ""}>
            <span className="simple-icon"><Icon name={index === cards.length - 1 ? "plus" : "leaf"} /></span>
            <div><strong>{name}</strong><small>{detail}</small></div>
            <Icon name="arrow" />
          </button>
        ))}
      </section>
    </>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatDecimal(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}
