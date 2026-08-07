import React from 'react'
import { Search, Bell, CalendarDays } from 'lucide-react'
export default function Topbar({title,subtitle}){
 return <header className="topbar">
  <div><h1>{title}</h1><p>{subtitle}</p></div>
  <div className="top-actions"><button className="icon-btn"><Search size={19}/></button><button className="icon-btn"><Bell size={19}/><span className="badge">3</span></button><button className="date-pill"><CalendarDays size={16}/> Hoje</button></div>
 </header>
}
