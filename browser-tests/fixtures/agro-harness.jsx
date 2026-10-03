import React from 'react'
import {createRoot} from 'react-dom/client'
import AgroTerritoryPanel from '../../src/components/AgroTerritoryPanel'
import Sidebar from '../../src/components/Sidebar'
import MobileNav from '../../src/components/MobileNav'
import fixture from './agro-fixture.json'
import '../../src/styles.css'
import '../../src/val-brand.css'
import '../../src/mobile-browser.css'
import '../../src/val-mobile-overflow.css'
import '../../src/val-workspace-shell.css'
import '../../src/val-mobile-navigation.css'
// No business API, credentials, remote geocoding or third-party imagery in this isolated browser test.
window.fetch=async url=>new Response(JSON.stringify(String(url).startsWith('/api/agro-geo')?fixture:{}),{status:200,headers:{'Content-Type':'application/json'}})
const map=new URLSearchParams(location.search).get('map')==='1'
createRoot(document.getElementById('root')).render(<div className="app-shell"><Sidebar page="agro" workspace="campo" currentUser={{name:'Teste sintético'}}/><main className="main"><header className="topbar"><h1>Território sintético</h1></header><div className="content"><AgroTerritoryPanel map={map} scope="synthetic-viewport"/></div></main><MobileNav page="agro" workspace="campo" onSelect={()=>{}} onWorkspaceChange={()=>{}}/></div>)
