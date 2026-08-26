import "server-only";

import { createHash, createHmac } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type ManualRecordForValor = {
  id: string;
  type: string;
  title: string;
  producerName?: string | null;
  payload: JsonRecord;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type ValorPublishResult = {
  ok: boolean;
  skipped?: boolean;
  eventType: string;
  externalId: string;
  status?: number;
  error?: string;
};

const blockedKey = /(?:password|senha|token|secret|authorization|cookie|cpf|cnpj|document|data.?url|base64|image|imagem|photo|foto|file.?content|watermark)/i;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 4000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function date(value: unknown, fallback = new Date().toISOString()) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : null;
}

function cleanForStrategy(value: unknown, depth = 0): unknown {
  if (depth > 7 || value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (/^(?:data:|blob:)/i.test(value)) return undefined;
    return value.slice(0, 10_000);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) => cleanForStrategy(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([key]) => !blockedKey.test(key))
        .slice(0, 200)
        .map(([key, item]) => [
          key.slice(0, 100),
          cleanForStrategy(item, depth + 1),
        ])
        .filter(([, item]) => item !== undefined),
    );
  }
  return undefined;
}

export function valor360ExternalKey(value: unknown) {
  return text(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 180);
}

function producerName(producer: JsonRecord) {
  return text(producer.name || producer.producerName || producer.producer);
}

function clientKeyFor(producer: JsonRecord) {
  return valor360ExternalKey(
    producer.valor360ExternalKey ||
      producer.externalKey ||
      producer.crmCode ||
      producer.id ||
      producerName(producer),
  );
}

function producerIdentityFor(producer: JsonRecord, clientExternalKey: string) {
  const explicitExternalKey = text(
    producer.valor360ExternalKey || producer.externalKey,
    180,
  );
  const declaredAliases = Array.isArray(producer.valor360LegacyExternalKeys)
    ? producer.valor360LegacyExternalKeys
    : [];
  const legacyExternalKeys = Array.from(new Set([
    ...declaredAliases.map((value) => valor360ExternalKey(value)),
    valor360ExternalKey(producerName(producer)),
  ].filter((value) => value && value !== clientExternalKey))).slice(0, 20);
  return {
    producerId: text(producer.id, 180),
    allowLegacyKeyMigration: !explicitExternalKey,
    legacyExternalKeys,
  };
}

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
}

function endpoint() {
  return text(process.env.VALOR360_WEBHOOK_URL, 2000).replace(/\/$/, "");
}

function secret() {
  return text(process.env.VALOR360_WEBHOOK_SECRET, 1000);
}

export function valor360Configured() {
  return Boolean(endpoint() && secret());
}

async function publish(event: JsonRecord, requestId = ""): Promise<ValorPublishResult> {
  const eventType = text(event.type, 80);
  const externalId = text(event.externalId, 180);
  const url = endpoint();
  const signingSecret = secret();
  if (!url || !signingSecret) {
    return { ok: false, skipped: true, eventType, externalId };
  }
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", signingSecret)
    .update(raw)
    .digest("hex");
  try {
    const safeRequestId = /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : "";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-valor-signature": `sha256=${signature}`,
        ...(safeRequestId ? { "x-request-id": safeRequestId } : {}),
      },
      body: raw,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = text(await response.text(), 500);
      return {
        ok: false,
        eventType,
        externalId,
        status: response.status,
        error: detail || `VALOR 360 respondeu HTTP ${response.status}.`,
      };
    }
    return { ok: true, eventType, externalId, status: response.status };
  } catch (error) {
    return {
      ok: false,
      eventType,
      externalId,
      error: error instanceof Error ? error.message : "Falha de comunicação.",
    };
  }
}

function event(input: {
  type: string;
  externalId: string;
  occurredAt?: unknown;
  clientExternalKey?: string;
  propertyExternalKey?: string;
  fieldExternalKey?: string;
  ownerUserId?: string;
  payload: JsonRecord;
}) {
  return {
    schemaVersion: 1,
    type: input.type,
    externalId: input.externalId.slice(0, 180),
    occurredAt: date(input.occurredAt),
    source: "manual-do-agronomo",
    ownerUserId: text(input.ownerUserId, 36),
    clientExternalKey: input.clientExternalKey || "",
    propertyExternalKey: input.propertyExternalKey || "",
    fieldExternalKey: input.fieldExternalKey || "",
    payload: cleanForStrategy(input.payload) as JsonRecord,
  };
}

