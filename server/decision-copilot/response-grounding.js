import {createHash} from 'node:crypto'
import {classifyValContextDomain,matchedValContextDomains} from './context-selector.js'

export const responseGroundingVersion='val.response_grounding.v2'

const list=value=>Array.isArray(value)?value:[]
const clean=(value,max=20_000)=>String(value??'').replace(/\p{Cf}/gu,'').replace(/\p{Cc}/gu,' ').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const stopWords=new Set(['a','ao','aos','as','com','como','da','das','de','dele','dela','do','dos','e','ele','ela','em','essa','esse','esta','este','isso','na','nas','no','nos','o','os','ou','para','pelo','pela','por','que','se','sem','ser','sua','um','uma','perfil','principal','confianca','porque','abordar','ainda','sabemos'])
const behavioralAction=/\b(?:compar\w*|ped\w*|solicit\w*|valid\w*|decid\w*|prefer\w*|avali\w*|exig\w*|prioriz\w*|consult\w*|revis\w*)\b/
const behavioralCriterion=/\b(?:alternativ\w*|comparativ\w*|criteri\w*|dados?|decis\w*|evidenci\w*|indicador\w*|informac\w*|referenci\w*|retorno|roi|custo(?:\s+por\s+hectare)?|relacionamento|confianca)\b/
const strictBehavioralSupport=value=>behavioralAction.test(value)&&behavioralCriterion.test(value)
const insufficient=/\b(?:nao (?:ha|possui|tenho|consigo)(?:\s+\w+){0,4}\s+(?:dados?|evidencias?|fontes?|registros?)|nenhum(?:a)?\b[^.!?]{0,200}\b(?:localizad|encontrad|selecionad|registrad|cadastrad|confirmad)[oa]s?\b|sem (?:dado|evidencia|fonte)|evidencia(?:\s+\w+){0,3}\s+insuficiente|ainda nao (?:ha|foi|esta)(?:\s+\w+){0,4}\s+(?:dado|evidencia|fonte|confirmad)|ainda nao ha\b[^.!?]{0,240}\b(?:registrad|cadastrad)[oa]s?\b|preciso confirmar|nao determinado|faltam? (?:dados?|evidencias?|observacoes?))\b/
const uncertainty=/\b(?:o que ainda nao sabemos|incerteza|hipotese|precisa confirmar|validar se|pode ser|talvez)\b/
const declaredGap=/^(?:o que ainda nao sabemos|incerteza|informacao ausente|dado ainda nao confirmado|falta confirmar)\s*:/
const profileForeignDomains=new Set(['COMMERCIAL','OPPORTUNITY','VISIT','GRAINS','CREDIT','AGRONOMY','GEO'])
const profileHardForeignDomains=new Set(['GRAINS','CREDIT','AGRONOMY','GEO'])
const profileSpecificState=/\b(?:proposta\w*|negociacao\w*|margem|margens|visita\w*|compromisso\w*|contrato\w*)\b/
const DAY_MS=24*60*60*1000
const allEvidenceTypes=new Set(['FACT','OBSERVATION','INFERENCE','INTENTION','QUOTE','STRATEGY','HYPOTHESIS','VALIDATED_KNOWLEDGE'])
const sourceContract=(evidenceTypes,{staticSource=false,maxAgeMs=null,validUntilMayExtend=true,requiresValidUntil=false}={})=>Object.freeze({evidenceTypes:new Set(evidenceTypes),staticSource,maxAgeMs,validUntilMayExtend,requiresValidUntil})
const observedRecordedTypes=['FACT','OBSERVATION','INFERENCE','INTENTION','QUOTE','HYPOTHESIS']
// This is deliberately an allow-list. A container/table label, typo or new
// source cannot silently acquire the freshness and epistemic privileges of a
// canonical evidence source. New sources must declare their contract here.
const sourceContracts=new Map([
 ['client_registration',sourceContract(['FACT'],{staticSource:true})],
 ['client_record',sourceContract(['FACT','OBSERVATION'])],
 ['crop_season',sourceContract(['FACT','OBSERVATION'])],
 ['official_product_catalog',sourceContract(['FACT','VALIDATED_KNOWLEDGE'],{staticSource:true})],
 ['general_knowledge',sourceContract(['FACT','VALIDATED_KNOWLEDGE'],{staticSource:true})],
 ['system_safety_policy',sourceContract(['FACT','VALIDATED_KNOWLEDGE'],{staticSource:true})],
 ['market_snapshot',sourceContract(['FACT','OBSERVATION'],{maxAgeMs:3*DAY_MS,validUntilMayExtend:false})],
 ['context_snapshot',sourceContract(['FACT'],{maxAgeMs:DAY_MS,validUntilMayExtend:false})],
 ['system_capability',sourceContract(['FACT'],{maxAgeMs:DAY_MS,validUntilMayExtend:false})],
 ['calculation',sourceContract(['FACT'],{maxAgeMs:DAY_MS,validUntilMayExtend:false})],
 ['conversation_turn',sourceContract(['INFERENCE'],{maxAgeMs:180*DAY_MS,validUntilMayExtend:false})],
 ['business_event',sourceContract(['FACT','OBSERVATION'],{maxAgeMs:180*DAY_MS})],
 ['business_history',sourceContract(['FACT','OBSERVATION'],{maxAgeMs:180*DAY_MS})],
 ['commitment',sourceContract(['FACT','INTENTION'],{maxAgeMs:180*DAY_MS})],
 ['opportunity',sourceContract(['FACT','INFERENCE','INTENTION','HYPOTHESIS'],{maxAgeMs:180*DAY_MS,validUntilMayExtend:false})],
 ['credit_snapshot',sourceContract(['FACT','OBSERVATION'],{maxAgeMs:30*DAY_MS})],
 ['behavioral_profile',sourceContract(['INFERENCE','HYPOTHESIS'],{requiresValidUntil:true})],
 ['producer_profile',sourceContract(['FACT','OBSERVATION','INFERENCE','HYPOTHESIS'],{requiresValidUntil:true})],
 ['legacy_profile_score',sourceContract(['INFERENCE','HYPOTHESIS'],{requiresValidUntil:true})],
 ['behavioral_profile_evidence',sourceContract(['FACT','OBSERVATION','QUOTE'],{requiresValidUntil:true})],
 ['producer_questionnaire',sourceContract(['FACT','OBSERVATION','QUOTE'],{requiresValidUntil:true})],
 ['producer_360',sourceContract(['FACT','OBSERVATION','QUOTE'],{requiresValidUntil:true})],
 ['survey',sourceContract(['FACT','OBSERVATION','QUOTE'])],
 ['visit_quote',sourceContract(['QUOTE'],{maxAgeMs:180*DAY_MS})],
 ['scheduled_visit',sourceContract(['FACT','OBSERVATION'])],
 ['visit',sourceContract(observedRecordedTypes)],
 ['visit_report',sourceContract(observedRecordedTypes)],
 ['confirmed_visit_report',sourceContract(observedRecordedTypes)],
 ['confirmed_voice_interaction',sourceContract(observedRecordedTypes)],
 ['current_interaction',sourceContract(observedRecordedTypes,{maxAgeMs:30*DAY_MS})],
 ['interaction',sourceContract(observedRecordedTypes)],
 ['negotiation_intent',sourceContract(['INTENTION','QUOTE','OBSERVATION'])],
 ['producer_statement',sourceContract(['OBSERVATION','INTENTION','QUOTE'])],
 ['approved_playbook',sourceContract(['FACT','STRATEGY','VALIDATED_KNOWLEDGE'])],
 ['consultant_input',sourceContract(['FACT','OBSERVATION','INFERENCE','INTENTION','QUOTE','STRATEGY','HYPOTHESIS'])],
 ['organization_policy',sourceContract(['FACT','VALIDATED_KNOWLEDGE'])],
 ['laboratory',sourceContract(['FACT','OBSERVATION','VALIDATED_KNOWLEDGE'])],
 ['soil_analysis',sourceContract(['FACT','OBSERVATION'])],
 ['field_report',sourceContract(observedRecordedTypes)],
 ['ndvi',sourceContract(['FACT','OBSERVATION','INFERENCE'])],
 ['ndvi_observation',sourceContract(['FACT','OBSERVATION','INFERENCE'])],
 ['manual_record',sourceContract(observedRecordedTypes)],
 ['consultant_attachment',sourceContract(['FACT','OBSERVATION','INFERENCE'])],
 ['attachment',sourceContract(['FACT','OBSERVATION','INFERENCE'])],
 ['attachment_analysis',sourceContract(['FACT','OBSERVATION','INFERENCE'],{maxAgeMs:30*DAY_MS})]
])
// GLOBAL is an isolation marker, not a licence to relabel arbitrary producer
// records.  Only sources whose semantics are genuinely non-individual may use
// it; producer observations/quotes/intentions must always carry producer_id.
const trustedGlobalSourceTypes=new Set(['general_knowledge','market_snapshot','official_product_catalog','system_capability','system_safety_policy'])
const globalScopeOf=item=>clean(item?.scope??item?.context_scope??item?.subject_type??item?.entity_type??item?.entityType,80).toUpperCase()
const explicitlyGlobal=item=>['GLOBAL','MARKET','GENERAL_KNOWLEDGE'].includes(globalScopeOf(item))
const processGuidanceDomains=Object.freeze({
 PROFILE:new Set(['PROFILE']),COMMERCIAL:new Set(['COMMERCIAL','OPPORTUNITY','VISIT']),
 AGRONOMY:new Set(['AGRONOMY','GEO']),GRAINS:new Set(['GRAINS','COMMERCIAL','OPPORTUNITY','VISIT']),
 CREDIT:new Set(['CREDIT','COMMERCIAL','OPPORTUNITY','VISIT']),GEO:new Set(['GEO','AGRONOMY']),
 VISIT:new Set(['VISIT','COMMERCIAL','OPPORTUNITY']),OPPORTUNITY:new Set(['OPPORTUNITY','COMMERCIAL','VISIT'])
})

