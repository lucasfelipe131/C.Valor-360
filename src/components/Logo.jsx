import React,{useId} from 'react'
export default function Logo({compact=false}){
 const gradientId=`valor-mark-${useId().replace(/:/g,'')}`
 return <div className={"brand "+(compact?'compact':'')} role="img" aria-label="VALOR 360">
   <div className="brand-mark" aria-hidden="true">
     <svg viewBox="0 0 64 64" fill="none" focusable="false">
       <defs><linearGradient id={gradientId} x1="8" y1="8" x2="56" y2="56"><stop stopColor="#00A8FF"/><stop offset=".6" stopColor="#0B67D8"/><stop offset="1" stopColor="#0A2B55"/></linearGradient></defs>
       <path d="M49 15C44 10 38 8 31 8C17 8 8 18 8 32s9 24 23 24c7 0 13-2 18-7" stroke={`url(#${gradientId})`} strokeWidth="10" strokeLinecap="round"/>
       <rect x="45.5" y="26.5" width="11" height="11" rx="3" fill="#7BC043" transform="rotate(18 51 32)"/>
     </svg>
   </div>
   {!compact && <div className="brand-word"><strong>VALOR <span>360</span></strong><small>INTELIGÊNCIA • AGRO • RESULTADO</small></div>}
 </div>
}
