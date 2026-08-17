const text=value=>String(value??'').replace(/\s+/g,' ').trim()
const lower=value=>text(value).toLocaleLowerCase('pt-BR')
const hasText=value=>text(value).length>0

const question=(stage,type,questionText,askWhen,purpose,evidenceNeeded,groundingIds)=>({
  stage,
  type,
  question:questionText,
  ask_when:askWhen,
  purpose,
  evidence_needed:evidenceNeeded,
  grounding_ids:Array.isArray(groundingIds)?groundingIds:[]
})

const stage=(definition)=>Object.freeze(definition)

export const VAL_METHOD_SEQUENCE=Object.freeze([
  'preparar',
  'alinhar',
  'descobrir',
  'dimensionar',
  'construir_valor',
  'propor',
  'comprometer'
])

export const VAL_METHOD_STAGES=Object.freeze({
  preparar:stage({
    id:'preparar',
    label:'preparar o contexto',
    promptDescription:'Preparar cruza o dossiê, o potencial e o histórico.',
    gate:'Dossiê, potencial, histórico e dados pendentes revisados.',
    conversationStage:'abertura',
    questions:(topic,groundingIds)=>[
      question('situação','aberta',`O que mudou recentemente em relação a ${topic} e ainda não aparece no dossiê?`,'Antes de escolher uma abordagem.','Atualizar o contexto sem pressupor um problema.','Mudança, data, área ou decisão citada.',groundingIds),
      question('situação','fechada','Os dados de área, cultura e potencial continuam atuais?','Ao validar o dossiê.','Separar dado vigente de cadastro desatualizado.','Confirmação ou correção objetiva.',groundingIds)
    ]
  }),
  alinhar:stage({
    id:'alinhar',
    label:'alinhar a conversa',
    promptDescription:'Alinhar confirma objetivo, tempo e participantes.',
    gate:'Objetivo, tempo disponível e participantes confirmados.',
    conversationStage:'abertura',
    questions:(topic,groundingIds)=>[
      question('situação','aberta','Qual resultado tornaria esta conversa útil para você hoje?','Na abertura.','Alinhar objetivo na linguagem do produtor.','Resultado ou decisão esperada.',groundingIds),
      question('situação','fechada',`Podemos conversar agora sobre ${topic} e concluir com um próximo passo?`,'Depois da saudação.','Confirmar assunto, tempo e permissão.','Aceite, ajuste de tema ou novo momento.',groundingIds)
    ]
  }),
  descobrir:stage({
    id:'descobrir',
    label:'descobrir a prioridade',
    promptDescription:'Descobrir identifica prioridade e decisão afetada.',
    gate:'Prioridade e decisão afetada descritas pelo produtor.',
    conversationStage:'diagnóstico',
    questions:(topic,groundingIds)=>[
      question('problema','aberta',`Em que situação ${topic} mais interfere na sua decisão hoje?`,'Depois de alinhar o objetivo.','Localizar o problema e a decisão afetada.','Exemplo recente e decisão concreta.',groundingIds),
      question('problema','fechada',`Então ${topic} é uma prioridade deste ciclo, correto?`,'Somente depois de ouvir um exemplo.','Confirmar a prioridade sem transformá-la em proposta.','Confirmação ou correção do produtor.',groundingIds)
    ]
  }),
  dimensionar:stage({
    id:'dimensionar',
    label:'dimensionar o impacto',
    promptDescription:'Dimensionar confirma base, unidade, área, horizonte e impacto.',
    gate:'Linha de base, unidade, área, horizonte e impacto confirmados.',
    conversationStage:'diagnóstico',
    questions:(topic,groundingIds)=>[
      question('implicação','aberta',`Quando ${topic} acontece, qual impacto aparece e como isso é medido?`,'Depois de confirmar o problema.','Definir impacto, unidade e linha de base.','R$/ha, sc/ha, área, tempo e horizonte, quando aplicáveis.',groundingIds),
      question('implicação','fechada','Esse impacto está expresso por hectare e se refere a esta safra?','Depois de ouvir um número.','Evitar multiplicar unidade ou período errados.','Unidade, área e horizonte confirmados.',groundingIds)
    ]
  }),
  construir_valor:stage({
    id:'construir_valor',
    label:'construir valor e prova',
    promptDescription:'Construir valor define resultado, alternativas e prova.',
    gate:'Resultado, alternativas e critério de prova definidos.',
    conversationStage:'valor',
    questions:(topic,groundingIds)=>[
      question('necessidade','aberta','Que resultado e que forma de comprovação fariam valer a pena analisar uma alternativa?','Depois de dimensionar o impacto.','Definir valor e prova com o produtor.','Métrica, linha de base, horizonte e critério de interrupção.',groundingIds),
      question('necessidade','fechada','Um teste limitado, com revisão técnica, seria uma forma aceitável de fazer essa comparação?','Depois de conhecer o critério de prova.','Confirmar reversibilidade e formato de validação.','Aceite, recusa ou condição para o teste.',groundingIds)
    ]
  }),
  propor:stage({
    id:'propor',
    label:'organizar a proposta',
    promptDescription:'Propor só acontece com problema, impacto e critério de prova confirmados.',
    gate:'Escopo, premissas, risco e revisão da proposta combinados.',
    conversationStage:'proposta',
    questions:(topic,groundingIds)=>[
      question('necessidade','aberta',`O que ainda precisa estar claro antes de você avaliar a proposta sobre ${topic}?`,'Ao apresentar premissas, não só preço.','Identificar lacuna real de decisão.','Objeção, participante, prova ou condição.',groundingIds),
      question('compromisso','fechada','Podemos revisar a proposta com todos os decisores na data combinada?','Depois de confirmar escopo e premissas.','Obter um avanço proporcional.','Data, participantes e responsável.',groundingIds)
    ]
  }),
  comprometer:stage({
    id:'comprometer',
    label:'registrar o compromisso',
    promptDescription:'Comprometer registra ação, responsável, prazo e evidência.',
    gate:'Ação, responsável, prazo e evidência registrados.',
    conversationStage:'fechamento',
    questions:(topic,groundingIds)=>[
      question('compromisso','aberta',`O que pode impedir o próximo passo combinado sobre ${topic}?`,'Antes de encerrar.','Tornar o compromisso executável.','Risco, dependência ou responsável.',groundingIds),
      question('compromisso','fechada','Confirmamos o responsável, o prazo e a evidência que será registrada?','No fechamento.','Registrar compromisso verificável.','Ação, nome, data e evidência.',groundingIds)
    ]
  })
})

