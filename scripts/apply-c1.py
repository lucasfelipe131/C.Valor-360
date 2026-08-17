from pathlib import Path


def patch(path, replacements):
    file=Path(path)
    source=file.read_text()
    for old,new,label in replacements:
        count=source.count(old)
        if count!=1:
            raise RuntimeError(f'{path}: {label} apareceu {count} vezes')
        source=source.replace(old,new,1)
    file.write_text(source)


patch('server/sales-playbook.js',[
 ("- answer é a fala principal. Use de 2 a 6 frases curtas, uma ideia por frase, no máximo uma pergunta e um próximo passo claro.","- answer é a fala principal. Use de duas a seis frases curtas, com uma ideia por frase, no máximo uma pergunta e um próximo passo claro.",'quantidade e paralelismo'),
 ("- Acompanhe o grau de formalidade do consultor sem copiar vícios de linguagem. Termo novo só quando for comum e realmente encurtar a explicação.","- Acompanhe o grau de formalidade do consultor sem copiar vícios de linguagem. Use um termo novo somente quando ele for comum e realmente encurtar a explicação.",'verbo ausente'),
 ("portanto preencha esses campos","portanto, preencha esses campos",'vírgula após portanto'),
 ("Se não houver motivo legítimo para abordar, deixe vazia.","Se não houver motivo legítimo para abordar, deixe o campo vazio.",'referência do campo question'),
 ("- priority=imediata somente com janela, compromisso vencendo ou risco atual documentado; esta_semana para próximo passo relevante; acompanhar sem urgência; sem_acao quando não houver hipótese sustentada.","- Use priority=imediata somente com janela, compromisso prestes a vencer ou risco atual documentado; esta_semana para um próximo passo relevante; acompanhar quando não houver urgência; sem_acao quando não houver hipótese sustentada.",'frase dos níveis de prioridade'),
 ("- Preparar cruza dossiê, potencial e histórico.","- Preparar cruza o dossiê, o potencial e o histórico.",'artigos na etapa preparar'),
 ("- EPA: Eduque com um insight verificável, Personalize ao contexto real e Assuma o controle do processo com um próximo passo claro — sem controlar a pessoa.","- EPA: eduque com um insight verificável, personalize a abordagem para o contexto real e assuma o controle do processo com um próximo passo claro — sem controlar a pessoa.",'paralelismo EPA'),
 ("como reage a novidade, canal, frequência","como reage a novidades, canal, frequência",'regência de reage'),
 ("- A mera presença de informação agronômica não bloqueia uma estratégia comercial.","- A mera presença de informações agronômicas não bloqueia uma estratégia comercial.",'plural de informações'),
 ("- Memória com status proposed é entrada ainda não verificada do consultor;","- Uma memória com status proposed é uma entrada ainda não verificada do consultor;",'artigos em memória'),
 ("Dose, mistura, produto regulado, receita, diagnóstico causal de campo/solo/NDVI ou alegação financeira sensível exigem human_review e blocked_actions explícitas.","Dose, mistura, produto regulado, receita, diagnóstico causal de campo, solo ou NDVI e alegação financeira sensível exigem o preenchimento explícito de human_review e blocked_actions.",'barreira humana'),
 ("qualidade de evidência deve ser descrita separadamente.","a qualidade da evidência deve ser descrita separadamente.",'artigo da qualidade'),
 ("question:'Que mudança recente na operação de '+topic+' ainda não aparece no dossiê?'","question:'O que mudou recentemente em relação a '+topic+' e ainda não aparece no dossiê?'",'pergunta preparar'),
 ("question:'Podemos tratar de '+topic+' agora e concluir com um próximo passo?'","question:'Podemos conversar agora sobre '+topic+' e concluir com um próximo passo?'",'pergunta alinhar'),
 ("question:'Quando '+topic+' acontece, qual impacto aparece e como vocês medem isso?'","question:'Quando '+topic+' acontece, qual impacto aparece e como isso é medido?'",'pergunta dimensionar aberta'),
 ("question:'Esse impacto é por hectare e nesta safra?'","question:'Esse impacto está expresso por hectare e se refere a esta safra?'",'pergunta dimensionar fechada'),
 ("question:'Que resultado e qual forma de comprovação fariam uma alternativa valer a análise?'","question:'Que resultado e que forma de comprovação fariam valer a pena analisar uma alternativa?'",'pergunta construir valor'),
 ("question:'Um teste limitado, com revisão técnica, seria uma forma aceitável de comparar?'","question:'Um teste limitado, com revisão técnica, seria uma forma aceitável de fazer essa comparação?'",'pergunta de teste'),
 ("question:'Confirmamos responsável, prazo e a evidência que será registrada?'","question:'Confirmamos o responsável, o prazo e a evidência que será registrada?'",'paralelismo compromisso')
])

