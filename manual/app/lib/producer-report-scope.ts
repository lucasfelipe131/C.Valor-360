export class ProducerReportAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function authorizeProducerReport(
  db: {query: (sql: string, params: string[]) => Promise<{rows: Array<{id: string; external_key: string | null; source: string | null}>}>},
  tenantId: string, ownerId: string | null | undefined, clientId: unknown,
) {
  if (!ownerId) throw new ProducerReportAccessError("Responsável pela carteira não autenticado.", 403);
  if (typeof clientId !== "string" || !clientId.trim() || clientId.length > 240) throw new ProducerReportAccessError("Informe o produtor do relatório.", 400);
  const result = await db.query("SELECT id, external_key, source FROM clients WHERE tenant_id=$1 AND consultant_id=$2 AND (id::text=$3 OR external_key=$3) AND status='active' LIMIT 1", [tenantId, ownerId, clientId]);
  const producer = result.rows[0];
  if (!producer) throw new ProducerReportAccessError("Produtor não encontrado na sua carteira.", 404);
  return {...producer, isDemo: producer.source === "val-demo-synthetic-v1"};
}
