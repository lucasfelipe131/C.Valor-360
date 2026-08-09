import {createHash,randomUUID} from 'node:crypto'
import {hasTechnicalApproval} from './ingestion.js'
import {additionalNeedState,hasIndependentOpportunity,isQ27Opportunity,normalizeText,opportunityFromAdditionalNeed,q27OpportunityProvenance} from '../src/lib/profile.js'

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
  else if(/^-?\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'')
  const normalized=raw.replace(/[^0-9.-]/g,'');if(!normalized||!/\d/.test(normalized))return null
  const number=Number(normalized);return Number.isFinite(number)?number:null
}
export const parseCultivatedArea=value=>{
  const raw=String(value??'').trim()
  if(!raw)return {totalAreaHa:null,areaBand:null}
  if(/\b(?:acima|abaixo|até|ate|entre)\b/i.test(raw)||/\bde\s+\d[\d.,]*\s+a\s+\d/i.test(raw))return {totalAreaHa:null,areaBand:raw.slice(0,120)}
  const numeric=raw.match(/-?\d[\d.,]*/)?.[0]||raw
  return {totalAreaHa:parseMoney(numeric),areaBand:null}
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
const profileSourceKey=(source,externalKey,answers)=>`${source}:${externalKey}:${createHash('sha256').update(JSON.stringify(answers||{})).digest('hex')}`.slice(0,240)
const sanitizeProfileResult=value=>{
  const result=jsonObject(value);if(!Object.keys(result).length)return value
  const commercial={...jsonObject(result.commercial)}
  if('opportunity' in commercial)commercial.opportunity=opportunityFromAdditionalNeed(commercial.opportunity)
  const hasAdditionalNeed='additionalNeed' in result
  const additionalNeed=result.additionalNeed==null?null:String(result.additionalNeed).trim()||null
  const needState=additionalNeedState(additionalNeed)
  if(hasAdditionalNeed){commercial.opportunity=opportunityFromAdditionalNeed(additionalNeed);commercial.opportunityProvenance=q27OpportunityProvenance(needState)}
  return {...result,...(hasAdditionalNeed?{additionalNeed,additionalNeedStatus:needState}:{}),...(hasAdditionalNeed||'commercial' in result?{commercial}:{})}
}
const canonicalSurveyCommercial=(result,currentValue,previousValue)=>{
  const incoming={...jsonObject(result?.commercial)}
  if(isQ27Opportunity(incoming)){delete incoming.opportunity;delete incoming.opportunityProvenance}
  const current={...jsonObject(currentValue)}
  const previous=jsonObject(sanitizeProfileResult(previousValue))
  const currentRaw=String(current.opportunity??'').trim();const previousNeed=String(previous.additionalNeed??'').trim()
  const legacyQ27=Boolean(currentRaw&&previousNeed&&!hasIndependentOpportunity(current)&&normalizeText(currentRaw)===normalizeText(previousNeed))
  if(isQ27Opportunity(current)||legacyQ27){delete current.opportunity;delete current.opportunityProvenance}
  return {...incoming,...current}
}
const surveyCommercialForWrite=async(connection,tenantId,externalKey,result)=>{
  await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0))`,[tenantId,externalKey])
  const existing=await connection.query(`SELECT c.commercial_profile,(SELECT p.profile_snapshot FROM client_profiles p WHERE p.tenant_id=c.tenant_id AND p.client_id=c.id ORDER BY p.assessed_at DESC LIMIT 1) profile_snapshot FROM clients c WHERE c.tenant_id=$1 AND c.external_key=$2 LIMIT 1 FOR UPDATE`,[tenantId,externalKey])
  return canonicalSurveyCommercial(result,existing.rows[0]?.commercial_profile,existing.rows[0]?.profile_snapshot)
}
const clientFromRow=(row,{defaults=false}={})=>{
  const snapshot=jsonObject(sanitizeProfileResult(row.profile_snapshot))
  const rowCommercial=jsonObject(row.commercial_profile)
  const commercial={...jsonObject(snapshot.commercial),...rowCommercial}
  if(rowCommercial.opportunity&&!rowCommercial.opportunityProvenance&&hasIndependentOpportunity(rowCommercial))commercial.opportunityProvenance={origin:'legacy_commercial',field:'opportunity',state:'reported'}
  if('opportunity' in commercial)commercial.opportunity=opportunityFromAdditionalNeed(commercial.opportunity)
  return {...snapshot,
    id:row.external_key||row.id,
    name:row.name||snapshot.name,
    municipality:row.municipality||snapshot.municipality||(defaults?'A definir':null),
    area:row.area_band||(row.total_area_ha==null?(snapshot.area??(defaults?'A definir':null)):Number(row.total_area_ha)),
    cultures:row.cultures||snapshot.cultures||(defaults?'A definir':null),
    primaryProfile:row.primary_profile||snapshot.primaryProfile||(defaults?'A classificar':null),
    secondaryProfile:row.secondary_profile||snapshot.secondaryProfile||(defaults?'Aguardando observação':null),
    irt:row.irt_score==null?(snapshot.irt??0):Number(row.irt_score),
    nps:row.nps_score==null?(snapshot.nps??0):Number(row.nps_score),
    servicePreference:row.preferred_channel||snapshot.servicePreference,
    additionalNeed:snapshot.additionalNeed??null,
    additionalNeedStatus:additionalNeedState(snapshot.additionalNeed),
    commercial,
    profileVersion:snapshot.profileVersion||null,
    profileSource:snapshot.profileSource||snapshot.source||null,
    profileUpdatedAt:iso(row.profile_assessed_at)||snapshot.profileUpdatedAt||null,
    profileValidUntil:iso(row.profile_valid_until)||null,
    source:'Banco VALOR 360'
  }
}
const surveyRecord=row=>({token:row.token,producerName:row.producer_name,consultantName:row.consultant_name,status:row.status,answers:row.answers||undefined,result:sanitizeProfileResult(row.result)||undefined,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at),submittedAt:iso(row.submitted_at),integratedAt:iso(row.integrated_at)})
const fallbackSurveyRecord=survey=>({...survey,result:sanitizeProfileResult(survey.result)||undefined})
const visitRecord=row=>({id:row.id,clientId:row.client_external_key||row.client_id,scheduledAt:iso(row.scheduled_at),objective:row.objective||'',processAgreement:row.process_agreement||'',summary:row.summary||'',nextCommitment:row.next_commitment||'',nextActionAt:iso(row.next_action_at),status:row.status||'Agendada',createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)})
const opportunityRecord=row=>({id:`o-${row.client_external_key||row.client_id}`,databaseId:row.id,clientId:row.client_external_key||row.client_id,title:row.title,value:row.estimated_value==null?0:Number(row.estimated_value),stage:row.stage||'Diagnóstico',candidateKey:row.evidence?.find?.(item=>item?.candidateKey)?.candidateKey||row.external_key||'',stageEvidence:row.evidence?.find?.(item=>item?.type==='manual_advance'||item?.type==='manual_set'||item?.type==='won'),nextAction:row.next_action||'',nextActionAt:iso(row.next_action_at),updatedAt:iso(row.updated_at)})

export class ValRepository{
  constructor({db,readStore,saveStore,tenantId}){this.db=db;this.readStore=readStore;this.saveStore=saveStore;this.tenantId=tenantId}

  fallback(){
    const store=this.readStore();store.val||={recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{}};store.val.modelRuns||=[];store.val.technicalContexts||={};return store
  }

  async listSurveys(){
    if(!this.db.configured)return (this.readStore().surveys||[]).map(fallbackSurveyRecord).sort((left,right)=>String(right.createdAt).localeCompare(String(left.createdAt)))
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5000',[this.tenantId]);return result.rows.map(surveyRecord)}catch{throw serviceError('Os questionários não puderam ser lidos no PostgreSQL configurado.')}
  }

  async createSurvey({token,producerName,consultantName,createdAt,expiresAt}){
    if(!this.db.configured){const store=this.readStore();store.surveys||=[];const survey={token,producerName,consultantName,status:'aguardando',createdAt,expiresAt};store.surveys.push(survey);this.saveStore(store);return survey}
    try{const result=await this.db.query(`INSERT INTO survey_invitations (tenant_id,token,producer_name,consultant_name,status,created_at,expires_at) VALUES ($1,$2,$3,$4,'aguardando',$5,$6) RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,token,producerName||null,consultantName||null,createdAt,expiresAt]);return surveyRecord(result.rows[0])}catch{throw serviceError('O convite não pôde ser persistido no PostgreSQL configurado.')}
  }

  async getSurvey(token){
    if(!this.db.configured){const survey=(this.readStore().surveys||[]).find(item=>item.token===token);return survey?fallbackSurveyRecord(survey):null}
    try{const result=await this.db.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 LIMIT 1',[this.tenantId,token]);return result.rows[0]?surveyRecord(result.rows[0]):null}catch{throw serviceError('O convite não pôde ser consultado no PostgreSQL configurado.')}
  }

  async submitSurvey({token,answers,result}){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token);if(!survey)throw domainError('Este convite não foi encontrado.',404);if(survey.expiresAt&&new Date(survey.expiresAt)<new Date())throw domainError('Este convite expirou.',410);if(survey.status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);survey.answers=answers;survey.result=sanitizeProfileResult(result);survey.status='respondido';survey.submittedAt=new Date().toISOString();this.saveStore(store);return fallbackSurveyRecord(survey)}
    try{return await this.db.transaction(async connection=>{const selected=await connection.query('SELECT status,expires_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2 FOR UPDATE',[this.tenantId,token]);if(!selected.rowCount)throw domainError('Este convite não foi encontrado.',404);if(new Date(selected.rows[0].expires_at)<new Date())throw domainError('Este convite expirou.',410);if(selected.rows[0].status!=='aguardando')throw domainError('Este questionário já foi respondido.',409);const updated=await connection.query(`UPDATE survey_invitations SET answers=$3,result=$4,status='respondido',submitted_at=NOW() WHERE tenant_id=$1 AND token=$2 RETURNING token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at`,[this.tenantId,token,jsonbParameter(answers),jsonbParameter(sanitizeProfileResult(result))]);return surveyRecord(updated.rows[0])})}catch(error){if(error.statusCode)throw error;throw serviceError('As respostas não puderam ser persistidas no PostgreSQL configurado.')}
  }

  async integrateSurvey(token){
    if(!this.db.configured){const store=this.readStore();const survey=(store.surveys||[]).find(item=>item.token===token);if(!survey)throw domainError('Resposta não encontrada.',404);if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409);survey.result=sanitizeProfileResult(survey.result);survey.status='integrado';survey.integratedAt=new Date().toISOString();this.saveStore(store);return fallbackSurveyRecord(survey)}
    try{return await this.db.transaction(async connection=>{
      const selected=await connection.query('SELECT id,status,answers,result FROM survey_invitations WHERE tenant_id=$1 AND token=$2 FOR UPDATE',[this.tenantId,token]);if(!selected.rowCount)throw domainError('Resposta não encontrada.',404)
      const survey=selected.rows[0];if(!survey.result)throw domainError('O questionário ainda não foi respondido.',409)
      if(survey.status!=='integrado'){
        const result=sanitizeProfileResult(survey.result);const externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180);const area=parseCultivatedArea(result.area)
        const commercial=await surveyCommercialForWrite(connection,this.tenantId,externalKey,result)
        const client=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','producer_360',NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,updated_at=NOW() RETURNING id`,[this.tenantId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(commercial)])
        await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,valid_until,assessed_at,source_survey_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '180 days',NOW(),$10) ON CONFLICT (source_survey_id) DO NOTHING`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(survey.answers||{}),jsonbParameter([{source:'producer_360',survey_id:survey.id,self_reported:true}]),jsonbParameter(snapshotFor(result,'producer_360')),survey.id])
        await connection.query(`UPDATE survey_invitations SET client_id=$3,status='integrado',integrated_at=NOW() WHERE tenant_id=$1 AND token=$2`,[this.tenantId,token,client.rows[0].id])
      }
      const updated=await connection.query('SELECT token,producer_name,consultant_name,status,answers,result,created_at,expires_at,submitted_at,integrated_at FROM survey_invitations WHERE tenant_id=$1 AND token=$2',[this.tenantId,token]);return surveyRecord(updated.rows[0])
    })}catch(error){if(error.statusCode)throw error;throw serviceError('A resposta não pôde ser integrada no PostgreSQL configurado.')}
  }

  async saveSurveyProfile({answers,result,source='assisted_survey'}){
    result=sanitizeProfileResult(result)
    if(!this.db.configured)return result
    try{return await this.db.transaction(async connection=>{
      const externalKey=String(result.id||normalize(result.name).replace(/\s+/g,'-')||randomUUID()).slice(0,180)
      const area=parseCultivatedArea(result.area)
      const commercial=await surveyCommercialForWrite(connection,this.tenantId,externalKey,result)
      const client=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=EXCLUDED.municipality,total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=EXCLUDED.cultures,preferred_channel=EXCLUDED.preferred_channel,commercial_profile=EXCLUDED.commercial_profile,updated_at=NOW() RETURNING id`,[this.tenantId,externalKey,String(result.name||'Produtor').slice(0,180),String(result.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(result.cultures||'').slice(0,1000)||null,String(result.servicePreference||'').slice(0,60)||null,jsonbParameter(commercial),source])
      const sourceKey=profileSourceKey(source,externalKey,answers)
      await connection.query(`INSERT INTO client_profiles (tenant_id,client_id,primary_profile,secondary_profile,irt_score,nps_score,answers,evidence,profile_snapshot,source_key,valid_until,assessed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+INTERVAL '180 days',NOW()) ON CONFLICT (tenant_id,source_key) DO UPDATE SET client_id=EXCLUDED.client_id,primary_profile=EXCLUDED.primary_profile,secondary_profile=EXCLUDED.secondary_profile,irt_score=EXCLUDED.irt_score,nps_score=EXCLUDED.nps_score,answers=EXCLUDED.answers,evidence=EXCLUDED.evidence,profile_snapshot=EXCLUDED.profile_snapshot,valid_until=EXCLUDED.valid_until,assessed_at=NOW()`,[this.tenantId,client.rows[0].id,result.primaryProfile||null,result.secondaryProfile||null,Number.isFinite(Number(result.irt))?Number(result.irt):null,Number.isFinite(Number(result.nps))?Number(result.nps):null,jsonbParameter(answers||{}),jsonbParameter([{source,self_reported:true}]),jsonbParameter(snapshotFor(result,source)),sourceKey])
      return {...result,id:externalKey}
    })}catch{throw serviceError('O perfil assistido não pôde ser salvo no PostgreSQL configurado.')}
  }

  async getIntelligence(){
    if(!this.db.configured){const store=this.readStore();const clients=new Map();store.imports?.forEach(record=>record.clients?.forEach(client=>clients.set(normalize(client.name),client)));return {imports:(store.imports||[]).map(({clients:ignored,...summary})=>summary),clients:[...clients.values()],visits:store.visits||[],opportunities:store.opportunities||[]}}
    try{
      const [importResult,clientResult,visitResult,opportunityResult]=await Promise.all([
        this.db.query('SELECT summary FROM import_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20',[this.tenantId]),
        this.db.query(`SELECT c.external_key,c.name,c.municipality,c.total_area_ha,c.area_band,c.cultures,c.preferred_channel,c.commercial_profile,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
            COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot
          FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
          LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
          WHERE c.tenant_id=$1 AND c.status='active' ORDER BY c.name LIMIT 5000`,[this.tenantId]),
        this.db.query(`SELECT visit.*,client.external_key client_external_key FROM visits visit JOIN clients client ON client.tenant_id=visit.tenant_id AND client.id=visit.client_id WHERE visit.tenant_id=$1 ORDER BY COALESCE(visit.updated_at,visit.created_at) DESC LIMIT 2000`,[this.tenantId]),
        this.db.query(`SELECT opportunity.*,client.external_key client_external_key FROM opportunities opportunity JOIN clients client ON client.tenant_id=opportunity.tenant_id AND client.id=opportunity.client_id WHERE opportunity.tenant_id=$1 ORDER BY opportunity.updated_at DESC LIMIT 2000`,[this.tenantId])
      ])
      return {imports:importResult.rows.map(row=>row.summary),clients:clientResult.rows.map(row=>clientFromRow(row,{defaults:true})),visits:visitResult.rows.map(visitRecord),opportunities:opportunityResult.rows.map(opportunityRecord)}
    }catch{throw serviceError('A carteira não pôde ser lida no PostgreSQL configurado.')}
  }

  async saveVisit(input){
    const scheduledAt=parsedDate(input.scheduledAt);if(!scheduledAt)throw domainError('Informe data e horário válidos para a visita.',400)
    if(!this.db.configured){const store=this.readStore();store.visits||=[];const record={id:randomUUID(),clientId:input.clientId,scheduledAt,objective:String(input.objective||'').slice(0,2000),status:'Agendada',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.visits.push(record);this.saveStore(store);return record}
    try{const result=await this.db.query(`INSERT INTO visits (tenant_id,client_id,scheduled_at,objective,status,created_at,updated_at) SELECT $1,client.id,$3,$4,$5,NOW(),NOW() FROM clients client WHERE client.tenant_id=$1 AND (client.id::text=$2 OR client.external_key=$2) RETURNING visits.*,(SELECT external_key FROM clients WHERE id=visits.client_id) client_external_key`,[this.tenantId,String(input.clientId||''),scheduledAt,String(input.objective||'').trim().slice(0,2000),String(input.status||'Agendada').slice(0,30)]);if(!result.rowCount)throw domainError('Produtor não encontrado na carteira autorizada.',404);return visitRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('A visita não pôde ser salva no PostgreSQL configurado.')}
  }

  async saveOpportunity(input){
    const candidateKey=String(input.candidateKey||input.title||'').trim().slice(0,300);if(!candidateKey)throw domainError('A oportunidade precisa de uma origem identificável.',400)
    const externalKey=`pipeline:${createHash('sha256').update(`${input.clientId}:${candidateKey}`).digest('hex').slice(0,64)}`
    const evidence=[...(Array.isArray(input.evidence)?input.evidence:[]),...(input.stageEvidence?[input.stageEvidence]:[])].slice(0,30)
    if(!this.db.configured){const store=this.readStore();store.opportunities||=[];const current=store.opportunities.find(item=>item.clientId===input.clientId&&item.candidateKey===candidateKey);const record={...current,...input,id:current?.id||`o-${input.clientId}`,updatedAt:new Date().toISOString()};store.opportunities=store.opportunities.filter(item=>!(item.clientId===input.clientId&&item.candidateKey===candidateKey)).concat(record);this.saveStore(store);return record}
    try{const result=await this.db.query(`INSERT INTO opportunities (tenant_id,client_id,external_key,title,category,hypothesis,estimated_value,stage,next_action,next_action_at,evidence,created_at,updated_at) SELECT $1,client.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW() FROM clients client WHERE client.tenant_id=$1 AND (client.id::text=$2 OR client.external_key=$2) ON CONFLICT (tenant_id,external_key) WHERE external_key IS NOT NULL DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,hypothesis=EXCLUDED.hypothesis,estimated_value=EXCLUDED.estimated_value,stage=EXCLUDED.stage,next_action=EXCLUDED.next_action,next_action_at=EXCLUDED.next_action_at,evidence=EXCLUDED.evidence,updated_at=NOW() RETURNING opportunities.*,(SELECT external_key FROM clients WHERE id=opportunities.client_id) client_external_key`,[this.tenantId,String(input.clientId||''),externalKey,String(input.title||'Oportunidade').slice(0,220),String(input.category||'').slice(0,120)||null,String(input.hypothesis||'').slice(0,4000)||null,Number.isFinite(Number(input.value))?Math.max(0,Number(input.value)):null,String(input.stage||'Diagnóstico').slice(0,40),String(input.nextAction||'').slice(0,2000)||null,parsedDate(input.nextActionAt),jsonbParameter(evidence)]);if(!result.rowCount)throw domainError('Produtor não encontrado na carteira autorizada.',404);return opportunityRecord(result.rows[0])}catch(error){if(error.statusCode)throw error;throw serviceError('A oportunidade não pôde ser salva no PostgreSQL configurado.')}
  }

  async getClientContext({tenantId=this.tenantId,clientId,client={}}){
    if(!this.db.configured)return {client,profile:{answers:client.profileAnswers||{},evidence:client.profileEvidence||[],assessedAt:client.profileUpdatedAt||null,validUntil:client.profileValidUntil||null},signals:this.fallback().val.signals.filter(item=>!clientId||item.clientExternalKey===clientId).slice(-20),learning:this.fallbackLearning(clientId),memories:[],businessHistory:[],visits:[],interactions:[],opportunities:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],priorRecommendations:[]}
    try{
      const result=await this.db.query(`SELECT c.*,p.primary_profile,p.secondary_profile,p.irt_score,p.nps_score,p.answers,p.evidence profile_evidence,p.source_survey_id,p.valid_until profile_valid_until,p.assessed_at profile_assessed_at,
        COALESCE(NULLIF(p.profile_snapshot,'{}'::jsonb),survey.result,'{}'::jsonb) profile_snapshot,
        COALESCE((SELECT jsonb_agg(s ORDER BY s.created_at DESC) FROM (SELECT id,source_event_id,signal_type,severity,title,evidence,commercial_hypothesis,requires_agronomist,status,created_at FROM agronomic_signals WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key) ORDER BY created_at DESC LIMIT 20) s),'[]'::jsonb) signals,
        COALESCE((SELECT jsonb_build_object('wins',count(*) FILTER (WHERE outcome='won'),'losses',count(*) FILTER (WHERE outcome='lost'),'revenue',COALESCE(sum(value) FILTER (WHERE outcome='won'),0)) FROM business_events WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key)),'{}'::jsonb) learning,
        COALESCE((SELECT jsonb_build_object('rated',count(*),'average_rating',round(avg(f.rating)::numeric,2),'accepted',count(*) FILTER (WHERE f.outcome='accepted'),'edited',count(*) FILTER (WHERE f.outcome='edited'),'executed',count(*) FILTER (WHERE f.outcome='executed'),'won',count(*) FILTER (WHERE f.outcome='won'),'lost',count(*) FILTER (WHERE f.outcome='lost')) FROM val_feedback f JOIN val_recommendations r ON r.id=f.recommendation_id AND r.tenant_id=f.tenant_id WHERE f.tenant_id=$1 AND (r.client_id=c.id OR r.client_external_key=c.external_key)),'{}'::jsonb) feedback_learning,
        COALESCE((SELECT jsonb_agg(m ORDER BY m.valid_from DESC) FROM (SELECT id,memory_type,key,value,evidence,confidence,status,source,valid_from,valid_until FROM val_memories WHERE tenant_id=$1 AND client_id=c.id AND status IN ('verified','proposed') AND (valid_until IS NULL OR valid_until>NOW()) ORDER BY valid_from DESC LIMIT 50) m),'[]'::jsonb) memories,
        COALESCE((SELECT jsonb_agg(b ORDER BY b.occurred_at DESC) FROM (SELECT id,source,external_id,occurred_at,outcome,category,product,quantity,value,margin,currency,loss_reason,payload FROM business_events WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key) ORDER BY occurred_at DESC LIMIT 50) b),'[]'::jsonb) business_history,
        COALESCE((SELECT jsonb_agg(v ORDER BY COALESCE(v.updated_at,v.created_at) DESC) FROM (SELECT id,scheduled_at,objective,process_agreement,summary,next_commitment,next_action_at,status,created_at,updated_at FROM visits WHERE tenant_id=$1 AND client_id=c.id ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 30) v),'[]'::jsonb) visits,
        COALESCE((SELECT jsonb_agg(i ORDER BY i.occurred_at DESC) FROM (SELECT id,visit_id,channel,direction,occurred_at,summary,commitments,source,source_external_id,created_at FROM interactions WHERE tenant_id=$1 AND client_id=c.id ORDER BY occurred_at DESC LIMIT 50) i),'[]'::jsonb) interactions,
        COALESCE((SELECT jsonb_agg(o ORDER BY o.updated_at DESC) FROM (SELECT opportunity.id,opportunity.external_key,opportunity.title,opportunity.category,opportunity.hypothesis,opportunity.estimated_value,opportunity.estimated_margin,opportunity.stage,opportunity.next_action,opportunity.next_action_at,opportunity.evidence,opportunity.created_at,opportunity.updated_at,(SELECT jsonb_build_object('baseline',value_case.baseline,'alternative',value_case.alternative,'assumptions',value_case.assumptions,'expected_value',value_case.expected_value,'low_value',value_case.low_value,'high_value',value_case.high_value,'total_incremental_cost',value_case.total_incremental_cost,'roi_percent',value_case.roi_percent,'proof_plan',value_case.proof_plan,'validated_at',value_case.validated_at) FROM value_cases value_case WHERE value_case.tenant_id=$1 AND value_case.opportunity_id=opportunity.id ORDER BY value_case.created_at DESC LIMIT 1) value_case FROM opportunities opportunity WHERE opportunity.tenant_id=$1 AND opportunity.client_id=c.id ORDER BY opportunity.updated_at DESC LIMIT 30) o),'[]'::jsonb) opportunities,
        COALESCE((SELECT jsonb_agg(prop ORDER BY prop.updated_at DESC) FROM (SELECT property.id,property.external_key,property.name,property.municipality,property.area_ha,property.metadata,property.created_at,property.updated_at,COALESCE((SELECT jsonb_agg(field_record ORDER BY field_record.created_at DESC) FROM (SELECT field.id,field.external_key,field.name,field.area_ha,field.geometry_ref,field.geometry_version,field.created_at,COALESCE((SELECT jsonb_agg(season_record ORDER BY season_record.created_at DESC) FROM (SELECT season,crop,cultivar,area_ha,productivity_target,productivity_actual,unit,planted_at,harvested_at,created_at FROM crop_seasons WHERE tenant_id=$1 AND field_id=field.id ORDER BY created_at DESC LIMIT 12) season_record),'[]'::jsonb) seasons FROM fields field WHERE field.tenant_id=$1 AND field.property_id=property.id ORDER BY field.created_at DESC LIMIT 50) field_record),'[]'::jsonb) fields FROM properties property WHERE property.tenant_id=$1 AND property.client_id=c.id ORDER BY property.updated_at DESC LIMIT 30) prop),'[]'::jsonb) properties,
        COALESCE((SELECT jsonb_agg(report ORDER BY COALESCE(report.observed_at,report.created_at) DESC) FROM (SELECT field_report.id,field_report.source,field_report.external_id,field_report.property_external_key,field_report.field_external_key,field_report.observed_at,field_report.crop_stage,field_report.summary,field_report.validated_actions,field_report.validation_evidence,field_report.validated_at,field_report.created_at,COALESCE((SELECT jsonb_agg(observation ORDER BY observation.created_at DESC) FROM (SELECT id,observation_type,value,unit,confidence,evidence_ref,requires_review,created_at FROM field_observations WHERE tenant_id=$1 AND report_id=field_report.id ORDER BY created_at DESC LIMIT 50) observation),'[]'::jsonb) observations FROM field_reports field_report WHERE field_report.tenant_id=$1 AND (field_report.client_id=c.id OR field_report.client_external_key=c.external_key) ORDER BY COALESCE(field_report.observed_at,field_report.created_at) DESC LIMIT 20) report),'[]'::jsonb) field_reports,
        COALESCE((SELECT jsonb_agg(analysis ORDER BY COALESCE(analysis.sampled_at,analysis.created_at::date) DESC) FROM (SELECT soil.id,soil.source,soil.external_id,soil.property_external_key,soil.field_external_key,soil.laboratory,soil.method,soil.depth_from_cm,soil.depth_to_cm,soil.sampled_at,soil.validated_flags,soil.validation_evidence,soil.validated_at,soil.created_at,COALESCE((SELECT jsonb_agg(measurement ORDER BY measurement.created_at DESC) FROM (SELECT id,sample_key,analyte,raw_value,raw_unit,normalized_value,normalized_unit,method,interpretation,confidence,created_at FROM soil_measurements WHERE tenant_id=$1 AND analysis_id=soil.id ORDER BY created_at DESC LIMIT 100) measurement),'[]'::jsonb) measurements FROM soil_analyses soil WHERE soil.tenant_id=$1 AND (soil.client_id=c.id OR soil.client_external_key=c.external_key) ORDER BY COALESCE(soil.sampled_at,soil.created_at::date) DESC LIMIT 20) analysis),'[]'::jsonb) soil_analyses,
        COALESCE((SELECT jsonb_agg(ndvi ORDER BY ndvi.observed_at DESC) FROM (SELECT id,source,external_id,property_external_key,field_external_key,index_name,observed_at,sensor,resolution_m,cloud_percent,processing_version,geometry_version,statistics,anomaly,validated_at,created_at FROM ndvi_observations WHERE tenant_id=$1 AND (client_id=c.id OR client_external_key=c.external_key) ORDER BY observed_at DESC LIMIT 30) ndvi),'[]'::jsonb) ndvi_observations,
        COALESCE((SELECT jsonb_agg(manual_record ORDER BY manual_record.occurred_at DESC) FROM (SELECT id,external_id,event_type,occurred_at,property_external_key,field_external_key,payload,status,ingested_at FROM integration_events WHERE tenant_id=$1 AND source='manual-do-agronomo' AND client_external_key=c.external_key AND event_type IN ('manual.record.saved','manual.producer.updated','manual.workspace.updated') ORDER BY occurred_at DESC LIMIT 40) manual_record),'[]'::jsonb) manual_records,
        COALESCE((SELECT jsonb_agg(recommendation ORDER BY recommendation.created_at DESC) FROM (SELECT val_recommendation.id,val_recommendation.user_question,val_recommendation.mode,val_recommendation.model_version,val_recommendation.status,val_recommendation.generated_content->>'next_best_action' next_best_action,val_recommendation.created_at,(SELECT jsonb_build_object('rating',feedback.rating,'outcome',feedback.outcome,'notes',feedback.notes,'created_at',feedback.created_at) FROM val_feedback feedback WHERE feedback.tenant_id=$1 AND feedback.recommendation_id=val_recommendation.id LIMIT 1) feedback FROM val_recommendations val_recommendation WHERE val_recommendation.tenant_id=$1 AND (val_recommendation.client_id=c.id OR val_recommendation.client_external_key=c.external_key) ORDER BY val_recommendation.created_at DESC LIMIT 10) recommendation),'[]'::jsonb) prior_recommendations
        FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_profiles WHERE tenant_id=c.tenant_id AND client_id=c.id ORDER BY assessed_at DESC LIMIT 1) p ON true
        LEFT JOIN survey_invitations survey ON survey.tenant_id=c.tenant_id AND survey.id=p.source_survey_id
        WHERE c.tenant_id=$1 AND (c.id::text=$2 OR c.external_key=$2) LIMIT 1`,[tenantId,clientId])
      if(!result.rows[0])throw Object.assign(new Error('Cliente não encontrado na base autorizada.'),{statusCode:404})
      const row=result.rows[0]
      const profileEvidence=Array.isArray(row.profile_evidence)?row.profile_evidence:[]
      return {client:{...clientFromRow(row),profileSelfReported:profileEvidence.some(item=>item?.self_reported===true),profileEvidence},profile:{answers:jsonObject(row.answers),evidence:profileEvidence,assessedAt:iso(row.profile_assessed_at)||null,validUntil:iso(row.profile_valid_until)||null,sourceId:row.source_survey_id||null},signals:row.signals||[],learning:{...(row.learning||{}),recommendations:row.feedback_learning||{}},memories:row.memories||[],businessHistory:row.business_history||[],visits:row.visits||[],interactions:row.interactions||[],opportunities:row.opportunities||[],properties:row.properties||[],fieldReports:row.field_reports||[],soilAnalyses:row.soil_analyses||[],ndviObservations:row.ndvi_observations||[],manualRecords:row.manual_records||[],priorRecommendations:row.prior_recommendations||[]}
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
          if(event.type==='manual.producer.updated'&&event.clientExternalKey){
            const producer=jsonObject(event.payload.producer||event.payload);const area=parseCultivatedArea(producer.areaHa??producer.area??producer.totalAreaHa);const cultures=Array.isArray(producer.cultures)?producer.cultures.join(', '):producer.cultures
            await client.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,area_band,cultures,preferred_channel,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','manual-do-agronomo',NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),clients.name),municipality=COALESCE(EXCLUDED.municipality,clients.municipality),total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),cultures=COALESCE(EXCLUDED.cultures,clients.cultures),preferred_channel=COALESCE(EXCLUDED.preferred_channel,clients.preferred_channel),updated_at=NOW()`,[tenantId,event.clientExternalKey,String(producer.name||producer.producerName||'Produtor').slice(0,180),String(producer.city||producer.municipality||'').slice(0,140)||null,area.totalAreaHa,area.areaBand,String(cultures||'').slice(0,1000)||null,String(producer.preferredChannel||producer.servicePreference||'').slice(0,60)||null])
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
        const importedClients=clients.slice(0,2000)
        const lockKeys=[...new Set(importedClients.map(item=>String(item.id||'').slice(0,180)))].sort()
        for(const externalKey of lockKeys)await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0))`,[tenantId,externalKey])
        for(const item of importedClients){const area=parseCultivatedArea(item.area);const externalKey=String(item.id||'').slice(0,180);const upserted=await connection.query(`INSERT INTO clients (tenant_id,external_key,name,municipality,total_area_ha,area_band,commercial_profile,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'active','commercial_import',NOW()) ON CONFLICT (tenant_id,external_key) DO UPDATE SET name=EXCLUDED.name,municipality=COALESCE(EXCLUDED.municipality,clients.municipality),total_area_ha=COALESCE(EXCLUDED.total_area_ha,clients.total_area_ha),area_band=COALESCE(EXCLUDED.area_band,clients.area_band),commercial_profile=(clients.commercial_profile||EXCLUDED.commercial_profile)||CASE WHEN clients.commercial_profile?'property' THEN jsonb_build_object('property',clients.commercial_profile->'property') ELSE '{}'::jsonb END,updated_at=NOW() RETURNING id,external_key`,[tenantId,externalKey,String(item.name||'').slice(0,180),item.municipality||null,area.totalAreaHa,area.areaBand,jsonbParameter(item.commercial||{})]);clientInternalIds.set(upserted.rows[0].external_key,upserted.rows[0].id)}
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
