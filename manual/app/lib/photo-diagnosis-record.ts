const blockedBinaryKey = /^(?:base64|contentBase64|dataUrl|preview|rawImage|rawImages|imageData)$/i;
const inlineImage = /^data:[^;,]+;base64,/i;

function sanitize(value: unknown, depth: number): unknown {
  if (depth > 8) return undefined;
  if (typeof value === "string") {
    if (inlineImage.test(value.trim())) return undefined;
    return value.slice(0, 20_000);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([name]) => !blockedBinaryKey.test(name))
        .slice(0, 200)
        .map(([name, item]) => [name.slice(0, 100), sanitize(item, depth + 1)])
        .filter(([, item]) => item !== undefined),
    );
  }
  return undefined;
}

export function sanitizePhotoDiagnosisPayload(payload: unknown) {
  const safe = sanitize(payload, 0);
  const record = safe && typeof safe === "object" && !Array.isArray(safe)
    ? safe as Record<string, unknown>
    : {};
  const existingPolicy = record.storagePolicy && typeof record.storagePolicy === "object" && !Array.isArray(record.storagePolicy)
    ? record.storagePolicy as Record<string, unknown>
    : {};
  return {
    ...record,
    storagePolicy: {
      ...existingPolicy,
      rawImagesStored: false,
      inlineBinaryStored: false,
    },
  };
}

export function containsInlineImage(value: unknown): boolean {
  if (typeof value === "string") return inlineImage.test(value.trim());
  if (Array.isArray(value)) return value.some(containsInlineImage);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .some(([name, item]) => blockedBinaryKey.test(name) || containsInlineImage(item));
  }
  return false;
}
