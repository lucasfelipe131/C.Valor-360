# VAL_REBRAND_R0_AUDIT

Auditoria executada antes de qualquer alteração visual.
Fase: **R0 — AUDITORIA**. Nenhum código de produto foi modificado até a conclusão deste documento.

---

## 1. Ambiente e Git

| Item | Valor |
|------|-------|
| Repositório | `lucasfelipe131/C.Valor-360` |
| Branch base (HEAD aprovado) | `content/val-knowledge-library-expansion-v1` |
| SHA base registrado | `be77a9fd484c4151aefc88cab75858df2ad39f86` |
| Branch de rebrand criada | `feature/val-global-rebrand-hybrid-workspace-v1` |
| `main` | **não tocada** |
| Branches congeladas | não tocadas |

### Trabalho pré-existente no working tree (NÃO pertence ao rebrand)

Havia alteração não commitada herdada da sessão anterior. Ela foi **preservada intacta**
e não entra em nenhum commit do rebrand:

- `server/decision-copilot/global-intent-router.js` — `PREPARE` passa a exigir verbo de abertura
- `src/pages/Visits.jsx` — pós-visita liberada em `PLANNED`/`PREPARED`
- `test/val-global-intent-workspace-v1.test.js` — cobertura do item acima

> Regra operacional desta branch: todo `git add` é feito por caminho explícito.

---

## 2. Stack real (não migrar)

| Camada | Tecnologia |
|--------|-----------|
| Build | Vite 5.4.19 |
| UI | React 18.3.1 — **sem router**; navegação por estado `page` em `App.jsx` |
| Ícones | `lucide-react` 0.468.0 |
| Tipografia | `@fontsource-variable/manrope` |
| Estilo | **CSS puro**, 25 arquivos em `src/*.css`. Sem Tailwind, sem CSS-in-JS, sem lib de componentes |
| Servidor | Node 20+, `server.js` (HTTP nativo) + módulos em `server/` |
| Banco | PostgreSQL (`pg`), migrations em `server/migrate.js` |
| IA | `openai` 7.4.0 |
| Sub-app | `manual/` — aplicação **Next.js separada**, embutida via `iframe` em `/tecnico?embedded=1` |
| PWA | `public/manifest.webmanifest` + `public/sw.js`, carimbado por `scripts/pwa-release.mjs` |

**Decisão:** a stack permanece. O rebrand acontece dentro do CSS + React que já existem.

---

## 3. Navegação atual (o que existe hoje)

Não há react-router. `App.jsx` mantém `page` em estado e renderiza condicionalmente.

### Sidebar desktop (`src/components/Sidebar.jsx`)

- **Primário (6):** `dashboard` (Hoje), `clients` (Clientes), `visits` (Visitas), `opportunities` (Oportunidades), `agro` (Inteligência Agronômica), `copilot` (VAL)
- **Secundário, escondido dentro de um `details` chamado "Mais recursos" (5+1):** `val` (Análise avançada), `datahub` (Base Inteligente), `questionnaire` (Coletar preferências), `reports` (Relatórios), `settings` (Configurações), `admin` (só role=admin)

> Estado medido após o merge de `origin/content/val-knowledge-library-expansion-v1`, que
> promoveu a Inteligência Agronômica ao primário no desktop e ao topo do sheet no mobile.

### Mobile (`src/components/MobileNav.jsx`)

- **Barra (4):** `dashboard`, `clients`, botão VAL, botão "Mais"
- **Sheet "Mais" (7+1):** `agro`, `opportunities`, `val`, `datahub`, `questionnaire`, `reports`, `settings`, `admin`

### Páginas alcançáveis mas ausentes da navegação

- `client360` — só por clique num produtor
- `login`, `password-change`, `public-survey` (`?responder=<token>`) — fora do shell

### Dívida de UX identificada

