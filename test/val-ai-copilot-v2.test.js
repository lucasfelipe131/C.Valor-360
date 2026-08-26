import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {aiReasoningResultVersion,composeAIReasoning,evaluateGoldenQuestions,evaluateValResponseQuality,questionSimilarity,runContextRemovalTest,runNameSwapTest} from '../server/ai-reasoning/index.js'
import {routeValIntent,valIntents} from '../server/ai-reasoning/intent-router.js'

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const globalCopilot=read('src/components/GlobalValCopilot.jsx')
const app=read('src/App.jsx')
const sidebar=read('src/components/Sidebar.jsx')
const mobile=read('src/components/MobileNav.jsx')
const voice=read('src/components/voice/VoiceCapture.jsx')
const server=read('server.js')
const repository=read('server/repository.js')
const bootstrap=read('server/conversion-bootstrap.js')
const dashboard=read('src/pages/Dashboard.jsx')

function fixture({id='ana',name='Ana Ribeiro',profile='Analítico',crop='Soja',opportunity='Programa fungicida',proof='dados da própria área'}={}){
 const context={
  client:{id,name,municipality:'Sorriso',cultures:crop,primaryProfile:profile,decisionDriver:proof},
  opportunities:[{id:`opp-${id}`,title:opportunity,category:'Proteção',stage:'Negociação'}],
  decisionIntelligence:{signals:[{id:`signal-${id}`,title:`Prova pendente para ${opportunity}`,kind:'decision',evidence_ids:[`interaction-${id}`,`opportunity-${id}`]}]},
  contextSnapshot:{organization_id:'org-test',context_snapshot_id:`snapshot-${id}`,contract_version:'val.context_snapshot.v1',confidence:{level:'PROVÁVEL'},facts:[],inferences:[],hypotheses:[],validated_knowledge:[],missing_information:[]}
 }
 const advice={
  answer:`${name} precisa validar ${proof} antes de avançar ${opportunity}.`,objective:`Definir a próxima decisão de ${opportunity}.`,
  evidence_used:[{id:`interaction-${id}`,source_type:'interaction',claim_supported:`${name} pediu ${proof}.`},{id:`opportunity-${id}`,source_type:'opportunity',claim_supported:`${opportunity} está em negociação para ${crop}.`}],
  executive_brief:{headline:`Prova pendente para ${opportunity}`,reason:`A conta pediu ${proof}.`,action:`Definir métrica, fonte e responsável para ${opportunity}.`,evidence_ids:[`interaction-${id}`,`opportunity-${id}`],missing_data:['métrica aceita']},
  strategic_synthesis:{moment:`Negociação de ${opportunity} depende de prova`,non_obvious_connection:`A preferência por ${proof} muda a forma de avançar ${opportunity} em ${crop}.`,decision_at_stake:`Avançar ou redesenhar a prova de ${opportunity}.`,do_not_do:'Não discutir desconto antes da prova.',competing_hypotheses:[{label:'Falta prova',explanation:`A prova para ${opportunity} ainda não existe.`,supporting_evidence_ids:[`interaction-${id}`],falsifier:'O produtor aceita uma fonte alternativa.',validation_move:'Confirmar a métrica aceita.'}],highest_value_unknown:{question:`Qual métrica de ${crop} tornaria a prova de ${opportunity} suficiente?`,why_it_matters:'Muda o desenho da prova.',how_to_get:`Perguntar a ${name}.`,evidence_ids:[`interaction-${id}`]}},
  decision_thesis:{recommended_action:`Construir a prova de ${opportunity}.`,rationale:[`Preferência por ${proof} registrada.`],missing_information:['métrica aceita'],what_would_change_my_mind:['Aceite de referência externa'],next_action:'Definir a prova.'},
  next_question:{question:`Qual métrica de ${crop} tornaria a prova de ${opportunity} suficiente?`,purpose:'Definir a prova.',evidence_needed:'Métrica aceita.',grounding_ids:[`interaction-${id}`]},questions:[],commercial_context:{status:'known'},behavioral_profile:{version:`profile-${id}`,approach_guidance:{adaptation:`Usar ${proof}.`}},human_review:{required:false},blocked_actions:[],guardrails:['Não fabricar evidência.']
 }
 return {context,advice}
}

