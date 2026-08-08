import {createReadStream} from 'node:fs'
import {readdir} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import OpenAI from 'openai'
import {config} from './config.js'

if(!config.openaiApiKey)throw new Error('Cadastre OPENAI_API_KEY como segredo antes de sincronizar conhecimento.')

const client=new OpenAI({apiKey:config.openaiApiKey,project:config.openaiProject||undefined})
const here=dirname(fileURLToPath(import.meta.url));const approvedDir=join(here,'..','knowledge','approved')
const names=(await readdir(approvedDir)).filter(name=>/\.(md|txt|pdf)$/i.test(name)).sort()
if(!names.length)throw new Error('Nenhum material aprovado foi encontrado em knowledge/approved.')

const vectorStoreId=(await client.vectorStores.create({name:`VALOR 360 — conhecimento aprovado ${new Date().toISOString()}`})).id
const batch=await client.vectorStores.fileBatches.uploadAndPoll(vectorStoreId,{files:names.map(name=>createReadStream(join(approvedDir,name)))})
if(batch.file_counts?.failed)throw new Error(`A sincronização falhou para ${batch.file_counts.failed} arquivo(s). O vector store ${vectorStoreId} não deve ser ativado.`)
console.log(`Conhecimento versionado com ${batch.file_counts?.completed??names.length} arquivo(s). Cadastre VAL_KNOWLEDGE_VECTOR_STORE_ID=${vectorStoreId} como variável privada; valide a nova base antes de excluir a versão anterior.`)