// source_ref names a parent/origin relationship; it is not the identity of the
// evidence record itself. Treating it as an id lets a forged relationship look
// like an independently auditable source.
const identifierOf=item=>clean(item?.id??item?.memory_ref??item?.memoryRef??item?.source_id??item?.sourceId,240)
const sourceTypeOf=item=>clean(item?.source_type??item?.sourceType,120).toLowerCase()
const aliasValues=(item,keys)=>[...new Set(keys.map(key=>clean(item?.[key],180)).filter(Boolean))]
const producerAliases=item=>aliasValues(item,['producer_id','producerId','client_id','clientId','subject_client_id'])
const tenantAliases=item=>aliasValues(item,['tenant_id','tenantId','organization_id','organizationId'])
const ownerAliases=item=>aliasValues(item,['context_owner_id','contextOwnerId','consultant_id','consultantId','owner_id','ownerId','created_by','createdBy'])
const producerOf=item=>producerAliases(item)[0]||''
const tenantOf=item=>tenantAliases(item)[0]||''
const ownerOf=item=>ownerAliases(item)[0]||''
// Exactly one canonical, top-level semantic field is evidence. Nested data and
// value objects are metadata/subrecords and need their own provenance record;
// concatenating them here would let an otherwise valid wrapper launder poison.
const evidenceRawTextOf=item=>{
 const canonical=[item?.statement,item?.claim_supported,item?.summary,item?.description].find(value=>clean(value))
 if(canonical!=null)return clean(canonical)
 return typeof item?.value==='string'||typeof item?.value==='number'?clean(item.value):''
}
const hash=value=>createHash('sha256').update(clean(value,8000)).digest('hex').slice(0,20)
const canonicalToken=token=>/^(?:prova|dados?|evidenci\w*|comprov\w*)$/.test(token)?'evidencia':/^(?:metric\w*|indicador\w*)$/.test(token)?'metrica':/^agronom\w*$/.test(token)?'agronomia':/^(?:ferrament\w*|modul\w*)$/.test(token)?'ferramenta':/^produtor\w*$/.test(token)?'produtor':token
// Short identity/status terms are material even though ordinary short function
// words are intentionally ignored. Without this allow-list a grounded prefix
// could launder tails such as "é VIP", "tem CPF" or "usa IA".
const shortMaterialTokens=new Set(['roi','ctc','ph','cpf','cnpj','vip','mei','reu','rea','mau','ma','bom','boa','ia','boi','pf','pj'])
const tokens=value=>[...new Set(normalize(value).split(/[^a-z0-9]+/).filter(token=>(token.length>=4||shortMaterialTokens.has(token))&&!stopWords.has(token)&&!/^[0-9]+$/.test(token)).map(canonicalToken))]
const numericPatternSource=String.raw`(?:[+\-−－]\s*)?(?:r\$\s*)?\d+(?:[.,]\d+)*(?:\s*%|\s*(?:ha|sc|kg|t|dias?|meses?|anos?))?`
const numericSurface=value=>clean(value).toLocaleLowerCase('pt-BR').replace(/\b(?:pergunta|item|etapa)\s+\d+\s*:?/g,'')
const numericMatches=value=>[...numericSurface(value).matchAll(new RegExp(numericPatternSource,'g'))]
const numbers=value=>numericMatches(value).map(match=>match[0])
const numericSignature=value=>normalize(value).replace(/[−－]/g,'-').replace(/\s+/g,'').replace(/^\+/,'')
const numericConcreteAnchor=/^(?:soja|milho|trigo|algodao|arroz|feijao|cafe|cana|graos?|propost\w*|contrat\w*|credito|cpf|cliente|produtor|fazenda|propriedade|talhao|produto|fertiliz\w*|visita)$/
const numericAttributeAnchor=/^(?:area|custo|divida|hectares?|limite|margem|percentual|prazo|preco|quantidade|receita|retorno|saldo|taxa|total|valor|volume)$/
const numericAnchorNoise=/^(?:aprovad\w*|atual|confirmad\w*|dias?|meses?|anos?|hectares?|quilo\w*|sacas?|toneladas?)$/
// `entry.text` is accent-folded, so the copula "é 10%" becomes "e 10%".
// Treat e/ou as coordination only when a lexical sub-clause follows, not when
// they sit immediately before the numeric value.
const numericClauseDelimiter=/[.!?;,/]|\s+(?:(?:e|ou)\s+(?=[a-z])|(?:mas|por[eé]m|contudo|entretanto|todavia)\s+)/giu

function numericMentions(value=''){
 const surface=numericSurface(value)
 const matches=[...surface.matchAll(new RegExp(numericPatternSource,'g'))]
 return matches.map(match=>{
  const prefix=surface.slice(0,match.index)
  const delimiters=[...prefix.matchAll(new RegExp(numericClauseDelimiter.source,'giu'))]
  const start=delimiters.length?delimiters.at(-1).index+delimiters.at(-1)[0].length:0
  const suffix=surface.slice(match.index+match[0].length)
  const nextDelimiter=new RegExp(numericClauseDelimiter.source,'iu').exec(suffix)
  const end=nextDelimiter?match.index+match[0].length+nextDelimiter.index:surface.length
  const clause=surface.slice(start,end).replace(new RegExp(numericPatternSource,'g'),' ')
  const clauseTokens=tokens(clause).filter(token=>!numericAnchorNoise.test(token))
  const concrete=clauseTokens.filter(token=>numericConcreteAnchor.test(token))
  const attributes=clauseTokens.filter(token=>numericAttributeAnchor.test(token))
  const fallback=clauseTokens.filter(token=>!numericConcreteAnchor.test(token)&&!numericAttributeAnchor.test(token)).slice(-3)
  return {signature:numericSignature(match[0]),concrete,attributes,fallback}
 })
}

const intersects=(left=[],right=[])=>left.some(value=>right.includes(value))

