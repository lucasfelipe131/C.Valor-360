import {ValRepository} from '../server/repository.js'

export const phase6TenantA='00000000-0000-4000-8000-000000000001'
export const phase6TenantB='00000000-0000-4000-8000-000000000002'
export const phase6ActorA='00000000-0000-4000-8000-000000000601'
export const phase6ActorB='00000000-0000-4000-8000-000000000602'
export const phase6VisitA='00000000-0000-4000-8000-000000000611'
export const phase6VisitB='00000000-0000-4000-8000-000000000612'
export const phase6AudioA='00000000-0000-4000-8000-000000000621'

export const phase6ReportText='O produtor achou o preço caro e pediu comparativo. Não fechou. Pediu retorno em 2026-08-29 depois de falar com o sócio. Também comentou problema de buva numa área.'

export function phase6InitialStore(options={}){
 const visits=options.visits||[
  {id:phase6VisitA,tenantId:phase6TenantA,ownerId:phase6ActorA,clientId:'producer-a',scheduledAt:'2026-08-23T14:00:00.000Z',objective:'Negociar fertilizante com evidência.',status:'Agendada',createdAt:'2026-08-20T12:00:00.000Z',updatedAt:'2026-08-20T12:00:00.000Z'},
  {id:phase6VisitB,tenantId:phase6TenantA,ownerId:phase6ActorA,clientId:'producer-a',scheduledAt:'2026-08-30T14:00:00.000Z',objective:'Retornar com comparativo e próximo passo.',status:'Agendada',createdAt:'2026-08-20T12:00:00.000Z',updatedAt:'2026-08-20T12:00:00.000Z'}
 ]
 return {
  surveys:[],imports:[],visits:structuredClone(visits),interactions:[],opportunities:[],
  val:{recommendations:[],feedback:[],integrationEvents:[],signals:[],conversations:[],modelRuns:[],technicalContexts:{},technicalContextHistory:[],memories:[],attachments:[{
   id:phase6AudioA,tenantId:phase6TenantA,tenant_id:phase6TenantA,ownerId:phase6ActorA,clientId:'producer-a',client_external_key:'producer-a',original_name:'visita.webm',mime_type:'audio/webm',size_bytes:24,content_base64:'YXVkaW8tZml4dHVyZQ==',sha256:'phase6-audio-fixture',status:'received',analysis:{},created_at:'2026-08-23T14:00:00.000Z',updated_at:'2026-08-23T14:00:00.000Z'
  }],contextSnapshots:[],actionPlans:[],commitments:[],visitPreparations:[],visitTranscripts:[],visitReports:[],outcomes:[],learningCandidates:[],visitLifecycleEvents:[]}
 }
}

export function phase6Repository(options={}){
 let store=phase6InitialStore(options)
 const repository=new ValRepository({db:{configured:false},tenantId:phase6TenantA,readStore:()=>store,saveStore:value=>{store=structuredClone(value)}})
 return {repository,read:()=>store}
}

export function explicitNoAction(report){
 return [{item_id:`${report.visit_report_id}:no-action`,epistemic_status:'FACT_CANDIDATE',statement:'Nenhuma ação adicional é necessária neste momento.',source_ref:report.source_ref,confidence:1,requires_confirmation:true,type:'NO_ACTION',description:'Nenhuma ação necessária.',due_at:null,date_confirmation_required:false,explicit:true}]
}
