import {randomUUID} from 'node:crypto'
import {hasTechnicalApproval} from './ingestion.js'

export function jsonbParameter(value){
  if(value===undefined)return null
  const serialized=JSON.stringify(value)
  if(serialized===undefined)throw new TypeError('O valor informado não pode ser serializado como JSON.')
  return serialized
}
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const parseMoney=value=>{
  if(typeof value==='number')return Number.isFinite(value)?value:null
  let raw=String(value||'').replace(/R\$|\s/g,'')
  if(!raw)return null
  if(raw.includes(',')&&raw.includes('.'))raw=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'')
  else if(raw.includes(','))raw=raw.replace(',','.')
  const normalized=raw.replace(/[^0-9.-]/g,'');if(!normalized||!/\d/.test(normalized))return null
  const number=Number(normalized);return Number.isFinite(number)?number:null
}
const parsedDate=value=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString()
  if(typeof value==='number'&&value>20_000)return new Date(Math.round((value-25_569)*86_400_000)).toISOString()
  const raw=String(value||'').trim();const br=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  const date=br?new Date(Date.UTC(Number(br[3].length===2?`20${br[3]}`:br[3]),Number(br[2])-1,Number(br[1]))):new Date(raw)
  if(!Number.isNaN(date.getTime()))return date.toISOString()
  return null
}
const parseDate=(value,fallback)=>parsedDate(value)||parsedDate(fallback)
const outcome=value=>/perd|cancel|recus|desist/i.test(String(value||''))?'lost':/ganh|fech|conclu|fatur|vend|aprov/i.test(String(value||''))?'won':/abert|andament|negocia|propost|pendente|\bopen\b/i.test(String(value||''))?'open':null
const serviceError=message=>Object.assign(new Error(message),{statusCode:503})
const domainError=(message,statusCode)=>Object.assign(new Error(message),{statusCode})
const iso=value=>value instanceof Date?value.toISOString():value
const jsonObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const snapshotFor=(result,source)=>({...jsonObject(result),profileVersion:String(result?.profileVersion||'producer-360-v1'),profileSource:source})
const clientFromRow=(row,{defaults=false}={})=>{
  const snapshot=jsonObject(row.profile_snapshot)
  return {...snapshot,
    id:row.external_key||row.id,
    name:row.name||snapshot.name,
    municipality:row.municipality||snapshot.municipality||(defaults?'A definir':null),
    area:row.total_area_ha??snapshot.area??(defaults?'A definir':null),
    cultures:row.cultures||snapshot.cultures||(defaults?'A definir':null),
    primaryProfile:row.primary_profile||snapshot.primaryProfile||(defaults?'A classificar':null),
    secondaryProfile:row.secondary_profile||snapshot.secondaryProfile||(defaults?'Aguardando observação':null),
    irt:row.irt_score==null?(snapshot.irt??0):Number(row.irt_score),
    nps:row.nps_score==null?(snapshot.nps??0):Number(row.nps_score),
    servicePreference:row.preferred_channel||snapshot.servicePreference,
    commercial:{...jsonObject(snapshot.commercial),...jsonObject(row.commercial_profile)},
    profileVersion:snapshot.profileVersion||null,
    profileSource:snapshot.profileSource||snapshot.source||null,
    profileUpdatedAt:iso(row.profile_assessed_at)||snapshot.profileUpdatedAt||null,
    profileValidUntil:iso(row.profile_valid_until)||null,
    source:'Banco VALOR 360'
  }
}
const surveyRecord=row=>({token:row.token,producerName:row.producer_name,consultantName:row.consultant_name,status:row.status,answers:row.answers||undefined,result:row.result||undefined,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at),submittedAt:iso(row.submitted_at),integratedAt:iso(row.integrated_at)})

export class ValRepository{
  constructor({db,readStore,saveStore,tenantId}){this.db=db;this.readStore=readStore;this.saveStore=saveStore;this.tenantId=tenantId}

  fallback(){
    const store=this.readStore();store.val||={recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{}};store.val.modelRuns||=[];store.val.technicalContexts||={};return store
  }

  async listSurveys(){
    if(!this.db.configured)return (this.readStore().surveys||[]).sort((left,right)=>String(right.createdAt).localeCompare(String(left.createdAt)))
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5000',[this.tenantId]);return result.rows.map(surveyRecord)}catch{throw serviceError('Os questionários não puderam ser lidos no PostgreSQL configurado.')}
  }

