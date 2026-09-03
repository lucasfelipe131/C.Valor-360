# VAL_FUNCTIONAL_INVENTORY_BEFORE_REBRAND

Inventário congelado do produto **antes** do rebrand.

**Regra que este documento existe para provar:** *existia antes → existe depois.*
Nenhuma linha pode terminar como `REMOVIDO` sem autorização explícita registrada aqui.

Coluna **Workspace destino** = agrupamento do Workspace Contextual Híbrido (R3).
A rota interna (`page`) **não muda** — o workspace é uma camada de navegação acima dela.

---

## A. Módulos de primeiro nível (estado `page` em `App.jsx`)

| # | `page` | Nome atual | Onde vive hoje | Workspace destino | Status |
|---|--------|-----------|----------------|-------------------|--------|
| 01 | `dashboard` | Hoje | Sidebar primário / MobileNav primário | **HOME** (transversal) | PRESERVADO |
| 02 | `clients` | Clientes | Sidebar primário / MobileNav primário | PRODUTOR | PRESERVADO |
| 03 | `client360` | Cliente 360 | Sem entrada de menu — só por clique | PRODUTOR | MELHORADO (vira Produtor 360 com Split View) |
| 04 | `visits` | Visitas | Sidebar primário / MobileNav "Mais" | COMERCIAL | PRESERVADO |
| 05 | `opportunities` | Oportunidades | Sidebar primário / MobileNav "Mais" | COMERCIAL | PRESERVADO |
| 06 | `copilot` | VAL Copilot | Sidebar primário / botão central mobile | Transversal (camada) | MELHORADO (contextual) |
| 07 | `val` | Análise avançada | `details` "Mais recursos" | INTELIGÊNCIA | MELHORADO (sai de trás do accordion) |
| 08 | `datahub` | Base Inteligente | `details` "Mais recursos" | PRODUTOR | MELHORADO |
| 09 | `questionnaire` | Coletar preferências / Produtor 360 | `details` "Mais recursos" | PRODUTOR | MELHORADO |
| 10 | `agro` | Ferramentas agronômicas | `details` "Mais recursos" | CAMPO | MELHORADO (promovido a workspace) |
| 11 | `reports` | Relatórios | `details` "Mais recursos" | GESTÃO | PRESERVADO |
| 12 | `settings` | Configurações | `details` "Mais recursos" | GESTÃO | PRESERVADO |
| 13 | `admin` | Administração (role=admin) | `details` "Mais recursos" | GESTÃO | PRESERVADO (permissão intacta) |

### Fora do shell autenticado

| # | Superfície | Gatilho | Status |
|---|-----------|---------|--------|
| 14 | `Login` | não autenticado | MELHORADO (marca oficial) |
| 15 | `PasswordChange` | `user.mustChangePassword` | PRESERVADO |
| 16 | `PublicSurvey` | `?responder=<token>` | PRESERVADO |
| 17 | `auth-loading` | validação de sessão | PRESERVADO |
| 18 | `SimplePage` | fallback | PRESERVADO |

---

## B. Ações por módulo

### 01 `dashboard` — Hoje
`Converse com a VAL` · `Perguntar` · `Abrir voz, foto ou arquivo` · `Abrir agenda` · `Abrir pipeline` ·
`Ver carteira, radar e números` · `Ver todas` · até 3 prioridades acionáveis · Atividades recentes ·
Oportunidades por etapa · `onRefreshPortfolio`
**Depende de:** `/api/intelligence`, `/api/usage/events` · **Status:** PRESERVADO → reorganizado como Command Center (R4)

### 02 `clients` — Clientes
Busca/filtro de carteira · `Limpar filtros` · cartão do produtor → abre `client360` · `onNew` → `questionnaire` ·
estado vazio "Nenhum produtor encontrado"
**Status:** PRESERVADO

### 03 `client360` — Cliente 360
`Voltar` · `Preparar visita` · `Perguntar à VAL` · "O que importa agora" · perfil comportamental ·
`ProducerBusinessOverview` · `ProducerFieldGallery` · `ProducerProfileEditor` · complemento técnico (`onSaved`) ·
`onUpdate` (PUT `/api/clients/:id`) · `onRefreshPortfolio`
**Status:** MELHORADO — header persistente do produtor, abas contextuais, painel direito (Timeline / Recomendações / Copiloto)

### 04 `visits` — Visitas
`Nova visita` / `Agendar visita` (produtor, data, hora, objetivo) · Agenda priorizada / rota ·
`Preparar com a VAL` · `Iniciar visita` · `Me conte como foi` (VoiceCapture POST_VISIT) ·
`Registrar observação rápida` (VoiceCapture FIELD_NOTE) · `Perguntar à VAL sobre esta visita` ·
`Abrir análise avançada` · registro legado texto/áudio → `Organizar relato` → revisão item a item →
`Confirmar visita` · compromissos propostos · próximo passo/prazo · `Nenhuma ação necessária` · outcome (8 valores)
**Ciclo de vida:** PLANNED · PREPARED · IN_PROGRESS · COMPLETED_PENDING_REVIEW · COMPLETED · CANCELLED
**Status:** PRESERVADO integralmente (R6 redesenha a apresentação, não o comportamento)

