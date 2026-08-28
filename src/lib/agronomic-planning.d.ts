export const BRAZIL_UFS: readonly string[];
export function regionForUf(uf: string): "Sul" | "Sudeste" | "Centro-Oeste" | "Nordeste" | "Norte";
export function locationLabel(municipality: string, uf: string): string;
export function estimateRegionalHarvest(input: Record<string, unknown>): null | Record<string, unknown>;
export function recommendPlantPopulation(input: Record<string, unknown>): Record<string, unknown>;