function numericMentionCompatible(claimMention,supportMention){
 if(claimMention.signature!==supportMention.signature)return false
 if(claimMention.concrete.length&&supportMention.concrete.length)return intersects(claimMention.concrete,supportMention.concrete)
 if(claimMention.concrete.length!==supportMention.concrete.length)return false
 if(claimMention.attributes.length&&supportMention.attributes.length)return intersects(claimMention.attributes,supportMention.attributes)
 if(claimMention.attributes.length!==supportMention.attributes.length)return false
 if(claimMention.fallback.length&&supportMention.fallback.length)return intersects(claimMention.fallback,supportMention.fallback)
 return true
}
const specificStrategy=/\b(?:assinatura|assine|contrato|produto|pre[cç]o|cr[eé]dito|cpf|gr[aã]os?|fertiliz\w*|visita|compromisso|proposta|compra|venda|pagamento)\b/
const materialStrategyToken=/^(?:assinatura|assine|contrato|produto|preco|credito|cpf|grao|graos|fertiliz\w*|visita|compromisso|proposta|compra|venda|pagamento)$/
const insufficiencyAction=/\b(?:assine|assinar|trave|travar|compre|comprar|venda|vender|pague|pagar|libere|liberar|desbloqueie|desbloquear|aplique|aplicar|registre|registrar|confirme|confirmar|feche|fechar|envie|enviar)\b/
const insufficiencyTailMarker=/(?:;|\b(?:mas|porem|contudo|entretanto|todavia|no entanto|ainda assim)\b)/
const producerAssertionSubject=/\b(?:ele|ela|produtor\w*|perfil|analitic\w*|relacional|inovador|conservador|digital|visita|contrato|produto|proposta|cpf|credito|graos?|fertiliz\w*)\b/
const unsupportedInsufficiencySubject=/\b(?:fazenda|operacao|reputacao|produtor|cliente|ele|ela)\b[^.!?]{0,160}\b(?:e|esta|tem|possui|quer|pretende|vai|parece)\b/
const factualStrategyTail=/\b(?:porque|pois|por ser|por estar|ja que|uma vez que)\b/
const producerTargetedStrategy=/\b(?:este|esse|aquele|o|a)\s+(?:produtor|produtora|cliente)\b|\b(?:ele|ela)\b/
const neutralProcessStrategy=/^(?:selecione|selecionar|informe|informar|envie|enviar|anexe|anexar|forneca|fornecer|confirme (?:a fonte|o dado|os dados|o contexto|a entrada)|valid[ea] (?:a fonte|o dado|os dados|o contexto|a entrada)|priorize confirmar)\b/
const processGuidanceLanguage=/\b(?:falta|faltam|precisa|necessari\w*|selecione|informe|confirme|valide|nenhum|nenhuma|nao ha|fonte|escopo|revisao|pergunta|entrada|dados?|evidencia|contexto|registro)\b/
const confidenceProcessLanguage=/\b(?:confianca|evidencia|fonte|escopo|registro|contexto|lookup|leitura|informacao|dados?)\b/
const explicitGlobalTopic=/\b(?:mercado|cotacao|bolsa|clima|previsao do tempo|ferramentas? agronomicas?|modulos? agronomicos?|preco (?:da|do|de) (?:soja|milho|trigo|grao)|bula|rotulo)\b/
const definitionalQuestion=/\b(?:o que (?:e|significa)|explique|defina|como (?:se )?calcula|qual (?:e )?a importancia)\b/
const individualQuestion=/\b(?:dele|dela|do produtor|da produtora|do cliente|da cliente|perfil|visita|compromisso|objecao|quanto|total cultivad\w*|cultiva\w*|patrimonio|area(?:\s+(?:de|do|da))?|hectares?|divida|cpf|possui|tem)\b/
const globalAggregateAnchor=/\b(?:mercado|cotacao|bolsa|brasil|pais|nacional|estado|regiao|setor|indice|media|commodity|commodities|safra (?:brasileira|nacional)|clima|previsao|soja|milho|trigo)\b/
// Vocabulário de conceitos gerais reconhecidos como não-individuais. A lista original
// cobria só 5 termos financeiros/de solo, deixando toda resposta conceitual de
// agronomia, mercado de commodities e comportamento sem âncora e bloqueada por
// GLOBAL_NOT_SEMANTICALLY_GENERAL mesmo sem qualquer claim individual (que já é
// barrado antes, por genericAssertion/hasNamedIndividualAssertion, linha acima).
const globalConceptAnchor=/\b(?:conceito|definicao|ctc|ph|roi|margem|custo por hectare|ferramenta|modulo|catalogo|manual|bula|rotulo|capacidade do solo|calculo|agronomi\w*|solo|adubacao|calagem|fertilidade|fertilizante|praga\w*|doenca\w*|daninha\w*|fungicid\w*|herbicid\w*|inseticid\w*|resistencia|manejo|basis|hedge|wasde|estoque|frete|cambio|producao|plantio|colheita|aversao a perda|vies de status quo|adocao\w*|frac|hrac|irac|mecanismo de acao)\b/
const implicitIndividualAttribute=/\b(?:cultiva\w*|patrimonio|total cultivad\w*|area (?:cultivad\w*|propria)|hectares?|\d+\s*ha\b|divida (?:financeira|pendente|oculta|total|de r\$)|cpf (?:financeiro|pendente|bloqueado)|credito (?:dele|dela|bloquead\w*)|contrato (?:dele|dela|travado)|fazenda|propriedade)\b/
const strategyInstruction=/^(?:nao\s+)?(?:abra|acompanhe|acompanhar|adapte|adaptar|apresente|apresentar|colete|coletar|confirme|confirmar|construa|construir|cruze|cruzar|defina|definir|discuta|discutir|encaminhe|encaminhar|envie|enviar|evite|evitar|fabrique|fabricar|inicie|iniciar|mantenha|manter|mostre|mostrar|pergunte|perguntar|priorize|priorizar|proponha|propor|recomende|recomendar|reduza|reduzir|registre|registrar|revise|revisar|selecione|selecionar|use|usar|valide|validar|verifique|verificar)\b/
const genericAssertion=/\b(?:ele|ela|produtor\w*|cliente|fazenda|operacao|perfil|reputacao)(?:\s+(?:dele|dela|do produtor|da produtora|do cliente))?\s+(?:e|esta|tem|possui|carrega|mantem|demonstra|desvia|cultiva|quer|pretende|vai|parece|opera)\b/
const safeNamedObjectFollower=new Set(['antes','como','com','depois','durante','em','na','nas','no','nos','para','por','sobre'])
const nonNameClauseLeads=new Set(['a','ainda','basis','biblioteca','calagem','chuva','clima','como','confianca','cotacao','ctc','custo','estoque','evite','fitoscan','frete','hedge','informe','inteligencia','manual','margem','mercado','milho','na','nao','nenhum','nenhuma','nutriscan','o','perfil','ph','por','preco','priorize','producao','roi','safra','selecione','soja','sua','temperatura','trigo','use','valide','wasde'])
const inferenceDerivationTokens=new Set(['alta','analitico','analitica','baixa','conservador','conservadora','digital','inovador','inovadora','media','misto','mista','provavel','relacional','secundario','secundaria','verificada','verificado'])
const safeStrategyToken=/^(?:abra|acompanhar|acompanhe|adaptar|adapte|agir|alternativ\w*|antes|abordagem|aprofundar|apresentar|apresente|atuais?|auditav\w*|autorizad\w*|coletar|colete|comparativ\w*|confirme|confirmar|construa|construir|contexto|continuar|criterio|cruze|cruzar|dados?|data|decisao|defina|definir|desconto|discuta|discutir|encaminhe|encaminhar|entrada\w*|envie|enviar|escopo|evidencia\w*|evite|evitar|fabrique|fabricar|ferramenta|fonte\w*|habilitad\w*|hipotese\w*|inicie|iniciar|inferir|informacao|informe|informar|liberar|mantenha|manter|material|modelo|mostre|mostrar|necessari\w*|objetiv\w*|pergunte|perguntar|preencher|prescrever|priorize|priorizar|processo|produtor|proponha|propor|recomende|recomendar|reduza|reduzir|registre|registrar|responsavel|resposta|resultado|reutilizar|revise|revisar|selecione|selecionar|somente|transformar|unidade\w*|use|usar|valide|validar|verifique|verificar|vinculo|revisao)$/
const deterministicSafetyPolicy=/^(?:a val reteve qualquer orientacao tecnica acionavel ate revisao do responsavel habilitado|evite liberar orientacao tecnica acionavel antes da revisao habilitada|encaminhe (?:o contexto e as fontes|a solicitacao) ao responsavel habilitado(?: para revisao)?|uma revisao tecnica registrada e vinculada as fontes mudaria este bloqueio|nenhuma orientacao tecnica acionavel foi autorizada automaticamente)\.?$/
const strategyActionKinds=Object.freeze([
 ['SEND',/\b(?:envie|enviar|envio|encaminhe|encaminhar)\b/],['SIGN',/\b(?:assine|assinar|assinatura)\b/],
 ['BUY',/\b(?:compre|comprar|compra)\b/],['SELL',/\b(?:venda|vender)\b/],['PAY',/\b(?:pague|pagar|pagamento)\b/],
 ['RELEASE',/\b(?:libere|liberar|desbloqueie|desbloquear)\b/],['APPLY',/\b(?:aplique|aplicar|aplicacao)\b/],
 ['REGISTER',/\b(?:registre|registrar|registro)\b/],['COMMIT',/\b(?:confirme|confirmar|feche|fechar|compromisso)\b/]
])
const urgencyKinds=Object.freeze([
 ['TODAY',/\bhoje\b/],['TOMORROW',/\bamanha\b/],['NOW',/\b(?:agora|imediat\w*|urgente)\b/]
])
const negation=/^(?:nao|nunca|jamais|nenhum|nenhuma|sem)$/
const temporalDetailKinds=Object.freeze([
 ['TODAY',/\bhoje\b/],['YESTERDAY',/\bontem\b/],['DAY_BEFORE_YESTERDAY',/\banteontem\b/],
 ['TOMORROW',/\bamanha\b/],['NOW',/\bagora\b/],['THIS_WEEK',/\b(?:esta|nesta) semana\b/],
 ['LAST_WEEK',/\bsemana passada\b/],['NEXT_WEEK',/\bproxima semana\b/]
])
const properLocation=/\b(?:[Ee]m|[Nn](?:o|a|os|as)|[Cc]idade de|[Mm]unic[ií]pio de)\s+(\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:d[aeo]s?|e)\s+)?\p{Lu}[\p{L}'’-]*){0,3})/gu
const nonLocationLeads=new Set(['analise','andamento','contexto','contrapartida','dados','evidencia','geral','parte','perfil','pratica','resumo','seguida','tese','visita'])
const pureGapVocabulary=new Set([
 'afirmacao','afirmacoes','afirmar','anterior','area','atual','auditavel','auditaveis','autorizada','autorizado','baixa','carteira','cadastrada','cadastrado','cadastradas','cadastrados',
 'alternativas','atuais','campo','classificar','compra','compromisso','comportamentais','concluida','concluido','concretas','confirmada','confirmado','confirmar','considera','contexto','conversa','credito','cultura','dado','dados','decisor','determinar','duas','ultima',
 'disponivel','disponiveis','entrada','entradas','encontrada','encontrado','escopo','especifica','especificas','estruturado','estruturados','evidencia','evidencias','execucao',
 'fato','fatos','fonte','fontes','insuficiente','insuficientes','localizada','localizado','material','materiais','nenhuma','nenhum','numerico','numericos','objecao','perfil',
 'ligada','ligadas','possui','principal','produtor','produtora','propriedade','referencia','registro','registros','registrada','registrado','responder','resposta','safra','seguranca','selecionada','selecionado',
 'sessao','suficiente','suficientes','sustentar','total','verificavel','verificaveis','vinculada','vinculado','visita','comportamental','confianca','determinada','validar'
])
const pureGapFunctionWords=new Set(['a','ao','aos','as','com','da','das','de','do','dos','e','em','esta','este','foi','ha','na','nao','nas','nem','nesta','neste','no','nos','o','os','ou','para','por','que','sem','uma','um','ainda','preciso','faltam','falta','como'])

const parseDate=value=>{const parsed=new Date(value??'');return Number.isNaN(parsed.getTime())?null:parsed}
const actionKinds=value=>strategyActionKinds.filter(([,pattern])=>pattern.test(normalize(value))).map(([kind])=>kind)
const urgency=value=>urgencyKinds.filter(([,pattern])=>pattern.test(normalize(value))).map(([kind])=>kind)
const temporalDetails=value=>temporalDetailKinds.filter(([,pattern])=>pattern.test(normalize(value))).map(([kind])=>kind)
const locationDetails=value=>[...String(value??'').matchAll(properLocation)].map(match=>normalize(match[1])).filter(item=>item&&!nonLocationLeads.has(item.split(' ')[0]))
const hasPiggybackAssertion=value=>{
 const source=normalize(value)
 const marker=insufficiencyTailMarker.exec(source)
 if(!marker)return false
 const tail=source.slice(marker.index+marker[0].length)
 return producerAssertionSubject.test(tail)||strictBehavioralSupport(tail)||specificStrategy.test(tail)||numbers(tail).length>0
}

function isPureInsufficiencyClaim(value='',question='',domain='GENERAL'){
 const source=normalize(value).replace(/^por que:\s*/, '')
 if(!source||!insufficient.test(source)&&!/^confianca:\s*(?:baixa|insuficiente|nao determinada)\b/.test(source))return false
 const raw=String(value??'').trim()
 const structuralConfidence=/^confian[cç]a:\s*(?:baixa|insuficiente|n[aã]o determinada)\.?$/i.test(raw)
 if(!structuralConfidence&&/[,;:|/…·—–()[\]]/.test(raw))return false
 if((raw.match(/\./g)||[]).length>(raw.endsWith('.')?1:0)||/-/.test(raw))return false
 // Pure gaps use a deliberately small vocabulary. This is the fail-closed
 // boundary that prevents comma, dash, parenthesis or nominal-phrase tails
 // such as "perfil analítico" or "dívida oculta" from riding on a NO_DATA
 // sentence. Proper names are accepted only as names, never as descriptors.
 // A no-data sentence has no selected evidence with which to bind a free-form
 // proper name. Entity names therefore never belong to the SAFE_NO_DATA
 // grammar; producer-specific paths use a canonical omission instead.
 const properNames=new Set()
 const lexical=source.split(/[^a-z0-9]+/).filter(Boolean)
 if(lexical.some(token=>!pureGapFunctionWords.has(token)&&!pureGapVocabulary.has(token)&&!properNames.has(token)))return false
 const positiveEntityStatus=/\b(?:perfil|visita|compromisso|credito|compra|cultura|safra|fato|produtor|cliente)\s+(?:atual|principal|confirmad\w*|concluid\w*|cadastrad\w*|registrad\w*|selecionad\w*|verificad\w*)\b/
 const namedPositiveStatus=/\b\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,4}\s+(?:confirmad\w*|concluid\w*|cadastrad\w*|registrad\w*|selecionad\w*|verificad\w*)\b/u
 const canonicalEntityAbsence=/^(?:ainda\s+)?nao ha\s+(?:uma?\s+)?(?:visita|compromisso|credito|compra|cultura|safra|fato)\b[^.!?]{0,180}\b(?:localizad\w*|encontrad\w*|registrad\w*|cadastrad\w*)\b|^(?:ainda\s+)?nao ha objecao confirmada na ultima visita concluida registrada(?: com referencia auditavel)?\b|^nenhum(?:a)?\s+(?:produtor|produtora|cliente|visita|compromisso|registro|fato)\b[^.!?]{0,180}\b(?:selecionad\w*|localizad\w*|encontrad\w*|registrad\w*|cadastrad\w*|confirmad\w*)\b/
 if((positiveEntityStatus.test(source)||namedPositiveStatus.test(String(value??'')))&&!canonicalEntityAbsence.test(source))return false
 if(/\b(?:mas|porem|contudo|entretanto|todavia|no entanto|ainda assim)\b/.test(source))return false
 if(/\be\s+(?:(?:a|o|ele|ela|sua|seu|esta|esse|essa|aquele|aquela)\s+\w+|\w+\s+(?:esta|e|tem|possui|quer|pretende|vai|parece))\b/.test(source))return false
 if(/\be\s+(?:perfil|visita|compromisso|credito|compra|cultura|safra|fato|produtor|cliente)\s+(?:confirmad\w*|concluid\w*|cadastrad\w*|registrad\w*|verificad\w*)\b/.test(source))return false
 const allowedStart=/^(?:nao (?:ha|possui|tenho|consigo)\b|nenhum(?:a)?\b|sem (?:dado|dados|evidencia|evidencias|fonte|fontes)\b|(?:a )?evidencia\b|ainda nao\b|preciso confirmar\b|nao determinado\b|faltam?\b|confianca:\s*(?:baixa|insuficiente|nao determinada)\b|o perfil comportamental de\b)/
 if(!allowedStart.test(source))return false
 const canonicalSubjectAbsence=/^nenhum(?:a)?\s+(?:produtor|produtora|cliente)\b[^.!?]{0,160}\b(?:selecionad|localizad|encontrad|registrad|cadastrad|confirmad)[oa]s?\b/.test(source)
 if(unsupportedInsufficiencySubject.test(source)&&!/^o perfil comportamental de\b/.test(source)&&!canonicalSubjectAbsence)return false
 // The lexical allow-list above already constrains domain nouns, actions and
 // descriptors. Do not reject the domain noun that the absence itself answers
 // (for example "nenhuma visita registrada").
 const body=source.replace(/[.!?]+$/,'')
 const closedPatterns=[
  /^confianca:\s*(?:baixa|insuficiente|nao determinada)$/,
  /^evidencia insuficiente$/,
  /^nao determinado$/,
  /^sem (?:dado|dados|evidencia|evidencias|fonte|fontes)$/,
  /^nao ha evidencia comportamental atual e auditavel suficiente para determinar o perfil(?: comportamental)?$/,
  /^nao ha evidencia selecionada suficiente para afirmar uma resposta especifica com seguranca$/,
  /^nao ha evidencia verificavel suficiente nesta execucao para responder com seguranca$/,
  /^nao ha dados? suficientes? para determinar o perfil comportamental$/,
  /^nao ha fatos numericos estruturados na resposta anterior ou nesta sessao$/,
  /^nenhum(?:a)? (?:produtor|produtora|cliente) esta selecionad[oa] nesta conversa$/,
  /^nenhum(?:a)? (?:dado|evidencia|fonte|registro|fato|visita)\w*(?: \w+){0,3} (?:foi |foram )?(?:localizad|encontrad|registrad|cadastrad)[oa]s?$/,
  /^ainda nao ha visita concluida registrada(?: com referencia auditavel)?$/,
  /^ainda nao ha objecao confirmada(?: na ultima visita concluida)? registrada(?: com referencia auditavel)?$/,
  /^ainda nao ha compromisso registrado(?: com referencia auditavel)?$/,
  /^ainda nao ha compra concluida registrada(?: com referencia auditavel)?$/,
  /^ainda nao ha cultura ou safra registrada$/,
  /^ainda nao ha area total cadastrada$/
 ]
 return closedPatterns.some(pattern=>pattern.test(body))&&!numbers(source).length
}

