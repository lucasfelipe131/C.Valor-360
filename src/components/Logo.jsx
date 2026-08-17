import React,{useId} from 'react'

export default function Logo({compact=false}){
 const uid=useId().replace(/:/g,'')
 const signalId=`val-signal-${uid}`
 const surfaceId=`val-surface-${uid}`
 return <div className={`brand val-brand ${compact?'compact':''}`} role="img" aria-label="VAL — inteligência que gera valor">
  <span className="brand-mark" aria-hidden="true">
   <svg viewBox="0 0 64 64" fill="none" focusable="false">
    <defs>
     <linearGradient id={surfaceId} x1="8" y1="5" x2="58" y2="61" gradientUnits="userSpaceOnUse">
      <stop stopColor="#0E3530"/>
      <stop offset="1" stopColor="#061A18"/>
     </linearGradient>
     <linearGradient id={signalId} x1="14" y1="15" x2="50" y2="47" gradientUnits="userSpaceOnUse">
      <stop stopColor="#C8F25E"/>
      <stop offset=".34" stopColor="#00C896"/>
      <stop offset="1" stopColor="#2D8CFF"/>
     </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#${surfaceId})`}/>
    <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="17.25" stroke="white" strokeOpacity=".13" strokeWidth="1.5"/>
    <path d="M15.5 18.5 31.4 45.2" stroke={`url(#${signalId})`} strokeWidth="7" strokeLinecap="round"/>
    <path d="M48.6 15.8c-5.2 9.2-9.9 20.8-17.2 29.4" stroke={`url(#${signalId})`} strokeWidth="7" strokeLinecap="round"/>
    <circle cx="15.5" cy="18.5" r="3.2" fill="#C8F25E"/>
    <circle cx="48.6" cy="15.8" r="3.2" fill="#72B8FF"/>
    <circle cx="31.4" cy="45.2" r="4.1" fill="white"/>
   </svg>
  </span>
  {!compact&&<span className="brand-word"><strong>VAL</strong><small>INTELIGÊNCIA QUE GERA VALOR</small></span>}
 </div>
}
