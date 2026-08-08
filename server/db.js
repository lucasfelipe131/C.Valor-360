import pg from 'pg'

const {Pool}=pg

export function createDatabase(runtimeConfig){
  const pool=runtimeConfig.databaseUrl?new Pool({
    connectionString:runtimeConfig.databaseUrl,
    max:Number(process.env.PG_POOL_MAX||10),
    idleTimeoutMillis:30_000,
    connectionTimeoutMillis:8_000,
    ssl:runtimeConfig.databaseSsl?{rejectUnauthorized:false}:undefined
  }):null

  async function query(text,params=[]){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    return pool.query(text,params)
  }

  async function transaction(work){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      const result=await work(client)
      await client.query('COMMIT')
      return result
    }catch(error){
      await client.query('ROLLBACK').catch(()=>null)
      throw error
    }finally{client.release()}
  }

  async function health(){
    if(!pool)return {configured:false,ready:false,mode:'json-fallback'}
    try{
      await pool.query('SELECT 1')
      return {configured:true,ready:true,mode:'postgresql'}
    }catch(error){
      return {configured:true,ready:false,mode:'postgresql',error:'Banco configurado, mas indisponível.'}
    }
  }

  return {configured:Boolean(pool),pool,query,transaction,health,close:()=>pool?.end()}
}