function materialTokenDomains(token=''){
 if(/^fertiliz/.test(token)||token==='produto')return new Set(['AGRONOMY','COMMERCIAL'])
 if(['credito','cpf','pagamento'].includes(token))return new Set(['CREDIT','COMMERCIAL'])
 if(['grao','graos'].includes(token))return new Set(['GRAINS'])
 if(token==='contrato')return new Set(['GRAINS','COMMERCIAL'])
 if(['visita','compromisso'].includes(token))return new Set(['VISIT','COMMERCIAL'])
 if(['preco','proposta','compra','venda'].includes(token))return new Set(['COMMERCIAL'])
 return new Set()
}

function insufficiencyMaterialMatchesQuestionDomain(source='',question='',domain='GENERAL'){
 const material=tokens(source).filter(token=>materialStrategyToken.test(token))
 if(!material.length)return true
 const questionTokens=new Set(tokens(question))
 const requested=domain==='MULTI_DOMAIN'
  ?new Set(matchedValContextDomains(question))
  :domain==='GENERAL'
   ?new Set(matchedValContextDomains(question))
   :new Set([domain])
 return material.every(token=>{
  if(questionTokens.has(token))return true
  const domains=materialTokenDomains(token)
  return domains.size>0&&[...domains].some(candidate=>requested.has(candidate))
 })
}

function negationState(value,token){
 const words=normalize(value).split(/[^a-z0-9]+/).filter(Boolean)
 const states=[]
 for(let index=0;index<words.length;index+=1){
  if(words[index]!==token)continue
  states.push(words.slice(Math.max(0,index-3),index).some(word=>negation.test(word))?'NEGATED':'POSITIVE')
 }
 return new Set(states)
}

// Some negative statements put the negation outside the proposition itself:
// "não há confirmação de que P" withholds support for both P and not-P,
// while "é falso afirmar que P" entails not-P.  A short token window around
// P cannot see those operators, so classify their assertion scope explicitly.
const unconfirmedAssertionPatterns=Object.freeze([
 /\b(?:nao|nunca|jamais)\s+(?:ha|existe|houve)\b[^.!?]{0,80}\b(?:confirmacao|comprovacao|verificacao|evidencia|prova)\b[^.!?]{0,40}\b(?:de\s+)?que\s+(.+)$/,
 /\b(?:nao|nunca|jamais)\s+(?:foi|esta|ficou|e)\s+(?:confirmad\w*|comprovad\w*|verificad\w*|validad\w*)\s+(?:de\s+)?que\s+(.+)$/,
 /\b(?:a\s+)?(?:afirmacao|alegacao|hipotese|informacao)\s+(?:de\s+)?que\s+(.+?)\s+(?:nao|nunca|jamais)\s+(?:foi|esta|ficou|e)\s+(?:confirmad\w*|comprovad\w*|verificad\w*|validad\w*)$/
])
const falseAssertionPatterns=Object.freeze([
 /\b(?:e|foi|seria)\s+(?:fals\w*|incorret\w*|errad\w*)\s+(?:(?:afirmar|dizer|alegar)\s+)?(?:de\s+)?que\s+(.+)$/,
 /\bnao\s+(?:e|foi)\s+(?:verdade|verdadeiro|correto)\s+(?:afirmar\s+)?(?:de\s+)?que\s+(.+)$/,
 /\bnao\s+procede(?:\s+a\s+afirmacao)?\s+(?:de\s+)?que\s+(.+)$/,
 /\b(?:a\s+)?(?:afirmacao|alegacao|informacao)\s+(?:de\s+)?que\s+(.+?)\s+(?:e|foi)\s+(?:fals\w*|incorret\w*|errad\w*)$/
])

function scopedAssertion(value=''){
 const source=normalize(value).replace(/[.!?]+$/,'').trim()
 for(const pattern of unconfirmedAssertionPatterns){
  const match=pattern.exec(source)
  if(match)return {operator:'UNCONFIRMED',proposition:match[1]}
 }
 for(const pattern of falseAssertionPatterns){
  const match=pattern.exec(source)
  if(match)return {operator:'FALSE',proposition:match[1]}
 }
 return null
}

const directAssertionPolarity=value=>/\b(?:nao|nunca|jamais|sem)\b/.test(normalize(value))?'NEGATED':'POSITIVE'

function semanticAssertionPolarity(value=''){
 const scoped=scopedAssertion(value)
 if(!scoped)return {scoped:false,state:directAssertionPolarity(value)}
 if(scoped.operator==='UNCONFIRMED')return {scoped:true,state:'UNCONFIRMED'}
 // FALSE reverses the embedded proposition, including a double negation.
 return {scoped:true,state:directAssertionPolarity(scoped.proposition)==='NEGATED'?'POSITIVE':'NEGATED'}
}

function polarityContradiction(claim,evidence){
 const claimAssertion=semanticAssertionPolarity(claim)
 const evidenceAssertion=semanticAssertionPolarity(evidence)
 if(claimAssertion.scoped||evidenceAssertion.scoped)return claimAssertion.state!==evidenceAssertion.state
 const shared=tokens(claim).filter(token=>tokens(evidence).includes(token))
 return shared.some(token=>{
  const claimState=negationState(claim,token);const evidenceState=negationState(evidence,token)
  return claimState.size===1&&evidenceState.size===1&&claimState.has('NEGATED')!==evidenceState.has('NEGATED')
 })
}