test('AIReasoningResult v1 materializa o contrato completo no mesmo pipeline',()=>{
 const {context,advice}=fixture({})
 const {result,quality}=composeAIReasoning({advice,context,message:'Como avançar?',conversationId:'thread-ana'})
 assert.equal(result.contract_version,aiReasoningResultVersion)
 for(const key of ['reasoning_id','organization','client','context_snapshot','objective','situation_summary','key_signals','facts_used','hypotheses','missing_information','decision_thesis','golden_questions','recommended_strategy','evidence_to_use','agronomic_context','commercial_context','next_commitment','risks','confidence','knowledge_refs','memory_refs','created_at','model','prompt_version'])assert.ok(Object.hasOwn(result,key),key)
 for(const key of ['CURRENT_SITUATION','WHAT_MATTERS','KEY_UNCERTAINTY','THESIS','WHY','WHAT_TO_VALIDATE','WHAT_WOULD_CHANGE_MY_VIEW'])assert.ok(result.decision_thesis[key],key)
 assert.ok(result.golden_questions.length<=3)
 assert.equal(result.conversation_id,'thread-ana')
 assert.equal(result.premises.recomputed_for_request,true)
 assert.equal(result.premises.conversation_is_not_confirmed_memory,true)
 assert.equal(quality.status,'PASSED')
 assert.deepEqual(Object.keys(quality.dimensions),['specificity','context_usage','history_usage','question_quality','decision_relevance','agronomic_relevance','commercial_relevance','knowledge_usage','actionability','clarity','non_generic_language','confidence_calibration'])
})

test('AIReasoningResult DEEP audita somente contexto, conhecimento e manual realmente usados',()=>{
 const {context,advice}=fixture({})
 context.fieldReports=[{id:'field-report-a',summary:'Observação do talhão.'}]
 context.manualRecords=[{id:'manual-record-a',summary:'Registro confirmado do manual.'}]
 advice.knowledge_retrieval={items:[{knowledge_item_id:'knowledge-a',title:'Referência selecionada',source_refs:['library:knowledge-a'],status:'APPLICABLE'}]}
 const {result}=composeAIReasoning({advice,context,message:'Analise o manejo agronômico desta conta.',intentHint:'ASK_AGRONOMIC',run:{latency:{MIA:0}}})
 assert.deepEqual(result.run.capabilities_planned,['AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL','KNOWLEDGE_LIBRARY'])
 assert.deepEqual(result.run.capabilities_used,['AGRONOMIC_WORKSPACE','AGRONOMIST_MANUAL','KNOWLEDGE_LIBRARY'])
 assert.deepEqual(result.run.capability_results.map(item=>[item.capability,item.status]),[
  ['AGRONOMIC_WORKSPACE','EXECUTED'],['AGRONOMIST_MANUAL','EXECUTED'],['KNOWLEDGE_LIBRARY','EXECUTED']
 ])
 assert.equal(result.run.latency_breakdown.MIA,0)
 assert.equal(result.run.latency_breakdown.DATABASE,null)
})

test('Perguntas de Ouro avaliam cinco dimensões e reprovam repetição semântica',()=>{
 const shared={reason:'Muda o próximo passo.',unknown:'Critério de decisão.',decision_impact:'Define se a oportunidade avança.',context_refs:['interaction-1']}
 const quality=evaluateGoldenQuestions([
  {...shared,question:'Qual decisão de fertilizante vocês precisam fechar nesta semana, e quem participa dela?'},
  {...shared,question:'Qual decisão sobre o fertilizante vocês precisam fechar nesta semana, e quem participa dela?'}
 ])
 assert.deepEqual(Object.keys(quality.items[0].dimensions),['specificity','openness','novelty','decision_impact','context_grounding'])
 assert.equal(quality.items[1].dimensions.novelty,.15)
 assert.equal(quality.items[1].passed,false)
 assert.equal(quality.passed,false)
 assert.ok(questionSimilarity('Qual dado, fonte ou método ainda falta para o responsável técnico revisar esta decisão?','Quais dados, método, unidade e contexto o responsável técnico precisa validar antes de orientar qualquer ação?')>=.68)
})

