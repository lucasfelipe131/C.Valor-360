import React from 'react'
export default function KpiCard({icon:Icon,label,value,delta,tone='blue'}){
 return <article className="kpi-card"><div className={'kpi-icon '+tone}><Icon size={20}/></div><div><small>{label}</small><strong>{value}</strong><span>{delta}</span></div></article>
}
