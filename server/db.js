import pg from 'pg'
import {databaseOperation,observe} from './observability.js'

const {Pool}=pg

const cancellationError=signal=>signal?.reason instanceof Error
  ?signal.reason
  :Object.assign(new Error('A operação PostgreSQL foi cancelada.'),{name:'AbortError',statusCode:499,code:'database_query_cancelled',safeToRetry:true})
const throwIfCancelled=signal=>{if(signal?.aborted)throw cancellationError(signal)}

export function createDatabase(runtimeConfig,{PoolClass=Pool}={}){
  const pool=runtimeConfig.databaseUrl?new PoolClass({
    connectionString:runtimeConfig.databaseUrl,
    max:Number(process.env.PG_POOL_MAX||10),
    idleTimeoutMillis:30_000,
    connectionTimeoutMillis:8_000,
    ssl:runtimeConfig.databaseSsl?{rejectUnauthorized:false}:undefined
  }):null

  const queryTimeout=options=>{
    const value=Number(options?.timeoutMs??options?.queryTimeoutMs)
    return Number.isFinite(value)&&value>0?Math.round(value):null
  }

  async function execute(executor,text,params=[],options={}){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    throwIfCancelled(options?.signal)
    const started=Date.now()
    try{
      const timeoutMs=queryTimeout(options)
      const result=timeoutMs
        ?await executor.query({text,values:params,query_timeout:timeoutMs})
        :await executor.query(text,params)
      throwIfCancelled(options?.signal)
      observe('db.query',{operation:databaseOperation(text),durationMs:Date.now()-started,rowCount:Number(result.rowCount||0),outcome:'ok'})
      return result
    }catch(error){
      observe('db.query',{operation:databaseOperation(text),durationMs:Date.now()-started,outcome:'error',errorCode:String(error?.code||'database_error')})
      throw error
    }
  }

  async function query(text,params=[],options={}){
    return execute(pool,text,params,options)
  }

  async function transaction(work,{signal,timeoutMs=runtimeConfig.databaseQueryTimeoutMs}={}){
    if(!pool)throw new Error('DATABASE_URL não configurada.')
    throwIfCancelled(signal)
    const client=await pool.connect()
    try{
      throwIfCancelled(signal)
      await client.query('BEGIN')
      throwIfCancelled(signal)
      const instrumented={...client,query:(text,params=[],options={})=>execute(client,text,params,{...options,timeoutMs:options.timeoutMs??options.queryTimeoutMs??timeoutMs,signal:options.signal||signal})}
      const result=await work(instrumented)
      throwIfCancelled(signal)
      // COMMIT é o ponto de não retorno: cancelamentos observados antes dele
      // fazem ROLLBACK; depois de enviado, o resultado precisa ser tratado como
      // durável para o chamador não reportar falha sobre uma escrita confirmada.
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
      await execute(pool,'SELECT 1',[],{timeoutMs:runtimeConfig.databaseQueryTimeoutMs})
      return {configured:true,ready:true,mode:'postgresql'}
    }catch(error){
      return {configured:true,ready:false,mode:'postgresql',error:'Banco configurado, mas indisponível.'}
    }
  }

  return {configured:Boolean(pool),pool,query,transaction,health,close:()=>pool?.end()}
}
