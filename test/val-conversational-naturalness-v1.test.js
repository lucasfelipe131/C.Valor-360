import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversationalNaturalnessDimensions,
  conversationalNaturalnessVersion,
  evaluateConversationalNaturalness
} from '../server/ai-reasoning/conversational-naturalness.js'

const naturalTurn={
  user_message:'Ele quer comparar o custo por hectare. O que eu valido amanhã?',
  assistant_response:'Entendi. Para o João, compare o custo por hectare do Programa Safra com o resultado esperado na Fazenda Horizonte. Qual faixa ele aceita usar como referência na decisão?',
  prior_turns:[
    {role:'user',content:'Amanhã vou visitar o João para falar do Programa Safra.'},
    {role:'assistant',content:'Certo. A visita será na Fazenda Horizonte e a decisão passa pelo custo por hectare.'}
  ],
  active_context:{current_client:{id:'client-joao',name:'João'},current_property:{id:'farm-horizonte',name:'Fazenda Horizonte'}},
  context_refs:['Programa Safra','custo por hectare'],
  context:{references_resolved:true,follow_up_needed:true,expected_tenant_id:'tenant-a',used_tenant_id:'tenant-a'},
  interaction:{response_mode:'voice',follow_up_needed:true,interrupted:false},
  safety:{boundary_respected:true},
  persistence:{performed:false}
}

test('avalia conversa contextual, breve e consultiva como natural',()=>{
  const result=evaluateConversationalNaturalness(naturalTurn)
  assert.equal(result.contract_version,conversationalNaturalnessVersion)
  assert.equal(result.status,'PASSED')
  assert.equal(result.passed,true)
  assert.ok(result.score>=3)
  assert.ok(['NATURAL','VERY_NATURAL'].includes(result.label))
  assert.deepEqual(Object.keys(result.dimensions),conversationalNaturalnessDimensions)
  assert.equal(result.dimensions.context_retention.score,4)
  assert.equal(result.dimensions.follow_up_quality.score,4)
  assert.equal(result.hard_failures.length,0)
})
test('identifica resposta robótica e desconectada sem depender de aleatoriedade',()=>{
  const input={
    user_message:'E naquela área do João, o que eu faço agora?',
    assistant_response:'Certamente! De acordo com sua solicitação, seguem abaixo algumas opções. Avalie o cenário. Posso ajudá-lo com mais alguma coisa?',
    prior_turns:[{role:'user',content:'João recusou o Programa Safra por custo por hectare.'}],
    active_context:{current_client:{name:'João'},current_property:{name:'Fazenda Horizonte'}},
    context:{follow_up_needed:false},
    interaction:{follow_up_needed:false,response_mode:'voice'}
  }
  const first=evaluateConversationalNaturalness(input)
  const second=evaluateConversationalNaturalness(input)
  assert.deepEqual(first,second)
  assert.equal(first.passed,false)
  assert.ok(['ROBOTIC','MOSTLY_ROBOTIC','ACCEPTABLE'].includes(first.label))
  assert.equal(first.dimensions.non_robotic_language.score,0)
  assert.equal(first.dimensions.context_retention.score,1)
  assert.ok(first.score<3)
})

test('falha dura de contexto prevalece sobre texto natural',()=>{
  const result=evaluateConversationalNaturalness({
    ...naturalTurn,
    context:{...naturalTurn.context,expected_tenant_id:'tenant-a',used_tenant_id:'tenant-b'}
  })
  assert.equal(result.status,'HARD_FAILURE')
  assert.equal(result.passed,false)
  assert.equal(result.score,0)
  assert.equal(result.label,'ROBOTIC')
  assert.ok(result.raw_score>=3)
  assert.deepEqual(result.hard_failures.map(item=>item.code),['CROSS_TENANT_CONTEXT'])
})

test('falhas duras cobrem segurança, ambiguidade e persistência sem confirmação',()=>{
  const result=evaluateConversationalNaturalness({
    ...naturalTurn,
    safety:{violation:true},
    context:{...naturalTurn.context,ambiguity_detected:true,clarification_asked:false},
    persistence:{performed:true,confirmed:false}
  })
  assert.deepEqual(result.hard_failures.map(item=>item.code),[
    'SAFETY_BOUNDARY_VIOLATION',
    'SILENT_CONTEXT_GUESS',
    'UNCONFIRMED_PERSISTENCE'
  ])
  assert.equal(result.status,'HARD_FAILURE')
  assert.equal(result.score,0)
})

test('dados ausentes retornam contrato completo e conservador, sem lançar exceção',()=>{
  for(const value of [undefined,null,{},'inválido']){
    const result=evaluateConversationalNaturalness(value)
    assert.equal(result.evaluable,false)
    assert.equal(result.passed,false)
    assert.equal(result.score,0)
    assert.equal(result.label,'ROBOTIC')
    assert.deepEqual(result.missing_fields,['user_message','assistant_response'])
    assert.deepEqual(Object.keys(result.dimensions),conversationalNaturalnessDimensions)
    assert.ok(Object.values(result.dimensions).every(item=>item.score===0))
  }
})