1. **Hierarquia plana e enganosa.** 6 dos 12 módulos vivem atrás de um `details` chamado "Mais recursos", entre eles a Base Inteligente e a Análise avançada. A Inteligência Agronômica — que concentra mapas, calculadoras, diagnóstico por foto e o Manual inteiro — acabou de ser promovida ao primário justamente porque a hierarquia não a acomodava.
2. **Sem noção de contexto.** A navegação sabe a *página*, não o *contexto de trabalho*. Sair de `client360` para `agro` perde o produtor, salvo o caminho herdado explícito dentro de `navigate()`.
3. **Mobile diverge do desktop.** `opportunities` é primário no desktop e secundário no mobile. As duas listas são independentes e já divergiram.
4. **Sem painel contextual.** Timeline, recomendações e Copiloto exigem troca de tela.
5. **Sem breadcrumb / contexto persistente** no `Topbar`.
6. **Sem busca global.** O `Topbar` não tem campo de busca.

---

## 4. Superfície de API (preservar integralmente)

`server.js` roteia por `pathname`. Rotas observadas:

**Auth/sessão:** `/api/auth/login`, `/api/auth/logout`, `/api/auth/password`, `/api/auth/session`

**Carteira:** `/api/intelligence`, `/api/intelligence/imports`, `/api/clients/:id`, `/api/clients/from-survey`, `/api/clients/from-survey/batch`, `/api/producer-import`, `/api/import/google-sheet`

**Operação:** `/api/visits`, `/api/v1/visits/`, `/api/opportunities`, `/api/v1/commitments`, `/api/v1/outcomes`, `/api/v1/action-plans`, `/api/v1/insights`

**VAL/IA:** `/api/val/chat`, `/api/val/status`, `/api/val/progress`, `/api/val/recommendations`, `/api/v1/val/recommendations`, `/api/val/feedback`, `/api/val/attachments`, `/api/val/latency-metrics`

**Voz:** `/api/val/voice/transcribe`, `/api/v1/voice-interactions`, `/api/v1/realtime-voice`, `/api/v1/realtime-voice/sessions`, `/api/v1/realtime-voice/budget`

**Agro/técnico:** `/api/agro`, `/api/technical/bootstrap`, `/api/soil-analysis`, `/api/diagnosis`, `/api/geospatial`, `/api/zarc`, `/api/weather`, `/api/municipalities`, `/api/records`, `/api/workspace`, `/api/profile`

**Grãos:** `/api/grains/bootstrap`, `/api/grains/market`, `/api/grains/profiles`, `/api/grains/intents`

**Pesquisa:** `/api/surveys`, `/api/surveys/invitations`

**Gestão:** `/api/access`, `/api/admin/users`, `/api/admin/usage`, `/api/admin/metrics`, `/api/portfolio-admin/users`, `/api/portfolio-admin/users/reset-password`, `/api/usage/events`, `/api/feedback`, `/api/release`

**Integrações:** `/api/integrations/manual/events`, `/api/v1/integrations/manual/events`, `/api/integrations/valor360/sync`

**Saúde:** `/live`, `/ready`, `/health`

**O rebrand não altera nenhuma dessas rotas.**

---

## 5. Design System existente

**Não existe.** O que existe é:

- `src/val-brand.css` — a única camada de tokens real (`--val-ink`, `--val-forest`, `--val-emerald`, `--val-blue`, `--val-canvas`, `--val-line`…), os tokens da logo atual e aliases legados (`--navy`, `--blue`, `--bg`, `--card`, `--line`).
- `src/styles.css` — **286 KB**, folha monolítica com quase toda a aparência do produto.
- Mais 23 folhas por feature (`copilot-ux.css`, `agro-workspace.css`, `presentation.css`, …).

### O problema central, medido

| Métrica (todos os `src/*.css`) | Valor |
|---|---|
| Cores hex distintas | **2.525** |
| Ocorrências de hex | ~5.000 |
| Ocorrências de `var(--token)` | **131** |
| Cor mais frequente depois de `#fff` | `#0b67d8` — **azul**, 115 ocorrências |
| `rgba()` distintos | 340 |

