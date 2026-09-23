const normalized=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
const list=value=>Array.isArray(value)?value:[]
export function registeredSpouseQuestion(message){
 // Family narratives (q32) are not a spouse-name field. Only a standalone
 // literal question may use this lookup; mixed advice/questions keep routing.
 // The entity resolver uses the SAME parsed owner so a long name or an indirect
 // relative can never silently become the producer currently open in the UI.
 const spouse=normalized(message).trim().match(/^(?:(?:qual\s+(?:e\s+)?(?:o\s+)?nome\s+d[ao])|(?:como\s+se\s+chama\s+(?:a|o))|(?:quem\s+e\s+(?:a|o)))\s+(?:esposa|esposo|conjuge|marido)(?:\s+(?<owner>(?:dele|dela|(?:deste|desse|desta|dessa)\s+(?:produtor|produtora|cliente)|(?:de|do|da)\s+[a-z][a-z' -]{0,120})))?\s*[?.!]*$/)
 if(!spouse||/\b(?:e|qual|quais|quanto|como|porque|recomende|prepare|manejo|dose|preco|custo)\b/.test(spouse.groups.owner||''))return null
 const owner=String(spouse.groups.owner||'').trim()
 if(!owner||/^(?:dele|dela|(?:deste|desse|desta|dessa)\s+(?:produtor|produtora|cliente)|(?:do|da)\s+(?:produtor|produtora|cliente)(?:\s+(?:atual|aberto|aberta))?)$/.test(owner))return {ownerReference:null,indirectOwner:false}
 const ownerReference=owner.replace(/^(?:de|do|da)\s+/,'')
 const indirectOwner=/\b(?:ele|ela|dele|dela|deles|delas|seu|sua|meu|minha)\b/.test(ownerReference)||/^(?:(?:o|a)\s+)?(?:vizinh[oa]s?|pai|mae|irmaos?|irmas?|filh[oa]s?|sogr[oa]s?|cunhad[oa]s?|prim[oa]s?|ti[oa]s?|avos?|net[oa]s?|sobrinh[oa]s?|amig[oa]s?|soci[oa]s?|compadre|comadre|parceir[oa]s?)\b/.test(ownerReference)
 return {ownerReference,indirectOwner}
}
export function registeredFactQuery(message,{previousMessage=''}={}){
 const text=normalized(message)
 const spouse=registeredSpouseQuestion(message)
 if(spouse&&!spouse.indirectOwner)return {kind:'spouse'}
 if(/\b(?:esposa|esposo|conjuge|marido)\b/.test(text))return null
 if(/\b(?:recomende|devo|prepare|manejo|dose|cotacao|preco|custo|produz|producao)\b/.test(text))return null
 const crop=text.match(/\b(milho|soja|trigo|canola|arroz|sorgo|feijao)\b/)?.[1]
 const area=/\b(?:hectares?|ha|area|planta|plantados?)\b/.test(text)
 const continuation=/^\s*e\s+(?:de\s+)?(?:soja|milho|trigo|canola|arroz)\s*\??$/.test(text)&&/hectare|\barea\b|\bha\b|planta/.test(normalized(previousMessage))
 if(crop&&(area||continuation))return {kind:'crop_area',crop,season:text.match(/\b(?:safra\s+)?(\d{4}\/\d{2,4}|\d{4}[iv])\b/)?.[1]||null}
 if(/\b(?:hobb(?:y|ies)|passatempo|lazer)\b/.test(text))return {kind:'hobby'}
 return null
}

// Preserve each declaration and its period/property. Never sum overlapping
// mapped area with the producer's consolidated declaration.
const thirdPartyArea=/\b(?:vizinh[oa]s?|compadre|comadre|irmaos?|irmas?|prim[oa]s?|sogr[oa]|genro|nora|cunhad[oa]s?|soci[oa]s?|arrendatari[oa]s?|arrendante|parceir[oa]s?|outro produtor|produtor ao lado)\b/
const STALE_MS=548*24*60*60*1000
export function registeredFactPresentation({query,client,declaredSeasons=[],properties=[],narratives=[],now=new Date()}){
 if(query.kind==='spouse'){
  const spouse=typeof client.relationship?.spouse==='string'?client.relationship.spouse.trim():''
  const found=Boolean(spouse)
  const statement=found?`Cônjuge registrado de ${client.name}: ${spouse}.`:'Informação ausente: nome do cônjuge no cadastro deste produtor.'
  const sourceRef=found?`client:${client.id}:relationship.spouse`:null
  const factsUsed=found?[{id:sourceRef,source_type:'client_registration',observed_at:client.updatedAt||client.updated_at||null,statement}]:[]
  return {dataPath:'REGISTERED_DETAIL',answer:statement,primaryFound:found,sourceRef,factsUsed,action:found?'':'Confirme a informação e registre no campo Cônjuge do produtor.',missing:'nome do cônjuge no cadastro',doNotDo:'Não inferir o nome do cônjuge a partir de relatos de família, de outra pessoa ou da conversa.',capabilityStatus:found?'EXECUTED':'NO_DATA',stale:false}
 }
 const rows=[]
 if(query.kind==='hobby'){
  const hobby=client.relationship?.hobbies||client.hobby||client.hobbies||client.commercial?.hobby||client.commercial?.hobbies
  if(hobby)rows.push({id:`client:${client.id}:hobby`,source_type:'client_registration',observed_at:client.updatedAt||client.updated_at||null,statement:`Hobby registrado de ${client.name}: ${Array.isArray(hobby)?hobby.join(', '):String(hobby)}.`})
 }
 if(query.kind==='crop_area'){
  for(const season of declaredSeasons){
   if(query.season&&normalized(season.season)!==query.season)continue
   for(const crop of list(season.crops))if(normalized(crop.crop)===query.crop&&crop.areaHa!==null&&crop.areaHa!==undefined){
    rows.push({id:`producer-season:${client.id}:${season.season}`,source_type:'crop_season',observed_at:season.updatedAt||season.observedOn,statement:`${client.name}: ${crop.areaHa} ha de ${crop.crop}, safra ${season.season}, declaração consolidada do produtor.`,value:Number(crop.areaHa),period:season.season})
   }
  }
  for(const property of properties)for(const field of list(property.fields))for(const season of list(field.seasons)){
   if(normalized(season.crop)!==query.crop||query.season&&normalized(season.season)!==query.season)continue
   const area=season.areaHa??season.area_ha;if(area===null||area===undefined)continue
   rows.push({id:`field-season:${field.id}:${season.season}`,source_type:'crop_season',observed_at:season.updated_at||season.created_at,statement:`${client.name}: ${area} ha de ${season.crop}, safra ${season.season}, talhão ${field.name||field.id}, propriedade ${property.name||property.id}.`,value:Number(area),period:season.season})
  }
 }
 const pattern=query.kind==='hobby'?/hobb(?:y|ies)|passatempo|lazer/i:new RegExp(`\\b${query.crop}\\b`,'i')
 let thirdPartyOmitted=0
 for(const record of narratives){
  const sentences=String(record.text||'').split(/(?<=[.!?])\s+/).filter(sentence=>pattern.test(normalized(sentence))&&(query.kind==='hobby'||/\b(?:ha|hectares?)\b/i.test(sentence)))
  for(const sentence of sentences){
   if(query.season&&!normalized(sentence).includes(query.season))continue
   // Area citada num relato pode ser de OUTRA pessoa. "O vizinho do Joao, o Ademar, planta 1200 ha
   // de milho na divisa" entrava na resposta de "quantos hectares o Joao planta de milho" com o
   // mesmo peso do cadastro, e nada na frase dizia que os 1200 ha nao eram do produtor aberto.
   // Frase que atribui a area a um terceiro fica de fora — e o consultor e avisado de que ficou.
   if(query.kind!=='hobby'&&thirdPartyArea.test(normalized(sentence))){thirdPartyOmitted++;continue}
   rows.push({id:record.id,source_type:record.source_type,observed_at:record.observedAt,statement:`Relato registrado${record.observedAt?` em ${new Date(record.observedAt).toLocaleDateString('pt-BR',{timeZone:'UTC'})}`:''}: ${sentence}`,narrative:true})
  }
 }
 const unique=[...new Map(rows.map(row=>[row.id+':'+row.statement,row])).values()]
 const found=unique.length>0,shown=unique.slice(0,8)
 const label=query.kind==='hobby'?'hobby':'área de '+query.crop
 const answer=found?shown.map(row=>row.statement).join(' '):`Informação ausente: ${label} nos cadastros e relatos consultados.`
 const periods=new Set(unique.map(row=>row.period).filter(Boolean))
 // O registro mais novo pode ter varias safras de idade. Perguntada no presente ("quantos hectares
 // ele planta"), a VAL respondia o numero da safra 2223V em setembro de 2026 sem uma palavra sobre
 // isso: o texto trazia a safra, mas nada dizia que nao existe declaracao posterior.
 const observedTimes=unique.map(row=>new Date(row.observed_at||0).getTime()).filter(time=>Number.isFinite(time)&&time>0)
 const newest=observedTimes.length?Math.max(...observedTimes):null
 const stale=Boolean(found&&newest&&now.getTime()-newest>STALE_MS)
 // A frase da lacuna nao pode carregar numero nem ponto-e-virgula: o contrato de grounding parte a
 // resposta em afirmacoes (inclusive no ';') e so libera uma lacuna declarada quando ela nao afirma
 // nenhum dado novo. Com a data embutida, a propria correcao derrubava a resposta com HTTP 400.
 const answerText=stale?`${answer} Informação ausente: registro de ${label} posterior a este.`:answer
 const notes=[
  unique.length>8?'Há outros registros; informe a safra ou propriedade para restringir a consulta.':periods.size>1?'Há safras distintas. Qual delas você quer considerar?':unique.length>1?'Os registros foram apresentados separadamente; confirme eventuais divergências antes de usar uma área consolidada.':'',
  stale?`Confirme com o produtor a ${label} atual antes de usar este número.`:'',
  thirdPartyOmitted?`${thirdPartyOmitted===1?'Um relato cita':`${thirdPartyOmitted} relatos citam`} área de terceiro (vizinho, sócio, arrendatário) e ${thirdPartyOmitted===1?'ficou':'ficaram'} de fora desta resposta; abra o relato para conferir.`:''
 ].filter(Boolean)
 return {dataPath:'REGISTERED_DETAIL',answer:answerText,primaryFound:found,sourceRef:shown[0]?.id||null,factsUsed:shown,action:notes.join(' '),missing:label,doNotDo:'Não somar áreas de períodos ou níveis diferentes.',capabilityStatus:found?'EXECUTED':'NO_DATA',stale,
  keyUncertainty:stale?`Não há registro de ${label} posterior a este no cadastro.`:'',
  whatToValidate:stale?`Confirme com o produtor se a ${label} mudou desde o último registro.`:''}
}