### 05 `opportunities` — Oportunidades
Fluxo/pipeline por etapa · `Simulador de cenário financeiro` · `Perguntar à VAL` · `onPersist` (POST `/api/opportunities`) ·
`onClient` · estados "Carteira em dia" / "Nenhuma oportunidade"
**Status:** PRESERVADO

### 06 `copilot` — VAL Copilot (`GlobalValCopilot`)
Chat · full screen · painel contextual (`ValContextualPanel`) · `DecisionCards` · `DecisionInterviewCard` ·
`EphemeralSpeechButton` · `ValAudioResponse` · `ValRealtimeConversation` (WebRTC) · `ValProgressFeedback` ·
composer multimodal (texto/voz/foto/arquivo) · seed de contexto (`resolveCopilotLaunch`) ·
`workspaceContext` · ações de workspace governadas (`validateValWorkspaceAction`) · atalho **Ctrl/Cmd+K**
**Status:** MELHORADO — mesma engine, superfícies contextualizadas (R7)

### 07 `val` — Análise avançada (`ValWorkspace`)
Modos `insumos` / `graos` · `ValDecisionWorkspace` · `ValueScenarioPanel` · `ConversionRadar` ·
`ConversionOpportunityStudio` · `CommitmentLadderPanel` · `ObjectionEvidencePanel` ·
`MessageCalibrationPanel` · `MultiDecisionMapPanel` · `PostConversionExpansionPanel` · `SogWorkspace`
**Status:** PRESERVADO

### 08 `datahub` — Base Inteligente
`Escolher planilha` (drag & drop) · mapeamento de colunas · `Importar outra base` · `Editar` · `Cancelar` ·
"O que a VAL registrou" · produtores deste login · `onUpdate` · `onDelete` · `QuestionnaireImport` · `smart-import`
**Depende de:** `/api/producer-import`, `/api/import/google-sheet`, `/api/intelligence/imports`
**Status:** PRESERVADO

### 09 `questionnaire` — Coletar preferências / Produtor 360
`Criar link inteligente` · `Copiar link` · `Enviar pelo WhatsApp` · `Importar arquivo` · `Importar respostas` ·
`Aplicação assistida` (`SurveyForm`) · Central de respostas · `Ver perfil` · `Atualizar`
**Depende de:** `/api/surveys`, `/api/surveys/invitations`, `/api/clients/from-survey[/batch]`
**Status:** PRESERVADO

### 10 `agro` — Inteligência Agronômica (`iframe` → app `manual/`)
**Hero (4 gestos):** `Falar com a VAL` · `Digitar / perguntar` · `Foto` · `Arquivo` — com `Parar e enviar`, `Cancelar`, `Enviar`
**Grupos e ferramentas do navegador técnico:**

| Grupo | Ferramenta | `id` |
|---|---|---|
| CAMPO E SOLO | Análises de solo | `solo` |
| CAMPO E SOLO | Propriedades e talhões (mapas, safras) | `produtores` |
| DIAGNÓSTICO | Diagnóstico por foto (nutrição, doenças, insetos, daninhas) | `diagnostico` |
| DIAGNÓSTICO | Observações e registros | `observacoes` |
| DECISÃO TÉCNICA | **Calculadoras** (semeadura, aplicação, fertilidade, reposição, custos) | `calculadoras` |
| DECISÃO TÉCNICA | Bulas e registros | `bulas` |
| CONTEXTO | Mercado e commodities | `mercado` |
| CONTEXTO | Clima e panorama | `clima` |
| CONHECIMENTO | Manual do Agrônomo | `manual` |
| CONHECIMENTO | Biblioteca e histórico | `biblioteca` |

Contexto transportado: produtor · propriedade · talhão · análise · telemetria `agro_hero_interaction`
**Depende de:** `/api/agro`, `/api/soil-analysis`, `/api/diagnosis`, `/api/geospatial`, `/api/zarc`, `/api/weather`, `/api/municipalities`, `/tecnico`
**Status:** PRESERVADO — `iframe` e contrato de contexto intactos; R9/R10 tratam moldura e calculadoras

### 11 `reports` — Relatórios
`Exportar PDF` · `Imprimir` · "O que medir até novembro" · preferências autodeclaradas · NPS · IRT · execução comercial
**Status:** PRESERVADO

### 12 `settings` — Configurações
`Encerrar sessão` · `Baixar backup JSON` · `Limpar dados locais` · Acesso atual · Governança da VAL ·
Dados da operação · Portabilidade e controle · diagnóstico do ambiente
**Status:** PRESERVADO