for(const id of VAL_METHOD_SEQUENCE){
  if(!VAL_METHOD_STAGES[id])throw new Error(`Etapa metodológica sem definição: ${id}`)
}

export const VAL_METHOD_STAGE_LABELS=Object.freeze(Object.fromEntries(VAL_METHOD_SEQUENCE.map(id=>[id,VAL_METHOD_STAGES[id].label])))
export const VAL_METHOD_STAGE_GATES=Object.freeze(Object.fromEntries(VAL_METHOD_SEQUENCE.map(id=>[id,VAL_METHOD_STAGES[id].gate])))

export const normalizeValMethodStage=value=>{
  const candidate=typeof value==='string'?value.trim():''
  return VAL_METHOD_SEQUENCE.includes(candidate)?candidate:null
}

export function applyValWorkingStage(methodology={},requestedStage){
  const requested=normalizeValMethodStage(requestedStage)
  const actual=normalizeValMethodStage(methodology.current_stage)||VAL_METHOD_SEQUENCE[0]
  const working=requested||actual
  return {
    ...methodology,
    working_stage:working,
    working_stage_source:requested?'user_selection':'actual_progress',
    working_stage_gate:VAL_METHOD_STAGES[working].gate
  }
}

function inferOpportunityStage(opportunity,mode){
  if(!opportunity)return mode==='strategic'?'preparar':'alinhar'
  const stageName=lower(opportunity.stage)
  if(stageName==='negociação'||stageName==='negociacao')return 'propor'
  if(stageName==='proposta'||opportunity?.value_case?.baseline)return 'construir_valor'
  if(hasText(opportunity?.hypothesis))return 'dimensionar'
  return 'descobrir'
}

