import pg from 'pg'
import {databaseOperation,observe} from './observability.js'

const {Pool}=pg

export function createDatabase(runtimeConfig,{PoolClass=Pool}={}){
  const pool=runtimeConfig.databaseUrl?new PoolClass({
    connectionString:runtimeConfig.databaseUrl,
    max:Number(process.env.PG_POOL_MAX||10),
    idleTimeoutMillis:30_000,
    connectionTimeoutMillis:8_000,
    ssl:runtimeConfig.databaseSsl?{rejectUnauthorized:false}:undefined
  }):null

  async function execute(executor,text,params=[]){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    const started=Date.now()
    try{
      const result=await executor.query(text,params)
      observe('db.query',{operation:databaseOperation(text),durationMs:Date.now()-started,rowCount:Number(result.rowCount||0),outcome:'ok'})
      return result
    }catch(error){
      observe('db.query',{operation:databaseOperation(text),durationMs:Date.now()-started,outcome:'error',errorCode:String(error?.code||'database_error')})
      throw error
    }
  }

  async function query(text,params=[]){
    return execute(pool,text,params)
  }

  async function transaction(work){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    const client=await pool.connect()
    try{
      await client.query('BEGIN')
      const instrumented={...client,query:(text,params=[])=>execute(client,text,params)}
      const result=await work(instrumented)
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
      await execute(pool,'SELECT 1')
      return {configured:true,ready:true,mode:'postgresql'}
    }catch(error){
      return {configured:true,ready:false,mode:'postgresql',error:'Banco configurado, mas indisponível.'}
    }
  }

  return {configured:Boolean(pool),pool,query,transaction,health,close:()=>pool?.end()}
}
