import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOpportunityWorkspace,filterOpportunities,opportunityMetrics,opportunityValue,dueInfo,scenarioResult,opportunityCsv,WORKSPACE_EVENT} from '../src/lib/opportunity-workspace.js'
import {buildWorkspaceMutation} from '../server/opportunity-workspace.js'
import {ValRepository} from '../server/repository.js'
import {previewClients,previewOpportunities,previewNow} from './visual/opportunities-fixture.js'

const now=new Date(previewNow)
const command=(extra={})=>({workspaceVersion:1,clientId:'c',candidateKey:'manual:one',title:'Negócio informado',stage:'Diagnóstico',status:'open',value:null,nextAction:'Validar necessidade',nextActionAt:'2026-09-08T12:00:00.000Z',mutationId:'mutation-00000001',...extra})
test('quadro usa registros canônicos completos, múltiplos negócios e nenhum produtor de fora',()=>{
 const input=[...previewOpportunities,{...previewOpportunities[0],databaseId:'second',candidateKey:'manual:second'},{...previewOpportunities[0],databaseId:'foreign',clientId:'foreign'}]
 const items=buildOpportunityWorkspace(previewClients,input)
 assert.equal(items.length,7)
 assert.equal(items.filter(x=>x.clientId==='preview-A').length,2)
 assert.equal(new Set(items.map(x=>x.id)).size,7)
 assert.equal(items.find(x=>x.clientId==='preview-E').nextAction,'Formalizar condições')
 assert.equal(items.find(x=>x.clientId==='preview-E').history.length,2)
 assert.deepEqual(buildOpportunityWorkspace([],input),[])
})
test('indicadores refletem dados conhecidos, prazo e período; fixture isolada tem totais coerentes',()=>{
 const items=buildOpportunityWorkspace(previewClients,previewOpportunities)
 assert.deepEqual(opportunityMetrics(items,now),{open:5,openValue:156000,unknown:2,wonValue:58000,wonUnknown:0,due:3,month:'2026-09'})
 const older=items.map(x=>x.status==='won'?{...x,closedAt:'2026-08-30T12:00:00Z',updatedAt:previewNow}:x)
 assert.equal(opportunityMetrics(older,now).wonValue,0)
 assert.equal(opportunityValue({value:0,valueKnown:true}),0)
 assert.equal(opportunityValue({value:0,valueKnown:false}),null)
 assert.equal(opportunityValue({value:null}),null)
})
test('busca, safra, cultura e tipo são combinados sem alterar os registros',()=>{
 const items=buildOpportunityWorkspace(previewClients,previewOpportunities)
 assert.deepEqual(filterOpportunities(items,{search:'proteCAo',season:'2627V',crop:'Soja',type:'Insumos'}).map(x=>x.clientId),['preview-E'])
 assert.equal(filterOpportunities(items,{type:'Grãos'}).length,1)
 assert.equal(filterOpportunities(items,{season:'2727I',crop:'Soja'}).length,0)
 assert.equal(items.length,6)
})
test('perdas, arquivados e fechados sem resultado não viram ganhos',()=>{
 const base=buildOpportunityWorkspace(previewClients,previewOpportunities)
 const items=base.map((x,i)=>i===0?{...x,status:'lost',stage:'Fechado'}:i===1?{...x,status:'archived',stage:'Fechado'}:i===5?{...x,status:'closed'}:x)
 assert.equal(filterOpportunities(items).length,4)
 assert.equal(filterOpportunities(items,{archived:true}).length,2)
 assert.equal(opportunityMetrics(items,now).wonValue,0)
})
test('prazos respeitam fuso e não contam ação concluída ou sem descrição',()=>{
 const item={nextAction:'Ligar',nextActionAt:'2026-09-08T01:00:00Z'}
 assert.equal(dueInfo(item,now).state,'today')
 assert.equal(dueInfo({...item,nextActionDone:true},now).state,'done')
 assert.equal(dueInfo({...item,nextAction:''},now).state,'none')
 assert.equal(dueInfo({...item,nextActionAt:'inválido'},now).state,'none')
})
test('simulação nasce vazia, preserva prejuízo e trata investimento zero',()=>{
 assert.equal(scenarioResult({area:'',investment:'',returnPerHa:''}),null)
 assert.equal(scenarioResult({area:0,investment:10,returnPerHa:50}),null)
 assert.deepEqual(scenarioResult({area:10,investment:100,returnPerHa:80}),{net:-200,investment:1000,ratio:.8})
 assert.equal(scenarioResult({area:10,investment:0,returnPerHa:80}).ratio,null)
})
test('exportação identifica ausências e neutraliza fórmulas de planilha',()=>{
 const csv=opportunityCsv([{client:{name:'=HYPERLINK("x")'},title:'+malicious',value:null,status:'open',stage:'Diagnóstico'}])
 assert.ok(csv.includes("'=HYPERLINK"))
 assert.ok(csv.includes("'+malicious"))
 assert.ok(csv.includes('Não informado'))
})
test('gravação conserva null, campos informados e autoria autenticada',()=>{
 const result=buildWorkspaceMutation(null,command({crop:'Canola',season:'2727I',businessType:'Grãos',volume:250,volumeUnit:'sc',actorId:'forged',evidence:[{type:WORKSPACE_EVENT,actorId:'forged'}]}),{ownerId:'owner',now:previewNow})
 assert.equal(result.record.value,null)
 assert.equal(result.record.workspaceDetails.season,'2727I')
 assert.equal(result.record.workspaceDetails.volume,250)
 const events=result.record.evidence.filter(x=>x.type===WORKSPACE_EVENT)
 assert.equal(events.length,1);assert.equal(events[0].actorId,'owner')
})
test('histórico de alteração é aditivo, registra origem/destino e não aceita adulteração do browser',()=>{
 const first=buildWorkspaceMutation(null,command(),{ownerId:'owner',now:previewNow}).record
 const next=buildWorkspaceMutation(first,command({stage:'Proposta',value:100,expectedUpdatedAt:first.updatedAt,mutationId:'mutation-00000002',returnNote:'Retorno informado',evidence:[]}),{ownerId:'owner',now:'2026-09-07T12:00:00.000Z'}).record
 const events=next.evidence.filter(x=>x.type===WORKSPACE_EVENT)
 assert.equal(events.length,2);assert.equal(events[1].from,'Diagnóstico');assert.equal(events[1].to,'Proposta')
 assert.ok(events[1].changes.some(x=>x.field==='value'&&x.before===null&&x.after===100))
})
test('repetir gravação não duplica; reutilizar chave com outro conteúdo é conflito',()=>{
 const first=buildWorkspaceMutation(null,command(),{ownerId:'owner',now:previewNow}).record
 assert.equal(buildWorkspaceMutation(first,command(),{ownerId:'owner',now:'2026-09-08T12:00:00Z'}).replay,true)
 assert.throws(()=>buildWorkspaceMutation(first,command({title:'Alterado'}),{ownerId:'owner'}),e=>e.statusCode===409)
 assert.throws(()=>buildWorkspaceMutation(first,command({mutationId:'mutation-00000002',expectedUpdatedAt:'stale'}),{ownerId:'owner'}),e=>e.statusCode===409)
})
test('ganho não inventa entrega e mantém data do fechamento após atualização e retry',()=>{
 const input=command({stage:'Fechado',status:'won'})
 const first=buildWorkspaceMutation(null,input,{ownerId:'owner',now:previewNow}).record
 assert.equal(first.workspaceDetails.closedAt,previewNow)
 assert.equal(first.delivered,undefined)
 assert.equal(buildWorkspaceMutation(first,input,{ownerId:'owner',now:'2026-09-09T10:00:00Z'}).replay,true)
 const update=buildWorkspaceMutation(first,{...input,mutationId:'mutation-00000002',expectedUpdatedAt:first.updatedAt,returnNote:'Acompanhamento'},{ownerId:'owner',now:'2026-10-01T10:00:00Z'}).record
 assert.equal(update.workspaceDetails.closedAt,previewNow)
})
test('validação rejeita perda sem motivo, unidade ausente, prazo inválido e falta de dono',()=>{
 for(const invalid of [{stage:'Fechado',status:'lost'},{volume:1,volumeUnit:''},{value:-1},{value:true},{volume:[]},{nextActionAt:'invalid'},{nextActionAt:42},{nextActionAt:'2026-09-07'},{businessType:'Outro'},{stage:'Fechado',status:'open'}])
  assert.throws(()=>buildWorkspaceMutation(null,command(invalid),{ownerId:'owner'}),e=>e.statusCode===400)
 assert.throws(()=>buildWorkspaceMutation(null,command(),{}),e=>e.statusCode===403)
})
test('repositório fallback mantém dois negócios do mesmo produtor e rejeita carteira alheia',async()=>{
 let store={imports:[{tenantId:'t',ownerId:'o',clients:[{id:'c',name:'Produtor',tenantId:'t',ownerId:'o',commercial:{}}]}],opportunities:[]}
 const repo=new ValRepository({tenantId:'t',db:{configured:false},readStore:()=>structuredClone(store),saveStore:value=>{store=value}})
 const first=await repo.saveOpportunity(command(),'o')
 await repo.saveOpportunity(command(),'o')
 const second=await repo.saveOpportunity(command({candidateKey:'manual:two',mutationId:'mutation-00000002'}),'o')
 assert.equal(store.opportunities.length,2);assert.notEqual(first.id,second.id)
 await assert.rejects(()=>repo.saveOpportunity(command(),'foreign'),e=>e.statusCode===404)
 await assert.rejects(()=>repo.saveOpportunity(command(),null),e=>e.statusCode===403)
 assert.equal(store.opportunities.length,2)
})
test('contrato SQL com conexão simulada atualiza visita no mesmo ID e preserva chave externa',async()=>{
 const calls=[],row={id:'database-opportunity',client_id:'db-client',external_key:'visit-report:abc',title:'Negócio',stage:'Diagnóstico',estimated_value:null,evidence:[],updated_at:previewNow,created_at:previewNow}
 const db={configured:true,transaction:work=>work({query:async(sql,params)=>{
  calls.push({sql,params})
  if(sql.startsWith('SELECT id,external_key'))return {rowCount:1,rows:[{id:'db-client',external_key:'c'}]}
  if(sql.startsWith('SELECT * FROM opportunities'))return {rowCount:1,rows:[row]}
  if(sql.startsWith('UPDATE opportunities'))return {rowCount:1,rows:[{...row,title:params[2],category:params[3],estimated_value:params[5],stage:params[6],next_action:params[7],next_action_at:params[8],evidence:JSON.parse(params[9]),updated_at:params[10]}]}
  throw new Error(sql)
 }})}
 const repo=new ValRepository({tenantId:'t',db})
 const saved=await repo.saveOpportunity(command({databaseId:row.id,candidateKey:'visit-report:abc',expectedUpdatedAt:previewNow,stage:'Proposta'}),'o')
 assert.equal(saved.databaseId,row.id);assert.equal(saved.externalKey,'visit-report:abc');assert.equal(saved.valueKnown,false)
 assert.ok(calls[0].sql.endsWith('FOR UPDATE'));assert.deepEqual(calls[0].params,['t','o','c'])
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT')).length,0)
 assert.equal(calls.find(x=>x.sql.startsWith('UPDATE')).params[11],row.id)
})