function depthRange(value: unknown) {
  const matches = text(value, 80).match(/(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)/);
  if (!matches) return {};
  const from = number(matches[1]);
  const to = number(matches[2]);
  return from !== null && to !== null && to > from
    ? { depthFromCm: from, depthToCm: to }
    : {};
}

function soilMeasurements(payload: JsonRecord) {
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const source = samples.length
    ? samples.flatMap((sample) => {
        const item = object(sample);
        return Object.entries(object(item.values)).map(([analyte, value]) => ({
          sampleKey: text(item.code || item.id || item.label, 120),
          analyte,
          value,
        }));
      })
    : Object.entries(object(payload.values)).map(([analyte, value]) => ({
        sampleKey: text(payload.sampleCode, 120),
        analyte,
        value,
      }));
  return source
    .filter((item) => text(item.value))
    .slice(0, 500)
    .map((item) => ({
      sampleKey: item.sampleKey,
      analyte: item.analyte,
      rawValue: item.value,
      method: text(payload.method || payload.phMethod || payload.phosphorusMethod, 180),
    }));
}

function recordProducerKey(record: ManualRecordForValor) {
  const payload = object(record.payload);
  return valor360ExternalKey(
    payload.valor360ExternalKey ||
      payload.clientExternalKey ||
      payload.externalKey ||
      payload.crmCode ||
      payload.producerId ||
      record.producerName ||
      payload.producerName ||
      payload.producer ||
      payload.clientName,
  );
}

function propertyKey(clientKey: string, value: unknown) {
  const name = valor360ExternalKey(value);
  return name ? `${clientKey}:${name}`.slice(0, 180) : "";
}

function propertyScopedFieldKey(propertyExternalKey: string, value: unknown) {
  const fieldIdentity = valor360ExternalKey(value);
  if (!propertyExternalKey || !fieldIdentity) return "";
  const propertyScope = createHash("sha256")
    .update(propertyExternalKey)
    .digest("hex")
    .slice(0, 20);
  const fieldScope = createHash("sha256")
    .update(fieldIdentity)
    .digest("hex")
    .slice(0, 20);
  return `manual-field:${propertyScope}:${fieldScope}:${fieldIdentity}`.slice(0, 180);
}

const soilLinkStates = new Set([
  "UNLINKED",
  "LINKED_TO_CLIENT",
  "LINKED_TO_PROPERTY",
  "LINKED_TO_FIELD",
]);

function soilLinkVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, 1_000_000_000) : 0;
}

function soilLogicalId(record: ManualRecordForValor, payload: JsonRecord) {
  return text(payload.id || payload.analysisId || record.id, 72) || fingerprint(payload);
}

