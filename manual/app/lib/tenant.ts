export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export function manualTenantId(value = process.env.VALOR360_DEFAULT_TENANT_ID) {
  const tenantId = String(value || DEFAULT_TENANT_ID).trim().toLowerCase();
  if (tenantId !== DEFAULT_TENANT_ID) {
    throw new Error("A segunda organização ainda não está habilitada no piloto.");
  }
  return tenantId;
}
