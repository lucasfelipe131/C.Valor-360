# VALOR 360 — Sprint 1

## 1. Visão do produto

**VALOR 360** é uma plataforma web de inteligência comercial para transformar conhecimento do produtor em preparação de visitas, personalização da abordagem e venda de valor.

**Slogan:** Conhecer. Personalizar. Gerar Valor.

**IA:** VAL — assistente de inteligência comercial do VALOR 360.

## 2. Problema central

A carteira possui produtores com perfis, prioridades, momentos e critérios de decisão diferentes, mas o atendimento tende a depender da memória do consultor, de registros dispersos e de abordagens pouco padronizadas.

## 3. Proposta de valor

O sistema cruza perfil, histórico, contexto produtivo, relacionamento e oportunidades para responder:

1. Quem visitar?
2. Por que visitar?
3. O que perguntar?
4. Como conduzir?
5. Como demonstrar valor?
6. Qual compromisso buscar?

## 4. Escopo do MVP para novembro

- Login web responsivo.
- Dashboard diário.
- Cadastro e ficha Cliente 360.
- Questionário e classificação de perfil.
- IRT, NPS e preferências.
- Preparação de visita pela VAL.
- Perguntas SPIN + roteiro EPA/Challenger.
- Registro de visita e próximo compromisso.
- Oportunidades e cálculo básico de ROI.
- Indicadores do piloto.
- Demonstração navegável em até 40 segundos.

## 5. Design system

### Cores
- Azul institucional: `#0758B6`
- Azul profundo: `#073B78`
- Azul de destaque: `#2D8CFF`
- Branco: `#FFFFFF`
- Fundo: `#F5F8FC`
- Texto: `#12304F`
- Cinza: `#6F8298`

### Princípios
- Muito espaço em branco.
- Um objetivo principal por tela.
- Cards limpos e arredondados.
- Linguagem simples.
- Sem excesso de campos.
- Ação prioritária sempre visível.

## 6. Mapa de navegação

Login
→ Visão do dia
→ Clientes
→ Cliente 360
→ Preparar visita com a VAL
→ Registrar visita
→ Próximo compromisso

Rotas paralelas:
- Roteiro inteligente
- Oportunidades
- Venda de valor
- Indicadores
- Administração

## 7. Fluxo principal

1. Consultor abre o sistema.
2. Dashboard apresenta prioridades.
3. Seleciona o produtor.
4. Consulta perfil, IRT, histórico e oportunidade.
5. Clica em “Preparar visita com a VAL”.
6. Recebe objetivo, abertura, perguntas, reframe, prova de valor e fechamento.
7. Executa a visita.
8. Registra achados, objeções e compromisso.
9. Sistema atualiza oportunidade e próxima ação.
10. Indicadores mostram execução e evolução.

## 8. Arquitetura da VAL

### Entradas
- Perfil principal e secundário.
- Preferência de interação.
- IRT/NPS/confiança.
- Culturas e área.
- Histórico de visitas.
- Dores e objetivos.
- Oportunidades abertas.
- Conteúdo técnico autorizado.
- Estratégias SPIN, EPA, OPC e Challenger.

### Motor
1. Recupera contexto do cliente.
2. Classifica objetivo da visita.
3. Seleciona abordagem por perfil.
4. Gera perguntas e provocações.
5. Traduz impacto técnico em valor.
6. Define próximo compromisso.
7. Registra recomendações e resultados para aprendizado.

### Saídas
- Resumo executivo.
- Objetivo da visita.
- Abertura personalizada.
- Perguntas SPIN.
- Reframe Challenger.
- Evidências e ROI.
- Objeções prováveis.
- Compromisso de fechamento.

### Guardrails
- Não inventar dados agronômicos.
- Exibir premissas de ROI.
- Diferenciar fato, estimativa e recomendação.
- Preservar decisão humana.
- Registrar fonte e versão do conteúdo.
- Restringir acesso por carteira e função.

## 9. Indicadores do piloto

- Tempo médio para preparar uma visita.
- Percentual de visitas com objetivo definido.
- Percentual de visitas com próximo compromisso.
- Frequência de contatos por perfil.
- Evolução do IRT.
- Conversão de oportunidade.
- Valor potencial mapeado.
- Percepção do consultor sobre utilidade.
- Percepção do produtor sobre personalização.

## 10. Pitch de quatro minutos

### 0:00–0:30 — Problema
“Uma carteira pode ter centenas de produtores, mas cada um decide de forma diferente. O problema não é a falta de dados; é transformar dados em uma conversa relevante.”

### 0:30–1:10 — Solução
“O VALOR 360 identifica o perfil, organiza o contexto e usa a VAL para preparar cada visita com objetivo, perguntas, argumento e próximo compromisso.”

### 1:10–2:10 — Demonstração
Abrir dashboard → escolher João → mostrar perfil → clicar em Preparar visita → exibir roteiro da VAL.

### 2:10–3:10 — Valor
“Em vez de começar pelo produto e pelo preço, o consultor começa pelo problema, quantifica o impacto e demonstra o retorno. O sistema transforma visita em processo comercial mensurável.”

### 3:10–4:00 — Validação e futuro
Apresentar resultados do piloto, aprendizados e possibilidade de expansão. Encerrar:
“VALOR 360: conhecer o cliente é o começo; gerar valor é o objetivo.”

## 11. Backlog da Sprint 2

- Implementar autenticação.
- Criar banco em nuvem.
- Importar respostas do Cliente 360.
- Tornar questionário editável.
- Registrar visitas reais.
- Construir cálculo de ROI.
- Integrar primeira versão da VAL.
- Publicar ambiente web de teste.
