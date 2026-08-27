export const BRAZIL_UFS = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
    "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
    "SP", "SE", "TO",
];
const UF_REGION = {
    RS: "Sul", SC: "Sul", PR: "Sul",
    SP: "Sudeste", MG: "Sudeste", RJ: "Sudeste", ES: "Sudeste",
    MT: "Centro-Oeste", MS: "Centro-Oeste", GO: "Centro-Oeste", DF: "Centro-Oeste",
    BA: "Nordeste", SE: "Nordeste", AL: "Nordeste", PE: "Nordeste", PB: "Nordeste",
    RN: "Nordeste", CE: "Nordeste", PI: "Nordeste", MA: "Nordeste",
    AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
};
/*
 * Ajustes em dias sobre a referência do catálogo, majoritariamente construída
 * com materiais e ensaios do Sul. São premissas de planejamento e ficam
 * deliberadamente pequenas: temperatura, latitude e fotoperíodo mudam o ciclo,
 * mas não autorizam transformar uma cultivar não adaptada em recomendação local.
 */
const REGION_CYCLE_DAYS = {
    Soja: { Sul: 0, Sudeste: -5, "Centro-Oeste": -9, Nordeste: -11, Norte: -10 },
    Milho: { Sul: 0, Sudeste: -4, "Centro-Oeste": -7, Nordeste: -8, Norte: -7 },
    Trigo: { Sul: 0, Sudeste: -4, "Centro-Oeste": -6, Nordeste: -5, Norte: -4 },
    Canola: { Sul: 0, Sudeste: -3, "Centro-Oeste": -5, Nordeste: -4, Norte: -3 },
};
const REGION_REFERENCE_ABS_LATITUDE = {
    Sul: 27,
    Sudeste: 20.5,
    "Centro-Oeste": 16.5,
    Nordeste: 10,
    Norte: 5,
};
const LATITUDE_DAYS_PER_DEGREE = {
    Soja: 0.45,
    Milho: 0.25,
    Trigo: 0.2,
    Canola: 0.2,
};
const SEASON_DAYS = {
    // Plantios tardios de primavera/verão tendem a encurtar soja sensível ao fotoperíodo.
    Soja: { 1: -8, 2: -10, 3: -9, 4: -6, 5: 0, 6: 2, 7: 4, 8: 5, 9: 4, 10: 2, 11: 0, 12: -4 },
    // Para milho, o catálogo pode trazer observação específica por mês; esta tabela é o fallback.
    Milho: { 1: -5, 2: -4, 3: -2, 4: 2, 5: 5, 6: 7, 7: 6, 8: 3, 9: 1, 10: 0, 11: -2, 12: -4 },
    Trigo: { 1: -4, 2: -3, 3: -1, 4: 1, 5: 3, 6: 4, 7: 3, 8: 1, 9: -2, 10: -3, 11: -4, 12: -4 },
    Canola: { 1: -4, 2: -3, 3: -1, 4: 1, 5: 3, 6: 4, 7: 3, 8: 0, 9: -2, 10: -3, 11: -4, 12: -4 },
};
const GENERAL_SOWING_MONTHS = {
    Soja: {
        Sul: [10, 11, 12], Sudeste: [10, 11, 12], "Centro-Oeste": [9, 10, 11, 12],
        Nordeste: [10, 11, 12, 1], Norte: [10, 11, 12, 1],
    },
    Milho: {
        Sul: [8, 9, 10, 11, 12, 1], Sudeste: [9, 10, 11, 12, 1, 2, 3],
        "Centro-Oeste": [9, 10, 11, 12, 1, 2, 3], Nordeste: [10, 11, 12, 1, 2, 3],
        Norte: [10, 11, 12, 1, 2, 3],
    },
    Trigo: {
        Sul: [4, 5, 6, 7], Sudeste: [2, 3, 4, 5], "Centro-Oeste": [2, 3, 4, 5],
        Nordeste: [], Norte: [],
    },
    Canola: {
        Sul: [4, 5, 6], Sudeste: [2, 3, 4, 5], "Centro-Oeste": [2, 3, 4, 5],
        Nordeste: [], Norte: [],
    },
};
const POPULATION_BASE = {
    Soja: { min: 220_000, target: 270_000, max: 320_000, spacing: [40, 50] },
    Milho: { min: 58_000, target: 68_000, max: 78_000, spacing: [45, 50] },
    Trigo: { min: 2_500_000, target: 3_000_000, max: 3_500_000, spacing: [15, 20] },
    Canola: { min: 350_000, target: 420_000, max: 500_000, spacing: [17, 34] },
};
const POPULATION_REGION_FACTOR = {
    Soja: { Sul: 1.03, Sudeste: 1, "Centro-Oeste": 0.95, Nordeste: 0.94, Norte: 0.95 },
    Milho: { Sul: 1, Sudeste: 1.02, "Centro-Oeste": 1.03, Nordeste: 0.95, Norte: 0.96 },
    Trigo: { Sul: 1, Sudeste: 0.98, "Centro-Oeste": 0.97, Nordeste: 0.95, Norte: 0.95 },
    Canola: { Sul: 1, Sudeste: 0.98, "Centro-Oeste": 0.97, Nordeste: 0.95, Norte: 0.95 },
};
const ENVIRONMENT_FACTOR = {
    Soja: { restritivo: 1.03, medio: 1, alto: 0.98 },
    Milho: { restritivo: 0.91, medio: 1, alto: 1.07 },
    Trigo: { restritivo: 0.95, medio: 1, alto: 1.03 },
    Canola: { restritivo: 0.95, medio: 1, alto: 1.02 },
};
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}
function validBrazilLatitude(value) {
    const latitude = Number(value);
    return Number.isFinite(latitude) && latitude >= -34 && latitude <= 6 ? latitude : null;
}
export function regionForUf(uf) {
    return UF_REGION[String(uf || "").toUpperCase()] ?? "Sul";
}
export function locationLabel(municipality, uf) {
    return `${municipality.trim() || "Município não informado"}/${String(uf || "").toUpperCase() || "UF"}`;
}
export function estimateRegionalHarvest(input) {
    const plantedAt = validDate(input.plantingDate);
    if (!plantedAt)
        return null;
    const region = regionForUf(input.uf);
    const month = plantedAt.getMonth() + 1;
    const baseCycleDays = Math.max(1, Math.round(input.cultivar.cycleDays));
    const monthObservedCycle = input.cultivar.cycleByMonth?.[String(month)];
    const seasonAdjustmentDays = Number.isFinite(monthObservedCycle)
        ? Math.round(Number(monthObservedCycle) - baseCycleDays)
        : SEASON_DAYS[input.crop][month] ?? 0;
    const seasonBasis = Number.isFinite(monthObservedCycle)
        ? "observação do material para o mês de semeadura"
        : "premissa sazonal por cultura e mês";
    const regionalAdjustmentDays = REGION_CYCLE_DAYS[input.crop][region];
    const municipalityLatitude = validBrazilLatitude(input.latitude);
    const municipalityAdjustmentDays = municipalityLatitude === null
        ? 0
        : Math.round(clamp((Math.abs(municipalityLatitude) - REGION_REFERENCE_ABS_LATITUDE[region])
            * LATITUDE_DAYS_PER_DEGREE[input.crop], -3, 3));
    const harvestConditionDays = Math.max(0, Math.round(input.harvestConditionDays ?? 0));
    const physiologicalCycleDays = Math.max(45, baseCycleDays + regionalAdjustmentDays + municipalityAdjustmentDays + seasonAdjustmentDays);
    const centralCycleDays = physiologicalCycleDays + harvestConditionDays;
    const catalogMin = Math.max(1, input.cultivar.cycleRangeDays?.[0] ?? baseCycleDays - 7);
    const catalogMax = Math.max(catalogMin, input.cultivar.cycleRangeDays?.[1] ?? baseCycleDays + 7);
    const regionalUncertainty = region === "Sul" ? 3 : 5;
    const startCycleDays = Math.max(40, catalogMin + regionalAdjustmentDays + municipalityAdjustmentDays + seasonAdjustmentDays + harvestConditionDays - regionalUncertainty);
    const endCycleDays = Math.max(startCycleDays + 7, catalogMax + regionalAdjustmentDays + municipalityAdjustmentDays + seasonAdjustmentDays + harvestConditionDays + regionalUncertainty);
    const central = addDays(plantedAt, centralCycleDays);
    const start = addDays(plantedAt, startCycleDays);
    const end = addDays(plantedAt, endCycleDays);
    const usualMonths = GENERAL_SOWING_MONTHS[input.crop][region];
    const warnings = [
        municipalityLatitude === null
            ? `Estimativa para ${locationLabel(input.municipality, input.uf)} usando a macrorregião ${region}; o centroide municipal não foi resolvido e não houve ajuste de latitude.`
            : `O ajuste municipal usa a latitude aproximada do centroide IBGE (${municipalityLatitude.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}°) apenas como proxy fenológica; altitude, solo, água e microclima não são resolvidos automaticamente.`,
        "Os ajustes regionais são premissas conservadoras do modelo sobre a referência do catálogo, majoritariamente sul-brasileira; não são dias oficiais publicados pelo MAPA ou pelo obtentor.",
        "Confirme adaptação do material com o obtentor/RNC e valide a data de semeadura no ZARC vigente antes de recomendar.",
    ];
    if (!usualMonths.includes(month)) {
        warnings.unshift(usualMonths.length
            ? "A data informada está fora do calendário geral usado nesta aproximação regional; confira o ZARC municipal."
            : `A cultura não tem calendário geral consolidado para ${region} nesta ferramenta; o resultado é apenas uma simulação.`);
    }
    if (input.crop === "Soja" && region !== "Sul") {
        warnings.push("Na soja, latitude e fotoperíodo podem alterar fortemente altura, florescimento e ciclo; um GMR usado no Sul não equivale automaticamente ao mesmo desempenho em outra macrorregião.");
    }
    if ((input.crop === "Trigo" || input.crop === "Canola") && (region === "Norte" || region === "Nordeste")) {
        warnings.push("Trigo/canola fora das regiões de adaptação mais usuais exigem validação local específica; não use esta data como recomendação de cultivo.");
    }
    return {
        region,
        location: locationLabel(input.municipality, input.uf),
        plantedAt,
        central,
        start,
        end,
        baseCycleDays,
        regionalAdjustmentDays,
        municipalityAdjustmentDays,
        municipalityLatitude,
        seasonAdjustmentDays,
        harvestConditionDays,
        physiologicalCycleDays,
        centralCycleDays,
        startCycleDays,
        endCycleDays,
        seasonBasis,
        warnings,
    };
}
function materialFactor(crop, cultivar) {
    const cycle = (cultivar.cycleClass ?? "").toLocaleLowerCase("pt-BR");
    if (crop === "Soja") {
        if (cycle.includes("superprecoce"))
            return 1.05;
        if (cycle.includes("precoce"))
            return 1.025;
        if (cycle.includes("tard"))
            return 0.97;
    }
    return 1;
}
export function recommendPlantPopulation(input) {
    const region = regionForUf(input.uf);
    const municipalityLatitude = validBrazilLatitude(input.latitude);
    const base = POPULATION_BASE[input.crop];
    const plantedAt = validDate(input.plantingDate);
    const month = plantedAt ? plantedAt.getMonth() + 1 : null;
    const usualMonths = GENERAL_SOWING_MONTHS[input.crop][region];
    const outsideGeneralWindow = month !== null && !usualMonths.includes(month);
    const seasonFactor = outsideGeneralWindow ? 0.95 : 1;
    const gap = clamp(Number(input.yieldGapPercent) || 0, 0, 80);
    // População não corrige limitação de solo, água ou sanidade: gaps altos reduzem
    // a densidade-alvo em vez de induzir uma densificação potencialmente cara.
    const yieldGapFactor = gap > 30 ? 0.94 : gap > 15 ? 0.97 : 1;
    const combinedFactor = POPULATION_REGION_FACTOR[input.crop][region]
        * ENVIRONMENT_FACTOR[input.crop][input.environment]
        * materialFactor(input.crop, input.cultivar)
        * seasonFactor
        * yieldGapFactor;
    const finalTarget = Math.round((base.target * combinedFactor) / 1000) * 1000;
    const finalMin = Math.round((base.min * combinedFactor) / 1000) * 1000;
    const finalMax = Math.max(finalMin + 1_000, Math.round((base.max * combinedFactor) / 1000) * 1000);
    const germination = clamp(Number(input.germinationPercent) || 0, 1, 100) / 100;
    const emergence = clamp(Number(input.emergencePercent) || 0, 1, 100) / 100;
    const establishment = germination * emergence;
    const seedsPerHa = Math.ceil(finalTarget / establishment);
    const spacingCm = clamp(Number(input.spacingCm) || base.spacing[0], 5, 100);
    const seedsPerMeter = (seedsPerHa * (spacingCm / 100)) / 10_000;
    const finalPlantsPerMeter = (finalTarget * (spacingCm / 100)) / 10_000;
    const warnings = [
        "A faixa é uma referência de regulagem, não uma população oficial da cultivar. Priorize a recomendação vigente do obtentor para a microrregião.",
        "Os fatores de macrorregião, ciclo e ambiente são premissas explícitas do cenário informado; nenhum deles é apresentado como número do fabricante.",
        "Yield gap indica restrições do sistema; aumentar sementes não substitui correção de solo, água, sanidade, época ou qualidade de distribuição.",
    ];
    if (outsideGeneralWindow)
        warnings.unshift("Plantio fora do calendário geral da cultura/macrorregião: confirme ZARC e reduza a confiança da população calculada.");
    if (gap > 25)
        warnings.push("Yield gap acima de 25%: diagnostique primeiro os fatores limitantes e valide a densidade em faixa lado a lado.");
    if (input.germinationPercent < 80 || input.emergencePercent < 80)
        warnings.push("Germinação ou emergência abaixo de 80% eleva muito a compensação; confira teste do lote e condição do sulco.");
    if (spacingCm < base.spacing[0] || spacingCm > base.spacing[1])
        warnings.push(`Espaçamento fora da faixa geral de ${base.spacing[0]}–${base.spacing[1]} cm usada para ${input.crop.toLocaleLowerCase("pt-BR")}.`);
    if ((input.crop === "Trigo" || input.crop === "Canola") && (region === "Norte" || region === "Nordeste"))
        warnings.push("A adaptação regional desta cultura precisa ser confirmada em pesquisa/assistência local antes de definir população.");
    const explanations = [
        `Base da cultura: ${base.min.toLocaleString("pt-BR")}–${base.max.toLocaleString("pt-BR")} plantas/ha; alvo ${base.target.toLocaleString("pt-BR")}.`,
        `Material: ${input.cultivar.name} (${input.cultivar.cycleClass || "classe de ciclo não informada"}); ajuste por ciclo ${(materialFactor(input.crop, input.cultivar) - 1) * 100 >= 0 ? "+" : ""}${Math.round((materialFactor(input.crop, input.cultivar) - 1) * 100)}%.`,
        `Local: ${locationLabel(input.municipality, input.uf)} · ${region}${municipalityLatitude === null ? "" : ` · centroide IBGE ${municipalityLatitude.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}°`}; fator regional ${Math.round((POPULATION_REGION_FACTOR[input.crop][region] - 1) * 100)}%.`,
        `Ambiente ${input.environment === "alto" ? "de alto potencial" : input.environment === "restritivo" ? "restritivo" : "médio"}; yield gap ${gap.toLocaleString("pt-BR")}% e fator conjunto de eficiência ${Math.round((ENVIRONMENT_FACTOR[input.crop][input.environment] * yieldGapFactor - 1) * 100)}%.`,
        `Estabelecimento calculado: ${(establishment * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% (${input.germinationPercent}% germinação × ${input.emergencePercent}% emergência).`,
    ];
    return {
        region,
        location: locationLabel(input.municipality, input.uf),
        municipalityLatitude,
        finalMin,
        finalTarget,
        finalMax,
        seedsPerHa,
        seedsPerMeter,
        finalPlantsPerMeter,
        establishmentPercent: establishment * 100,
        spacingRangeCm: base.spacing,
        outsideGeneralWindow,
        warnings,
        explanations,
    };
}
