// Test-only data. Never imported by src/main or a production route.
export const previewNow='2026-09-07T11:00:00.000Z'
export const previewClients='ABCDEF'.split('').map(letter=>({id:'preview-'+letter,name:'Produtor exemplo '+letter,additionalNeedStatus:'unknown',commercial:{synthetic:true}}))
const rows=[
 ['A','Manejo de soja','Soja','2627V','Insumos','Diagnóstico',null,'Levantar necessidade','2026-09-07T12:00:00Z'],
 ['B','Compra de milho','Milho','2627V','Grãos','Diagnóstico',null,'Confirmar disponibilidade','2026-09-08T12:00:00Z'],
 ['C','Programa nutricional','Soja','2627V','Insumos','Proposta',48000,'Apresentar proposta','2026-09-07T17:00:00Z'],
 ['D','Manejo de trigo','Trigo','2727I','Insumos','Proposta',36000,'Validar retorno esperado','2026-09-08T17:00:00Z'],
 ['E','Proteção da lavoura','Soja','2627V','Insumos','Negociação',72000,'Formalizar condições','2026-09-07T19:00:00Z'],
 ['F','Implantação de milho','Milho','2627V','Insumos','Fechado',58000,'Agendar acompanhamento','2026-09-09T12:00:00Z']
]
export const previewOpportunities=rows.map(([letter,title,crop,season,businessType,stage,value,nextAction,nextActionAt])=>{
 const candidateKey='manual:preview-'+letter
 const metadata={type:'opportunity_workspace_v1',candidateKey,crop,season,businessType,status:letter==='F'?'won':'open',closedAt:letter==='F'?'2026-09-06T13:00:00Z':null,waitingProducer:letter==='E'}
 return {databaseId:'preview-'+letter,id:'o-preview-'+letter,clientId:'preview-'+letter,candidateKey,title,stage,value,valueKnown:value!==null,nextAction,nextActionAt,updatedAt:'2026-09-07T10:00:00.000Z',createdAt:'2026-09-05T13:00:00.000Z',workspaceDetails:metadata,evidence:[metadata,...(letter==='E'?[
  {type:'opportunity_workspace_event',mutationId:'preview-history-1',label:'Diagnóstico registrado',at:'2026-09-05T13:00:00Z'},
  {type:'opportunity_workspace_event',mutationId:'preview-history-2',label:'Proposta apresentada',at:'2026-09-06T17:00:00Z'}
 ]:[])]}
})