  async createSurvey({token,producerName,consultantName,createdAt,expiresAt}){
    if(!this.db.configured){const store=this.readStore();store.surveys||=[];const survey={token,producerName,consultantName,status:'aguardando',createdAt,expiresAt};store.surveys.push(survey);this.saveStore(store);return survey}
    try{const result=await this.db.query(`INSERT INTO survey_invitations (tenant_id,token,producer_name,consultant_name,status,created_at,expires_at) VALUES ($1,$2,$3,$4,'aguardando',$5,$6) RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,token,producerName||null,consultantName||null,createdAt,expiresAt]);return surveyRecord(result.rows[0])}catch{throw serviceError('O convite não pôde ser persistido no PostgreSQL configurado.')}
  }

  async getSurvey(token){
    if(!this.db.configured)return (this.readStore().surveys||[]).find(item=>item.token===token)||null
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 LIMIT 1',[this.tenantId,token]);return result.rows[0]?surveyRecord(result.rows[0]):null}catch{throw serviceError('O convite não pôde ser consultado no PostgreSQL configurado.')}
  }

  async submitSurvey({token,answers,result}){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token);if(!survey)throw domainError('Este convite não foi encontrado.',404);if(survey.expiresAt&&new Date(survey.expiresAt)<new Date())throw domainError('Este convite expirou.',410);if(survey.status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);survey.answers=answers;survey.result=result;survey.status='respondido';survey.submittedAt=new Date().toISOString();this.saveStore(store);return survey}
    try{return await this.db.transaction(async connection=>{const selected=await connection.query('SELECT status,expires_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 FOR UPDATE',[this.tenantId,token]);if(!selected.rowCount)throw domainError('Este convite não foi encontrado.',404);if(new Date(selected.rows[0].expires_at)<new Date())throw domainError('Este convite expirou.',410);if(selected.rows[0].status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);const updated=await connection.query(`UPDATE survey_invitations SET answers=$3,result=$4,status='respondido',submitted_at=NOW() WHERE tenant_id=$1 AND token=$2 RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,token,jsonbParameter(answers),jsonbParameter(result)]);return surveyRecord(updated.rows[0])})}catch(error){if(error.statusCode)throw error;throw serviceError('As respostas não puderam ser persistidas no PostgreSQL configurado.')}
  }

  async integrateSurvey(token){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token);if(!survey)throw domainError('Resposta não encontrada.',404);if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409);survey.status='integrado';survey.integratedAt=new Date().toISOString();this.saveStore(store);return survey}
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query('SELECT id,status,answers,result FROM survey_invitations WHERE tenant_id=$1 AND token=$2 FOR UPDATE',[this.tenantId,token]);if(!selected.rowCount)throw domainError('Resposta não encontrada.',404)
      const survey=selected.rows[0];if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409)
      if(survey.status!=='integrado'){
        const result=survey.result;const externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180)
        const client=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,cultures,preferred_channel,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','producer_360',NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=EXCLUDED.total_area_ha,cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,updated_at=NOW() RETURNING id`,[this.tenantId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,parseMoney(result.area),String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(result.commercial||{})])
        await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,valid_until,assessed_at,source_survey_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '180 days',NOW(),$10) ON CONFLICT (source_survey_id) DO NOTHING`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(survey.answers||{}),jsonbParameter([{source:'producer_360',survey_id:survey.id,self_reported:true}]),jsonbParameter(snapshotFor(result,'producer_360')),survey.id])
        await connection.query(`UPDATE survey_invitations SET client_id=$3,status='integrado',integrated_at=NOW() WHERE tenant_id=$1 AND token=$2`,[this.tenantId,token,client.rows[0].id])
      }
      const updated=await connection.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2',[this.tenantId,token]);return surveyRecord(updated.rows[0])
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A resposta não pôde ser integrada no PostgreSQL configurado.')}
  }

  async saveSurveyProfile({answers,result,source='assisted_survey'}){
    if(!this.db.configured)return result
    try{return await this.db.transaction(async connection=>{const externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180);const client=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,cultures,preferred_channel,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=EXCLUDED.total_area_ha,cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,updated_at=NOW() RETURNING id`,[this.tenantId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,parseMoney(result.area),String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(result.commercial||{}),source]);await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,valid_until,assessed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '180 days',NOW())`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(answers||{}),jsonbParameter([{source,self_reported:true}]),jsonbParameter(snapshotFor(result,source))]);return {...result,id:externalKey}})}catch{throw serviceError('O perfil assistido não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getIntelligence(){
    if(!this.db.configured){const store=this.readStore();const clients=new Map();store.imports?.forEach(record=>record.clients?.forEach(client=>clients.set(normalize(client.name),client)));return {imports:(store.imports||[]).map(({clients:ignored,...summary})=>summary),clients:[...clients.values()]}}
    try{
      const [importResult,clientResult]=await Promise.all([
        this.db.query('SELECT summary FROM import_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20',[this.tenantId]),
        this.db.query(`SELECT c.external_key,c.name,c.municipality,c.total_area_ha,c.cultures,c.preferred_channel,c.commercial_profile,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
            COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot
          FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
          LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
          WHERE c.tenant_id=$1 AND c.status='active' ORDER BY c.name LIMIT 5000`,[this.tenantId])
      ])
      return {imports:importResult.rows.map(row=>row.summary),clients:clientResult.rows.map(row=>clientFromRow(row,{defaults:true}))}
    }catch{throw serviceError('A carteira não pôde ser lida no PostgreSQL configurado.')}
  }

  async getClientContext({tenantId=this.tenantId,clientId,client={}}){
    if(!this.db.configured)return {client,signals:this.fallback().val.signals.filter(item=>!clientId||item.clientExternalKey===clientId).slice(-20),learning:this.fallbackLearning(clientId),memories:[]}
    try{
      const result=await this.db.query(`SELECT c.*,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.answers,p.evidence profile_evidence,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
        COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot,
        COALESCE((SELECT jsonb_agg(s ORDER BY s.created_at DESC) FROM (SELECT id,source_event_id,signal_type,severity,title,evidence,commercial_hypothesis,requires_agronomist,status,created_at FROM agronomic_signals WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key) ORDER BY created_at DESC LIMIT 20) s),'[]'::jsonb) signals,
        COALESCE((SELECT jsonb_build_object('wins',count(*) FILTER (WHERE outcome='won'),'losses',count(*) FILTER (WHERE outcome='lost'),'revenue',COALESCE(sum(value) FILTER (WHERE outcome='won'),0)) FROM business_events WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key)),'{}'::jsonb) learning,
        COALESCE((SELECT jsonb_build_object('rated',count(*),'average_rating',round(avg(f.rating)::numeric,2),'accepted',count(*) FILTER (WHERE f.outcome='accepted'),'edited',count(*) FILTER (WHERE f.outcome='edited'),'executed',count(*) FILTER (WHERE f.outcome='executed'),'won',count(*) FILTER (WHERE f.outcome='won'),'lost',count(*) FILTER (WHERE f.outcome='lost')) FROM val_feedback f JOIN val_recommendations r ON r.id=f.recommendation_id AND r.tenant_id=f.tenant_id WHERE f.tenant_id=$1 AND (r.client_id=c.id OR r.client_external_key=c.external_key)),'{}'::jsonb) feedback_learning,
        COALESCE((SELECT jsonb_agg(m ORDER BY m.valid_from DESC) FROM (SELECT id,memory_type,key,value,evidence,confidence,status,source,valid_from,valid_until FROM val_memories WHERE tenant_id=$1 AND client_id=c.id AND status IN ('verified','proposed') AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY valid_from DESC LIMIT 50) m),'[]'::jsonb) memories
        FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
        LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
        WHERE c.tenant_id=$1 AND (c.id::text=$2 OR c.external_key=$2) LIMIT 1`,[tenantId,clientId])
      if(!result.rows[0])throw Object.assign(new Error('Cliente não encontrado na base autorizada.'),{statusCode:404})
      const row=result.rows[0]
      const profileEvidence=Array.isArray(row.profile_evidence)?row.profile_evidence:[]
      return {client:{...clientFromRow(row),profileSelfReported:profileEvidence.some(item=>item?.self_reported===true),profileEvidence},signals:row.signals||[],learning:{...(row.learning||{}),recommendations:row.feedback_learning||{}},memories:row.memories||[]}
    }catch(error){if(error.statusCode===404)throw error;throw serviceError('O contexto do cliente não pôde ser lido no banco configurado.')}
  }

  async getTechnicalContext(clientId){
    if(!this.db.configured)return this.fallback().val.technicalContexts[clientId]||null
    try{const result=await this.db.query(`SELECT m.value,m.status,m.updated_at FROM clients c LEFT JOIN LATERAL (SELECT value,status,updated_at FROM val_memories WHERE tenant_id=c.tenant_id AND client_id=c.id AND key='consultant_technical_context' AND status IN ('proposed','verified') AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY valid_from DESC,updated_at DESC LIMIT 1) m ON true WHERE c.tenant_id=$1 AND (c.id::text=$2 OR c.external_key=$2) LIMIT 1`,[this.tenantId,clientId]);if(!result.rowCount)throw domainError('Cliente não encontrado na base autorizada.',404);return result.rows[0].value?{...result.rows[0].value,status:result.rows[0].status,updatedAt:iso(result.rows[0].updated_at)}:null}catch(error){if(error.statusCode)throw error;throw serviceError('O complemento técnico não pôde ser lido no PostgreSQL configurado.')}
  }

  async saveTechnicalContext(clientId,input){
    const allowed=['property','crops','area','weeds','diseases','insects','soil','goal','competitors','notes'];const value=Object.fromEntries(allowed.map(key=>[key,String(input?.[key]||'').trim().slice(0,key==='notes'?10_000:2_000)]));const observedAt=new Date().toISOString()
    if(!this.db.configured){const store=this.fallback();store.val.technicalContextHistory||=[];const previous=store.val.technicalContexts[clientId];if(previous)store.val.technicalContextHistory.push({...previous,clientId,status:'expired',validUntil:observedAt});store.val.technicalContextHistory=store.val.technicalContextHistory.slice(-1000);store.val.technicalContexts[clientId]={...value,status:'proposed',updatedAt:observedAt};this.saveStore(store);return store.val.technicalContexts[clientId]}
    try{return await this.db.transaction(async connection=>{const client=await connection.query('SELECT id FROM clients WHERE tenant_id=$1 AND (id::text=$2 OR external_key=$2) LIMIT 1 FOR UPDATE',[this.tenantId,clientId]);if(!client.rowCount)throw domainError('Cliente não encontrado na base autorizada.',404);const expired=await connection.query(`UPDATE val_memories SET status='expired',valid_until=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND client_id=$2 AND key='consultant_technical_context' AND status IN ('proposed','verified') RETURNING id`,[this.tenantId,client.rows[0].id]);const evidence=jsonbParameter([{source:'consultant_input',observed_at:observedAt,verification:'pending',supersedes:(expired.rows||[]).map(item=>item.id)}]);await connection.query(`INSERT INTO val_memories (tenant_id,client_id,memory_type,key,value,evidence,status,source,valid_from,created_at,updated_at) VALUES ($1,$2,'fact','consultant_technical_context',$3,$4,'proposed','consultant_input',NOW(),NOW(),NOW())`,[this.tenantId,client.rows[0].id,jsonbParameter(value),evidence]);return {...value,status:'proposed',updatedAt:observedAt}})}catch(error){if(error.statusCode)throw error;throw serviceError('O complemento técnico não pôde ser salvo no PostgreSQL configurado.')}
  }

  fallbackLearning(clientId){
    const events=this.fallback().val.integrationEvents.filter(item=>!clientId||item.clientExternalKey===clientId)
    return {wins:events.filter(item=>item.type==='business.closed').length,losses:events.filter(item=>item.type==='business.lost').length,revenue:events.filter(item=>item.type==='business.closed').reduce((sum,item)=>sum+Number(item.payload?.value||0),0)}
  }

  async recordRecommendation(record){
    const id=record.id||randomUUID()
    if(this.db.configured){
      try{
        await this.db.transaction(async connection=>{
          let clientId=null;let clientExternalKey=record.clientId||null
          if(record.clientId){const resolved=await connection.query('SELECT id,external_key FROM clients WHERE tenant_id=$1 AND (id::text=$2 OR external_key=$2) LIMIT 1',[record.tenantId||this.tenantId,record.clientId]);clientId=resolved.rows[0]?.id||null;clientExternalKey=resolved.rows[0]?.external_key||clientExternalKey}
          const sourceIds=(record.advice?.evidence_used||[]).map(item=>item.source_id).filter(Boolean)
          const recommendationStatus=record.advice?.human_review?.required?'pending_review':'generated'
          await connection.query(`INSERT INTO val_recommendations (id,tenant_id,client_id,client_external_key,user_question,mode,model_version,prompt_version,input_context,source_ids,generated_content,confidence,status,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,[id,record.tenantId||this.tenantId,clientId,clientExternalKey,record.question,record.mode,record.model,record.promptHash||null,jsonbParameter(record.context),jsonbParameter(sourceIds),jsonbParameter(record.advice),record.advice?.confidence?.score??null,recommendationStatus])
          if(record.modelRun){const run=record.modelRun;await connection.query(`INSERT INTO model_runs (id,tenant_id,recommendation_id,model,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,error_details,provider_response_id,provider_request_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,[randomUUID(),record.tenantId||this.tenantId,id,run.model,run.promptVersion||null,run.latencyMs||null,run.inputTokens||null,run.outputTokens||null,run.status,run.errorCode||null,jsonbParameter(run.errorDetails),run.responseId||null,run.requestId||null])}
        })
        return id
      }catch{throw serviceError('Não foi possível persistir a recomendação no banco configurado.')}
    }
    const store=this.fallback();const {modelRun,...recommendation}=record;store.val.recommendations.push({...recommendation,id,createdAt:new Date().toISOString()});store.val.recommendations=store.val.recommendations.slice(-500);if(modelRun){store.val.modelRuns.push({...modelRun,recommendationId:id,id:randomUUID(),createdAt:new Date().toISOString()});store.val.modelRuns=store.val.modelRuns.slice(-1000)}this.saveStore(store);return id
  }

  async recordModelRun(record){
    const id=randomUUID()
    if(this.db.configured){
      try{await this.db.query(`INSERT INTO model_runs (id,tenant_id,recommendation_id,model,prompt_version,latency_ms,input_tokens,output_tokens,status,error_code,error_details,provider_response_id,provider_request_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,[id,record.tenantId||this.tenantId,record.recommendationId,record.model,record.promptVersion||null,record.latencyMs||null,record.inputTokens||null,record.outputTokens||null,record.status,record.errorCode||null,jsonbParameter(record.errorDetails),record.responseId||null,record.requestId||null]);return id}catch{throw serviceError('Não foi possível registrar a execução do modelo no banco configurado.')}
    }
    const store=this.fallback();store.val.modelRuns.push({...record,id,createdAt:new Date().toISOString()});store.val.modelRuns=store.val.modelRuns.slice(-1000);this.saveStore(store);return id
  }

  async recordFeedback(feedback){
    const id=randomUUID()
    if(this.db.configured){
      try{
        const inserted=await this.db.query(`INSERT INTO val_feedback (id,tenant_id,recommendation_id,rating,outcome,value,reason,notes,created_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,NOW() FROM val_recommendations WHERE id=$3 AND tenant_id=$2
          ON CONFLICT (tenant_id,recommendation_id) DO UPDATE SET rating=EXCLUDED.rating,outcome=EXCLUDED.outcome,value=EXCLUDED.value,reason=EXCLUDED.reason,notes=EXCLUDED.notes,created_at=NOW() RETURNING id`,[id,feedback.tenantId||this.tenantId,feedback.recommendationId,feedback.rating,feedback.outcome||null,feedback.value??null,feedback.reason||null,feedback.notes||null])
        if(!inserted.rowCount)throw new Error('recommendation-not-found')
        return inserted.rows[0].id
      }catch{throw serviceError('Não foi possível persistir o feedback no banco configurado.')}
    }
    const store=this.fallback();if(!store.val.recommendations.some(item=>item.id===feedback.recommendationId))throw Object.assign(new Error('A recomendação informada não existe.'),{statusCode:404});store.val.feedback.push({...feedback,id,createdAt:new Date().toISOString()});store.val.feedback=store.val.feedback.slice(-1000);this.saveStore(store);return id
  }

  async ingestEvent({tenantId=this.tenantId,event,signals=[]}){
    if(this.db.configured){
      try{
        return await this.db.transaction(async client=>{
          const inserted=await client.query(`INSERT INTO integration_events (tenant_id,external_id,event_type,schema_version,source,occurred_at,client_external_key,property_external_key,field_external_key,payload,payload_hash,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'processed') ON CONFLICT (tenant_id,source,external_id) DO NOTHING RETURNING id`,[tenantId,event.externalId,event.type,event.schemaVersion,event.source,event.occurredAt,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,jsonbParameter(event.payload),event.payloadHash])
          if(!inserted.rowCount){
            const existing=await client.query('SELECT payload_hash FROM integration_events WHERE tenant_id=$1 AND source=$2 AND external_id=$3 LIMIT 1',[tenantId,event.source,event.externalId])
            if(String(existing.rows[0]?.payload_hash||'')!==String(event.payloadHash||''))throw domainError('O externalId já foi usado com um conteúdo diferente.',409)
            return {duplicate:true,signals:0}
          }
          const resolveId=async(table,externalKey)=>{if(!externalKey)return null;const found=await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND (id::text=$2 OR external_key=$2) LIMIT 1`,[tenantId,externalKey]);return found.rows[0]?.id||null}
          const [resolvedClientId,resolvedPropertyId,resolvedFieldId]=await Promise.all([resolveId('clients',event.clientExternalKey),resolveId('properties',event.propertyExternalKey),resolveId('fields',event.fieldExternalKey)])
          const approved=hasTechnicalApproval(event.payload);const validation=event.payload.validation||{}
          if(event.type==='field_report.completed'){
            const report=await client.query(`INSERT INTO field_reports (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,observed_at,crop_stage,summary,validated_actions,validation_evidence,validated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,observed_at=EXCLUDED.observed_at,crop_stage=EXCLUDED.crop_stage,summary=EXCLUDED.summary,validated_actions=EXCLUDED.validated_actions,validation_evidence=EXCLUDED.validation_evidence,validated_at=EXCLUDED.validated_at RETURNING id`,[tenantId,resolvedClientId,resolvedPropertyId,resolvedFieldId,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,event.source,event.externalId,parseDate(event.payload.observedAt,event.occurredAt),String(event.payload.cropStage||'').slice(0,100)||null,String(event.payload.summary||'').slice(0,10_000)||null,jsonbParameter(approved&&Array.isArray(event.payload.validatedActions)?event.payload.validatedActions:[]),jsonbParameter(validation),approved?parseDate(validation.reviewedAt,event.occurredAt):null])
            for(const finding of Array.isArray(event.payload.findings)?event.payload.findings.slice(0,100):[]){const item=finding&&typeof finding==='object'?finding:{text:String(finding)};const confidence=Number.isFinite(Number(item.confidence))?Math.max(0,Math.min(100,Math.round(Number(item.confidence)))):null;await client.query(`INSERT INTO field_observations (tenant_id,report_id,observation_type,value,unit,confidence,evidence_ref,requires_review) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantId,report.rows[0].id,String(item.type||'finding').slice(0,80),jsonbParameter(item),String(item.unit||'').slice(0,60)||null,confidence,String(item.evidenceRef||'').slice(0,500)||null,!approved])}
          }
          if(event.type==='soil_analysis.completed'){
            const analysis=await client.query(`INSERT INTO soil_analyses (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,laboratory,method,depth_from_cm,depth_to_cm,sampled_at,validated_flags,validation_evidence,validated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,laboratory=EXCLUDED.laboratory,method=EXCLUDED.method,depth_from_cm=EXCLUDED.depth_from_cm,depth_to_cm=EXCLUDED.depth_to_cm,sampled_at=EXCLUDED.sampled_at,validated_flags=EXCLUDED.validated_flags,validation_evidence=EXCLUDED.validation_evidence,validated_at=EXCLUDED.validated_at RETURNING id`,[tenantId,resolvedClientId,resolvedPropertyId,resolvedFieldId,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,event.source,event.externalId,String(event.payload.laboratory||'').slice(0,180)||null,String(event.payload.method||'').slice(0,180)||null,parseMoney(event.payload.depthFromCm),parseMoney(event.payload.depthToCm),parseDate(event.payload.sampledAt,event.occurredAt),jsonbParameter(approved&&Array.isArray(event.payload.validatedFlags)?event.payload.validatedFlags:[]),jsonbParameter(validation),approved?parseDate(validation.reviewedAt,event.occurredAt):null])
            for(const measurement of Array.isArray(event.payload.measurements)?event.payload.measurements.slice(0,500):[]){if(!measurement?.analyte)continue;const confidence=Number.isFinite(Number(measurement.confidence))?Math.max(0,Math.min(100,Math.round(Number(measurement.confidence)))):null;await client.query(`INSERT INTO soil_measurements (tenant_id,analysis_id,sample_key,analyte,raw_value,raw_unit,normalized_value,normalized_unit,method,interpretation,confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[tenantId,analysis.rows[0].id,String(measurement.sampleKey||'').slice(0,120)||null,String(measurement.analyte).slice(0,120),parseMoney(measurement.rawValue??measurement.value),String(measurement.rawUnit||measurement.unit||'').slice(0,80)||null,parseMoney(measurement.normalizedValue),String(measurement.normalizedUnit||'').slice(0,80)||null,String(measurement.method||event.payload.method||'').slice(0,180)||null,String(measurement.interpretation||'').slice(0,240)||null,confidence])}
          }
          if(event.type==='ndvi.observation'){
            await client.query(`INSERT INTO ndvi_observations (tenant_id,client_id,property_id,field_id,client_external_key,property_external_key,field_external_key,source,external_id,index_name,observed_at,sensor,resolution_m,cloud_percent,processing_version,geometry_version,statistics,anomaly,raster_uri,validated_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,property_id=EXCLUDED.property_id,field_id=EXCLUDED.field_id,observed_at=EXCLUDED.observed_at,sensor=EXCLUDED.sensor,resolution_m=EXCLUDED.resolution_m,cloud_percent=EXCLUDED.cloud_percent,processing_version=EXCLUDED.processing_version,geometry_version=EXCLUDED.geometry_version,statistics=EXCLUDED.statistics,anomaly=EXCLUDED.anomaly,raster_uri=EXCLUDED.raster_uri,validated_at=EXCLUDED.validated_at`,[tenantId,resolvedClientId,resolvedPropertyId,resolvedFieldId,event.clientExternalKey||null,event.propertyExternalKey||null,event.fieldExternalKey||null,event.source,event.externalId,String(event.payload.index||'NDVI').slice(0,30),parseDate(event.payload.observedAt,event.occurredAt),String(event.payload.sensor||'').slice(0,100)||null,parseMoney(event.payload.resolutionM),parseMoney(event.payload.cloudPercent),String(event.payload.processingVersion||'').slice(0,80)||null,String(event.payload.geometryVersion||'').slice(0,80)||null,jsonbParameter(event.payload.statistics||{}),jsonbParameter({flag:event.payload.anomaly===true,classification:event.payload.classification||null,changePercent:parseMoney(event.payload.changePercent)}),String(event.payload.rasterUri||'').slice(0,2000)||null,approved?parseDate(validation.reviewedAt,event.occurredAt):null])
          }
          for(const item of signals)await client.query(`INSERT INTO agronomic_signals (tenant_id,client_id,client_external_key,property_id,property_external_key,field_id,field_external_key,source_event_id,signal_type,severity,title,evidence,commercial_hypothesis,requires_agronomist,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[tenantId,resolvedClientId,event.clientExternalKey||null,resolvedPropertyId,event.propertyExternalKey||null,resolvedFieldId,event.fieldExternalKey||null,inserted.rows[0].id,item.type,item.severity,item.title,jsonbParameter(item.evidence),item.commercialHypothesis,item.requiresAgronomist,item.status])
          if(event.type.startsWith('business.'))await client.query(`INSERT INTO business_events (tenant_id,client_id,client_external_key,source,external_id,occurred_at,outcome,category,value,currency,loss_reason,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id,source,external_id) DO NOTHING`,[tenantId,resolvedClientId,event.clientExternalKey||null,event.source,event.externalId,event.occurredAt,event.type==='business.closed'?'won':event.type==='business.lost'?'lost':'open',event.payload.category||null,parseMoney(event.payload.value),/^[A-Z]{3}$/.test(String(event.payload.currency||'').toUpperCase())?String(event.payload.currency).toUpperCase():'BRL',event.payload.lossReason||event.payload.reason||null,jsonbParameter(event.payload)])
          return {duplicate:false,signals:signals.length}
        })
      }catch(error){if(error.statusCode)throw error;throw serviceError('Não foi possível persistir o evento de integração no banco configurado.')}
    }
    const store=this.fallback();const duplicate=store.val.integrationEvents.some(item=>item.externalId===event.externalId&&item.source===event.source)
    if(duplicate)return {duplicate:true,signals:0}
    store.val.integrationEvents.push({...event,ingestedAt:new Date().toISOString()});store.val.signals.push(...signals.map(item=>({...item,id:randomUUID(),clientExternalKey:event.clientExternalKey,sourceExternalId:event.externalId,createdAt:new Date().toISOString()})));store.val.integrationEvents=store.val.integrationEvents.slice(-1000);store.val.signals=store.val.signals.slice(-1000);this.saveStore(store);return {duplicate:false,signals:signals.length}
  }

  async ingestCommercialImport({tenantId=this.tenantId,summary,clients,rows=[],mapping={}}){
    if(!this.db.configured)return {persisted:false}
    try{
      await this.db.transaction(async connection=>{
        await connection.query(`INSERT INTO import_jobs (id,tenant_id,source_type,file_name,status,row_count,recognized_count,summary,completed_at) VALUES ($1,$2,'commercial_history',$3,'completed',$4,$5,$6,NOW()) ON CONFLICT (id) DO NOTHING`,[summary.id,tenantId,summary.fileName,summary.rowCount,clients.length,jsonbParameter(summary)])
        const clientInternalIds=new Map()
        for(const item of clients.slice(0,2000)){const upserted=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'active','commercial_import',NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=COALESCE(EXCLUDED.municipality,clients.municipality),total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),commercial_profile=EXCLUDED.commercial_profile,updated_at=NOW() RETURNING id,external_key`,[tenantId,String(item.id||'').slice(0,180),String(item.name||'').slice(0,180),item.municipality||null,parseMoney(item.area),jsonbParameter(item.commercial||{})]);clientInternalIds.set(upserted.rows[0].external_key,upserted.rows[0].id)}
        const clientKeys=new Map(clients.map(item=>[normalize(item.name),item.id]))
        for(let index=0;index<rows.slice(0,5000).length;index++){
          const row=rows[index]||{};const name=String(row[mapping.client]||'').trim();if(!name)continue
          const status=mapping.status?row[mapping.status]:null;const eventOutcome=outcome(status);const occurredAt=parsedDate(mapping.date?row[mapping.date]:null)
          if(!eventOutcome||!occurredAt)continue
          const safeRow={client:name.slice(0,180),value:row[mapping.value]??null,date:row[mapping.date]??null,product:String(row[mapping.product]||'').slice(0,180)||null,status:String(status||'').slice(0,240)||null,municipality:String(row[mapping.municipality]||'').slice(0,140)||null,culture:String(row[mapping.culture]||'').slice(0,160)||null,area:row[mapping.area]??null}
          const externalKey=clientKeys.get(normalize(name))||normalize(name).replace(/\s+/g,'-').slice(0,180)
          await connection.query(`INSERT INTO business_events (tenant_id,client_id,client_external_key,source,external_id,occurred_at,outcome,category,product,value,currency,loss_reason,payload)
            VALUES ($1,$2,$3,'commercial_import',$4,$5,$6,$7,$8,$9,'BRL',$10,$11) ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET client_id=EXCLUDED.client_id,client_external_key=EXCLUDED.client_external_key,occurred_at=EXCLUDED.occurred_at,outcome=EXCLUDED.outcome,category=EXCLUDED.category,product=EXCLUDED.product,value=EXCLUDED.value,loss_reason=EXCLUDED.loss_reason,payload=EXCLUDED.payload`,[tenantId,clientInternalIds.get(externalKey)||null,externalKey,`${summary.id}:${index+1}`,occurredAt,eventOutcome,String(row[mapping.product]||'').trim()||null,String(row[mapping.product]||'').trim()||null,parseMoney(row[mapping.value]),eventOutcome==='lost'?String(status||'').slice(0,240):null,jsonbParameter(safeRow)])
        }
      })
      return {persisted:true,rawRows:Math.min(rows.length,5000),truncated:Boolean(summary.truncated)}
    }catch{throw serviceError('A importação não pôde ser persistida no PostgreSQL configurado.')}
  }
}
