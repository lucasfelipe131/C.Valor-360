import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import App from './App'
import './styles.css'
import './val-brand.css'
import './agro-workspace.css'
import './mobile-browser.css'
import './mobile-login.css'
import './val-mobile-overflow.css'
import './val-logo-final.css'
import './presentation.css'

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
if('serviceWorker' in navigator&&import.meta.env.PROD){
 window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))
 // Após um deploy o SW novo assume (skipWaiting + claim) e os chunks antigos deixam de existir; recarregar uma vez evita "Failed to fetch dynamically imported module".
 let hadController=Boolean(navigator.serviceWorker.controller);let reloaded=false
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!reloaded){reloaded=true;window.location.reload()}hadController=true})
}
