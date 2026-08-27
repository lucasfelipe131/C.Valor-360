# Home VAL v2

## Objetivo

Responder em poucos segundos: “O que merece minha atenção agora?”

## Primeira camada

1. Título e orientação curta.
2. Até três prioridades acionáveis:
   - agir agora;
   - preparar;
   - acompanhar.
3. Seletor de produtor quando o contexto não puder ser inferido com segurança.
4. Ação principal: **Falar com a VAL**.

Após transcrever e revisar, somente a confirmação humana dispara a orientação. A Home relaciona o resumo canônico à memória, chama o pipeline existente, mostra headline, motivo, próxima ação e pergunta em um bloco curto e recarrega as prioridades. Falha de análise não desfaz a informação confirmada e não produz resposta fictícia.

Nenhuma prioridade pode inventar compromisso, oportunidade, prazo ou risco. Na ausência de dados, a Home informa a lacuna e oferece uma próxima ação concreta.

## Camadas secundárias

Agenda, carteira, oportunidades, números, Conversion Core, métodos, Manual e análises permanecem acessíveis, mas não disputam a primeira tela.

## Regras

- máximo de três cards;
- sem nomes de motores, scores ou metodologia na camada primária;
- a fala usa `GENERAL_CONTEXT`, confirmação humana e o produtor selecionado;
- o roteamento é interno;
- mobile-first, botões com alvo de toque e sem tabela horizontal;
- a Home não substitui a carteira, a agenda ou o modo analítico: ela os prioriza.

## Critérios de aceite

- um usuário simples identifica a próxima ação sem abrir detalhes;
- voz funciona sem escolher motor ou etapa;
- nenhum estado técnico interno polui a tela;
- análise completa continua disponível;
- tenancy e confirmação de voz permanecem inalteradas.
