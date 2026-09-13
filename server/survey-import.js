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

  // A chave era so o id derivado do nome. Dois produtores DIFERENTES com o mesmo nome — comum no
  // campo, e frequente em carteira herdada — colapsavam num cadastro so: a segunda linha
  // sobrescrevia a primeira e a unica pista era um contador de "duplicados". Um produtor de 1.800 ha
  // em Sorriso desaparecia atras de um xara de 120 ha em Lucas do Rio Verde, sem nenhuma mensagem
  // dizendo o que foi descartado.
  // A identidade so ganha o municipio quando ele DISTINGUE de fato: assim o cadastro ja gravado
  // (external_key = slug do nome) continua casando na proxima importacao, e nao vira duplicata.
  const byName=new Map()
  for(const profile of profiles){
    const list=byName.get(profile.result.id)||[]
    list.push(profile)
    byName.set(profile.result.id,list)
  }
  const latestByProducer=new Map()
  const collapsed=[]
  for(const [id,group] of byName){
    const places=new Set(group.map(item=>producerPlace(item.result)))
    if(places.size<2){
      // Mesmo nome e mesmo municipio: e reenvio da mesma pessoa, a resposta mais recente vence.
      const winner=group.at(-1)
      if(group.length>1)collapsed.push({id,name:winner.result.name,place:producerPlace(winner.result),discarded:group.length-1,reason:'same_place'})
      latestByProducer.set(id,winner)
      continue
    }
    // Municipios diferentes: sao pessoas diferentes. A primeira mantem a chave historica; as demais
    // ganham o municipio na identidade.
    const seen=new Set()
    group.forEach((profile,index)=>{
      const place=producerPlace(profile.result)
      const key=index===0||place===producerPlace(group[0].result)?id:`${id}-${slugPlace(place)}`
      if(seen.has(key))collapsed.push({id:key,name:profile.result.name,place,discarded:1,reason:'same_place'})
      seen.add(key)
      latestByProducer.set(key,{...profile,result:{...profile.result,id:key}})
    })
  }
  return {
    profiles:[...latestByProducer.values()],
    receivedCount:profiles.length,
    duplicateCount:profiles.length-latestByProducer.size,
    // Nada some em silencio: quem foi descartado vai nomeado, com o municipio, para a tela poder
    // dizer o que aconteceu em vez de so contar.
    collapsedProducers:collapsed
  }
}
const producerPlace=result=>String(result?.municipality||'').trim().toLocaleLowerCase('pt-BR')
const slugPlace=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'sem-localidade'