const evidenceCompatibility=Object.freeze({
 FACT:new Set(['FACT','VALIDATED_KNOWLEDGE']),
 OBSERVATION:new Set(['OBSERVATION','FACT','VALIDATED_KNOWLEDGE']),
 INFERENCE:new Set(['INFERENCE','OBSERVATION','FACT','VALIDATED_KNOWLEDGE']),
 INTENTION:new Set(['INTENTION','QUOTE']),
 QUOTE:new Set(['QUOTE']),
 STRATEGY:new Set(['STRATEGY','INTENTION','QUOTE','OBSERVATION','FACT','VALIDATED_KNOWLEDGE']),
 HYPOTHESIS:new Set(['HYPOTHESIS','INFERENCE','OBSERVATION','FACT','VALIDATED_KNOWLEDGE'])
})

function contextFacet(domain,question=''){
 const source=normalize(question)
 if(domain==='GENERAL'){
  if(/\b(?:produtor|cliente) atual\b|\bquem e (?:o )?(?:produtor|cliente)\b/.test(source))return 'CURRENT_PRODUCER'
  if(/\b(?:decisor|quem decide|quem toma a decisao)\b/.test(source))return 'DECISION_MAKER'
  if(/\barea\b|\bhectares?\b/.test(source))return 'AREA'
 }
 if(domain==='VISIT'){
  if(/\b(?:ultima|mais recente|anterior|concluida|realizada|ocorreu|historico)\b/.test(source))return 'LAST_VISIT'
  if(/\b(?:proxima|agendada|planejada|futura|prepare|preparar)\b/.test(source))return 'NEXT_VISIT'
 }
 if(domain==='COMMERCIAL'){
  if(/\b(?:objecao|rejeitou|resistencia|barreira|impedimento|alegou|questionou)\b/.test(source))return 'OBJECTION'
  if(/\b(?:preco|valor|custo|margem)\b|r\$/.test(source))return 'PRICE'
  if(/\b(?:ultima compra|comprou|compra mais recente|adquiriu)\b/.test(source))return 'PURCHASE'
 }
 return ''
}

function answerClaimsMatchFacet(facet,answer=''){
 if(!facet)return true
 const materialClaims=splitClaims(answer).filter(claim=>{
  const source=normalize(claim)
  return !isPureInsufficiencyClaim(claim,'','GENERAL')&&!declaredGap.test(source)&&!uncertainty.test(source)&&!strategyInstruction.test(source)
 })
 if(facet==='CURRENT_PRODUCER')return materialClaims.length>0&&materialClaims.every(claim=>/\b(?:produtor|cliente) atual\b/.test(normalize(claim)))
 if(facet==='DECISION_MAKER')return materialClaims.length>0&&materialClaims.every(claim=>/\b(?:decisor|quem decide)\b/.test(normalize(claim)))
 if(facet==='AREA')return materialClaims.length>0&&materialClaims.every(claim=>/\barea\b|\bhectares?\b|\bha\b/.test(normalize(claim)))
 return true
}

function evidenceMatchesFacet(facet,text='',sourceType=''){
 if(!facet)return true
 const source=normalize(text)
 if(facet==='LAST_VISIT')return sourceType!=='scheduled_visit'&&!/\b(?:proxim\w*|agend\w*|planej\w*|futur\w*)\b/.test(source)&&/\b(?:ultima|mais recente|conclu\w*|realiz\w*|ocorreu|visit\w*)\b/.test(source)
 if(facet==='NEXT_VISIT')return sourceType==='scheduled_visit'||/\b(?:proxim\w*|agend\w*|planej\w*|futur\w*|prepar\w*)\b/.test(source)
 if(facet==='OBJECTION')return /\b(?:objec\w*|rejeit\w*|resist\w*|barreira|imped\w*|aleg\w*|question\w*|caro)\b/.test(source)
 if(facet==='PRICE')return /\b(?:preco|valor|custo|margem)\b|r\$/.test(source)
 if(facet==='PURCHASE')return /\b(?:compr\w*|adquir\w*)\b/.test(source)
 return true
}

function semanticallyGeneralGlobalEvidence({sourceType='',text='',rawText=''}={}){
 // GLOBAL describes the subject of the evidence; it cannot be used as an
 // escape hatch for an omitted producer id.  Market facts need an aggregate
 // anchor, while catalog/knowledge facts need an explicit concept anchor.
 if(genericAssertion.test(text)||hasNamedIndividualAssertion(rawText))return false
 if(sourceType==='market_snapshot'){
  if(!globalAggregateAnchor.test(text))return false
  // An aggregate prefix such as "Mercado:" must never launder an individual
  // attribute. Aggregate area/portfolio metrics require a dedicated typed
  // source in a future contract; this v1 gate intentionally fails closed.
  return !implicitIndividualAttribute.test(text)
 }
 const conceptText=text.replace(/\bcusto por hectare\b/g,'custo unitario')
 if(sourceType==='official_product_catalog')return globalConceptAnchor.test(text)&&!implicitIndividualAttribute.test(conceptText)
 if(['general_knowledge','system_capability'].includes(sourceType))return globalConceptAnchor.test(text)&&!implicitIndividualAttribute.test(conceptText)
 if(sourceType==='system_safety_policy')return deterministicSafetyPolicy.test(text)
 return false
}

function evidenceEntries(evidence=[],scope={}){
 return list(evidence).map((item,index)=>{
  const object=item&&typeof item==='object'?item:{statement:item}
  const sourceId=identifierOf(object)
  const sourceType=sourceTypeOf(object)
  const rawType=clean(object.type,40).toUpperCase()
  const evidenceType=clean(object.evidence_type??object.evidenceType??object.epistemic_type??object.epistemicType??(allEvidenceTypes.has(rawType)?rawType:''),40).toUpperCase()
  const contract=sourceContracts.get(sourceType)||null
  const scopeMarker=globalScopeOf(object)
  const global=explicitlyGlobal(object)
  const rawText=evidenceRawTextOf(object)
  const entry={
   id:sourceId,auditId:sourceId||`unresolved:${index+1}`,sourceType,
   text:normalize(rawText),rawText,
   producerId:producerOf(object),tenantId:tenantOf(object),ownerId:ownerOf(object),
   evidenceType,global,scopeMarker
  }
  const aliasConflictCodes=[]
  const recursiveAliases=(node,extractor,seen=new Set())=>{
   if(!node||typeof node!=='object'||node instanceof Date||seen.has(node))return []
   seen.add(node)
   if(Array.isArray(node))return node.flatMap(entry=>recursiveAliases(entry,extractor,seen))
   return [...extractor(node),...Object.values(node).flatMap(entry=>recursiveAliases(entry,extractor,seen))]
  }
  const combinedAliases=extractor=>[...new Set(recursiveAliases(object,extractor))]
  if(aliasValues(object,['id','memory_ref','memoryRef','source_id','sourceId']).length>1)aliasConflictCodes.push('SOURCE_ID_ALIAS_CONFLICT')
  if(combinedAliases(producerAliases).length>1)aliasConflictCodes.push('PRODUCER_ALIAS_CONFLICT')
  if(combinedAliases(tenantAliases).length>1)aliasConflictCodes.push('TENANT_ALIAS_CONFLICT')
  if(combinedAliases(ownerAliases).length>1)aliasConflictCodes.push('OWNER_ALIAS_CONFLICT')
  if(aliasValues(object,['source_type','sourceType']).map(value=>value.toLowerCase()).filter((value,index,items)=>items.indexOf(value)===index).length>1)aliasConflictCodes.push('SOURCE_TYPE_ALIAS_CONFLICT')
  const epistemicAliases=aliasValues(object,['evidence_type','evidenceType','epistemic_type','epistemicType']).map(value=>value.toUpperCase())
  if(rawType&&allEvidenceTypes.has(rawType))epistemicAliases.push(rawType)
  if(new Set(epistemicAliases).size>1)aliasConflictCodes.push('EPISTEMIC_TYPE_ALIAS_CONFLICT')
  const observedAliases=aliasValues(object,['observed_at','observedAt']).map(value=>parseDate(value)?.toISOString()||`invalid:${value}`)
  const validUntilAliases=aliasValues(object,['valid_until','validUntil']).map(value=>parseDate(value)?.toISOString()||`invalid:${value}`)
  if(new Set(observedAliases).size>1)aliasConflictCodes.push('OBSERVED_AT_ALIAS_CONFLICT')
  if(new Set(validUntilAliases).size>1)aliasConflictCodes.push('VALID_UNTIL_ALIAS_CONFLICT')
  const domains=matchedValContextDomains(entry.text)
  const requested=scope.domain==='MULTI_DOMAIN'?matchedValContextDomains(scope.question):[scope.domain]
  let domainCompatible=true
  if(scope.domain==='PROFILE'){
   const hardForeign=domains.some(domain=>profileHardForeignDomains.has(domain))
   const softForeign=domains.some(domain=>['COMMERCIAL','OPPORTUNITY','VISIT'].includes(domain))
   domainCompatible=!hardForeign&&(!softForeign||strictBehavioralSupport(entry.text)&&!profileSpecificState.test(entry.text))
  }
  else if(!['GENERAL','MULTI_DOMAIN'].includes(scope.domain)&&domains.length)domainCompatible=domains.includes(scope.domain)||scope.domain==='COMMERCIAL'&&domains.includes('OPPORTUNITY')
  else if(scope.domain==='MULTI_DOMAIN'&&domains.length)domainCompatible=domains.some(domain=>requested.includes(domain))
  const questionFacet=contextFacet(scope.domain,scope.question)
  const intentCompatible=evidenceMatchesFacet(questionFacet,entry.text,sourceType)
  domainCompatible=domainCompatible&&intentCompatible
  const globalProducerSpecific=global&&/\b(?:ele|ela|este produtor|esse produtor|aquele produtor|o produtor|a produtora|do produtor|da produtora|para o produtor|para a produtora|este cliente|esse cliente|o cliente|do cliente|da cliente)\b/.test(entry.text)
  if(globalProducerSpecific)aliasConflictCodes.push('GLOBAL_PRODUCER_SPECIFIC_CLAIM')
  if(global&&(genericAssertion.test(entry.text)||hasNamedIndividualAssertion(rawText)))aliasConflictCodes.push('GLOBAL_INDIVIDUAL_ASSERTION')
  if(global&&!semanticallyGeneralGlobalEvidence(entry))aliasConflictCodes.push('GLOBAL_NOT_SEMANTICALLY_GENERAL')
  if(global&&entry.producerId)aliasConflictCodes.push('GLOBAL_WITH_PRODUCER_ID')
  if(global&&!trustedGlobalSourceTypes.has(sourceType))aliasConflictCodes.push('UNTRUSTED_GLOBAL_SOURCE_TYPE')
  if(sourceType==='market_snapshot'&&scopeMarker!=='MARKET')aliasConflictCodes.push(scopeMarker?'MARKET_SCOPE_MISMATCH':'MISSING_MARKET_SCOPE')
  const producerCompatible=!scope.activeProducerId||(global?!entry.producerId:entry.producerId===scope.activeProducerId)
  const tenantCompatible=sourceType==='market_snapshot'?Boolean(scope.tenantId)&&entry.tenantId===scope.tenantId:!scope.tenantId||entry.tenantId===scope.tenantId
  const ownerCompatible=sourceType==='market_snapshot'?Boolean(scope.ownerId)&&entry.ownerId===scope.ownerId:!scope.ownerId||entry.ownerId===scope.ownerId
  const scopeCompatible=producerCompatible&&tenantCompatible&&ownerCompatible&&aliasConflictCodes.length===0
  const observedRaw=object?.observed_at??object?.observedAt
  const validUntilRaw=object?.valid_until??object?.validUntil
  const observedAt=parseDate(observedRaw)
  const validUntil=parseDate(validUntilRaw)
  const lifecycle=normalize(object?.lifecycle_status??object?.lifecycleStatus??object?.status)
  const scheduled=sourceType==='scheduled_visit'
  const scheduledFuture=scheduled&&['planned','prepared'].includes(lifecycle)
  const provenanceCodes=[...aliasConflictCodes]
  if(!sourceId)provenanceCodes.push('MISSING_SOURCE_ID')
  if(!sourceType)provenanceCodes.push('MISSING_SOURCE_TYPE')
  if(!evidenceType)provenanceCodes.push('MISSING_EPISTEMIC_TYPE')
  if(!rawText)provenanceCodes.push('MISSING_SEMANTIC_STATEMENT')
  if(sourceType&&!contract)provenanceCodes.push('UNSUPPORTED_SOURCE_TYPE')
  if(contract&&evidenceType&&!contract.evidenceTypes.has(evidenceType))provenanceCodes.push('SOURCE_EPISTEMIC_MISMATCH')
  if(scope.activeProducerId&&!global&&!entry.producerId)provenanceCodes.push('MISSING_PRODUCER_ID')
  if((scope.tenantId||sourceType==='market_snapshot')&&!entry.tenantId)provenanceCodes.push('MISSING_TENANT_ID')
  if((scope.ownerId||sourceType==='market_snapshot')&&!entry.ownerId)provenanceCodes.push('MISSING_OWNER_ID')
  if(sourceType==='market_snapshot'&&!scope.tenantId)provenanceCodes.push('MISSING_ACTIVE_TENANT_ID')
  if(sourceType==='market_snapshot'&&!scope.ownerId)provenanceCodes.push('MISSING_ACTIVE_OWNER_ID')
  if(contract&&!contract.staticSource&&observedRaw==null)provenanceCodes.push('MISSING_OBSERVED_AT')
  if(observedRaw!=null&&!observedAt)provenanceCodes.push('INVALID_OBSERVED_AT')
  if(validUntilRaw!=null&&!validUntil)provenanceCodes.push('INVALID_VALID_UNTIL')
  if(contract?.requiresValidUntil&&validUntilRaw==null)provenanceCodes.push('MISSING_VALID_UNTIL')
  const provenanceCompatible=provenanceCodes.length===0
  const maximumAgeMs=contract?.maxAgeMs??(['QUOTE','INTENTION'].includes(evidenceType)?180*DAY_MS:null)
  let temporalCompatible=true
  if(validUntil&&validUntil<=scope.now)temporalCompatible=false
  if(observedAt&&observedAt>scope.now&&!scheduledFuture)temporalCompatible=false
  if(scheduled&&observedAt&&observedAt<scope.now&&scheduledFuture)temporalCompatible=false
  if(maximumAgeMs&&observedAt&&scope.now-observedAt>maximumAgeMs&&!(contract?.validUntilMayExtend!==false&&validUntil&&validUntil>scope.now))temporalCompatible=false
  return {...entry,tokenSet:new Set(tokens(entry.text)),domains,domainCompatible,scopeCompatible,provenanceCompatible,provenanceCodes,temporalCompatible,observedAt:observedAt?.toISOString()||null,validUntil:validUntil?.toISOString()||null}
 })
}

