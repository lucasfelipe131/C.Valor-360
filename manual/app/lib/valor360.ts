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
      producerName(producer) ||
      producer.crmCode ||
      producer.id,
  );
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

async function publish(event: JsonRecord): Promise<ValorPublishResult> {
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
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-valor-signature": `sha256=${signature}`,
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

function specializedRecordEvent(record: ManualRecordForValor, ownerUserId = "") {
  const payload = object(record.payload);
  const clientExternalKey = recordProducerKey(record);
  const occurredAt = record.updatedAt || payload.savedAt || record.createdAt;
  if (!clientExternalKey) return null;

  if (record.type === "soil_analysis") {
    const specializedPayload = {
      analysisId: record.id,
      laboratory: text(payload.laboratory, 180),
      method: text(payload.method || payload.phMethod || payload.phosphorusMethod, 180),
      sampledAt: date(payload.sampleDate || payload.sampledAt, date(occurredAt)),
      ...depthRange(payload.depth),
      measurements: soilMeasurements(payload),
      validation: { status: "pending" },
    };
    return event({
      type: "soil_analysis.completed",
      externalId: `manual-soil:${record.id}:${fingerprint(specializedPayload)}`,
      occurredAt,
      clientExternalKey,
      ownerUserId,
      propertyExternalKey: propertyKey(clientExternalKey, payload.property),
      fieldExternalKey: propertyKey(clientExternalKey, payload.fieldId),
      payload: specializedPayload,
    });
  }

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

export async function publishManualRecordToValor(record: ManualRecordForValor, ownerUserId = "") {
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
  const results = [await publish(generic)];
  if (specialized) results.push(await publish(specialized));
  return results;
}

export async function publishProducerToValor(
  input: unknown,
  soilAnalyses: unknown[] = [],
  ownerUserId = "",
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
  const producerId = text(producer.id);
  const producerNameValue = producerName(producer);
  const relatedSoil = soilAnalyses.filter((analysis) => {
    const item = object(analysis);
    return (
      (producerId && text(item.producerId) === producerId) ||
      (producerNameValue &&
        valor360ExternalKey(item.producerName || item.producer) === clientExternalKey)
    );
  });
  const payload = {
    producer: safeProducer,
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
  return [await publish(producerEvent)];
}

export async function publishWorkspaceToValor(
  producers: unknown[],
  soilAnalyses: unknown[],
  ownerUserId = "",
) {
  const queue = producers.slice(0, 1000);
  const results: ValorPublishResult[] = [];
  const concurrency = 6;
  for (let index = 0; index < queue.length; index += concurrency) {
    const batch = queue.slice(index, index + concurrency);
    const published = await Promise.all(
      batch.map((producer) => publishProducerToValor(producer, soilAnalyses, ownerUserId)),
    );
    results.push(...published.flat());
  }
  return {
    configured: valor360Configured(),
    attempted: results.length,
    delivered: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok && !item.skipped).length,
    skipped: results.filter((item) => item.skipped).length,
    truncated: producers.length > queue.length,
  };
}
