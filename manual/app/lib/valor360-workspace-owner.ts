type Valor360WorkspaceSession = {
  user?: { id?: string | null } | null;
  valor360OwnerId?: string | null;
};

const uuid = /^[0-9a-f-]{36}$/i;

/**
 * A publicacao no VALOR 360 so pode usar a identidade ligada ao proprio
 * workspace autenticado. Um admin pode consultar outro workspace, mas nao
 * pode publica-lo como se os dados pertencessem a sua carteira.
 */
export function authenticatedValor360OwnerForWorkspace(
  session: Valor360WorkspaceSession | null | undefined,
  workspaceId: string,
) {
  const authenticatedWorkspaceId = String(session?.user?.id ?? "").trim();
  const targetWorkspaceId = String(workspaceId ?? "").trim();
  if (
    !uuid.test(authenticatedWorkspaceId) ||
    !uuid.test(targetWorkspaceId) ||
    targetWorkspaceId !== authenticatedWorkspaceId
  ) return null;

  const ownerId = String(
    session?.valor360OwnerId ?? authenticatedWorkspaceId,
  ).trim();
  return uuid.test(ownerId) ? ownerId : null;
}
