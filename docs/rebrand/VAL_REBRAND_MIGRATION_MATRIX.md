# VAL_REBRAND_MIGRATION_MATRIX

Matriz de migração do rebrand. **Nenhuma linha pode terminar como `REMOVIDO`.**

Legenda: **PRESERVADO** = existe e funciona igual · **MELHORADO** = existe, funciona igual e ficou mais fácil de alcançar ou de ler.

---

## A. Módulos

| Recurso antigo | Local antigo | Local novo | Status | Testado |
|---|---|---|---|---|
| Hoje (`dashboard`) | Sidebar primário | Sidebar, item fixo acima dos workspaces + barra mobile | MELHORADO | ✅ `val-rebrand-home-command-center-v1` |
| Clientes (`clients`) | Sidebar primário | Workspace **Produtor** + barra mobile "Produtores" | PRESERVADO | ✅ `val-rebrand-workspace-shell-v1` |
| Cliente 360 (`client360`) | Sem entrada de menu | Workspace **Produtor** (contextual, por clique) + Split View | MELHORADO | ✅ `val-rebrand-split-view-v1` |
| Visitas (`visits`) | Sidebar primário | Workspace **Comercial** | PRESERVADO | ✅ |
| Oportunidades (`opportunities`) | Sidebar primário / sheet mobile | Workspace **Comercial** (mesmo lugar nos dois) | MELHORADO | ✅ |
| Copiloto VAL (`copilot`) | Sidebar primário | Cartão dedicado no rodapé da sidebar + barra mobile + painel contextual | MELHORADO | ✅ `val-full-screen-copilot` |
| Análise avançada (`val`) | `details` "Mais recursos" | Workspace **Inteligência** | MELHORADO | ✅ |
| Base Inteligente (`datahub`) | `details` "Mais recursos" | Workspace **Produtor** | MELHORADO | ✅ |
| Coletar preferências (`questionnaire`) | `details` "Mais recursos" | Workspace **Produtor** + ação rápida do "+" mobile | MELHORADO | ✅ |
| Inteligência Agronômica (`agro`) | Sidebar primário (promovida pelo usuário) | Workspace **Campo** | MELHORADO | ✅ `agro-large-workspace`, `agro-manual-parity` |
| Relatórios (`reports`) | `details` "Mais recursos" | Workspace **Gestão** | PRESERVADO | ✅ |
| Configurações (`settings`) | `details` "Mais recursos" | Workspace **Gestão** | PRESERVADO | ✅ |
| Administração (`admin`) | `details`, gate `role==='admin'` | Workspace **Gestão**, gate declarado no modelo | PRESERVADO | ✅ `ui-layout-contract` |
| Login | fora do shell | fora do shell, com marca oficial | MELHORADO | ✅ `val-brand-variants` |
| Troca de senha | fora do shell | igual | PRESERVADO | ✅ |
| Pesquisa pública (`?responder=`) | fora do shell | igual | PRESERVADO | ✅ |

**13 módulos antes → 13 módulos depois.** `assertModuleCoverage()` falha o build se algum ficar inalcançável.

---

## B. Ferramentas agronômicas (dentro do iframe `/tecnico`)

| Ferramenta | Antes | Depois | Status |
|---|---|---|---|
| Análises de solo | só dentro do iframe | idem + **encontrável na busca global** | MELHORADO |
| Propriedades e talhões | idem | idem + busca global | MELHORADO |
| Diagnóstico por foto | idem | idem + busca global | MELHORADO |
| Observações e registros | idem | idem + busca global | MELHORADO |
| **Calculadoras** | idem | idem + busca global | MELHORADO |
| Bulas e registros | idem | idem + busca global | MELHORADO |
| Mercado e commodities | idem | idem + busca global | MELHORADO |
| Clima e panorama | idem | idem + busca global | MELHORADO |
| Manual do Agrônomo | idem | idem + busca global | MELHORADO |
| Biblioteca e histórico | idem | idem + busca global | MELHORADO |

As dez saíram de dentro de `pages/Agro.jsx` para `lib/agro-tools.js` — mesmo registro, agora visível fora do iframe.

---

## C. Capacidades transversais

| Capacidade | Status | Observação |
|---|---|---|
| Voz — captura e ciclo de vida | PRESERVADO | nenhum arquivo de voz alterado |
| Voz — WebRTC em tempo real | PRESERVADO | idem |
| Voz — síntese e resposta em áudio | PRESERVADO | idem |
| Transcrição | PRESERVADO | idem |
| Memória de conversa | PRESERVADO | idem |
| Contexto de workspace | ESTENDIDO | `val-workspace-context` intacto; soma-se `val-workspaces` para navegação |
| **Fronteira de produtor ativo** | PRESERVADO E REFORÇADO | o painel contextual recebe só o escopo do produtor; a timeline filtra de novo na origem |
| Ações governadas da VAL | PRESERVADO | `validateValWorkspaceAction` intacto |
| Atalho Ctrl/Cmd+K | PRESERVADO | |
| Telemetria de uso | PRESERVADO | |
| Toast, skip link, foco | PRESERVADO | |
| Sessão: expiração e revalidação | PRESERVADO | |
| PWA / service worker | PRESERVADO | ícones e `theme_color` atualizados |
| Calculadoras agronômicas | PRESERVADO | contrato mobile virou teste |
| Perfil comportamental | MELHORADO | vira camada de ênfase no painel contextual; sem medição, a VAL diz que não mediu |
| Método VAL / SPIN / OPC | PRESERVADO | |

---

## D. O que mudou de comportamento (e por quê)

| Mudança | Antes | Depois | Motivo |
|---|---|---|---|
| Produtor em foco ao navegar | `navigate()` zerava `selected`; um efeito reativava o **primeiro da carteira** | a seleção explícita do usuário sobrevive | o contexto anterior não era mais seguro, era arbitrário — ninguém escolheu aquele produtor |
| Sidebar e MobileNav | duas listas independentes, já divergentes | um modelo único | a divergência já era um bug de produto |
| Busca do cabeçalho | ícone que navegava para `clients` | busca sobre carteira, agenda, funil, módulos e ferramentas | o ícone prometia busca e não buscava |
| Barra inferior mobile | 4 destinos | 5 destinos com "+" de criação | o prompt pede Início · Produtores · + · Copiloto · Mais |

Nada além disso mudou de comportamento. Engines, prompts, roteamento de modelo, banco, APIs e permissões seguem intactos.

---

## E. Fora de escopo, declarado

| Item | Situação |
|---|---|
| R6 — Preparar Visita redesenhado | **NÃO FEITO.** `PrepareVisitSimple` recebeu a nova paleta pela migração cromática, mas o fluxo em seis etapas não foi implementado |
| R8 — Conhecimento em Resumo/Diagnóstico/Evidências/Recomendação/Alternativas/Risco/Próxima ação | **NÃO FEITO.** A apresentação do conhecimento não foi reestruturada |
| R10 — refatoração das calculadoras | **PARCIAL.** Identidade migrada e contrato mobile travado por teste; a refatoração de apresentação não foi feita e não pôde ser validada em execução (`manual/node_modules` não instalado) |
| `src/styles.css` com 286 KB | dívida registrada no R0, não resolvida |
| Deep-link / histórico do navegador | não existe router; não foi introduzido |
| Publicação em staging | **NÃO FEITA** — depende de autorização e credenciais |
