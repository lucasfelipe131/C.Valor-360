import React from 'react'
import {Check,LoaderCircle} from 'lucide-react'
import {VAL_PROGRESS_STEPS} from '../lib/val-progress-client'
import '../val-progress.css'

export default function ValProgressFeedback({progress,compact=false}){
  const current=progress||{stage:'received',label:'Recebendo a solicitação',order:0}
  return <div className={`val-progress-feedback ${compact?'is-compact':''}`} role="status" aria-live="polite">
    <div className="val-progress-current"><LoaderCircle className={current.done?'':'is-spinning'}/><span><small>ETAPA ATUAL</small><b>{current.label}</b></span></div>
    <ol>{VAL_PROGRESS_STEPS.map((item,index)=>{
      const done=current.stage==='complete'||Number(current.order)>index+1
      const active=current.stage===item.stage
      return <li key={item.stage} className={done?'is-done':active?'is-active':''}>{done?<Check/>:<span>{index+1}</span>}<b>{item.label}</b></li>
    })}</ol>
  </div>
}
