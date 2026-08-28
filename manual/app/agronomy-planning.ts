import {
  BRAZIL_UFS as canonicalBrazilUfs,
  estimateRegionalHarvest as canonicalEstimateRegionalHarvest,
  locationLabel as canonicalLocationLabel,
  recommendPlantPopulation as canonicalRecommendPlantPopulation,
  regionForUf as canonicalRegionForUf,
} from "../../src/lib/agronomic-planning.js";

export type PlanningCrop = "Soja" | "Milho" | "Trigo" | "Canola";
export type BrazilRegion = "Sul" | "Sudeste" | "Centro-Oeste" | "Nordeste" | "Norte";
export type ProductionEnvironment = "restritivo" | "medio" | "alto";

export type PlanningCultivar = {
  name: string;
  cycleDays: number;
  cycleRangeDays: [number, number];
  cycleByMonth?: Record<string, number>;
  cycleClass?: string;
  gmr?: number | null;
  dataBasis?: string;
};

export type HarvestPlanningInput = {
  crop: PlanningCrop;
  cultivar: PlanningCultivar;
  plantingDate: string;
  municipality: string;
  uf: string;
  latitude?: number | null;
  harvestConditionDays?: number;
};

export type PopulationPlanningInput = {
  crop: PlanningCrop;
  cultivar: PlanningCultivar;
  plantingDate: string;
  municipality: string;
  uf: string;
  latitude?: number | null;
  environment: ProductionEnvironment;
  yieldGapPercent: number;
  germinationPercent: number;
  emergencePercent: number;
  spacingCm: number;
};

export const BRAZIL_UFS = canonicalBrazilUfs as readonly string[];
export const regionForUf = canonicalRegionForUf as (uf: string) => BrazilRegion;
export const locationLabel = canonicalLocationLabel as (municipality: string, uf: string) => string;
export const estimateRegionalHarvest = canonicalEstimateRegionalHarvest as unknown as (
  input: HarvestPlanningInput,
) => null | {
  region: BrazilRegion;
  location: string;
  plantedAt: Date;
  central: Date;
  start: Date;
  end: Date;
  baseCycleDays: number;
  regionalAdjustmentDays: number;
  municipalityAdjustmentDays: number;
  municipalityLatitude: number | null;
  seasonAdjustmentDays: number;
  harvestConditionDays: number;
  physiologicalCycleDays: number;
  centralCycleDays: number;
  startCycleDays: number;
  endCycleDays: number;
  seasonBasis: string;
  warnings: string[];
};
export const recommendPlantPopulation = canonicalRecommendPlantPopulation as unknown as (
  input: PopulationPlanningInput,
) => {
  region: BrazilRegion;
  location: string;
  municipalityLatitude: number | null;
  finalMin: number;
  finalTarget: number;
  finalMax: number;
  seedsPerHa: number;
  seedsPerMeter: number;
  finalPlantsPerMeter: number;
  establishmentPercent: number;
  spacingRangeCm: [number, number];
  outsideGeneralWindow: boolean;
  warnings: string[];
  explanations: string[];
};
