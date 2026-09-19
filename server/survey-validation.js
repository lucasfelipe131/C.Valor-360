export function buildSurveyOptions(profileMatrix){
 return profileMatrix.reduce((map,item)=>{(map[item.Pergunta]??=new Set()).add(item.Alternativa);return map},{})
}

// O corte em 2000 era por unidade de codigo UTF-16. Emoji ocupa DUAS, entao uma resposta longa
// terminada em emoji perto do limite era cortada no meio do par substituto: o texto passava a ter
// um substituto solitario, o jsonb recusava, e o produtor recebia 503 dizendo que o PostgreSQL
// precisa estar disponivel. Ele reescrevia a resposta, tomava 503 de novo, e nao havia como saber
// que a culpa era do emoji. O \u0000 tambem e recusado pelo jsonb e vinha junto de colagem.
const LIMITE_RESPOSTA=2000
const cortarResposta=texto=>{
 const limpo=String(texto).replace(/\u0000/g,'').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'')
 if(limpo.length<=LIMITE_RESPOSTA)return limpo
 const ultimo=limpo.charCodeAt(LIMITE_RESPOSTA-1)
 // Nunca terminar em substituto ALTO: seria metade de um par.
 return limpo.slice(0,ultimo>=0xD800&&ultimo<=0xDBFF?LIMITE_RESPOSTA-1:LIMITE_RESPOSTA)
}

export function validateSurveyAnswers(input,surveyOptions){
 const answers={}
 for(let id=1;id<=45;id++){
  const raw=input?.[id]
  if(id>=19&&id<=24){
   const value=Number(raw)
   if(!Number.isInteger(value)||value<0||value>10)throw new Error(`A resposta ${id} precisa estar entre 0 e 10.`)
   answers[id]=value
   continue
  }
  const value=cortarResposta(String(raw??'').trim())
  if(id>=27){answers[id]=value||null;continue}
  if(!value)throw new Error(`A resposta ${id} é obrigatória.`)
  if(id>=7&&id<=18&&!surveyOptions[id]?.has(value))throw new Error(`A alternativa da resposta ${id} não é válida.`)
  answers[id]=value
 }
 return answers
}
