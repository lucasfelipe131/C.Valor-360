import React from 'react'

const numberValue=value=>{
 const parsed=Number(value)
 return Number.isFinite(parsed)?Math.max(0,parsed):0
}

export const formatCurrencyNumber=value=>numberValue(value).toLocaleString('pt-BR',{
 minimumFractionDigits:2,
 maximumFractionDigits:2
})

export default function CurrencyInput({value,onChange,readOnly=false,placeholder='0,00',...inputProps}){
 const empty=value===null||value===undefined||value===''
 const display=empty?'':formatCurrencyNumber(value)
 const change=event=>{
  if(readOnly)return
  const digits=String(event.target.value||'').replace(/\D/g,'').slice(0,15)
  onChange?.(digits?Number(digits)/100:'')
 }
 return <span className={`currency-input ${readOnly?'is-readonly':''}`}>
  <span aria-hidden="true">R$</span>
  <input {...inputProps} type="text" inputMode="numeric" value={display} onChange={change} readOnly={readOnly} placeholder={placeholder}/>
 </span>
}
