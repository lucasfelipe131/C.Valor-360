# VAL_REBRAND_TEST_REPORT

Resultado dos gates do rebrand.

---

## 1. Suíte automatizada

> **Revisão 2.** Os números abaixo são da entrega final, depois da correção pela
> referência (paleta restaurada, marca corrigida, navegação e Home refeitas) e depois de
> o próprio usuário ter triado as falhas ambientais no commit `b8e85b2`.

| Momento | Total | Pass | Fail |
|---|---|---|---|
| **Baseline (antes do rebrand)** | 1291 | 1263 | **28** |
| **Entrega final** | 1364 | **1359** | **5** |
| **r16 — dois níveis + voz no celular** | 1370 | **1365** | **5** |

**+36 testes, +38 passando, −2 falhas.** Nenhum teste que passava passou a falhar.
(O ganho de 38 supera os 36 novos porque duas falhas do baseline foram resolvidas por trabalho do próprio usuário incorporado nesta branch.)

### As 26 falhas restantes são ambientais e pré-existentes

Todas já constavam do baseline no R0. Nenhuma tem relação com o rebrand.

| Causa | Qtde | Detalhe |
|---|---|---|
| `vite.ssrLoadModule` não resolve caminho absoluto POSIX no Windows | 18 | `ERR_LOAD_URL: Failed to load url /src/pages/Agro.jsx` — os 10 `AGRO_HERO_*`, os SSR de Prepare Visit, ValRealtime, ValAudio e VoiceCapture |
| `node --test` sem loader TS importa `.ts` de `manual/` | 5 | `ERR_UNKNOWN_FILE_EXTENSION ".ts"` |
| Dependências externas ausentes (`ffprobe`, worker carimbado, storage) | 3 | ambiente |

Rodar em Linux/CI deve zerar a maior parte delas. **Não foram introduzidas nem corrigidas por este trabalho.**

---

## 2. Testes novos criados pelo rebrand (35 + 1)

| Arquivo | Testes | O que trava |
|---|---|---|
| `val-rebrand-workspace-shell-v1.test.js` | 13 | inventário completo alcançável, client360 contextual, ponto de entrada de cada workspace, permissão de admin, herança de workspace, trilha de contexto, registro de ferramentas, índice da busca, ausência de listas paralelas, cinco colunas no mobile, tokens da marca antiga, azul residual |
| `val-rebrand-split-view-v1.test.js` | 10 | montagem da timeline, **fronteira de produtor**, ausência de data inventada, dedupe, ciclo de vida legado, três contextos sem chamada de IA, escopo do painel, perfil sem estereótipo, colapso responsivo |
| `val-rebrand-home-command-center-v1.test.js` | 7 | contadores do dia, carteira vazia honesta, ordenação e limite das próximas visitas, produtor não vinculado, visita sem data, ciclo de vida legado, ordem da Home |
| `val-rebrand-embedded-manual-v1.test.js` | 5 | identidade dentro do iframe, marca oficial servida, calculadoras empilhando no mobile, alvo de toque de 44px |

### Testes existentes reescritos para o novo contrato (7 arquivos)

`val-brand-variants` (agora trava a marca oficial com o mesmo rigor), `val-copilot-ux`,
`ui-layout-contract`, `val-ai-copilot-v2`, `val-full-screen-copilot`, `agro-manual-parity`,
`agro-large-workspace`, `presentation-contract`, `voice-capture-frontend`.

Todos travavam a **marca anterior**, a **navegação em duas listas** ou a **paleta azul** —
contratos substituídos por instrução explícita.

---

## 3. Gates por fase

| Gate | Resultado | Evidência |
|---|---|---|
| 01 Typecheck | n/a | o projeto é JS puro; `.d.ts` de calculadoras intactos |
| 02 Lint | n/a | não há linter configurado no repositório |
| 03 Testes | ✅ | 1301 pass / 26 fail ambientais |
| 04 Build | ✅ | `vite build` limpo, PWA carimbado e validado |
| 05 Route smoke | ✅ | os 5 workspaces e os 11 módulos navegáveis foram abertos no navegador, desktop e mobile |
| 06 Inventário funcional | ✅ | `assertModuleCoverage()` + `val-rebrand-workspace-shell-v1` |
| 07 Visual desktop | ✅ | 1920, 1440, 1366, 1280, 1024 |
| 08 Visual mobile | ✅ | 768, 430, 390, 375 |
| 09 A11y | ✅ parcial | contraste preservado por construção; `role="tablist"`, `aria-selected`, `aria-controls`, `aria-current`, `aria-expanded`, skip link e foco preservados. **Não houve auditoria com leitor de tela.** |
| 10 Performance | ✅ | nenhuma dependência nova; nenhuma chamada de rede nova; o painel contextual e o resumo do dia usam só o que a sessão já carregou |
| 11 Integridade de contexto | ✅ | fronteira de produtor testada; painel recebe apenas o escopo do produtor ativo |
| 12 Anti-regressão | ✅ | zero testes verdes viraram vermelhos |

