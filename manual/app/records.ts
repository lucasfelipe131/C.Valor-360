export type RecordType =
  | "quote"
  | "soil_analysis"
  | "spray_recommendation"
  | "fertilizer_comparison"
  | "season_report"
  | "field_analysis"
  | "calculator"
  | "crm_import"
  | "producer_change"
  | "land_registry"
  | "system_change";

export type SavedRecord = {
  id: string;
  ownerId: string;
  type: RecordType;
  title: string;
  producerName: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export const recordTypeLabels: Record<RecordType, string> = {
  quote: "Cotação de insumos",
  soil_analysis: "Interpretação de solo",
  spray_recommendation: "Recomendação de pulverização",
  fertilizer_comparison: "Comparativo de fertilizantes",
  season_report: "Fechamento de safra",
  field_analysis: "Interpretação de talhão",
  calculator: "Cálculo salvo",
  crm_import: "Importação de CRM",
  producer_change: "Alteração de produtor",
  land_registry: "Matrícula e croqui",
  system_change: "Configuração do sistema",
};

const DB_NAME = "manual-do-agronomo-local";
const DB_VERSION = 2;
const STORE_NAME = "records";
const OWNER_KEY = "mp-record-owner";
const SERVER_SYNC_VERSION = "valor360-v1";
const LOCAL_DATA_KEYS = [
  "mp-producers",
  "mp-professional-profile",
  "mp-soil-analyses",
  "mp-season-reports",
] as const;

function requireBrowser() {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("O armazenamento local não está disponível neste navegador.");
  }
}

function ownerId() {
  requireBrowser();
  const value = window.localStorage.getItem(OWNER_KEY)?.trim() ?? "";
  if (!value) throw new Error("Entre novamente para acessar o arquivo local.");
  return value;
}

export function setRecordOwner(value: string) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(OWNER_KEY, value);
  else window.localStorage.removeItem(OWNER_KEY);
}

function openDatabase() {
  requireBrowser();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o arquivo local."));
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains("ownerId")) store.createIndex("ownerId", "ownerId", { unique: false });
      if (!store.indexNames.contains("ownerType")) store.createIndex("ownerType", ["ownerId", "type"], { unique: false });
      if (!store.indexNames.contains("ownerUpdated")) store.createIndex("ownerUpdated", ["ownerId", "updatedAt"], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no arquivo local."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falha ao salvar no dispositivo."));
    transaction.onabort = () => reject(transaction.error ?? new Error("O salvamento local foi interrompido."));
  });
}

async function persistRecordOnServer(record: SavedRecord) {
  const response = await fetch("/api/records", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: record.id,
      type: record.type,
      title: record.title,
      producerName: record.producerName,
      payload: record.payload,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(
      result.error ||
        "O registro foi preservado neste dispositivo, mas a nuvem não confirmou o salvamento.",
    );
  }
}

export async function syncLocalRecordsToServer() {
  const currentOwner = ownerId();
  const marker = `mp-record-server-sync:${SERVER_SYNC_VERSION}:${currentOwner}`;
  if (window.localStorage.getItem(marker) === "done") {
    return { synchronized: 0, alreadySynchronized: true };
  }
  const records = await listRecords();
  const concurrency = 5;
  let synchronized = 0;
  for (let index = 0; index < records.length; index += concurrency) {
    const batch = records.slice(index, index + concurrency);
    await Promise.all(batch.map((record) => persistRecordOnServer(record)));
    synchronized += batch.length;
  }
  window.localStorage.setItem(marker, "done");
  return { synchronized, alreadySynchronized: false };
}

export async function saveRecord(input: {
  id?: string;
  type: RecordType;
  title: string;
  producerName?: string;
  payload: Record<string, unknown>;
}) {
  const database = await openDatabase();
  const currentOwner = ownerId();
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  let previous: SavedRecord | undefined;
  if (input.id) {
    const readTransaction = database.transaction(STORE_NAME, "readonly");
    previous = await requestResult(
      readTransaction.objectStore(STORE_NAME).get(input.id) as IDBRequest<SavedRecord | undefined>,
    );
  }
  const record: SavedRecord = {
    id,
    ownerId: currentOwner,
    type: input.type,
    title: input.title.trim().slice(0, 220),
    producerName: String(input.producerName ?? "").trim().slice(0, 180),
    payload: JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>,
    createdAt: previous?.ownerId === currentOwner ? previous.createdAt : now,
    updatedAt: now,
  };
  const writeTransaction = database.transaction(STORE_NAME, "readwrite");
  writeTransaction.objectStore(STORE_NAME).put(record);
  await transactionDone(writeTransaction);
  database.close();
  await persistRecordOnServer(record);
  return record;
}

export async function listRecords(type?: RecordType) {
  const database = await openDatabase();
  const currentOwner = ownerId();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const values = type
    ? await requestResult(
        store.index("ownerType").getAll(IDBKeyRange.only([currentOwner, type])) as IDBRequest<SavedRecord[]>,
      )
    : await requestResult(
        store.index("ownerId").getAll(IDBKeyRange.only(currentOwner)) as IDBRequest<SavedRecord[]>,
      );
  database.close();
  return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteRecord(id: string) {
  const database = await openDatabase();
  const currentOwner = ownerId();
  const readTransaction = database.transaction(STORE_NAME, "readonly");
  const record = await requestResult(
    readTransaction.objectStore(STORE_NAME).get(id) as IDBRequest<SavedRecord | undefined>,
  );
  if (record?.ownerId === currentOwner) {
    const writeTransaction = database.transaction(STORE_NAME, "readwrite");
    writeTransaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(writeTransaction);
  }
  database.close();
}

export async function exportRecords() {
  const records = await listRecords();
  const currentOwner = ownerId();
  const localData = Object.fromEntries(
    LOCAL_DATA_KEYS.map((key) => [key, window.localStorage.getItem(`${key}:${currentOwner}`)]),
  );
  return JSON.stringify(
    {
      format: "manual-do-agronomo-local-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      localData,
      records: records.map(({ ownerId: _ownerId, ...record }) => record),
    },
    null,
    2,
  );
}

export async function importRecords(raw: string) {
  const parsed = JSON.parse(raw) as {
    format?: string;
    localData?: Record<string, unknown>;
    records?: Array<Omit<SavedRecord, "ownerId">>;
  };
  if (parsed.format !== "manual-do-agronomo-local-backup" || !Array.isArray(parsed.records)) {
    throw new Error("Este arquivo não é um backup válido do núcleo técnico.");
  }
  const currentOwner = ownerId();
  for (const key of LOCAL_DATA_KEYS) {
    const value = parsed.localData?.[key];
    if (typeof value === "string" && value.length <= 12_000_000) {
      window.localStorage.setItem(`${key}:${currentOwner}`, value);
    }
  }
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  let imported = 0;
  for (const source of parsed.records.slice(0, 5000)) {
    if (!source || !recordTypeLabels[source.type]) continue;
    const now = new Date().toISOString();
    store.put({
      ...source,
      id: /^[0-9a-f-]{36}$/i.test(source.id ?? "") ? source.id : crypto.randomUUID(),
      ownerId: currentOwner,
      title: String(source.title ?? "").slice(0, 220),
      producerName: String(source.producerName ?? "").slice(0, 180),
      payload: source.payload && typeof source.payload === "object" ? source.payload : {},
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || now,
    } satisfies SavedRecord);
    imported += 1;
  }
  await transactionDone(transaction);
  database.close();
  return imported;
}