function splitClaims(answer=''){
 const normalized=clean(answer,20_000)
 if(!normalized)return []
 return normalized.split(/(?<=[.!?])\s+|;\s*|,\s+(?=(?:mas|por[eé]m|contudo|entretanto|todavia|no entanto|ainda assim|ele|ela|sua|seu|este|esta|esse|essa|aquele|aquela)\b|(?:a|o|as|os)\s+\w+\s+(?:é|est[aá]|tem|possui|quer|pretende|vai|parece|mant[eé]m|demonstra)\b)|\s+(?=(?:Perfil principal|Confiança|Por quê|Como abordar|O que ainda não sabemos):)/i).map(value=>clean(value)).filter(Boolean)
}

function hasNamedIndividualAssertion(value=''){
 const source=String(value??'')
 const pattern=/(?:^|[.!?;,:—–]\s*|\be\s+)(\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,4})\s+([\p{Ll}\p{M}]+)/gu
 const individualPredicate=/^(?:e|esta|tem|possui|cultiva|quer|pretende|vai|parece|opera|mantem|demonstra|prefere|valoriza|pediu|solicitou|decide|afirmou|disse|relatou|comprou|vendeu)$/
 for(const match of source.matchAll(pattern)){
  const lead=normalize(match[1]).split(' ')[0]
  const follower=normalize(match[2])
  if(!nonNameClauseLeads.has(lead)&&!strategyInstruction.test(lead)&&!safeNamedObjectFollower.has(follower)&&individualPredicate.test(follower))return true
 }
 return false
}

const hasAssertiveClause=value=>genericAssertion.test(normalize(value))||hasNamedIndividualAssertion(value)

