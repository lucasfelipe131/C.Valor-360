import {calculateProfile} from '../src/lib/profile.js'
import {validateSurveyAnswers} from './survey-validation.js'

const importError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})

export function compileSurveyImportBatch(input,{profileMatrix,surveyOptions,source='questionnaire_import'}={}){
  const records=Array.isArray(input?.records)?input.records:[]
  if(!records.length)throw importError('A importação não contém respostas do Produtor 360.')
  if(records.length>500)throw importError('Importe no máximo 500 respostas do Produtor 360 por vez.',413)

  const profiles=[]
  for(let index=0;index<records.length;index++){
    let answers
    try{answers=validateSurveyAnswers(records[index]?.answers,surveyOptions)}
    catch(error){throw importError(`Resposta ${index+1}: ${error.message}`)}
    const result=calculateProfile(answers,profileMatrix,'Planilha Produtor 360 validada no servidor')
    profiles.push({answers,result,source})
  }

  const latestByProducer=new Map()
  for(const profile of profiles)latestByProducer.set(profile.result.id,profile)
  return {
    profiles:[...latestByProducer.values()],
    receivedCount:profiles.length,
    duplicateCount:profiles.length-latestByProducer.size
  }
}
