import {createHash} from 'node:crypto'
import {expectedIndexContract,expectedSchemaContract,sqlSources} from './lib/schema-contract.mjs'

const sources=await sqlSources()
const contract=await expectedSchemaContract()
const indexes=await expectedIndexContract()
const embedded=[...sources[0].sql.matchAll(/schema_migrations\s*\(version\)\s*VALUES\s*\('([^']+)'\)/gi)].map(match=>match[1])
const inventory={
  generatedAt:new Date().toISOString(),
  sources:sources.map(source=>({name:source.name,sha256:createHash('sha256').update(source.sql).digest('hex'),lines:source.sql.split(/\r?\n/).length})),
  tables:[...contract].sort(([left],[right])=>left.localeCompare(right)).map(([table,columns])=>({table,columnCount:columns.size})),
  explicitIndexCount:indexes.size,
  embeddedHistoricalVersions:[...new Set(embedded)].sort(),
  policy:'database/schema.sql permanece como baseline histórico; novas mudanças vivem em database/migrations e têm checksum imutável.'
}
console.log(JSON.stringify(inventory,null,2))
