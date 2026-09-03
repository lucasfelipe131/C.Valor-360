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
import './copilot-ux.css'
import './val-ui-simple-modern.css'

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))
