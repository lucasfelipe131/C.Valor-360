export const manualNavigationProtocolVersion = 1 as const;

export type ManualPageKey =
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

export type ManualCalculatorKey =
  | "semeadora"
  | "populacao"
  | "sementes"
  | "colheita"
  | "zoneamento"
  | "pulverizacao"
  | "fertilizante"
  | "reposicao"
  | "cotacao";

export type ManualDiagnosisMode = "nutrition" | "disease" | "insect" | "weed";
export type ManualNavigationTool = "mapping" | "calculators" | "soil" | "diagnosis";

export type ManualNavigationContext = {
  clientId?: string;
  clientName?: string;
  propertyId?: string;
  propertyName?: string;
  fieldId?: string;
  fieldName?: string;
  analysisId?: string;
};

export type ManualNavigationCommand = {
  type: "valor360:navigate";
  version: typeof manualNavigationProtocolVersion;
  requestId: string;
  page: ManualPageKey;
  tool?: ManualNavigationTool;
  calculator?: ManualCalculatorKey;
  diagnosisMode?: ManualDiagnosisMode;
  context: ManualNavigationContext;
};

type NavigationProducer = {
  id?: unknown;
  crmCode?: unknown;
  name?: unknown;
  properties?: unknown;
  valor360LegacyExternalKeys?: unknown;
  registrations?: Array<{ id?: unknown; propertyName?: unknown; number?: unknown }>;
  fields?: Array<{ id?: unknown; name?: unknown; registrationId?: unknown }>;
};

type NavigationAnalysis = {
  id?: unknown;
  recordId?: unknown;
  producerId?: unknown;
  property?: unknown;
  fieldId?: unknown;
};

const pageKeys = new Set<ManualPageKey>([
  "inicio", "produtores", "solo", "diagnostico", "calculadoras", "bulas", "mercado",
  "relatorios", "feedback", "administracao", "perfil", "empresa",
]);

const calculatorKeys = new Set<ManualCalculatorKey>([
  "semeadora", "populacao", "sementes", "colheita", "zoneamento", "pulverizacao",
  "fertilizante", "reposicao", "cotacao",
]);

