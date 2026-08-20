const tenantIdPattern=/^[a-z0-9][a-z0-9._:-]{0,179}$/i

export function normalizeTenantId(value){
  const tenantId=String(value||'').trim().toLowerCase()
  if(!tenantIdPattern.test(tenantId))throw Object.assign(new Error('Escopo de organização inválido.'),{statusCode:403,code:'tenant_scope_invalid'})
  return tenantId
}

export function assertTenantScope(configuredTenantId,requestedTenantId=configuredTenantId){
  const configured=normalizeTenantId(configuredTenantId)
  const requested=normalizeTenantId(requestedTenantId||configured)
  if(requested!==configured)throw Object.assign(new Error('A organização solicitada não pertence a esta sessão.'),{statusCode:403,code:'cross_tenant_scope_denied'})
  return configured
}