Conclusão: **a camada de tokens existe mas quase não é usada.** O produto é visualmente
*azul corporativo* codificado à mão, não a VAL verde da marca. Trocar apenas os tokens
não muda a aparência — mudaria 131 declarações de ~5.000.

**Consequência para o plano:** o R2 precisa de uma migração cromática determinística sobre
os literais hex/rgb, não de uma troca de variáveis. Método em `VAL_DESIGN_SYSTEM.md`.

---

## 6. Logo atual vs. logo oficial

| | Atual (no código) | Oficial (ativo aprovado) |
|---|---|---|
| Símbolo | Traço azul em "raio"/check + folha verde-água | **V** prateado + **folha** verde |
| Paleta | Azul `#2d8cff → #0757b6`, verde-água `#00c896` | Verde floresta escuro, verde/oliva da folha, marfim |
| Wordmark | "VAL" azul-marinho `#082c57`, com acento verde-água no "A" | "VAL" marfim, geométrico, sem acento colorido |
| Assinatura | "INTELIGÊNCIA QUE GERA VALOR" | "INTELIGÊNCIA QUE GERA VALOR" (mantida) |

Arquivos que carregam a marca antiga e precisam migrar:

- `src/components/Logo.jsx` (geometria SVG inline)
- `src/val-brand.css` (tokens `--val-logo-*`)
- `src/val-logo-final.css`
- `logo.svg` (raiz)
- `public/icon.svg`, `public/val-logo.svg`
- `public/brand/*.svg` (9 variantes)
- `public/manifest.webmanifest`, `index.html` (`theme-color`, `mask-icon`)

---

## 7. Testes — baseline registrada

```
npm test  ->  1291 tests | 1263 pass | 28 fail
```

As 28 falhas são **pré-existentes e ambientais (Windows)**, não regressões:

| Causa | Testes | Detalhe |
|---|---|---|
| `vite.ssrLoadModule` não resolve caminho absoluto POSIX no Windows | 20 (agro-hero, prepare-visit SSR, ValRealtime SSR, ValAudio SSR, VoiceCapture SSR…) | `ERR_LOAD_URL: Failed to load url /src/pages/Agro.jsx` |
| `node --test` sem loader TS importa `.ts` de `manual/` | 5 (`manual-*.test.js`, `agronomy-planning`) | `ERR_UNKNOWN_FILE_EXTENSION ".ts"` |
| Dependências externas ausentes (`ffprobe`, service worker carimbado) | 3 | ambiente |

**Contrato anti-regressão desta branch: `fail` não pode passar de 28, e nenhum teste hoje verde pode ficar vermelho.**

---

## 8. Dívida técnica registrada (não corrigida aqui)

1. `app.js` e `styles.css` **na raiz** são um protótipo estático legado (dados fictícios "João da Silva", `document.querySelector`). `index.html` **não os carrega**. São código morto — mantidos por ora, apenas sinalizados.
2. `src/styles.css` com 286 KB é um único ponto de acoplamento visual de todo o produto.
3. `Sidebar.jsx` e `MobileNav.jsx` duplicam a definição de navegação em duas listas independentes.
4. Ausência de router: deep-link e histórico do navegador não existem.

---

## 9. Ordem de execução aprovada

| Fase | Escopo | Gate |
|---|---|---|
| R0 | Auditoria + inventário funcional | este documento |
| R1 | Marca oficial (SVG, variantes, favicon, manifest, tokens de logo) | identidade |
| R2 | Design System: tokens + migração cromática determinística | contraste + anti-regressão |
| R3 | App Shell: WorkspaceSidebar, GlobalHeader, ContextPanel, MobileBottomNav | inventário funcional |
| R4 | Home Command Center | dados reais |
| R5 | Produtor 360 + Split View | integridade de contexto |
| R6–R11 | Preparar Visita, Copiloto, Conhecimento, Mapas, Calculadoras, restante | por módulo |
