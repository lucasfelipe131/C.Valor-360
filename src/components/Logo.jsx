import React,{useId} from 'react'

export default function Logo({compact=false}){
 const uid=useId().replace(/:/g,'')
 const signalId=`val-signal-${uid}`
 const greenId=`val-green-${uid}`
 const leafId=`val-leaf-${uid}`
 return <div className={`brand val-brand ${compact?'compact':''}`} role="img" aria-label="VAL — inteligência que gera valor">
  <span className="brand-mark" aria-hidden="true">
   <svg viewBox="0 0 64 64" fill="none" focusable="false">
    <defs>
     <linearGradient id={signalId} x1="11" y1="8" x2="34" y2="49" gradientUnits="userSpaceOnUse">
      <stop stopColor="#2D8CFF"/>
      <stop offset=".58" stopColor="#0B67D8"/>
      <stop offset="1" stopColor="#073E8C"/>
     </linearGradient>
     <linearGradient id={greenId} x1="28" y1="48" x2="49" y2="17" gradientUnits="userSpaceOnUse">
      <stop stopColor="#007D69"/>
      <stop offset=".52" stopColor="#00C896"/>
      <stop offset="1" stopColor="#7BC043"/>
     </linearGradient>
     <linearGradient id={leafId} x1="41" y1="24" x2="58" y2="5" gradientUnits="userSpaceOnUse">
      <stop stopColor="#008C65"/>
      <stop offset=".46" stopColor="#00C896"/>
      <stop offset="1" stopColor="#7BC043"/>
     </linearGradient>
    </defs>
    <path d="M13 13 30.5 43.5" stroke="#073E8C" strokeOpacity=".38" strokeWidth="12" strokeLinecap="round"/>
    <path d="M13 13 30.5 43.5" stroke={`url(#${signalId})`} strokeWidth="10.5" strokeLinecap="round"/>
    <path d="M30.5 43.5 45 21" stroke="#007D69" strokeOpacity=".36" strokeWidth="12" strokeLinecap="round"/>
    <path d="M30.5 43.5 45 21" stroke={`url(#${greenId})`} strokeWidth="10.5" strokeLinecap="round"/>
    <path d="M12.9 12.4 30.2 42.7" stroke="white" strokeOpacity=".24" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M31.3 42.3 45.1 20.7" stroke="white" strokeOpacity=".22" strokeWidth="1.35" strokeLinecap="round"/>
    <path d="M40.8 20.7C41.4 11.2 49.4 5.4 58 6.4c-.6 8.8-5.5 16.5-16 18.1-2.2-1-2.7-2.5-1.2-3.8Z" fill={`url(#${leafId})`}/>
    <path d="M42.4 21.2c4.2-5.2 8.5-8.9 13.2-11.8" stroke="white" strokeOpacity=".36" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="31.4" cy="45.2" r="1.9" fill="white"/>
   </svg>
  </span>
  {!compact&&<span className="brand-word"><strong>VAL</strong><small>INTELIGÊNCIA QUE GERA VALOR</small></span>}
 </div>
}
