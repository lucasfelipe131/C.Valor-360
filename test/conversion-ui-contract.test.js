import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizeAdviceForValUi,toValUiConfidence,toValUiPriority} from '../server/conversion-ui-contract.js'

test('mapeia prioridade e confiança para os códigos usados pela interface',()=>{
  assert.equal(toValUiPriority('alta'),'esta_semana')
  assert.equal(toValUiPriority('média'),'acompanhar')
  assert.equal(toValUiPriority('imediata'),'imediata')
  assert.equal(toValUiConfidence('alta'),'high')
  assert.equal(toValUiConfidence('média'),'moderate')
  assert.equal(toValUiConfidence('baixa'),'low')
})

test('torna score, inconsistências e confiança visíveis sem inventar probabilidade',()=>{
  const advice={
    executive_brief:{priority:'alta',headline:'João • Expansão de milho • prioridade alta',reason:'Janela próxima.'},
    confidence:{level:'média',rationale:'Confiança baseada nos registros.',missing_data:['prazo da próxima ação']},
    conversion_intelligence:{score:78,priority:'alta',data_quality:{contradictions:['potencial em aberto supera o potencial total']}},
    conversation_plan:{steps:[]}
  }
  const conversion={
    selectedOpportunity:{title:'Expansão de milho',score:78,priority:'alta'},
    confidence:{score:63,level:'média',rationale:'Confiança operacional baseada em dados.',missingData:['evidência vinculada'],contradictions:['potencial em aberto supera o potencial total']},
    dataQuality:{contradictions:['potencial em aberto supera o potencial total']},
    workflow:{label:'Converter intenção em compromisso',action:'Confirmar decisão e prazo.',question:'Qual pendência impede a decisão?',closedQuestion:'Podemos definir o próximo passo até sexta?',successGate:'Responsável e data confirmados.',avoid:'Não confundir interesse com compromisso.'}
  }

  const normalized=normalizeAdviceForValUi(advice,conversion)

  assert.equal(normalized.executive_brief.priority,'esta_semana')
  assert.match(normalized.executive_brief.headline,/prioridade esta semana/i)
  assert.match(normalized.executive_brief.reason,/Score operacional 78\/100/)
  assert.equal(normalized.confidence.level,'moderate')
  assert.equal(normalized.confidence.calibration_status,'not_calibrated')
  assert.equal(normalized.confidence.conversion_probability,null)
  assert.ok(normalized.confidence.missing_data.some(item=>/Inconsistência: potencial em aberto/i.test(item)))
  assert.equal(normalized.conversation_plan.steps.length,3)
  assert.ok(normalized.conversation_plan.steps.every(item=>item.stage&&item.goal&&item.suggested_line&&item.advance_signal))
  assert.equal(normalized.conversation_plan.closing_options[0].suggested_line,'Podemos definir o próximo passo até sexta?')
})

test('preserva um roteiro válido já produzido pela camada segura',()=>{
  const plan={opening:'Abertura',steps:[{stage:'descobrir',goal:'Entender impacto',suggested_line:'O que mudou?',advance_signal:'Impacto confirmado',question_type:'aberta',if_resistance:'Voltar ao contexto'}],closing_options:[],do_not_say:[]}
  const advice={conversation_plan:plan,executive_brief:{priority:'imediata'},confidence:{level:'high'}}
  const normalized=normalizeAdviceForValUi(advice,{selectedOpportunity:{priority:'imediata',score:90}})
  assert.deepEqual(normalized.conversation_plan,plan)
})

test('não modifica o objeto original recebido da engine',()=>{
  const advice={executive_brief:{priority:'alta',reason:'Teste'},confidence:{level:'alta'},conversation_plan:{steps:[]}}
  const snapshot=structuredClone(advice)
  normalizeAdviceForValUi(advice,{selectedOpportunity:{priority:'alta',score:80},workflow:{}})
  assert.deepEqual(advice,snapshot)
})
