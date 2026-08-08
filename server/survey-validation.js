export function buildSurveyOptions(profileMatrix){
 return profileMatrix.reduce((map,item)=>{(map[item.Pergunta]??=new Set()).add(item.Alternativa);return map},{})
}

export function validateSurveyAnswers(input,surveyOptions){
 const answers={}
 for(let id=1;id<=27;id++){
  const raw=input?.[id]
  if(id>=19&&id<=24){
   const value=Number(raw)
   if(!Number.isInteger(value)||value<0||value>10)throw new Error(`A resposta ${id} precisa estar entre 0 e 10.`)
   answers[id]=value
   continue
  }
  const value=String(raw??'').trim().slice(0,2000)
  if(id===27){answers[id]=value||null;continue}
  if(!value)throw new Error(`A resposta ${id} é obrigatória.`)
  if(id>=7&&id<=18&&!surveyOptions[id]?.has(value))throw new Error(`A alternativa da resposta ${id} não é válida.`)
  answers[id]=value
 }
 return answers
}
