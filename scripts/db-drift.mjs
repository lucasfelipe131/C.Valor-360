import pg from 'pg'
import {expectedIndexContract,expectedSchemaContract} from './lib/schema-contract.mjs'

const connectionString=String(process.env.DRIFT_DATABASE_URL||'').trim()
if(!connectionString)throw new Error('Defina DRIFT_DATABASE_URL para um banco controlado; produção não é assumida.')
const pool=new pg.Pool({connectionString,max:1,ssl:/railway\.internal/.test(connectionString)?undefined:{rejectUnauthorized:false}})
try{
  const expected=await expectedSchemaContract()
  const expectedIndexes=await expectedIndexContract()
  const actualRows=await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)
  const actual=new Map()
  for(const row of actualRows.rows){const columns=actual.get(row.table_name)||new Set();columns.add(row.column_name);actual.set(row.table_name,columns)}
  const missingTables=[];const missingColumns=[];const unexpectedTables=[];const unexpectedColumns=[]
  for(const [table,columns] of expected){
    if(!actual.has(table)){missingTables.push(table);continue}
    for(const column of columns)if(!actual.get(table).has(column))missingColumns.push(`${table}.${column}`)
    for(const column of actual.get(table))if(!columns.has(column))unexpectedColumns.push(`${table}.${column}`)
  }
  for(const table of actual.keys())if(!expected.has(table))unexpectedTables.push(table)
  const actualIndexRows=await pool.query("SELECT indexname,tablename FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")
  const actualIndexes=new Map(actualIndexRows.rows.map(row=>[row.indexname,row.tablename]))
  const constraintIndexRows=await pool.query("SELECT index_record.relname indexname FROM pg_constraint constraint_record JOIN pg_class table_record ON table_record.oid=constraint_record.conrelid JOIN pg_namespace namespace_record ON namespace_record.oid=table_record.relnamespace JOIN pg_class index_record ON index_record.oid=constraint_record.conindid WHERE namespace_record.nspname='public' AND constraint_record.conindid<>0")
  const constraintIndexes=new Set(constraintIndexRows.rows.map(row=>row.indexname))
  const missingIndexes=[...expectedIndexes].filter(([name,table])=>actualIndexes.get(name)!==table).map(([name])=>name)
  const unexpectedIndexes=[...actualIndexes.keys()].filter(name=>!expectedIndexes.has(name)&&!constraintIndexes.has(name))
  const result={checkedAt:new Date().toISOString(),database:(await pool.query('SELECT current_database() name')).rows[0].name,missingTables,missingColumns,missingIndexes,unexpectedTables,unexpectedColumns,unexpectedIndexes,driftDetected:Boolean(missingTables.length||missingColumns.length||missingIndexes.length||unexpectedTables.length||unexpectedColumns.length||unexpectedIndexes.length)}
  console.log(JSON.stringify(result,null,2))
  if(missingTables.length||missingColumns.length||missingIndexes.length||process.argv.includes('--strict')&&(unexpectedTables.length||unexpectedColumns.length||unexpectedIndexes.length))process.exitCode=1
}finally{await pool.end()}
