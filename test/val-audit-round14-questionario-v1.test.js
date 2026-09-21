import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildSurveyOptions,validateSurveyAnswers} from '../server/survey-validation.js'
import {recognizeQuestionnaire} from '../src/lib/smart-import.js'
import matrix from '../src/data/profile-matrix.json' with {type:'json'}

// PS-02 a PS-05. O questionario publico e a UNICA superficie da VAL que escreve na base de um
// inquilino sem autenticacao, e ate esta rodada nenhum arquivo de teste a mencionava.
const surveyOptions=buildSurveyOptions(matrix)
const respostasValidas=()=>{
 const answers={}
 for(let id=1;id<=45;id++){
  if(id>=19&&id<=24){answers[id]=7;continue}
  if(id>=7&&id<=18){answers[id]=[...surveyOptions[id]][0];continue}
  answers[id]=id>=27?'':'Resposta'
 }
 return answers
}

test('PS-03 — resposta longa terminada em emoji nao quebra o par substituto',()=>{
 // O corte em 2000 era por unidade de codigo UTF-16 e emoji ocupa DUAS. Cortar no meio do par
 // deixava um substituto solitario, o jsonb recusava, e o produtor recebia 503 dizendo que o
 // PostgreSQL precisa estar disponivel - para sempre, porque o emoji volta a cada tentativa.
 const answers=respostasValidas()
 answers[27]='a'.repeat(1999)+'🌱'
 const validado=validateSurveyAnswers(answers,surveyOptions)
 const texto=validado[27]
 assert.ok(texto.length<=2000)
 const ultimo=texto.charCodeAt(texto.length-1)
 assert.ok(!(ultimo>=0xD800&&ultimo<=0xDBFF),'nao pode terminar em substituto alto')
 assert.equal(JSON.parse(JSON.stringify(texto)),texto,'o texto tem de sobreviver a serializacao')
 assert.doesNotMatch(texto,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,'nenhum substituto solitario')
})

test('PS-03 — caractere nulo e substituto solitario recebidos do cliente sao removidos',()=>{
 const answers=respostasValidas()
 answers[28]='linha\u0000com nulo'
 answers[29]='par quebrado \uD83C e texto'
 const validado=validateSurveyAnswers(answers,surveyOptions)
 assert.equal(validado[28],'linhacom nulo','o jsonb nao aceita \\u0000')
 assert.doesNotMatch(validado[29],/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})

test('PS-03 — resposta curta com emoji continua intacta',()=>{
 // O outro lado: o saneamento nao pode mutilar resposta normal.
 const answers=respostasValidas()
 answers[30]='Gostei do atendimento 🌱🚜'
 assert.equal(validateSurveyAnswers(answers,surveyOptions)[30],'Gostei do atendimento 🌱🚜')
})

test('PS-05 — nota decimal na faixa 19..24 e reconhecida como ausente antes do envio',()=>{
 // A tela dizia "Pronto para atualizar 50 produtores" e o servidor recusava os 50 com uma mensagem
 // que se contradiz: o cliente aceitava 8,5 e o servidor exige inteiro de 0 a 10.
 const parsed={rows:[['Pergunta 19'],['8,5']]}
 const reconhecido=recognizeQuestionnaire(parsed)
 const registro=reconhecido.records?.[0]
 if(registro)assert.equal(registro.answers?.[19],undefined,'nota decimal nao pode ser aceita pelo reconhecedor')
 // E o servidor, que e a fonte autoritativa, continua recusando.
 const answers=respostasValidas()
 answers[19]=8.5
 assert.throws(()=>validateSurveyAnswers(answers,surveyOptions),/entre 0 e 10/)
})

test('PS-02 — o balde por endereco so e gasto por token desconhecido, e o envio usa token+endereco',()=>{
 // Atras de um CDN, de um NAT de cooperativa ou do wi-fi do escritorio, todos os produtores
 // compartilham o mesmo endereco de socket: 60 tentativas de UMA maquina desligavam o questionario
 // para todos, e o produtor legitimo pagava a cota gasta pela adivinhacao alheia.
 const servidor=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 const consulta=servidor.slice(servidor.indexOf("const surveyMatch=url.pathname.match"),servidor.indexOf("const submitMatch=url.pathname.match"))
 assert.doesNotMatch(consulta,/consumeRateLimit\('survey',requestIdentity/,'o token valido nao pode gastar o balde do endereco')
 assert.match(consulta,/if\(!survey\)\{if\(!consumeRateLimit\('survey-miss',requestIdentity\(request\),60\)\)/,'quem gasta o balde e o token desconhecido')
 const envio=servidor.slice(servidor.indexOf("const submitMatch=url.pathname.match"),servidor.indexOf("const integrateMatch=url.pathname.match"))
 // Rodada 15: por TOKEN sozinho fechou a negacao de servico ampla e abriu uma dirigida - quem tem o
 // link gastava as 20 tentativas e trancava o produtor fora do proprio questionario. A chave e o
 // PAR token+endereco: o vizinho de NAT nao paga pelo atacante, e o atacante remoto nao paga pelo
 // produtor. E token absurdamente longo nao entra no balde: ele e recusado antes.
 assert.match(envio,/consumeRateLimit\('survey-submit',`\$\{submitMatch\[1\]\}\|\$\{requestIdentity\(request\)\}`,20\)/,'o envio e limitado pelo par token+endereco')
 assert.match(envio,/String\(submitMatch\[1\]\)\.length>64/,'token fora do formato emitido nao pode ocupar o balde')
})

test('PS-04 — o questionario publico grava rascunho sob o escopo do token',()=>{
 // Sem sessao, activeStorageScope() nao tem o que devolver e o rascunho nao era gravado: o produtor
 // perdia as 45 respostas em qualquer recarga - e com o banco fora ele ainda lia uma mensagem que
 // culpa o PostgreSQL. O escopo ja existia na URL.
 const form=readFileSync(new URL('../src/components/SurveyForm.jsx',import.meta.url),'utf8')
 assert.match(form,/draftScope:scopeOverride/,'o formulario precisa aceitar escopo de fora')
 assert.match(form,/const draftScope=scopeOverride\?\?activeStorageScope\(\)/,'sem a prop, o comportamento anterior continua')
 const publico=readFileSync(new URL('../src/pages/PublicSurvey.jsx',import.meta.url),'utf8')
 assert.match(publico,/draftScope=\{`publico:\$\{token\}`\}/,'o publico passa o token como escopo')
 const assistido=readFileSync(new URL('../src/pages/Questionnaire.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(assistido,/draftScope=/,'a aplicacao assistida continua no escopo da sessao')
})

test('GPS-01 — o mapa do consultor conta descarte pelo mesmo criterio do painel do gestor',()=>{
 // discardedSegments, no servidor, conta trecho descartado POR VELOCIDADE IMPOSSIVEL. Acima de
 // 120 s o corte ja veio do intervalo - buraco de sinal -, e contar os dois lados divergia: a tela
 // do consultor avisava descarte que o painel do gestor nao reconhecia.
 const mapa=readFileSync(new URL('../src/components/map/RouteMap.jsx',import.meta.url),'utf8')
 assert.match(mapa,/if\(salto&&seconds<=120\)discarded\+=1/,'salto apos buraco de sinal nao conta como descarte por velocidade')
})
