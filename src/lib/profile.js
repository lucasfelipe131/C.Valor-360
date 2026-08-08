export const profileKeys=['Conservador','Analítico','Inovador','Relacional','Digital']

export const slug=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')

export function calculateProfile(answers,matrix,source='Produtor 360'){
 const score=Object.fromEntries(profileKeys.map(key=>[key,0]))
 matrix.forEach(item=>{if(answers[item.Pergunta]===item.Alternativa)score[item.Perfil]=(score[item.Perfil]||0)+1})
 const ranking=Object.entries(score).sort((a,b)=>b[1]-a[1])
 const scale=[19,20,21,22,23].map(id=>Number(answers[id]||0))
 const irt=Math.round(scale.reduce((sum,value)=>sum+value,0)*2)
 const nps=Number(answers[24]||0)
 const name=String(answers[1]||'Produtor sem nome').trim()
 return {
  id:`${slug(name)||'produtor'}-${Date.now()}`,
  name,
  municipality:String(answers[2]||'A definir'),
  area:String(answers[3]||'A definir'),
  cultures:String(answers[4]||'A definir'),
  relationshipTime:String(answers[5]||'A definir'),
  primaryProfile:ranking[0]?.[1]?ranking[0][0]:'A classificar',
  secondaryProfile:ranking[1]?.[1]?ranking[1][0]:'A aprofundar',
  scores:Object.fromEntries(Object.entries(score).map(([key,value])=>[slug(key),value])),
  irt,
  irtBand:irt>=80?'Relacionamento estratégico':irt>=60?'Relacionamento consolidado':irt>=40?'Relacionamento em desenvolvimento':irt>=20?'Relacionamento vulnerável':'Relacionamento crítico',
  nps,
  npsClass:nps>=9?'Promotor':nps>=7?'Neutro':'Detrator',
  valuedAspect:String(answers[25]||'A registrar'),
  missingFor10:String(answers[26]||''),
  additionalNeed:String(answers[27]||''),
  decisionParticipants:String(answers[6]||''),
  decisionDriver:String(answers[7]||''),
  technicalPresentation:String(answers[8]||''),
  planningStyle:String(answers[9]||''),
  innovationBehavior:String(answers[10]||''),
  servicePreference:String(answers[11]||''),
  contactFrequency:String(answers[12]||''),
  firstActionProblem:String(answers[13]||''),
  trustDriver:String(answers[14]||''),
  eventPreference:String(answers[15]||''),
  buyingBehavior:String(answers[16]||''),
  contentPreference:String(answers[17]||''),
  postSalePreference:String(answers[18]||''),
  scoresScale:{trust:answers[19],contact:answers[20],value:answers[21],innovation:answers[22],continuity:answers[23],recommendation:answers[24]},
  commercial:{potential:0,lastContactDays:0,priority:'Nova',opportunity:String(answers[27]||'Diagnóstico inicial'),property:'A cadastrar'},
  source,
  profileUpdatedAt:new Date().toISOString()
 }
}

export const normalizeText=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()
