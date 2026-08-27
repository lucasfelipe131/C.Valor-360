export const manualSessionMediaProtocolVersion = 1 as const;

export type ManualSessionMediaIntent = "IMAGE_DIAGNOSIS" | "ANALYZE_SOIL";
export type ManualSessionMediaStatus = "APPLIED" | "REJECTED";

export type ManualSessionMediaCommand = {
  type: "valor360:session-media";
  version: typeof manualSessionMediaProtocolVersion;
  transferId: string;
  navigationRequestId: string;
  intent: ManualSessionMediaIntent;
  persistenceMode: "NONE";
  association: "UNLINKED";
  files: File[];
};

export type ManualSessionMediaResult = {
  type: "valor360:session-media-result";
  version: typeof manualSessionMediaProtocolVersion;
  transferId: string;
  navigationRequestId: string;
  status: ManualSessionMediaStatus;
  intent: ManualSessionMediaIntent | null;
  acceptedCount: number;
  errorCode: string | null;
};

export const manualSessionMediaMaxBytes = 6_000_000;

const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const soilTypes = new Set([...photoTypes, "application/pdf"]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120)
    : "";
}

export function manualSessionMediaIdentity(input: unknown) {
  const source = object(input);
  return {
    transferId: identifier(source.transferId),
    navigationRequestId: identifier(source.navigationRequestId),
  };
}

function isBrowserFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

export function validateManualSessionMedia(input: unknown): {
  command: ManualSessionMediaCommand | null;
  errorCode: string | null;
} {
  const source = object(input);
  if (source.type !== "valor360:session-media") return { command: null, errorCode: "INVALID_ENVELOPE" };
  if (Number(source.version) !== manualSessionMediaProtocolVersion) return { command: null, errorCode: "INVALID_ENVELOPE" };

  const transferId = identifier(source.transferId);
  const navigationRequestId = identifier(source.navigationRequestId);
  const intent = source.intent === "IMAGE_DIAGNOSIS" || source.intent === "ANALYZE_SOIL"
    ? source.intent
    : null;
  if (!transferId || !navigationRequestId || !intent) return { command: null, errorCode: "INVALID_ENVELOPE" };
  if (source.persistenceMode !== "NONE" || source.association !== "UNLINKED") return { command: null, errorCode: "INVALID_ENVELOPE" };

  const values = Array.isArray(source.files) ? source.files : [];
  const expectedCount = intent === "IMAGE_DIAGNOSIS"
    ? values.length >= 1 && values.length <= 3
    : values.length === 1;
  if (!expectedCount) return { command: null, errorCode: "INVALID_FILE_COUNT" };
  if (!values.every(isBrowserFile)) return { command: null, errorCode: "INVALID_ENVELOPE" };
  const files = values as File[];
  if (files.some((file) => !Number.isFinite(file.size) || file.size <= 0)) return { command: null, errorCode: "FILE_EMPTY" };
  if (files.some((file) => file.size > manualSessionMediaMaxBytes)) return { command: null, errorCode: "FILE_TOO_LARGE" };
  const types = intent === "IMAGE_DIAGNOSIS" ? photoTypes : soilTypes;
  if (files.some((file) => !types.has(String(file.type || "").toLowerCase()))) {
    return { command: null, errorCode: "UNSUPPORTED_MEDIA_TYPE" };
  }

  return { command: {
    type: "valor360:session-media",
    version: manualSessionMediaProtocolVersion,
    transferId,
    navigationRequestId,
    intent,
    persistenceMode: "NONE",
    association: "UNLINKED",
    files,
  }, errorCode: null };
}

export function normalizeManualSessionMedia(input: unknown): ManualSessionMediaCommand | null {
  return validateManualSessionMedia(input).command;
}

export function createManualSessionMediaResult({
  transferId,
  navigationRequestId,
  status,
  intent = null,
  acceptedCount = 0,
  errorCode = null,
}: {
  transferId: string;
  navigationRequestId: string;
  status: ManualSessionMediaStatus;
  intent?: ManualSessionMediaIntent | null;
  acceptedCount?: number;
  errorCode?: string | null;
}): ManualSessionMediaResult {
  return {
    type: "valor360:session-media-result",
    version: manualSessionMediaProtocolVersion,
    transferId: identifier(transferId),
    navigationRequestId: identifier(navigationRequestId),
    status,
    intent,
    acceptedCount: Math.max(0, Math.min(3, Math.trunc(Number(acceptedCount) || 0))),
    errorCode: errorCode ? identifier(errorCode) : null,
  };
}
