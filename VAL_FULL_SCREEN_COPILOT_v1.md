# VAL Full-Screen Copilot v1

## Objetivo

O VAL Full-Screen Copilot é a página principal de conversa, decisão e orquestração do ecossistema. Ele não substitui Clientes, Produtor 360, Visitas, Oportunidades, Inteligência Agronômica, Manual, Biblioteca, SOG, relatórios, Voice Capture ou ferramentas especializadas.

## Contrato de experiência

- Rota interna canônica: `copilot`.
- Entrada principal da sidebar: `VAL`.
- Atalhos da Home, Produtor 360, Visitas, Oportunidades e Agronomia abrem a mesma página completa.
- Desktop mantém a sidebar principal do produto; não cria uma segunda navegação fixa.
- Mobile ocupa `100dvh`, remove Topbar e navegação inferior enquanto a conversa está aberta.
- Estrutura: header mínimo, toolbar contextual, conversa central, composer fixo e painel contextual opcional.

## Princípio de produto

A superfície deve parecer um ambiente de trabalho inteligente, não um chatbot genérico. A resposta curta vem primeiro e pode ser seguida por cards, Decision Interview, evidências e ações de aprofundamento.

## Contexto de entrada

`resolveCopilotLaunch` permanece como fronteira de contexto. Ele aceita somente clientes presentes na carteira autenticada e invalida contexto quando tenant/owner ou página de origem não coincidem.

- Produtor 360 → produtor atual.
- Oportunidade → produtor + oportunidade.
- Visita → produtor + visita ou rascunho.
- Agronomia → ferramenta agronômica ativa.
- Entrada direta → conversa geral, sem produtor.

O objeto ativo recebe uma thread própria, mas não cria outra memória. ContextSnapshot e memórias confirmadas continuam pertencendo ao produtor e às políticas existentes.

## Estados centrais

- `ASK`: pergunta e raciocínio sem promoção de memória.
- `REGISTER`: captura, extração, revisão e confirmação antes de qualquer escrita.
- `FAST`: consulta determinística simples.
- `DEEP`: cruzamento de contexto, memória, conhecimento e capacidades.
- `NEEDS_INPUT`: Decision Interview com uma a três perguntas materiais.

## Coexistência com módulos

Cards usam drill-down de um clique. O resultado pode aparecer na conversa; quando a profundidade excede o contrato do Copilot, a ação abre o módulo original. Nenhuma rota ou ferramenta existente foi removida.

## Limites

- A IA solicita capacidades; o Orchestrator governa execução, autorização, tenant, safety e persistência.
- Current data exige fonte e data autorizadas.
- Foto/arquivo sem produtor permanece local até o usuário vincular uma conta ou abrir o fluxo headless da Inteligência Agronômica.
- Não há migration nesta evolução.
- Produção, `main` e Passo 07 ficam fora do escopo.