function specializedRecordEvent(record: ManualRecordForValor, ownerUserId = "") {
  const payload = object(record.payload);
  const clientExternalKey = recordProducerKey(record);
  const occurredAt = record.updatedAt || payload.savedAt || record.createdAt;

  if (record.type === "soil_analysis") {
    const declaredState = text(payload.linkState, 40).toUpperCase();
    const inferredState = clientExternalKey
      ? text(payload.fieldId)
        ? "LINKED_TO_FIELD"
        : text(payload.property)
          ? "LINKED_TO_PROPERTY"
          : "LINKED_TO_CLIENT"
      : "UNLINKED";
    const requestedState = soilLinkStates.has(declaredState) ? declaredState : inferredState;
    const linkState = requestedState !== "UNLINKED" && !clientExternalKey
      ? "UNLINKED"
      : requestedState;
    const linkVersion = soilLinkVersion(payload.linkVersion);
    const logicalId = soilLogicalId(record, payload);
    const analysisExternalId = `manual-soil:${text(ownerUserId, 36) || "workspace"}:${logicalId}`.slice(0, 180);
    const linkedClientKey = linkState === "UNLINKED" ? "" : clientExternalKey;
    const linkedPropertyValue = payload.property || (linkState === "LINKED_TO_FIELD" ? "Propriedade principal" : "");
    const linkedPropertyKey = ["LINKED_TO_PROPERTY", "LINKED_TO_FIELD"].includes(linkState)
      ? propertyKey(linkedClientKey, linkedPropertyValue)
      : "";
    const linkedFieldKey = linkState === "LINKED_TO_FIELD"
      ? propertyScopedFieldKey(linkedPropertyKey, payload.fieldId || payload.fieldName)
      : "";
    const specializedPayload = {
      analysisId: logicalId,
      analysisExternalId,
      propertyName: text(linkedPropertyValue, 180),
      fieldId: text(payload.fieldId, 180),
      fieldName: text(payload.fieldName, 180),
      laboratory: text(payload.laboratory, 180),
      method: text(payload.method || payload.phMethod || payload.phosphorusMethod, 180),
      sampledAt: date(payload.sampleDate || payload.sampledAt, date(occurredAt)),
      ...depthRange(payload.depth),
      measurements: soilMeasurements(payload),
      linkState,
      linkVersion,
      linkHistory: Array.isArray(payload.linkHistory) ? payload.linkHistory : [],
      linkProvenance: object(payload.linkProvenance),
      validation: {
        status: "pending",
        linkage: {
          state: linkState,
          version: linkVersion,
          history: Array.isArray(payload.linkHistory) ? payload.linkHistory : [],
          provenance: object(payload.linkProvenance),
        },
      },
    };
    return event({
      type: "soil_analysis.completed",
      externalId: `manual-soil-event:${text(ownerUserId, 36) || "workspace"}:${logicalId}:v${linkVersion}:${fingerprint(specializedPayload)}`,
      occurredAt,
      clientExternalKey: linkedClientKey,
      ownerUserId,
      propertyExternalKey: linkedPropertyKey,
      fieldExternalKey: linkedFieldKey,
      payload: specializedPayload,
    });
  }

  if (!clientExternalKey) return null;

  if (record.type === "field_analysis") {
    const scene = object(payload.scene);
    const specializedPayload = {
      index: text(payload.index, 30) || "NDVI",
      observedAt: date(scene.date || payload.observedAt, date(occurredAt)),
      cloudPercent: number(scene.cloud),
      statistics: object(payload.statistics),
      classification: "observacao",
      anomaly: false,
      validation: { status: "pending" },
    };
    return event({
      type: "ndvi.observation",
      externalId: `manual-field:${record.id}:${fingerprint(specializedPayload)}`,
      occurredAt,
      clientExternalKey,
      ownerUserId,
      fieldExternalKey: propertyKey(clientExternalKey, payload.fieldName),
      payload: specializedPayload,
    });
  }

  if (record.type === "season_report") {
    const specializedPayload = {
      reportId: record.id,
      observedAt: date(payload.updatedAt || payload.savedAt, date(occurredAt)),
      cropStage: text(payload.crop || payload.season, 100),
      summary: text(
        payload.summary ||
          payload.conclusion ||
          `${record.title}. Fechamento de safra registrado no núcleo técnico do VALOR 360.`,
        10_000,
      ),
      findings: [],
      validation: { status: "pending" },
    };
    return event({
      type: "field_report.completed",
      externalId: `manual-report:${record.id}:${fingerprint(specializedPayload)}`,
      occurredAt,
      clientExternalKey,
      ownerUserId,
      propertyExternalKey: propertyKey(clientExternalKey, payload.property),
      fieldExternalKey: propertyKey(clientExternalKey, payload.fieldName || payload.fieldId),
      payload: specializedPayload,
    });
  }
  return null;
}

export async function publishManualRecordToValor(record: ManualRecordForValor, ownerUserId = "", requestId = "") {
  const clientExternalKey = recordProducerKey(record);
  const safePayload = cleanForStrategy(record.payload) as JsonRecord;
  const genericPayload = {
    recordId: record.id,
    recordType: record.type,
    title: record.title,
    producerName: record.producerName || "",
    data: safePayload,
    validation: { status: "pending" },
  };
  const generic = event({
    type: "manual.record.saved",
    externalId: `manual-record:${record.id}:${fingerprint(genericPayload)}`,
    occurredAt: record.updatedAt || record.createdAt,
    clientExternalKey,
    ownerUserId,
    payload: genericPayload,
  });
  const specialized = specializedRecordEvent(record, ownerUserId);
  const results = [await publish(generic, requestId)];
  if (specialized) results.push(await publish(specialized, requestId));
  return results;
}

