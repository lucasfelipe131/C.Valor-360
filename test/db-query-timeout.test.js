import assert from 'node:assert/strict'
import test from 'node:test'
import {createDatabase} from '../server/db.js'

test('query_timeout é opt-in no pool e transação aplica o orçamento configurado por padrão',async()=>{
  const calls=[]
  const client={
    async query(...args){calls.push({scope:'client',args});return {rowCount:1,rows:[{ok:true}]}},
    release(){}
  }
  class FakePool{
    async query(...args){calls.push({scope:'pool',args});return {rowCount:1,rows:[{ok:true}]}}
    async connect(){return client}
    async end(){}
  }
  const database=createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false,databaseQueryTimeoutMs:3_000},{PoolClass:FakePool})

  await database.query('SELECT $1::int value',[1])
  await database.query('SELECT pg_sleep($1)',[1],{timeoutMs:750})
  await database.transaction(async connection=>{
    await connection.query('SELECT 2')
    await connection.query('SELECT pg_sleep($1)',[1],{queryTimeoutMs:900})
  })
  await database.health()
  await database.close()

  assert.deepEqual(calls[0],{scope:'pool',args:['SELECT $1::int value',[1]]})
  assert.deepEqual(calls[1],{scope:'pool',args:[{text:'SELECT pg_sleep($1)',values:[1],query_timeout:750}]})
  assert.deepEqual(calls[2],{scope:'client',args:['BEGIN']})
  assert.deepEqual(calls[3],{scope:'client',args:[{text:'SELECT 2',values:[],query_timeout:3_000}]})
  assert.deepEqual(calls[4],{scope:'client',args:[{text:'SELECT pg_sleep($1)',values:[1],query_timeout:900}]})
  assert.deepEqual(calls[5],{scope:'client',args:['COMMIT']})
  assert.deepEqual(calls[6],{scope:'pool',args:[{text:'SELECT 1',values:[],query_timeout:3_000}]})
})

test('cancelamento observado durante COMMIT respeita o ponto de não retorno e não reporta rollback falso',async()=>{
  const controller=new AbortController()
  const cancelled=Object.assign(new Error('deadline no commit'),{name:'AbortError',statusCode:504,code:'val_chat_timeout'})
  const statements=[]
  const client={
    async query(...args){
      const text=typeof args[0]==='string'?args[0]:args[0]?.text
      statements.push(text)
      if(text==='COMMIT')controller.abort(cancelled)
      return {rowCount:1,rows:[]}
    },
    release(){}
  }
  class FakePool{async connect(){return client}async end(){}}
  const database=createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false,databaseQueryTimeoutMs:3_000},{PoolClass:FakePool})

  const result=await database.transaction(async connection=>{await connection.query('INSERT INTO controlled_write VALUES (1)');return 'committed'},{signal:controller.signal})
  assert.equal(result,'committed')
  assert.deepEqual(statements,['BEGIN','INSERT INTO controlled_write VALUES (1)','COMMIT'])
})

test('cancelamento durante query transacional força rollback e impede commit',async()=>{
  const controller=new AbortController()
  const cancelled=Object.assign(new Error('request superseded'),{name:'AbortError',statusCode:409,code:'val_request_superseded'})
  const statements=[]
  const client={
    async query(...args){
      const text=typeof args[0]==='string'?args[0]:args[0]?.text
      statements.push(text)
      if(text==='INSERT INTO controlled_write VALUES (1)')controller.abort(cancelled)
      return {rowCount:1,rows:[]}
    },
    release(){}
  }
  class FakePool{async connect(){return client}async end(){}}
  const database=createDatabase({databaseUrl:'postgres://controlado',databaseSsl:false,databaseQueryTimeoutMs:3_000},{PoolClass:FakePool})

  await assert.rejects(
    database.transaction(connection=>connection.query('INSERT INTO controlled_write VALUES (1)'),{signal:controller.signal}),
    error=>error===cancelled
  )
  assert.deepEqual(statements,['BEGIN','INSERT INTO controlled_write VALUES (1)','ROLLBACK'])
})