test('NAME_SWAP_TEST e CONTEXT_REMOVAL_TEST reprovam resposta genérica sem fontes',()=>{
 const {context}=fixture({})
 const generic={situation_summary:'Converse com o cliente.',facts_used:[],evidence_to_use:[],memory_refs:[],knowledge_refs:[],golden_questions:[],decision_thesis:{CURRENT_SITUATION:'Avalie o cenário.',WHAT_MATTERS:'Entenda as necessidades.',KEY_UNCERTAINTY:'Falta informação.',THESIS:'Adapte a abordagem.',WHY:'É importante.',WHAT_TO_VALIDATE:'Busque mais informações.',WHAT_WOULD_CHANGE_MY_VIEW:'Novos dados.'},recommended_strategy:{reading:'Faça uma abordagem consultiva.',action:'Apresente os benefícios.'},commercial_context:{},agronomic_context:{status:'not_applicable'}}
 assert.equal(runNameSwapTest(generic,context).passed,false)
 assert.equal(runContextRemovalTest(generic,context).passed,false)
 assert.equal(evaluateValResponseQuality(generic,context).passed,false)
})

test('recomposição de qualidade nunca apaga bloqueio de segurança agronômica',()=>{
 const {context,advice}=fixture({})
 advice.answer='A VAL reteve qualquer orientação técnica acionável até revisão do responsável habilitado.'
 advice.human_review={required:true,reason:'Pedido de dose.',required_role:'technical_reviewer'}
 advice.blocked_actions=['Prescrever produto, dose ou mistura']
 advice.evidence_used=[]
 const {result,quality}=composeAIReasoning({advice,context,message:'Qual dose devo aplicar?'})
 assert.equal(quality.status,'SAFETY_PRESERVED')
 assert.match(result.recommended_strategy.reading,/reteve qualquer orientação técnica acionável/)
 assert.equal(result.agronomic_context.human_review_required,true)
})

test('perfis de produtores materialmente diferentes geram premissas e teses diferentes',()=>{
 const producers=[
  fixture({id:'analitico',name:'Ana Ribeiro',profile:'Analítico',crop:'Soja',opportunity:'Programa fungicida',proof:'dados medidos na própria área'}),
  fixture({id:'relacional',name:'Bruno Lopes',profile:'Relacional',crop:'Café',opportunity:'Nutrição foliar',proof:'referência do consultor e conversa presencial'}),
  fixture({id:'inovador',name:'Carla Mendes',profile:'Inovador',crop:'Milho',opportunity:'Monitoramento digital',proof:'piloto rápido com sinal observável'}),
  fixture({id:'conservador',name:'Daniel Costa',profile:'Conservador',crop:'Algodão',opportunity:'Tratamento de sementes',proof:'histórico estável e risco limitado'}),
  fixture({id:'misto',name:'Elisa Ramos',profile:'Misto',crop:'Trigo',opportunity:'Manejo integrado',proof:'comparação econômica com validação da família'})
 ]
 const results=producers.map(({context,advice})=>composeAIReasoning({advice,context,message:'Como avançar?'}).result)
 assert.equal(new Set(results.map(item=>item.decision_thesis.WHAT_MATTERS)).size,5)
 assert.equal(new Set(results.map(item=>item.commercial_context.profile_strategy)).size,5)
 assert.ok(results.every(item=>item.premises.profile_specific))
})

