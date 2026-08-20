const controlledNamePattern=/(?:^|[_-])(staging|stage|restore|sandbox|test|gate)(?:$|[_-])/i

export function databaseTarget(connectionString){
  let url
  try{url=new URL(String(connectionString||''))}catch{throw new Error('A URL do banco controlado é inválida.')}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('O banco controlado deve usar PostgreSQL.')
  const name=decodeURIComponent(url.pathname.replace(/^\//,'')).trim()
  if(!name)throw new Error('A URL do banco controlado não informa o database.')
  return {hostname:url.hostname.toLowerCase(),name,sslMode:String(url.searchParams.get('sslmode')||'').toLowerCase()}
}

export function assertControlledDatabase(connectionString,{confirmation='',requiredConfirmation=''}={}){
  const target=databaseTarget(connectionString)
  const explicitlyConfirmed=requiredConfirmation&&confirmation===requiredConfirmation
  if(!controlledNamePattern.test(target.name)&&!explicitlyConfirmed){
    throw new Error(`Banco recusado porque não parece controlado: ${target.name}.`)
  }
  return target
}

export function databaseSsl(connectionString){
  const target=databaseTarget(connectionString)
  if(target.sslMode==='disable'||['localhost','127.0.0.1','::1'].includes(target.hostname)||target.hostname.endsWith('.railway.internal'))return undefined
  return {rejectUnauthorized:false}
}

export function postgresCliEnv(connectionString,baseEnv=process.env){
  const target=databaseTarget(connectionString)
  const url=new URL(connectionString)
  const local=['localhost','127.0.0.1','::1'].includes(target.hostname)||target.hostname.endsWith('.railway.internal')
  return {
    ...baseEnv,
    PGHOST:target.hostname,
    PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:target.name,
    PGSSLMODE:target.sslMode|| (local?'disable':'require')
  }
}
