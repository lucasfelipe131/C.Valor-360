# VAL Agronomic Workspace v2

> **Status da entrega:** arquitetura candidata em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Objetivo

Inteligência Agronômica permanece uma página própria da VAL e um conjunto de capacidades técnicas reutilizáveis pelo Copilot. Ela não é removida, escondida no chat nem apresentada como outro produto.

## Arquitetura de informação

```text
Inteligência Agronômica
├── Campo e solo
│   ├── análises de solo
│   ├── propriedades e talhões
│   └── culturas e histórico
├── Diagnóstico
│   ├── foto
│   └── observações e registros
├── Decisão técnica
│   ├── calculadoras
│   ├── bulas
│   └── fontes e evidências
├── Contexto
│   ├── clima
│   ├── mercado e commodities
│   └── notícias relevantes
└── Conhecimento
    ├── Manual do Agrônomo
    └── Biblioteca VAL
```

O topo oferece perguntar, falar, foto e documento. Cards funcionais abrem diretamente a capacidade correspondente.

## Shell e modo headless

O shell principal da VAL é dono de:

- navegação global;
- topbar;
- contexto do produtor;
- abertura do Copilot;
- layout desktop/mobile.

O Manual permanece como fonte e implementação técnica, mas seu modo incorporado deve ser headless: sem marca concorrente e sem sidebar global paralela.

O protocolo same-origin usa:

- rota `/tecnico?embedded=1&page=<PageKey>` para abrir uma capacidade;
- mensagem `valor360:navigate` para navegação controlada entre shell e conteúdo técnico;
- identidade assinada e sessão herdada do VALOR 360.

Mensagens desconhecidas, origem diferente ou page key não permitida são ignoradas.

## Preservação funcional

Devem continuar acessíveis:

- solo e amostras;
- propriedades/talhões/mapas;
- diagnóstico por imagem;
- calculadoras;
- bulas/Agrofit;
- clima/ZARC;
- mercado/notícias;
- relatórios e arquivo;
- conteúdos técnicos do Manual.

Redesenhar acesso não autoriza retirar ferramentas ou reduzir safety.

## Relação com o Copilot

O Copilot planeja capacidades por `System Capability Router`. O workspace continua sendo o local de exploração, conferência, edição e profundidade.

No resultado auditável, capacidade agronômica selecionada aparece em `capabilities_planned`; somente adapter realmente executado e usado aparece em `capabilities_used`, acompanhado por `capability_results`. Um card ou deep link disponível não comprova que a fonte foi consultada naquela resposta.

Exemplos:

- “O que vê nesta análise?” usa `SOIL_ANALYSIS`, mas “Ver análise completa” abre Campo e solo.
- “Confira a bula” usa `LABELS`/Manual, mas o usuário pode abrir Bulas diretamente.
- “Como está o mercado?” consulta a referência autorizada, mas Mercado continua navegável; fonte e data/hora precisam aparecer no texto e na saída falável.

## Governança agronômica

- análise extraída não é automaticamente confirmada;
- dados vinculados só entram no produtor quando o vínculo é explícito;
- interpretação depende de método, unidade, profundidade, cultura e revisão;
- diagnóstico não autoriza dose, mistura ou aplicação;
- fonte técnica de alto risco exige revisão humana;
- provenance deve sobreviver à navegação headless.

## Layout

Desktop mantém grid funcional e pode abrir conteúdo técnico no mesmo shell. Mobile evita iframe com largura própria, sidebar dupla e navegação duplicada; a barra principal da VAL permanece a referência.

## Evidência de aprovação

- nenhuma função anterior removida;
- página organizada por função;
- ausência de sidebar paralela no modo incorporado;
- deep link abre a capacidade correta;
- back/forward e foco funcionam;
- sessão/tenant permanecem protegidos;
- desktop e mobile autenticados;
- builds principal e Manual passam.

Até essa evidência existir em staging, “workspace nativo” é direção arquitetural, não afirmação de gate aprovado.