patch('src/components/ValDecisionWorkspace.jsx',[
 ("const unique=items=>[...new Set(items.map(item=>text(item)).filter(Boolean))]\n","const unique=items=>[...new Set(items.map(item=>text(item)).filter(Boolean))]\nconst countLabel=(value,singular,plural)=>`${Number(value)||0} ${Number(value)===1?singular:plural}`\n",'helper de plural'),
 ("description:contradictions.length?`${contradictions.length} inconsistência(s) visível(is).`:`${missing.length} lacuna(s) priorizada(s).`","description:contradictions.length?`${countLabel(contradictions.length,'inconsistência visível','inconsistências visíveis')}.`:`${countLabel(missing.length,'lacuna priorizada','lacunas priorizadas')}.`",'plural da camada de dados'),
 ("value:response?`${evidence.length} fonte(s)`:'Aguardando análise'","value:response?countLabel(evidence.length,'fonte','fontes'):'Aguardando análise'",'plural de fontes'),
 ("description:'A IA melhora a linguagem; regras, dados e revisão governam a decisão.'","description:'A IA melhora a linguagem; as regras, os dados e a revisão governam a decisão.'",'artigos da governança'),
 ("caption={contradictions.length?`${contradictions.length} inconsistência(s) detectada(s).`:`${missing.length} lacuna(s) relevante(s).`}","caption={contradictions.length?`${countLabel(contradictions.length,'inconsistência detectada','inconsistências detectadas')}.`:`${countLabel(missing.length,'lacuna relevante','lacunas relevantes')}.`}",'plural do resumo'),
 ("caption=\"Força da evidência; não chance de fechamento.\"","caption=\"Força das evidências, não probabilidade de fechamento.\"",'frase de confiança'),
 ("'Existe próximo passo aceito, responsável, prazo e critério de conclusão.'","'Existe um próximo passo aceito, com responsável, prazo e critério de conclusão.'",'critério de avanço'),
 ("<h3>{evidence.length} fonte(s) usada(s)</h3>","<h3>{countLabel(evidence.length,'fonte usada','fontes usadas')}</h3>",'título de evidências')
])

patch('src/components/ProducerBusinessOverview.jsx',[
 ("const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0\n","const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0\nconst countLabel=(value,singular,plural)=>`${finite(value).toLocaleString('pt-BR')} ${finite(value)===1?singular:plural}`\n",'helper de plural'),
 ("detail={`${money(business.creditUsed)} utilizados`}","detail={`${money(business.creditUsed)} já utilizados do limite`}",'crédito utilizado'),
 ("detail={`${finite(business.knownOutcomes)} resultado(s) classificado(s)`}","detail={countLabel(business.knownOutcomes,'resultado classificado','resultados classificados')}",'resultados classificados'),
 ("<h4>Realizado x oportunidade aberta</h4>","<h4>Realizado × oportunidade em aberto</h4>",'comparação do potencial'),
 ("overdue?`${overdue} próxima(s) ação(ões) vencida(s) no funil.`:'Nenhuma próxima ação vencida registrada.'","overdue?`${countLabel(overdue,'próxima ação vencida','próximas ações vencidas')} no funil.`:'Nenhuma próxima ação vencida registrada.'",'ações vencidas'),
 ("'Aguardando primeiro registro vinculado ao produtor'","'Aguardando o primeiro registro vinculado ao produtor'",'artigo do primeiro registro')
])

