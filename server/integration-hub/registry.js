import {createHash} from 'node:crypto'
import {supportedIntegrationEvents} from '../ingestion.js'

// Each connector must normalize into VAL's existing event contract and project through
// an existing domain repository. Registration alone never enables an external service.
export const HUB_CONTRACT_VERSION=1
export const SOURCE_SYSTEMS=Object.freeze({
 'manual-do-agronomo':Object.freeze({id:'manual-do-agronomo',name:'Manual do Agrônomo',category:'agronomy',contractVersion:1,status:'ENABLED',authentication:'EXISTING_SIGNED_WEBHOOK',events:Object.freeze([...supportedIntegrationEvents])})
})
export const HUB_STATUSES=Object.freeze(['PROCESSED','OLDER','DUPLICATE','CONFLICT','REVIEW_REQUIRED','REJECTED','FAILED'])
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
export const contentHash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const text=value=>String(value||'').trim().slice(0,180)
export function describeEvent(event){
 const p=event.payload||{}
 const producerId=text(p.identity?.producerId||p.producer?.id||p.producerId)
 const entityId=text(event.type==='manual.producer.updated'?(producerId||event.clientExternalKey):event.type==='manual.workspace.updated'?(p.workspaceId||event.ownerUserId||'workspace'):event.type==='manual.record.saved'?(p.record?.id||p.recordId||p.id||event.externalId):event.type==='soil_analysis.completed'?(p.analysisExternalId||event.externalId):event.type==='agronomic.scan.completed'?(p.resultReference||event.externalId):(p.recordId||p.id||event.externalId))
 const sourceVersion=event.sourceVersion??p.sourceVersion??null
 if(sourceVersion!==null&&(!Number.isSafeInteger(Number(sourceVersion))||Number(sourceVersion)<0))throw Object.assign(new Error('Versão de origem inválida.'),{statusCode:422,code:'hub_version_invalid'})
 const payloadHash=contentHash(p)
 // Legacy publishers regenerate occurredAt on retries. Their immutable externalId,
 // content, target and explicit version define a delivery, not the retry clock.
 const envelopeHash=contentHash({type:event.type,schemaVersion:event.schemaVersion,source:event.source,client:event.clientExternalKey||'',property:event.propertyExternalKey||'',field:event.fieldExternalKey||'',sourceVersion,payload:p})
 return {producerId,entityId,entityType:event.type,sourceVersion:sourceVersion===null?null:Number(sourceVersion),payloadHash,envelopeHash,observedAt:p.observedAt||event.occurredAt}
}