function text(value: unknown, limit = 180) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function key(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeDiagnosisMode(value: unknown): ManualDiagnosisMode | undefined {
  const normalized = key(value);
  if (["nutrition", "nutricao", "nutriscan", "nutri-scan"].includes(normalized)) return "nutrition";
  // FitoScan e o nome canonico. FitScan e aceito somente como alias de entrada.
  if (["disease", "doenca", "doencas", "fitoscan", "fito-scan", "fitscan", "fit-scan"].includes(normalized)) return "disease";
  if (["insect", "inseto", "insetoscan", "inseto-scan"].includes(normalized)) return "insect";
  if (["weed", "daninha", "daninhascan", "daninha-scan"].includes(normalized)) return "weed";
  return undefined;
}

function normalizeTool(value: unknown): { tool?: ManualNavigationTool; diagnosisMode?: ManualDiagnosisMode } {
  const normalized = key(value);
  if (["mapping", "area-mapping", "mapeamento", "mapa"].includes(normalized)) return { tool: "mapping" };
  if (["calculator", "calculators", "calculate", "calculadoras", "calcular"].includes(normalized)) return { tool: "calculators" };
  if (["soil", "soil-analysis", "analyze-soil", "solo", "analise-de-solo"].includes(normalized)) return { tool: "soil" };
  const diagnosisMode = normalizeDiagnosisMode(normalized);
  if (diagnosisMode) return { tool: "diagnosis", diagnosisMode };
  if (["diagnosis", "image-diagnosis", "diagnostico", "diagnostico-por-foto"].includes(normalized)) return { tool: "diagnosis" };
  return {};
}

function pageForTool(tool?: ManualNavigationTool): ManualPageKey | undefined {
  if (tool === "mapping") return "produtores";
  if (tool === "calculators") return "calculadoras";
  if (tool === "soil") return "solo";
  if (tool === "diagnosis") return "diagnostico";
  return undefined;
}

function toolForPage(page: ManualPageKey): ManualNavigationTool | undefined {
  if (page === "produtores") return "mapping";
  if (page === "calculadoras") return "calculators";
  if (page === "solo") return "soil";
  if (page === "diagnostico") return "diagnosis";
  return undefined;
}

function navigationContext(input: Record<string, unknown>) {
  const nested = object(input.context);
  const value = (name: keyof ManualNavigationContext) => nested[name] ?? input[name];
  const context: ManualNavigationContext = {};
  for (const name of ["clientId", "clientName", "propertyId", "propertyName", "fieldId", "fieldName", "analysisId"] as const) {
    const normalized = text(value(name));
    if (normalized) context[name] = normalized;
  }
  return context;
}

export function normalizeManualNavigation(input: unknown): ManualNavigationCommand | null {
  const source = object(input);
  if (source.type !== "valor360:navigate") return null;
  if (source.version !== undefined && Number(source.version) !== manualNavigationProtocolVersion) return null;

  const normalizedTool = normalizeTool(source.tool ?? source.capability);
  const requestedPage = text(source.page) as ManualPageKey;
  const page = pageKeys.has(requestedPage)
    ? requestedPage
    : pageForTool(normalizedTool.tool);
  if (!page) return null;

  const calculatorValue = text(source.calculator ?? source.calculatorKey) as ManualCalculatorKey;
  const calculator = calculatorKeys.has(calculatorValue) ? calculatorValue : undefined;
  const diagnosisMode = normalizeDiagnosisMode(source.diagnosisMode ?? source.mode) ?? normalizedTool.diagnosisMode;
  const requestId = text(source.requestId, 120).replace(/[^a-zA-Z0-9:_-]/g, "") || `manual-${Date.now()}`;

  return {
    type: "valor360:navigate",
    version: manualNavigationProtocolVersion,
    requestId,
    page,
    tool: normalizedTool.tool ?? toolForPage(page),
    calculator,
    diagnosisMode,
    context: navigationContext(source),
  };
}

export function manualNavigationFromUrl(url: URL): ManualNavigationCommand | null {
  const source: Record<string, unknown> = {
    type: "valor360:navigate",
    version: manualNavigationProtocolVersion,
    requestId: url.searchParams.get("requestId") || "manual-url",
    page: url.searchParams.get("page") || undefined,
    tool: url.searchParams.get("tool") || undefined,
    calculator: url.searchParams.get("calculator") || undefined,
    diagnosisMode: url.searchParams.get("diagnosisMode") || url.searchParams.get("mode") || undefined,
  };
  for (const name of ["clientId", "clientName", "propertyId", "propertyName", "fieldId", "fieldName", "analysisId"] as const) {
    source[name] = url.searchParams.get(name) || undefined;
  }
  return normalizeManualNavigation(source);
}

export function resolveManualNavigationContext(
  command: ManualNavigationCommand,
  producers: NavigationProducer[],
  analyses: NavigationAnalysis[],
) {
  const requested = command.context;
  const issues: string[] = [];
  const producerValues = Array.isArray(producers) ? producers : [];
  const analysisValues = Array.isArray(analyses) ? analyses : [];
  const requestedClientKey = key(requested.clientId);
  const requestedClientName = key(requested.clientName);
  let analysis = requested.analysisId
    ? analysisValues.find((item) => [item.id, item.recordId].some((value) => text(value) === requested.analysisId))
    : undefined;
  const analysisWasFound = Boolean(analysis);
  const producerById = requestedClientKey
    ? producerValues.find((item) => {
        const aliases = Array.isArray(item.valor360LegacyExternalKeys) ? item.valor360LegacyExternalKeys : [];
        const identifiers = [item.id, item.crmCode, ...aliases].map(key).filter(Boolean);
        return identifiers.includes(requestedClientKey);
      })
    : undefined;
  const producersByName = requestedClientName
    ? producerValues.filter((item) => key(item.name) === requestedClientName)
    : [];
  let producer = producerById ?? (producersByName.length === 1 ? producersByName[0] : undefined);

  if (requestedClientKey && !producerById && producer) issues.push("client_id_not_in_workspace");
  if (!producer && producersByName.length > 1) issues.push("client_ambiguous_in_workspace");

  if (!producer && !requestedClientKey && !requestedClientName && analysis?.producerId) {
    producer = producerValues.find((item) => text(item.id) === text(analysis?.producerId));
  }
  if ((requestedClientKey || requestedClientName) && !producer && !producersByName.length) {
    issues.push("client_not_in_workspace");
  }

  if ((requestedClientKey || requestedClientName) && !producer && analysis) {
    issues.push("analysis_outside_client");
    analysis = undefined;
  }

  if (analysis && producer && analysis.producerId && text(analysis.producerId) !== text(producer.id)) {
    issues.push("analysis_outside_client");
    analysis = undefined;
  }
  if (requested.analysisId && !analysisWasFound) issues.push("analysis_not_in_workspace");

  const requestedFieldId = requested.fieldId || text(analysis?.fieldId);
  const requestedFieldName = requested.fieldName;
  const field = producer && (requestedFieldId || requestedFieldName)
    ? (producer.fields ?? []).find((item) =>
        (requestedFieldId && text(item.id) === requestedFieldId) ||
        (requestedFieldName && key(item.name) === key(requestedFieldName)))
    : undefined;
  if ((requestedFieldId || requestedFieldName) && !field) issues.push("field_not_in_client");

  const inferredPropertyId = text(field?.registrationId);
  const requestedPropertyId = requested.propertyId || inferredPropertyId;
  const requestedPropertyName = requested.propertyName || text(analysis?.property);
  const registration = producer && (requestedPropertyId || requestedPropertyName)
    ? (producer.registrations ?? []).find((item) =>
        (requestedPropertyId && text(item.id) === requestedPropertyId) ||
        (requestedPropertyName && [item.propertyName, item.number].some((value) => key(value) === key(requestedPropertyName))))
    : undefined;
  const declaredProperties = text(producer?.properties)
    .split(/[,;/|]+/)
    .map(key)
    .filter(Boolean);
  const primaryPropertyMatches = Boolean(
    producer && requestedPropertyName && declaredProperties.includes(key(requestedPropertyName)),
  );
  if ((requestedPropertyId || requestedPropertyName) && !registration && !primaryPropertyMatches) {
    issues.push("property_not_in_client");
  }
  if (requested.propertyId && (!registration || text(registration.id) !== requested.propertyId)) {
    issues.push("property_id_not_in_client");
  }

  const context: ManualNavigationContext = {};
  if (producer) {
    context.clientId = text(producer.id);
    context.clientName = text(producer.name);
  }
  if (registration || primaryPropertyMatches) {
    context.propertyId = text(registration?.id) || undefined;
    context.propertyName = text(registration?.propertyName || requestedPropertyName) || undefined;
  }
  if (field) {
    context.fieldId = text(field.id);
    context.fieldName = text(field.name);
  }
  if (analysis) context.analysisId = text(analysis.id || analysis.recordId);

  return { context, issues };
}
