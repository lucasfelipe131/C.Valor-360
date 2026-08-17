import React,{useId} from 'react'

export default function Logo({compact=false}){
 const uid=useId().replace(/:/g,'')
 const signalId=`val-signal-${uid}`
 const blueFoldId=`val-blue-fold-${uid}`
 const greenId=`val-green-${uid}`
 const leafId=`val-leaf-${uid}`
 const leafShadeId=`val-leaf-shade-${uid}`
 const wordId=`val-word-${uid}`
 const wordGreenId=`val-word-green-${uid}`
 return <div className={`brand val-brand val-final-brand ${compact?'compact':''}`} role="img" aria-label="VAL — inteligência que gera valor">
  <span className="brand-mark" aria-hidden="true">
   <svg viewBox="0 0 64 64" fill="none" focusable="false">
    <defs>
     <linearGradient id={signalId} x1="10" y1="7" x2="36" y2="53" gradientUnits="userSpaceOnUse">
      <stop stopColor="#24B8FF"/>
      <stop offset=".44" stopColor="#167FE8"/>
      <stop offset="1" stopColor="#063A8C"/>
     </linearGradient>
     <linearGradient id={blueFoldId} x1="11" y1="8" x2="30" y2="41" gradientUnits="userSpaceOnUse">
      <stop stopColor="#0B57B7"/>
      <stop offset="1" stopColor="#042B69"/>
     </linearGradient>
     <linearGradient id={greenId} x1="31" y1="51" x2="52" y2="18" gradientUnits="userSpaceOnUse">
      <stop stopColor="#006E5E"/>
      <stop offset=".45" stopColor="#00A96F"/>
      <stop offset="1" stopColor="#58E21A"/>
     </linearGradient>
     <linearGradient id={leafId} x1="41" y1="27" x2="59" y2="4" gradientUnits="userSpaceOnUse">
      <stop stopColor="#006A52"/>
      <stop offset=".48" stopColor="#00A85C"/>
      <stop offset="1" stopColor="#65ED22"/>
     </linearGradient>
     <linearGradient id={leafShadeId} x1="43" y1="25" x2="57" y2="9" gradientUnits="userSpaceOnUse">
      <stop stopColor="#004D3E"/>
      <stop offset="1" stopColor="#008B57"/>
     </linearGradient>
    </defs>
    <path d="M12.5 10.1c2.6-2.1 6.5-1.6 8.4 1.2l21.2 31.6-8.6 13.6L9.4 18.7c-1.8-2.8-1.2-6.4 1.4-8.4l1.7-.2Z" fill={`url(#${signalId})`}/>
    <path d="M12.5 10.1c2.6-2.1 6.5-1.6 8.4 1.2l4 6-8.9 14.1-6.6-12.7c-1.8-2.8-1.2-6.4 1.4-8.4l1.7-.2Z" fill={`url(#${blueFoldId})`} fillOpacity=".78"/>
    <path d="M33.5 56.5 49.8 29c1.8-3 5.7-4 8.8-2.3 3.1 1.8 4.1 5.8 2.1 8.8L42.4 59.1c-2.3 3.3-7.3 3.1-8.9-.4v-2.2Z" fill={`url(#${greenId})`}/>
    <path d="M40.7 27.4C41.4 15.1 49.4 6.2 59.3 4.8c.1 11.5-5.1 21.8-17.5 25.4-2.2-.3-2.8-1.2-1.1-2.8Z" fill={`url(#${leafId})`}/>
    <path d="M42.1 28.5c4.2-7.6 9.5-13.3 15.6-18.1-5 7.6-8.8 14.9-11.2 21.8-2.2.1-3.6-1.1-4.4-3.7Z" fill={`url(#${leafShadeId})`} fillOpacity=".9"/>
    <path d="M42.8 27.7c4.4-6.1 8.9-10.9 13.9-14.7" stroke="white" strokeOpacity=".38" strokeWidth="1.15" strokeLinecap="round"/>
    <path d="M16.4 12.6 34.2 49.1" stroke="white" strokeOpacity=".2" strokeWidth="1.25" strokeLinecap="round"/>
    <path d="M35.8 53.4 51.7 28.3" stroke="white" strokeOpacity=".18" strokeWidth="1.15" strokeLinecap="round"/>
    <circle cx="31.4" cy="45.2" r="1.1" fill="white" fillOpacity=".72"/>
   </svg>
  </span>
  {!compact&&<span className="brand-word" aria-hidden="true">
   <svg className="val-wordmark" viewBox="0 0 220 72" fill="none" focusable="false">
    <defs>
     <linearGradient id={wordId} x1="0" y1="0" x2="220" y2="72" gradientUnits="userSpaceOnUse">
      <stop stopColor="#082C57"/>
      <stop offset="1" stopColor="#0A4C9B"/>
     </linearGradient>
     <linearGradient id={wordGreenId} x1="124" y1="67" x2="146" y2="48" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00835F"/>
      <stop offset="1" stopColor="#58E21A"/>
     </linearGradient>
    </defs>
    <path d="M5 9h19l26 43c2.4 4 5.3 4 7.7 0L84 9h19L66 67H42L5 9Z" fill={`url(#${wordId})`}/>
    <path fillRule="evenodd" clipRule="evenodd" d="M91 67 126 9h17l35 58h-20l-23.5-39-23.5 39H91Zm33.2-9.5h20.6l-10.3-17-10.3 17Z" fill={`url(#${wordId})`}/>
    <path d="m134.5 49.5 10.7 17.5h-21.4l10.7-17.5Z" fill={`url(#${wordGreenId})`}/>
    <path d="M181 9h18v39.5c0 4 2 5.5 6.5 5.5H219v13h-21c-11.5 0-17-5.6-17-17V9Z" fill={`url(#${wordId})`}/>
   </svg>
  </span>}
 </div>
}