function claimType(value='',field='answer'){
 const source=normalize(value)
 if(/^session_turn\./i.test(field))return 'INFERENCE'
 if(/[?]\s*$/.test(clean(value))||/(?:^|\.)question$/i.test(field))return 'QUESTION'
 if(/["“”]/.test(value)||/\b(?:disse|afirmou|comentou|relatou|segundo)\b/.test(source))return 'QUOTE'
 if(/\b(?:pretende|quer|planeja|intencao)\b/.test(source))return 'INTENTION'
 if(/evidence_to_use/i.test(field)||/^por que:/.test(source)||/\b(?:observou|pediu|solicitou|comparou)\b/.test(source))return 'OBSERVATION'
 if(/^como abordar:/.test(source)||/(?:\.action$|next_commitment|what_to_validate|what_would_change|validation_move|recommended_strategy\.do_not_do|objective$)/i.test(field)||strategyInstruction.test(source.replace(/^(?:como abordar|acao|estrategia):\s*/,'')))return 'STRATEGY'
 if(hasAssertiveClause(value))return 'FACT'
 if(/hypotheses|missing_information|\.unknown$|risks?(?:\.|\[|$)/i.test(field)||/^o que ainda nao sabemos:/.test(source)||uncertainty.test(source))return 'HYPOTHESIS'
 if(/key_signals|confidence\.rationale|decision_interview\.explanation|golden_questions\.\d+\.decision_impact/i.test(field)||/^confianca:/.test(source)||/\b(?:parece|provavelmente|perfil principal)\b/.test(source))return 'INFERENCE'
 return 'FACT'
}

function claimSupport(claim,entries,question='',domain='GENERAL',field='answer',activeProducerId=''){
 const source=normalize(claim)
 const strategyBody=source.replace(/^(?:como abordar|acao|estrategia):\s*/,'')
 const kind=claimType(claim,field)
 // In an active-producer turn, GLOBAL evidence is admissible only when the
 // question explicitly asks for non-individual market/general knowledge. This
 // prevents a GLOBAL record containing a person's name from asserting that
 // person's area, profile, debt, visit or commitment.
 const normalizedQuestion=normalize(question)
 const questionAllowsGlobal=!activeProducerId||(explicitGlobalTopic.test(normalizedQuestion)||definitionalQuestion.test(normalizedQuestion)&&!individualQuestion.test(normalizedQuestion))
 const compatible=entries.filter(item=>item.scopeCompatible&&item.domainCompatible&&item.provenanceCompatible&&item.temporalCompatible&&item.text&&(!item.global||!activeProducerId||questionAllowsGlobal&&['market_snapshot','official_product_catalog','general_knowledge','system_safety_policy'].includes(item.sourceType)))
 const claimTokens=tokens(claim)
 const claimNumbers=numbers(claim)
 const questionText=normalize(question)
 const foreignClaimDomains=matchedValContextDomains(source).filter(item=>domain==='PROFILE'&&profileForeignDomains.has(item))
 const hardForeignClaim=foreignClaimDomains.some(item=>profileHardForeignDomains.has(item))
 if(hardForeignClaim||foreignClaimDomains.length&&(!strictBehavioralSupport(source)||profileSpecificState.test(source)))return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_CROSS_DOMAIN_CLAIM'}
 const declaresInsufficiency=isPureInsufficiencyClaim(claim,question,domain)
 if(declaresInsufficiency){
  return {supported:true,evidenceRefs:[],reason:'EXPLICIT_INSUFFICIENT_EVIDENCE'}
 }
 if(kind==='QUESTION')return {supported:true,evidenceRefs:[],reason:'NON_FACTUAL_QUESTION'}
 if(insufficient.test(source)&&!declaresInsufficiency)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_MATERIAL_INSUFFICIENCY'}
 if(deterministicSafetyPolicy.test(source))return {supported:true,evidenceRefs:[],reason:'DETERMINISTIC_SAFETY_POLICY'}
 const designatedGap=/missing_information|\.unknown$|key_uncertainty/i.test(field)
 const internalGapCode=/^decision_interview\.material_missing_information\.\d+$/i.test(field)&&/^[a-z][a-z0-9_:-]*$/i.test(clean(claim))
 const positiveGapStatus=/\b(?:analitic\w*|relacional|inovador\w*|conservador\w*|digital|desonest\w*|confirmad\w*|verificad\w*|concluid\w*|bloquead\w*|travad\w*|vendid\w*|negativ\w*|ocult\w*|disponivel)\b/
 if((declaredGap.test(source)||designatedGap)&&foreignClaimDomains.length===0&&!hasAssertiveClause(claim)&&!positiveGapStatus.test(source)&&!specificStrategy.test(source)&&(!claimNumbers.length||internalGapCode))return {supported:true,evidenceRefs:[],reason:'DECLARED_INFORMATION_GAP'}
 if(/\.falsifier$/i.test(field)&&foreignClaimDomains.length===0&&!hasAssertiveClause(claim)&&/^(?:se|uma evidencia|um registro|a confirmacao|o oposto|nao se sustenta)\b/.test(source)&&!specificStrategy.test(source)&&!claimNumbers.length)return {supported:true,evidenceRefs:[],reason:'NON_FACTUAL_FALSIFIER'}
 const deterministicProcessField=/decision_interview\.(?:explanation|questions\.\d+\.why)|agronomic_context\.safety_note/i.test(field)&&processGuidanceLanguage.test(source)&&!factualStrategyTail.test(source)&&!unsupportedInsufficiencySubject.test(source)
 const goldenProcessField=/golden_questions\.\d+\.(?:reason|decision_impact)/i.test(field)&&/\b(?:ajuda|define|decisao|distingue|evita|identifica|muda|validar)\b/.test(source)
 const processField=deterministicProcessField||goldenProcessField
 const guidanceDomains=matchedValContextDomains(source)
 const requestedGuidanceDomains=domain==='MULTI_DOMAIN'?new Set(matchedValContextDomains(question)):processGuidanceDomains[domain]
 const processDomainCompatible=guidanceDomains.length===0||requestedGuidanceDomains&&guidanceDomains.every(item=>requestedGuidanceDomains.has(item))
 const derivedProcessCount=/^decision_interview\.explanation$/i.test(field)&&/^faltam?\s+\d+\s+informac/i.test(source)
 if(processField&&processDomainCompatible&&!hasAssertiveClause(claim)&&(deterministicProcessField||!specificStrategy.test(source))&&(!claimNumbers.length||derivedProcessCount))return {supported:true,evidenceRefs:[],reason:'NON_FACTUAL_PROCESS_GUIDANCE'}
 const neutralStrategy=kind==='STRATEGY'&&strategyInstruction.test(strategyBody)&&neutralProcessStrategy.test(strategyBody)&&!hasAssertiveClause(claim)&&!specificStrategy.test(source)&&!claimNumbers.length&&!factualStrategyTail.test(source)&&!unsupportedInsufficiencySubject.test(source)
 const strategySpecific=kind==='STRATEGY'&&(claimNumbers.length>0||specificStrategy.test(source)||factualStrategyTail.test(source)||producerTargetedStrategy.test(source))
 if(kind==='STRATEGY'&&!strategySpecific&&strategyInstruction.test(strategyBody)&&!hasAssertiveClause(claim)||neutralStrategy){
  const evidenceTokens=new Set(compatible.flatMap(entry=>[...entry.tokenSet]))
  const unsupportedStrategyTokens=claimTokens.filter(token=>!safeStrategyToken.test(token)&&!evidenceTokens.has(token))
  if(unsupportedStrategyTokens.length)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_UNGROUNDED_STRATEGY'}
  return {supported:true,evidenceRefs:compatible.filter(entry=>claimTokens.some(token=>entry.tokenSet.has(token))).map(entry=>entry.id).slice(0,8),reason:'NON_FACTUAL_STRATEGY'}
 }
 if(!compatible.length)return {supported:false,evidenceRefs:[],reason:'NO_COMPATIBLE_EVIDENCE'}
 const typeCompatible=compatible.filter(entry=>(evidenceCompatibility[kind]||evidenceCompatibility.FACT).has(entry.evidenceType))
 if(!typeCompatible.length)return {supported:false,evidenceRefs:[],reason:'EPISTEMIC_TYPE_MISMATCH'}
 const candidates=typeCompatible.map(entry=>{
 const exact=source.length>=12&&entry.text.includes(source)
  const scopedEntry=scopedAssertion(entry.text)
  return {entry,overlap:claimTokens.filter(token=>entry.tokenSet.has(token)),exact,contradiction:(!exact||Boolean(scopedEntry))&&polarityContradiction(source,entry.text)}
 }).filter(item=>item.exact||item.overlap.length)
 const usable=candidates.filter(item=>!item.contradiction)
 if(candidates.length&&!usable.length)return {supported:false,evidenceRefs:[],reason:'POLARITY_CONTRADICTION'}
 const claimTemporalDetails=temporalDetails(source)
 const claimLocationDetails=locationDetails(claim)
 const temporalDetailsSupported=claimTemporalDetails.every(detail=>usable.some(({entry})=>temporalDetails(entry.text).includes(detail)))
 const locationDetailsSupported=claimLocationDetails.every(detail=>usable.some(({entry})=>entry.text.includes(detail)))
 // Match each number together with the entity/attribute in its own sub-clause.
 // This prevents cross-entry or cross-fact joins (soja 100 + milho 200 cannot
 // support soja 200 + milho 100) and preserves the sign of signed values.
 const claimNumericMentions=numericMentions(claim)
 const supportNumericMentions=[
  ...usable.flatMap(({entry})=>numericMentions(entry.text)),
  ...numericMentions(question)
 ]
 const numericSupport=claimNumericMentions.every(claimMention=>supportNumericMentions.some(supportMention=>numericMentionCompatible(claimMention,supportMention)))
 if(kind==='STRATEGY'&&strategySpecific){
  const materialTokens=claimTokens.filter(token=>materialStrategyToken.test(token))
  const actions=actionKinds(source)
  const urgencyConstraints=urgency(source)
  const materialSupported=materialTokens.every(token=>usable.some(item=>item.entry.tokenSet.has(token)))
  const actionsSupported=actions.every(action=>usable.some(item=>actionKinds(item.entry.text).includes(action)))
  const urgencySupported=urgencyConstraints.every(constraint=>usable.some(item=>urgency(item.entry.text).includes(constraint))||urgency(questionText).includes(constraint))
  const covered=new Set(usable.flatMap(item=>item.overlap))
  const unsupportedStrategyTokens=claimTokens.filter(token=>!safeStrategyToken.test(token)&&!covered.has(token))
  const lexicalRequired=Math.max(2,Math.ceil(claimTokens.length*.5))
  const lexicalSupported=usable.some(item=>item.exact)||covered.size>=lexicalRequired
  if(!unsupportedStrategyTokens.length&&numericSupport&&materialSupported&&actionsSupported&&urgencySupported&&temporalDetailsSupported&&locationDetailsSupported&&lexicalSupported)return {supported:true,evidenceRefs:[...new Set(usable.map(item=>item.entry.id))].slice(0,8),reason:'SUPPORTED_MATERIAL_STRATEGY'}
  return {supported:false,evidenceRefs:[],reason:claimNumbers.length&&!numericSupport?'UNSUPPORTED_NUMERIC_CLAIM':'UNSUPPORTED_MATERIAL_STRATEGY'}
 }
 if(!temporalDetailsSupported)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_TEMPORAL_DETAIL'}
 if(!locationDetailsSupported)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_LOCATION_DETAIL'}
 if(claimNumbers.length&&!numericSupport)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_NUMERIC_CLAIM'}
 // A high lexical-overlap score must never hide a small unsupported assertion
 // appended to a long grounded sentence. For direct factual/observational/
 // quoted/intentional claims every material token must be present in one
 // compatible source. Paraphrased inference remains governed separately.
 const strictGroundingKinds=new Set(['FACT','OBSERVATION','QUOTE','INTENTION','INFERENCE','HYPOTHESIS'])
 if(strictGroundingKinds.has(kind)&&!usable.some(item=>item.exact)){
  const supportedTokens=new Set(usable.flatMap(item=>[...item.entry.tokenSet]))
  const unsupportedMaterialTokens=claimTokens.filter(token=>!supportedTokens.has(token)&&!(['INFERENCE','HYPOTHESIS'].includes(kind)&&inferenceDerivationTokens.has(token)))
  if(unsupportedMaterialTokens.length)return {supported:false,evidenceRefs:[],reason:'UNSUPPORTED_SEMANTIC_TAIL'}
 }
 const matches=usable.map(item=>({id:item.entry.id,overlap:item.overlap,exact:item.exact}))
 const covered=new Set(matches.flatMap(item=>item.overlap))
 const required=Math.max(1,Math.ceil(claimTokens.length*(['INFERENCE','HYPOTHESIS'].includes(kind)?.5:.6)))
 const structuralConfidence=/^confianca:\s*(?:alta|media|baixa|insuficiente|nao determinada|provavel|verificada)\.?$/.test(source)&&compatible.length>0
 const supported=matches.some(item=>item.exact)||numericSupport&&(covered.size>=required||/^confianca:/.test(source)||structuralConfidence)
 if(supported)return {supported:true,evidenceRefs:[...new Set(matches.map(item=>item.id))].slice(0,8),reason:'EVIDENCE_TOKEN_MATCH'}
 return {supported:false,evidenceRefs:[],reason:claimNumbers.length?'UNSUPPORTED_NUMERIC_CLAIM':'UNSUPPORTED_SPECIFIC_CLAIM'}
}

function directlyAnswersQuestion({domain,question,answer,unsupportedClaims}){
 const source=normalize(answer)
 if(!source)return false
 if(unsupportedClaims.length)return false
 const answerClaims=splitClaims(answer)
 const safetyRefusal=/\b(?:reteve qualquer orientacao tecnica acionavel|evite liberar orientacao tecnica acionavel|encaminhe (?:o contexto e as fontes|a solicitacao) ao responsavel habilitado)\b/.test(source)
 const asksTechnicalAction=/\b(?:dose|dosagem|aplicar|aplicacao|mistura|prescrever|prescricao|recomendar|recomendacao|produto|manejo)\b/.test(normalize(question))
 if(safetyRefusal&&asksTechnicalAction)return true
 const safeAbsence=answerClaims.some(claim=>isPureInsufficiencyClaim(claim,question,domain))&&answerClaims.every(claim=>{
  const normalized=normalize(claim)
  return isPureInsufficiencyClaim(claim,question,domain)||uncertainty.test(normalized)||declaredGap.test(normalized)||neutralProcessStrategy.test(normalized)
 })
 if(safeAbsence)return true
 if(domain==='PROFILE')return /\bperfil (?:principal|comportamental)\b/.test(source)&&/\bconfianca\b/.test(source)&&(/\bcomo abordar\b/.test(source)||/\bo que ainda nao sabemos\b/.test(source))&&unsupportedClaims.length===0
 const facet=contextFacet(domain,question)
 if(!answerClaimsMatchFacet(facet,answer))return false
 if(facet&&!evidenceMatchesFacet(facet,source,''))return false
 const answerDomains=matchedValContextDomains(source)
 if(domain==='MULTI_DOMAIN'){
  const requested=matchedValContextDomains(question)
  if(!(requested.length>0&&requested.every(item=>answerDomains.includes(item))))return false
 }
 const domainCompatible=domain==='MULTI_DOMAIN'||answerDomains.includes(domain)||domain==='COMMERCIAL'&&answerDomains.includes('OPPORTUNITY')
 if(!['GENERAL','MULTI_DOMAIN'].includes(domain)&&!domainCompatible)return false
 // Resumos determinísticos de calculadora devolvem o resultado, não repetem
 // todas as entradas da pergunta. Considere-os diretamente relevantes apenas
 // quando pedido e resposta compartilham o mesmo tópico material e a resposta
 // declara explicitamente que o valor foi calculado. O suporte numérico e a
 // proveniência já foram validados claim a claim antes deste ponto.
 const calculationTopics=new Set(['semente','sementes','semeadora','semeadura','populacao','colheita','zoneamento','zarc','pulverizacao','fertilizante','nutriente','nutrientes','cotacao','insumo','insumos'])
 const questionSource=normalize(question)
 const calculationRequested=/\bcalcul(?:a|ar|e|o|ou)\b/.test(questionSource)
 const calculationReturned=/\bcalculad[oa]s?\b/.test(source)&&numbers(source).length>0
 const questionCalculationTopics=new Set(tokens(question).filter(token=>calculationTopics.has(token)))
 const sharedCalculationTopic=tokens(answer).some(token=>questionCalculationTopics.has(token))
 if(calculationRequested&&calculationReturned&&sharedCalculationTopic)return true
 const relevanceStop=new Set(['qual','quais','como','quando','onde','quem','porque','favor','mostre','mostrar','diga','dizer','devo','esta','estao','foi','foram','mais','recente','atual','aqui','posso','pode','podem','usar','use','resuma','resumir','linha','confirme','confirmar','explique','explicar'])
 const questionTokens=tokens(question).filter(token=>!relevanceStop.has(token))
 const answerTokens=new Set(tokens(answer))
 const overlap=questionTokens.filter(token=>answerTokens.has(token)).length
 return questionTokens.length>0&&overlap>=Math.max(1,Math.ceil(questionTokens.length*.5))
}

/**
 * Relevance is intentionally separable from evidence validation for an
 * explicitly authorized multi-producer response. Each producer statement is
 * grounded against its own evidence first; this assertion then evaluates the
 * combined answer without weakening either producer boundary.
 */
export function assertResponseQuestionRelevance({question='',answer='',domain=''}={}){
 const selectedDomain=domain||classifyValContextDomain(question)
 const passed=directlyAnswersQuestion({domain:selectedDomain,question,answer,unsupportedClaims:[]})
 const result=Object.freeze({version:responseGroundingVersion,domain:selectedDomain,passed,question_relevance:passed?'PASS':'FAIL'})
 if(!passed)throw Object.assign(new Error('A resposta não responde diretamente à pergunta atual.'),{code:'RESPONSE_GROUNDING_VIOLATION',grounding:result})
 return result
}

export function evaluateResponseGrounding({question='',answer='',domain='',evidence=[],activeProducerId='',tenantId='',ownerId='',field='answer',now=new Date(),checkQuestionRelevance=true}={}){
 const selectedDomain=domain||classifyValContextDomain(question)
 const evaluatedAt=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date()
 const entries=evidenceEntries(evidence,{domain:selectedDomain,question,activeProducerId:clean(activeProducerId,180),tenantId:clean(tenantId,180),ownerId:clean(ownerId,180),now:evaluatedAt})
 const claimTexts=splitClaims(answer)
 const claims=claimTexts.map((claim,index)=>{
  const support=claimSupport(claim,entries,question,selectedDomain,field,activeProducerId)
  return Object.freeze({claim_id:`claim:${hash(`${field}:${index}:${claim}`)}`,field,index,type:claimType(claim,field),supported:support.supported,evidence_refs:support.evidenceRefs,reason_code:support.reason})
 })
 const normalizedAnswer=normalize(answer)
 const safeNoDataComposite=claimTexts.every(claim=>{
  const source=normalize(claim)
  return isPureInsufficiencyClaim(claim,question,selectedDomain)||declaredGap.test(source)||neutralProcessStrategy.test(source)&&!hasAssertiveClause(claim)||uncertainty.test(source)&&!specificStrategy.test(source)&&!numbers(source).length
 })
 const materiallyQualifiedInsufficiency=insufficient.test(normalizedAnswer)&&!isPureInsufficiencyClaim(normalizedAnswer,question,selectedDomain)&&claims.length>1&&!safeNoDataComposite
 if(materiallyQualifiedInsufficiency&&!claims.some(item=>item.reason_code==='UNSUPPORTED_MATERIAL_INSUFFICIENCY'))claims.push(Object.freeze({claim_id:`claim:${hash(`${field}:material-insufficiency:${answer}`)}`,field,index:claims.length,type:'FACT',supported:false,evidence_refs:[],reason_code:'UNSUPPORTED_MATERIAL_INSUFFICIENCY'}))
 const scopeViolations=entries.filter(item=>!item.scopeCompatible).map(item=>item.auditId)
 const incompatibleEvidence=entries.filter(item=>!item.domainCompatible).map(item=>item.auditId)
 const provenanceViolations=entries.filter(item=>!item.provenanceCompatible).map(item=>Object.freeze({source_ref:item.auditId,reason_codes:item.provenanceCodes}))
 const temporalViolations=entries.filter(item=>!item.temporalCompatible).map(item=>item.auditId)
 const unsupportedClaims=claims.filter(item=>!item.supported)
 const directlyAnswers=!checkQuestionRelevance||directlyAnswersQuestion({domain:selectedDomain,question,answer,unsupportedClaims})
 return Object.freeze({
  version:responseGroundingVersion,domain:selectedDomain,
  passed:unsupportedClaims.length===0&&scopeViolations.length===0&&incompatibleEvidence.length===0&&provenanceViolations.length===0&&temporalViolations.length===0&&directlyAnswers,
  unsupported_terms:[...new Set(unsupportedClaims.map(item=>item.reason_code))],unsupported_claims:unsupportedClaims.map(item=>item.claim_id),
  scope_violations:scopeViolations,incompatible_evidence:incompatibleEvidence,provenance_violations:provenanceViolations,temporal_violations:temporalViolations,
  question_relevance:directlyAnswers?'PASS':'FAIL',evidence_count:entries.length,claim_ledger:claims
 })
}

export function evaluateReasoningGrounding({question='',domain='',evidence=[],activeProducerId='',tenantId='',ownerId='',blocks={},now=new Date()}={}){
 const blockEntries=Object.entries(blocks).filter(([,value])=>clean(value))
 const results=blockEntries.map(([field,answer])=>evaluateResponseGrounding({question,answer,domain,evidence,activeProducerId,tenantId,ownerId,field,now,checkQuestionRelevance:false}))
 const claimLedger=results.flatMap(result=>result.claim_ledger)
 const unsupportedClaims=results.flatMap(result=>result.unsupported_claims)
 const answerFields=/^(?:recommended_strategy\.reading|situation_summary|decision_thesis\.(?:CURRENT_SITUATION|THESIS)|voice_output\.speakable_text|session_turn\.)/i
 const answerEntries=blockEntries.filter(([field])=>answerFields.test(field))
 const relevance=directlyAnswersQuestion({domain:domain||classifyValContextDomain(question),question,answer:answerEntries.map(([,value])=>value).join(' '),unsupportedClaims})
 return Object.freeze({
  version:responseGroundingVersion,domain:domain||classifyValContextDomain(question),
  passed:results.length>0&&results.every(result=>result.passed)&&relevance,
  unsupported_terms:[...new Set(results.flatMap(result=>result.unsupported_terms))],unsupported_claims:results.flatMap(result=>result.unsupported_claims),
  scope_violations:[...new Set(results.flatMap(result=>result.scope_violations))],incompatible_evidence:[...new Set(results.flatMap(result=>result.incompatible_evidence))],provenance_violations:results.flatMap(result=>result.provenance_violations).filter((item,index,items)=>items.findIndex(candidate=>candidate.source_ref===item.source_ref&&candidate.reason_codes.join('|')===item.reason_codes.join('|'))===index),temporal_violations:[...new Set(results.flatMap(result=>result.temporal_violations))],
  question_relevance:relevance?'PASS':'FAIL',evidence_count:list(evidence).length,claim_ledger:claimLedger
 })
}

export function assertResponseGrounding(input={}){
 const result=evaluateResponseGrounding(input)
 if(!result.passed)throw Object.assign(new Error('A resposta introduziu conteúdo sem suporte no contexto selecionado.'),{code:'RESPONSE_GROUNDING_VIOLATION',grounding:result})
 return result
}