export async function publishProducerToValor(
  input: unknown,
  soilAnalyses: unknown[] = [],
  ownerUserId = "",
  requestId = "",
) {
  const producer = object(input);
  const clientExternalKey = clientKeyFor(producer);
  if (!clientExternalKey) {
    return [{
      ok: false,
      skipped: true,
      eventType: "manual.producer.updated",
      externalId: "manual-producer:sem-chave",
      error: "Produtor sem nome ou chave externa.",
    } satisfies ValorPublishResult];
  }
  const safeProducer = cleanForStrategy(producer) as JsonRecord;
  const identity = producerIdentityFor(producer, clientExternalKey);
  const producerId = text(producer.id);
  const producerNameValue = producerName(producer);
  const relatedSoil = soilAnalyses.filter((analysis) => {
    const item = object(analysis);
    if (text(item.linkState, 40).toUpperCase() === "UNLINKED") return false;
    return (
      (producerId && text(item.producerId) === producerId) ||
      (producerNameValue &&
        valor360ExternalKey(item.producerName || item.producer) === clientExternalKey)
    );
  });
  const payload = {
    producer: safeProducer,
    identity,
    soilAnalyses: cleanForStrategy(relatedSoil),
    synchronization: {
      source: "workspace-postgresql",
      scope: "producer-dossier",
    },
  };
  const producerEvent = event({
    type: "manual.producer.updated",
    externalId: `manual-producer:${clientExternalKey}:${fingerprint(payload)}`,
    clientExternalKey,
    ownerUserId,
    payload,
  });
  return [await publish(producerEvent, requestId)];
}

export async function publishWorkspaceToValor(
  producers: unknown[],
  soilAnalyses: unknown[],
  ownerUserId = "",
  requestId = "",
) {
  const queue = producers.slice(0, 1000);
  const soilQueue = soilAnalyses.slice(0, 2500);
  const results: ValorPublishResult[] = [];
  const concurrency = 6;
  for (let index = 0; index < queue.length; index += concurrency) {
    const batch = queue.slice(index, index + concurrency);
    const published = await Promise.all(
      batch.map((producer) => publishProducerToValor(producer, soilAnalyses, ownerUserId, requestId)),
    );
    results.push(...published.flat());
  }
  const producersById = new Map(
    producers.map((producer) => {
      const item = object(producer);
      return [text(item.id), item] as const;
    }),
  );
  for (let index = 0; index < soilQueue.length; index += concurrency) {
    const batch = soilQueue.slice(index, index + concurrency);
    const published = await Promise.all(batch.map(async (analysis) => {
      const item = object(analysis);
      const producer = producersById.get(text(item.producerId));
      const producerFields = producer && Array.isArray(producer.fields) ? producer.fields : [];
      const linkedField = producerFields
        .map((field) => object(field))
        .find((field) => text(field.id) === text(item.fieldId));
      const record: ManualRecordForValor = {
        id: text(item.recordId || item.id, 180) || fingerprint(item),
        type: "soil_analysis",
        title: text(item.sampleCode || item.fileName || "Análise de solo", 220),
        producerName: producer ? producerName(producer) : "",
        payload: producer
          ? {
              ...item,
              producerId: text(producer.id) || text(item.producerId),
              valor360ExternalKey: clientKeyFor(producer),
              fieldName: text(linkedField?.name),
              ...(!text(item.property) ? { property: text(producer.properties) } : {}),
            }
          : item,
        createdAt: text(item.importedAt),
        updatedAt: text(item.savedAt || item.importedAt),
      };
      const specialized = specializedRecordEvent(record, ownerUserId);
      return specialized ? publish(specialized, requestId) : null;
    }));
    results.push(...published.filter((item): item is ValorPublishResult => Boolean(item)));
  }
  return {
    configured: valor360Configured(),
    attempted: results.length,
    delivered: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    truncated: producers.length > queue.length || soilAnalyses.length > soilQueue.length,
    errors: results
      .filter((item) => !item.ok && !item.skipped)
      .slice(0, 5)
      .map((item) => ({
        eventType: item.eventType,
        externalId: item.externalId,
        status: item.status ?? null,
        error: text(item.error, 500) || "Falha de integração não detalhada.",
      })),
  };
}