patch('src/components/ValPanel.jsx',[
 (" const list=Array.isArray(value)?value:(value?[value]:fallback)\n return list.map(textValue).filter(Boolean)\n}\n"," const list=Array.isArray(value)?value:(value?[value]:fallback)\n return list.map(textValue).filter(Boolean)\n}\n\nconst countLabel=(value,singular,plural)=>`${Number(value)||0} ${Number(value)===1?singular:plural}`\n",'helper de plural'),
 ("autonomy:'A decisão permanece com consultor e produtor.'","autonomy:'A decisão permanece com o consultor e o produtor.'",'artigos da autonomia'),
 ("{opportunityReview.total} analisada(s) • {opportunityReview.open} aberta(s)","{countLabel(opportunityReview.total,'oportunidade analisada','oportunidades analisadas')} • {countLabel(opportunityReview.open,'aberta','abertas')}",'contagem de oportunidades')
])

patch('src/components/AccessManagement.jsx',[
 ("onNotice?.('Login criado com carteira zerada.')","onNotice?.('Acesso criado com carteira vazia.')",'mensagem de acesso criado')
])

patch('src/components/SogWorkspace.jsx',[
 ("'Intenção concluída no histórico SOG.'","'Intenção concluída no histórico da SOG.'",'histórico da SOG'),
 ("`${summary.confirmedIntentions||0} confirmadas ou negociando`","`${summary.confirmedIntentions||0} confirmadas ou em negociação`",'status das intenções'),
 ("'referências observadas em até 24h'","'referências observadas nas últimas 24 h'",'espaço e clareza de horas')
])

patch('src/pages/Questionnaire.jsx',[
 (". Leva cerca de 7 a 10 minutos: ${invitation.link||",". O preenchimento leva cerca de 7 a 10 minutos: ${invitation.link||",'mensagem do WhatsApp'),
 ("submitLabel={importQueue.length?'Salvar e revisar próximo':'Compilar perfil'}","submitLabel={importQueue.length?'Salvar e revisar o próximo':'Compilar perfil'}",'rótulo do próximo perfil')
])

patch('src/pages/DataHub.jsx',[
 ("onNotice?.(`${validatedClients.length} produtores organizados na base.`)","onNotice?.(`${validatedClients.length} ${validatedClients.length===1?'produtor organizado':'produtores organizados'} na base.`)",'plural da importação')
])

patch('src/pages/Dashboard.jsx',[
 ("`${priorities.length} prioridades agora`","`${priorities.length} ${priorities.length===1?'prioridade para agora':'prioridades para agora'}`",'plural das prioridades')
])

patch('src/pages/Settings.jsx',[
 ("`${count} itens indexados`","`${count} ${count===1?'item indexado':'itens indexados'}`",'plural dos itens indexados')
])

patch('README.md',[
 ("- interface Ultra responsiva para web e celular;","- interface responsiva para web e celular;",'interface responsiva'),
 ("O modo atual continua sendo **piloto de uma organização**. Antes de múltiplas empresas são obrigatórios identidade corporativa, papéis, tenant na sessão, Row-Level Security testada e isolamento de arquivos/geometrias.","O modo atual continua sendo um **piloto para uma organização**. Antes de atender múltiplas empresas, são obrigatórios identidade corporativa, papéis, tenant na sessão, Row-Level Security testada e isolamento de arquivos e geometrias.",'piloto de uma organização'),
 ("Object storage, antivírus/OCR, ingestão direta de PDF/Excel técnico, PostGIS, processamento de raster/COG, RLS multiempresa, identidade corporativa e avaliação online com casos reais ainda são camadas de produção, não funcionalidades concluídas.","Armazenamento de objetos, antivírus/OCR, ingestão direta de PDF ou Excel técnico, PostGIS, processamento de raster/COG, RLS multiempresa, identidade corporativa e avaliação on-line com casos reais ainda são camadas de produção, não funcionalidades concluídas.",'limites atuais')
])