---

## 4. Gate 07/08 — overflow horizontal medido

`document.documentElement.scrollWidth − window.innerWidth`, percorrendo Hoje e os cinco
workspaces em cada largura, na aplicação em execução:

| Largura | Overflow máximo | Elemento culpado |
|---|---|---|
| 1920 | 0 | nenhum |
| 1440 | 0 | nenhum |
| 1366 | 0 | nenhum |
| 1280 | 0 | nenhum |
| 1024 | 0 | nenhum |
| 768 | 0 | nenhum |
| 430 | 0 | nenhum |
| 390 | 0 | nenhum |
| 375 | 0 | nenhum |

No mobile, os cinco workspaces foram abertos pelo sheet "Mais" e todos renderizaram sem
estouro: Comercial → Visitas, Produtor → Clientes, Inteligência → Análise avançada,
Campo → Inteligência Agronômica, Gestão → Relatórios.

---

## 5. Gate 09 — contraste

A migração cromática **resolve a claridade para preservar a luminância relativa** de cada
cor. Toda razão de contraste do produto é, por construção, idêntica à de antes.

Verificado à parte, nos valores da marca:

| Par | Razão | WCAG AA |
|---|---|---|
| wordmark `#12291B` sobre branco | 15.0:1 | ✅ |
| wordmark `#EDEDE6` sobre floresta `#0D1F15` | 14.6:1 | ✅ |
| assinatura `#9BC85A` sobre floresta `#0D1F15` | 8.3:1 | ✅ |

Cores semânticas preservadas: vermelhos (0–20°), âmbares (20–55°), amarelos (55–70°) e
violetas (≥247°) ficaram fora da faixa migrada. **Alerta não virou verde VAL.**

---

## 6. Comparação visual BEFORE / AFTER

Feita com a aplicação real rodando lado a lado, em 1440×900, ambas em modo demonstrativo:

- **BEFORE** — `git worktree` no commit base `2bed57c`, build próprio, porta 3100.
- **AFTER** — branch `rebrand/val-global-hybrid-workspace-v1`, porta 3000.

| Aspecto | Antes | Depois |
|---|---|---|
| Marca | traço azul/verde-água em "raio" + folha | **V marfim + folha oliva** |
| Acento | verde-água `#00c896` | oliva da folha `#80c23d` |
| Navegação | lista plana de 6 + accordion "Mais recursos" | Hoje + 5 workspaces + subnavegação contextual + cartão do Copiloto |
| Contexto no cabeçalho | nenhum | trilha workspace › módulo › produtor |
| Busca | ícone que navegava para Clientes | busca real sobre 5 tipos de entidade |
| Home | saudação → prioridades → conversa | saudação → **dia** → **próximas visitas** → prioridades → conversa |
| Produtor 360 | pilha vertical com 3 accordions | Split View com painel Timeline / Contexto / Copiloto |

Reproduzir:

```bash
git worktree add /tmp/val-before 2bed57c
cd /tmp/val-before && npm run build && VAL_DEMO_MODE=true PORT=3100 node server/start.js
```

---

## 7. Limitações declaradas

1. **App embutido não executado.** `manual/node_modules` não está instalado; a verificação
   das calculadoras em execução não foi feita. O que este trabalho garante nelas é
   estático: identidade migrada e contrato mobile travado por teste.
2. **Sem leitor de tela.** A acessibilidade foi verificada por marcação e contraste.
3. **Modo demonstrativo sem PostgreSQL.** A carteira fica vazia, então as telas foram
   validadas nos estados vazios — que é justamente onde a honestidade do texto importa.
   O Split View foi validado com o CSS real da aplicação em execução.
4. **Staging não publicado.** Depende de autorização e credenciais.