### 13 `admin` — Administração (role=admin)
`AccessManagement` · usuários · reset de senha · uso e métricas globais
**Depende de:** `/api/access`, `/api/admin/users`, `/api/admin/usage`, `/api/admin/metrics`, `/api/portfolio-admin/*`
**Status:** PRESERVADO — gate `currentUser?.role==='admin'` inalterado

---

## C. Capacidades transversais

| # | Capacidade | Implementação | Status |
|---|-----------|---------------|--------|
| C1 | Voz — captura e ciclo de vida | `VoiceCapture`, `useVoiceRecorder`, `/api/v1/voice-interactions` | PRESERVADO |
| C2 | Voz — conversa em tempo real (WebRTC) | `useNaturalRealtimeVoice`, `realtime-webrtc.js`, `/api/v1/realtime-voice` | PRESERVADO |
| C3 | Voz — síntese / resposta em áudio | `useSpeechSynthesis`, `ValAudioResponse` | PRESERVADO |
| C4 | Transcrição | `/api/val/voice/transcribe` | PRESERVADO |
| C5 | Memória de conversa | `copilot-session-storage`, `conversation-thread-context` | PRESERVADO |
| C6 | Contexto de workspace | `val-workspace-context.js` + `createValWorkspaceContext` | ESTENDIDO |
| C7 | Fronteira de produtor ativo | `resolveCopilotLaunch`, `tenant-scope`, `storageScope` | PRESERVADO (gate R11) |
| C8 | Ações governadas da VAL | `validateValWorkspaceAction` → DENIED / CONFIRM_REQUIRED / COMPLETED | PRESERVADO |
| C9 | Atalho de teclado | **Ctrl/Cmd + K** abre o Copiloto | PRESERVADO |
| C10 | Telemetria de uso | `/api/usage/events` por página e entidade | PRESERVADO |
| C11 | Toast / notificações | `notify()` em `App.jsx` | PRESERVADO |
| C12 | Skip link + foco | `.skip-link` → `#main-content`, `resetPageViewport` | PRESERVADO |
| C13 | Sessão: expiração, revalidação em foco e a cada 5 min | `App.jsx` `useEffect` | PRESERVADO |
| C14 | Limpeza de cache por escopo | `clearSessionPortfolioCache` | PRESERVADO |
| C15 | PWA / service worker | `public/sw.js`, `manifest.webmanifest` | PRESERVADO (ícones trocam no R1) |
| C16 | Calculadoras agronômicas | `src/lib/agronomic-calculators.js` + app `manual/` | PRESERVADO (UX mobile no R10) |
| C17 | Planejamento agronômico | `src/lib/agronomic-planning.js` | PRESERVADO |
| C18 | Perfil comportamental | `src/data/profile-matrix.json`, `lib/profile.js` | PRESERVADO |
| C19 | Método VAL / SPIN / OPC | `val-method-application.js`, `server/val-methodology.js` | PRESERVADO |
| C20 | Importação inteligente | `smart-import.js`, `profile-import.js` | PRESERVADO |

---

## D. Componentes compartilhados existentes

`Sidebar` · `MobileNav` · `Topbar` · `Logo` · `KpiCard` · `CurrencyInput` · `ValPanel` · `ValWorkspace` ·
`ValDecisionWorkspace` · `GlobalValCopilot` · `ValContextualPanel` · `ValProgressFeedback` ·
`DecisionCards` · `DecisionInterviewCard` · `EphemeralSpeechButton` · `ValAudioResponse` ·
`ValRealtimeConversation` · `VoiceCapture` · `PrepareVisitSimple` · `ProducerBusinessOverview` ·
`ProducerFieldGallery` · `ProducerProfileEditor` · `QuestionnaireImport` · `SurveyForm` ·
`AccessManagement` · `CommitmentLadderPanel` · `ConversionOpportunityStudio` · `ConversionRadar` ·
`MessageCalibrationPanel` · `MultiDecisionMapPanel` · `ObjectionEvidencePanel` ·
`PostConversionExpansionPanel` · `ValueScenarioPanel` · `SogWorkspace`

**Todos preservados.** O R2/R3 adiciona componentes novos; não substitui os existentes.

---

## E. Mapa Workspace → conteúdo (destino R3)

| Workspace | Módulos |
|---|---|
| **COMERCIAL** | `visits` · `opportunities` · preparar visita · pipeline · compromissos |
| **PRODUTOR** | `clients` · `client360` · `questionnaire` · `datahub` |
| **INTELIGÊNCIA** | `copilot` · `val` (análise avançada) · conhecimento · mercado |
| **CAMPO** | `agro` (mapas, solo, diagnóstico, calculadoras, bulas, clima, Manual) |
| **GESTÃO** | `reports` · `settings` · `admin` |
| **Transversal** | `dashboard` (Home) · Copiloto · busca · perfil · notificações |

**13 módulos antes → 13 módulos depois.** Nenhum órfão.