patch('docs/VAL_ENGINE.md',[
 ("A HMAC prova qual sistema enviou o evento;","A assinatura HMAC comprova qual sistema enviou o evento;",'assinatura HMAC'),
 ("O mesmo `source + externalId` nunca é aplicado duas vezes.","A mesma combinação `source + externalId` nunca é processada duas vezes.",'idempotência'),
 ("Sem HMAC e atestação válida, o dado bruto é preservado, mas nenhuma ação é tratada como validada.","Sem HMAC e uma atestação válida, o dado bruto é preservado, mas nenhuma ação é tratada como validada.",'artigo da atestação'),
 ("Saída: resposta interna, objetivo, dimensões decisórias observáveis, próxima pergunta, plano opcional, tensão aplicável/não aplicável/bloqueada, comparação agir/esperar/manter, próxima ação, compromisso opcional, confiança categórica, evidências estruturadas, revisão humana e ações bloqueadas.","A saída inclui resposta interna, objetivo, dimensões decisórias observáveis, próxima pergunta, plano opcional, tensão aplicável, não aplicável ou bloqueada, comparação entre agir, esperar e manter, próxima ação, compromisso opcional, confiança categórica, evidências estruturadas, revisão humana e ações bloqueadas.",'descrição da saída'),
 ("Antes da primeira migração sobre um banco 0.3,","Antes da primeira migração de um banco 0.3,",'regência da migração')
])

Path('test/ptbr-copy-contract.test.js').write_text("""import assert from 'node:assert/strict'\nimport {readFileSync} from 'node:fs'\nimport test from 'node:test'\n\nconst read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')\nconst playbook=read('server/sales-playbook.js')\nconst decision=read('src/components/ValDecisionWorkspace.jsx')\nconst overview=read('src/components/ProducerBusinessOverview.jsx')\nconst panel=read('src/components/ValPanel.jsx')\nconst questionnaire=read('src/pages/Questionnaire.jsx')\nconst readme=read('README.md')\nconst docs=read('docs/VAL_ENGINE.md')\n\ntest('instruções e perguntas da VAL usam português natural sem mudar o contrato',()=>{\n assert.match(playbook,/Use de duas a seis frases curtas, com uma ideia por frase/)\n assert.match(playbook,/portanto, preencha esses campos/)\n assert.match(playbook,/personalize a abordagem para o contexto real/)\n assert.match(playbook,/O que mudou recentemente em relação a /)\n assert.match(playbook,/Confirmamos o responsável, o prazo e a evidência/)\n assert.doesNotMatch(playbook,/Termo novo só quando/)\n assert.doesNotMatch(playbook,/na operação de '\+topic/)\n})\n\ntest('telas não exibem plurais entre parênteses nem frases telegráficas revisadas',()=>{\n for(const source of [decision,overview,panel]){\n  assert.doesNotMatch(source,/inconsistência\(s\)|lacuna\(s\)|fonte\(s\)|resultado\(s\)|ação\(ões\)|analisada\(s\)|aberta\(s\)/)\n }\n assert.match(decision,/Força das evidências, não probabilidade de fechamento/)\n assert.match(overview,/Realizado × oportunidade em aberto/)\n assert.match(panel,/A decisão permanece com o consultor e o produtor/)\n assert.match(questionnaire,/Salvar e revisar o próximo/)\n})\n\ntest('README e documentação têm prosa revisada',()=>{\n assert.match(readme,/Antes de atender múltiplas empresas, são obrigatórios/)\n assert.match(readme,/Armazenamento de objetos/)\n assert.match(docs,/A assinatura HMAC comprova/)\n assert.match(docs,/A saída inclui resposta interna/)\n})\n""")

for path in ['scripts/audit-c1.py','.github/workflows/audit-c1.yml','tmp/c1-copy-audit.txt','scripts/apply-c1.py','.github/workflows/apply-c1.yml']:
 Path(path).unlink(missing_ok=True)
try: Path('tmp').rmdir()
except OSError: pass
print('C1 aplicado com sucesso.')
