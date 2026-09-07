# Oportunidades — composição aprovada

Base integrada: `3b1f5d3f4e7a68a6b4dc59c0edb5a7e942fac184` (Produtor 360, mapa e relatório técnico preservados).

A página substitui o hero e a faixa duplicada por indicadores compactos, filtros combinados, Quadro/Lista, quatro etapas e VAL Copiloto contextual à direita. O simulador ocupa a faixa inferior. A marca usa os assets oficiais existentes.

Criação, edição, resultado e retorno usam a API autenticada existente. O repositório conserva múltiplos negócios, valores ausentes, campos informados, histórico aditivo, autoria no servidor, idempotência e conflito de versão. O Copiloto reutiliza o componente e os serviços existentes com o produtor selecionado. Relatórios exportam CSV e impressão/PDF; o simulador inicia vazio e não grava no negócio.

## Verificações executadas

- `node --test test/*.test.js`: 109 testes disponíveis no checkout local, todos passando. Inclui 17 testes novos de domínio, persistência e componentes. Não representa a suíte integral do repositório.
- `npm run build`: passou, incluindo stamp e verificação PWA.
- `npm run bundle:audit`: passou.
- Bundle de produção inspecionado: sem identidades da fixture e sem diretório de rotas de teste.
- Builder de prévia isolada executado com sucesso.
- Fluxo fallback testado de fato. PostgreSQL coberto por contrato de queries com conexão simulada; não executado em banco real nesta sessão.

## Revisão visual pendente

O navegador da sessão bloqueou localhost e acesso ao arquivo de prévia pela política de segurança. Não foram obtidas capturas reais nem realizada comparação visual. Portanto a fidelidade à imagem aprovada ainda NÃO está comprovada.

Para revisão em ambiente local autorizado, iniciar Vite e abrir `/test/visual/frame.html?size=desktop`. O frame suporta `desktop` (1600), `medium` (1440), `tablet` (1100) e `mobile` (390); conferir os valores no próprio arquivo. Alternativamente, `node scripts/build-opportunities-preview.mjs /caminho/temporario` gera uma prévia estática para inspeção local. Nenhuma prévia foi publicada nesta tarefa.

As seis oportunidades fictícias ficam exclusivamente em `test/visual`, com aviso visível, gravação em memória e interceptação de chamadas de rede. Não são importadas pelo aplicativo de produção. A prévia oferece cenários vazio, falha e troca de carteira. As interações reais do Copiloto precisam de validação no ambiente autenticado autorizado, sem a fixture.

Antes de integrar em release: concluir CI, capturar desktop de referência e celular, comparar com o mockup aprovado, verificar painel/contexto e exercitar gravação contra PostgreSQL. Main, produção e PR #95 não foram alterados.