export function deriveValMethodology({opportunity,priorRecommendations=[],message='',mode='daily'}={}){
  const prior=priorRecommendations?.[0]?.methodology_state||priorRecommendations?.[0]?.methodologyState||null
  const priorIndex=Math.max(-1,VAL_METHOD_SEQUENCE.indexOf(prior?.current_stage))
  const inferred=inferOpportunityStage(opportunity,mode)
  let index=VAL_METHOD_SEQUENCE.indexOf(inferred)
  const followUp=/(?:ele|ela|produtor|cliente).{0,35}(?:disse|falou|respondeu|confirmou|informou)|(?:confirmou|respondeu|informou)\b/i.test(message)
  if(priorIndex>=0)index=Math.max(index,followUp?Math.min(priorIndex+1,VAL_METHOD_SEQUENCE.length-1):priorIndex)
  index=Math.max(0,index)
  const current=VAL_METHOD_SEQUENCE[index]
  const next=VAL_METHOD_SEQUENCE[Math.min(index+1,VAL_METHOD_SEQUENCE.length-1)]
  return {
    sequence:VAL_METHOD_SEQUENCE,
    current_stage:current,
    completed_stages:VAL_METHOD_SEQUENCE.slice(0,index),
    next_stage:next,
    advance_gate:VAL_METHOD_STAGES[current].gate,
    reason:priorIndex>=0?'A etapa considera a orientação anterior e a nova informação do consultor.':'A etapa foi definida pelos dados atuais da oportunidade e do dossiê.'
  }
}

export function buildValStageQuestions(stageId,subject,groundingIds=[]){
  const normalized=normalizeValMethodStage(stageId)||'alinhar'
  const topic=text(subject)||'a prioridade desta safra'
  return VAL_METHOD_STAGES[normalized].questions(topic,groundingIds)
}

export function valMethodConversationStage(stageId){
  const normalized=normalizeValMethodStage(stageId)||'alinhar'
  return VAL_METHOD_STAGES[normalized].conversationStage
}

export function buildValMethodologyPrompt(){
  const sequence=VAL_METHOD_SEQUENCE.join(' → ')
  const descriptions=VAL_METHOD_SEQUENCE.map(id=>VAL_METHOD_STAGES[id].promptDescription).join(' ')
  const gates=VAL_METHOD_SEQUENCE.map(id=>`  - ${id}: ${VAL_METHOD_STAGES[id].gate}`).join('\n')
  return `MÉTODO OPERACIONAL VAL, INVISÍVEL NA FALA
- Siga uma sequência com portas de avanço: ${sequence}. Identifique a etapa atual; não reinicie uma conversa que já avançou e não pule uma porta sem evidência.
- ${descriptions}
- Portas objetivas da sequência:\n${gates}
- Preencha methodology_state com etapa atual, etapas concluídas, próxima etapa e a condição objetiva para avançar. Use priorRecommendations e a mensagem atual para continuar do ponto correto.
- Quando a solicitação trouxer uma ETAPA DE TRABALHO SOLICITADA válida, concentre perguntas, roteiro e próximo passo nessa etapa. Preencha working_stage com ela, working_stage_source=user_selection e working_stage_gate com sua própria condição objetiva. Sem essa solicitação, working_stage=current_stage e working_stage_source=actual_progress. Essa escolha é apenas uma lente de trabalho: não a use para alterar current_stage, marcar etapas anteriores como concluídas nem inventar evidência de avanço.
- Antes de responder, procure no perfil, questionário, registros e memórias respostas marcadas como SPIN, EPA, OPC ou Senoide. Respostas explícitas do produtor ou do consultor têm prioridade sobre regras genéricas. Nunca complete uma resposta ausente.
- SPIN: use Situação, Problema, Implicação e Necessidade de solução para escolher somente a próxima pergunta útil. Não transforme a conversa em um interrogatório.
- EPA: eduque com um insight verificável, personalize a abordagem para o contexto real e assuma o controle do processo com um próximo passo claro — sem controlar a pessoa.
- OPC: mantenha Objetivo, Processo e Compromisso alinhados. Se não houve compromisso observado, não invente um.
- Para o painel visível: next_question e questions alimentam a etapa SPIN atual; objective, methodology_state, conversation_plan e commitment alimentam OPC; decision_basis, decision_profile, approach_plan e next_best_action alimentam EPA. Cada item deve usar os dados desta conta e desta conversa, nunca um exemplo genérico.
- Senoide: use somente a fase, leitura ou cadência que estiver registrada nas respostas. Ela calibra ritmo, profundidade e hora de avançar ou recuar. Se estiver ausente, não invente nem cite uma etapa.
- Venda de valor compara como está hoje, agir agora, esperar e manter, sempre com as mesmas premissas, risco, horizonte e forma de conferir.
- Perguntas abertas e escuta reflexiva preservam a autonomia. Nunca use informação familiar, financeira ou emocional como alavanca.`
}