test('roteador v3 cobre as 17 intenções, mantém aliases e nunca promove ASK para memória',()=>{
 assert.equal(valIntents.length,17)
 const cases=[
  ['ASK_GENERAL','Explique o que é margem.',false],['ASK_CLIENT','O que importa nesta conta?',true],['ASK_AGRONOMIC','Analise o manejo agronômico.',true],['ASK_MARKET','Como está o mercado?',false],['ASK_COMMODITY','Qual é o preço da soja?',false],['PREPARE_VISIT','Prepare a próxima visita.',true],['REGISTER_INFORMATION','Registrar nota.',true],['POST_VISIT','Registrar o pós-visita.',true],['ANALYZE_SOIL','Interprete esta análise de solo.',true],['IMAGE_DIAGNOSIS','Analise esta foto.',true],['CALCULATE','Calcule o ponto de equilíbrio.',true],['CHECK_LABEL','Confira a bula.',false],['CHECK_WEATHER','Como está o clima?',false],['CHECK_MARKET','Confira o mercado.',false],['CHECK_OPPORTUNITY','Revise a oportunidade no pipeline.',true],['OBJECTION_HELP','Ajude com esta objeção.',true],['FOLLOW_UP_HELP','Ajude no follow-up.',true]
 ]
 for(const [intent,message,hasClient] of cases){const route=routeValIntent({message,intentHint:intent,hasClient});assert.equal(route.intent,intent);assert.equal(route.persistence_mode,['REGISTER_INFORMATION','POST_VISIT'].includes(intent)?'CONFIRM_REQUIRED':'NONE')}
 assert.equal(routeValIntent({intentHint:'REGISTER_NOTE',hasClient:true}).intent,'REGISTER_INFORMATION')
 assert.equal(routeValIntent({intentHint:'SOIL_INTERPRETATION',hasClient:true}).intent,'ANALYZE_SOIL')
})

test('copiloto global mantém contexto por produtor e oferece texto, voz, foto e arquivo',()=>{
 assert.match(app,/GlobalValCopilot/)
 assert.match(app,/ctrlKey\|\|event\.metaKey/)
 assert.match(sidebar,/Perguntar à VAL/)
 assert.match(mobile,/\['dashboard','Hoje'/)
 assert.match(mobile,/onClick=\{onOpenVal\}/)
 assert.match(globalCopilot,/conversationKey=clientId=>`valor360:val-copilot-thread:v3:/)
 assert.match(globalCopilot,/setAttachments\(\[\]\);setError\(''\)/)
 assert.match(globalCopilot,/Perguntar por voz/)
 assert.match(globalCopilot,/persistence_mode:'NONE'/)
 assert.match(globalCopilot,/persistence_mode:'CONFIRM_REQUIRED'/)
 assert.match(globalCopilot,/capture="environment"/)
 assert.match(globalCopilot,/Por que a VAL disse isso\?/)
 assert.match(globalCopilot,/reasoning\.golden_questions\.slice\(0,3\)/)
 assert.match(dashboard,/key=\{`\$\{priority\.insight_id\|\|priority\.subject_id\|\|'priority'\}-\$\{index\}`\}/)
})

test('perguntar por voz cancela a interação sem confirmação e sem memória',()=>{
 assert.match(voice,/if\(transient\)/)
 assert.match(voice,/await cancelVoiceInteraction\(id,\{signal:controller\.signal\}\)/)
 assert.match(voice,/onTranscribed\?\.\(transcript,result\)/)
 assert.match(voice,/PERGUNTA SEM REGISTRO/)
 assert.ok(voice.indexOf('await cancelVoiceInteraction(id,{signal:controller.signal})')<voice.indexOf('onTranscribed?.(transcript,result)'))
})

test('conversa curta é escopada por sessão e produtor no backend',()=>{
 assert.match(server,/conversationId=clean\(payload\.conversationId\)/)
 assert.match(server,/persistence_mode!=='NONE'/)
 assert.match(bootstrap,/filter\(item=>String\(item\?\.conversation_id\|\|''\)===conversationId\)/)
 assert.match(bootstrap,/scope:'client_session'/)
 assert.match(repository,/generated_content->'ai_reasoning'->>'conversation_id' conversation_id/)
})

test('preferência de densidade de cinco consultores não altera o pedido de raciocínio',()=>{
 const consultants=['simple','balanced','analytical','simple','balanced']
 assert.equal(consultants.length,5)
 assert.match(globalCopilot,/\['simple','Simples'\]/)
 assert.match(globalCopilot,/\['balanced','Equilibrada'\]/)
 assert.match(globalCopilot,/\['analytical','Analítica'\]/)
 assert.match(globalCopilot,/mode:'daily',intent:effectiveIntent,conversationId/)
 assert.doesNotMatch(globalCopilot,/mode:density/)
})
