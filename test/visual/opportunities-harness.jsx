import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import Sidebar from '../../src/components/Sidebar'
import Opportunities from '../../src/pages/Opportunities'
import {previewClients,previewOpportunities,previewNow} from './opportunities-fixture.js'
import '@fontsource-variable/manrope'
import '../../src/styles.css'
import '../../src/val-brand.css'
import '../../src/mobile-browser.css'
import '../../src/val-mobile-overflow.css'
import '../../src/val-logo-final.css'
import '../../src/presentation.css'
import '../../src/val-ui-simple-modern.css'
import '../../src/val-workspace-shell.css'
import '../../src/val-opportunities.css'

// All application requests terminate here; nothing reaches a business service.
const requests=[]
window.fetch=async(url,options={})=>{
 requests.push({url:String(url),method:options.method||'GET',body:options.body||null})
 return new Response(JSON.stringify({error:'Serviço indisponível no teste visual isolado.'}),{status:503,headers:{'Content-Type':'application/json'}})
}
function Harness(){
 const [items,setItems]=useState(previewOpportunities),[empty,setEmpty]=useState(false),[fail,setFail]=useState(false),[account,setAccount]=useState(1),[saved,setSaved]=useState('')
 const user={id:'preview-owner-'+account,ownerId:'preview-owner-'+account,tenantId:'preview-tenant',storageScope:'isolated-visual-'+account,name:'Responsável de teste',timeZone:'America/Sao_Paulo'}
 const save=async input=>{
  await new Promise(resolve=>setTimeout(resolve,150))
  if(fail)throw new Error('Falha simulada. Nenhum dado foi gravado.')
  const metadata={...input,type:'opportunity_workspace_v1'}
  const record={...input,workspaceDetails:metadata,evidence:[metadata],databaseId:input.databaseId||crypto.randomUUID(),valueKnown:input.value!==null,updatedAt:previewNow}
  setItems(current=>[record,...current.filter(x=>x.candidateKey!==input.candidateKey)]);return record
 }
 return <><div className="app-shell opp-shell"><Sidebar page="opportunities" workspace="comercial" currentUser={user}/><main className="main"><div className="content"><Opportunities key={account} clients={empty?[]:previewClients} persistedItems={empty?[]:items} currentUser={user} storageScope={user.storageScope} preview initialSelection="db:preview-E" nowOverride={previewNow} onPersist={save} onSaved={setSaved} onRefreshPortfolio={async()=>{}}/></div></main></div>
 <details style={{padding:20}}><summary>Controles do teste isolado</summary><button onClick={()=>setEmpty(!empty)}>Alternar carteira vazia</button><button onClick={()=>setFail(!fail)}>Alternar falha de gravação</button><button onClick={()=>{setEmpty(true);setAccount(a=>a+1)}}>Trocar conta de teste</button><p role="status">{saved}</p><p>{fail?'Falha de gravação ativada':'Gravação em memória'}</p><p>APIs reais bloqueadas. Nenhum dado é persistido.</p><button onClick={()=>setSaved(JSON.stringify(requests))}>Ver requisições interceptadas</button></details></>
}
createRoot(document.getElementById('root')).render(<Harness/>)
