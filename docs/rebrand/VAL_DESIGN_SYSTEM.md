# VAL_DESIGN_SYSTEM

Sistema visual da VAL depois do rebrand — **Mescla 09 + identidade oficial**.

---

## 1. A decisão que define este documento

> **Marca nova. Paleta da VAL.**

A primeira tentativa deste rebrand rodou uma migração cromática sobre 3.156 literais de
cor, girando a matiz do produto inteiro do esmeralda da VAL para o oliva da folha da nova
logo. Tecnicamente funcionou — luminância preservada, contraste intacto. **Foi rejeitada.**

O motivo é o certo: a cor da VAL já era a VAL. Trocá-la porque a logo nova tem oliva
confundia dois problemas. A logo é o ativo que mudou; a paleta é patrimônio do produto.

Então:

- a **paleta permanece** a da VAL — verde profundo, esmeralda, menta, lima;
- a **marca** é a oficial — V marfim/floresta com folha oliva;
- o oliva vive **dentro da logo**, e só ali.

O script de migração cromática foi removido do repositório. Mantê-lo seria manter uma
ferramenta cuja única função é desfazer esta decisão.

---

## 2. Paleta

Definida em `src/val-brand.css`, inalterada pelo rebrand:

| Token | Valor | Papel |
|---|---|---|
| `--val-ink` | `#071b19` | superfície mais escura — sidebar, Copiloto |
| `--val-ink-soft` | `#0b2925` | elevação sobre o ink |
| `--val-forest` | `#0e3530` | verde profundo |
| `--val-emerald` | `#00c896` | destaque da marca |
| `--val-emerald-dark` | `#009f78` | ação primária |
| `--val-mint` | `#72e6c5` | acento sobre superfície escura |
| `--val-blue` | `#2d8cff` | acento secundário |
| `--val-lime` | `#c8f25e` | destaque pontual |
| `--val-canvas` | `#f4f8f6` | fundo geral |
| `--val-surface` | `#ffffff` | superfície |
| `--val-text` | `#10231f` | texto |
| `--val-muted` | `#6c7f78` | texto secundário |
| `--val-line` | `#dce8e4` | borda e divisor |

Cores semânticas seguem independentes da marca: alerta não é verde VAL, erro continua
reconhecível.

### Hierarquia de superfícies

```
FUNDO GERAL   --val-canvas   #f4f8f6
  SUPERFÍCIE  --val-surface  #ffffff
    CARD      borda --val-line + --shadow
      AÇÃO    --val-emerald-dark
```

A área de trabalho permanece clara. O verde profundo fica onde a Mescla 09 o coloca:
sidebar, faixa do Copiloto e superfícies institucionais.

---

## 3. Camadas de folha, na ordem de carga

`src/main.jsx`:

| # | Folha | Papel |
|---|---|---|
| 1 | `styles.css` | base monolítica herdada (286 KB) |
| 2 | `val-brand.css` | tokens da paleta e da marca oficial |
| 3–8 | `agro-workspace`, `mobile-browser`, `mobile-login`, `val-mobile-overflow`, `val-logo-final`, `presentation` | por feature |
| 9 | `copilot-ux.css` | Copiloto |
| 10 | `val-ui-simple-modern.css` | refinamento visual |
| 11 | **`val-workspace-shell.css`** | **Mescla 09** — sidebar hierárquica, cockpit da Home, Split View, barra mobile |

O shell entra por último porque precisa vencer o legado sem `!important`.

---

## 4. Componentes do shell

### Sidebar (`.val-workspace-sidebar`)

Marca com assinatura · Início · **Workspaces** · subnavegação do workspace ativo ·
**Configurações** · cartão do usuário · **Acessar Copiloto**.

Estados: `active` (pílula sólida esmeralda), `is-loaded` (workspace carregado enquanto o
usuário está no Início — marcado, não cheio), `is-collapsed` (só ícones, rótulo por
`title`).

### Cockpit da Home

| Bloco | Classe | Conteúdo |
|---|---|---|
| Saudação | título do `Topbar` | "Bom dia, {nome}! 👋" + "Aqui está o que preparamos para você hoje." |
| Resumo do dia | `.home-day-strip` | 4 cartões com ícone, rótulo, número e leitura |
| Linha operacional | `.home-operational` | Próximas visitas · Produtores em foco · Insights para você (`.home-insights`, de `/api/v1/insights`) |
| Copiloto | `.home-copilot-banner` | faixa escura com dois gestos: **Falar com a VAL** (`.is-voice`, abre o Copiloto já em modo conversa) e **Perguntar**. No celular sobe para o topo da Home |
| Ações rápidas | `.home-quick-actions` | 8 atalhos para funções que já existem |
| Segundo plano | `.val-disclosure` (`Disclosure.jsx`) | Números da carteira · Perguntar à VAL daqui · Carteira, radar e estúdio — nascem fechados e lembram a escolha por chave em `localStorage` |
| Coluna direita | `.home-rail` | Pendências e alertas · Atividades recentes |

**Regra de dois níveis, em qualquer tela.** O primeiro nível responde "o que faço agora"
e fica visível. O segundo nível é o que interessa às vezes e mora num `Disclosure`, que
é o mesmo componente no desktop e no celular — a rolagem encurta nos dois. Cartão dentro
do recolhível perde a moldura (`.val-disclosure .copilot-talk`, `.pipeline-roi`). O
Produtor 360 já seguia a regra com `client-drilldown`; Oportunidades passou a seguir com
o simulador de cenário.

### Mapa de satélite (`.val-map-shell`)

Leaflet sob demanda com tiles Esri World Imagery (mesma atribuição do Manual). Pino em
`divIcon` esmeralda, talhão em lima (`#c8f25e`, 18% de preenchimento), rota tracejada
esmeralda, rascunho de desenho em azul. Sem sede registrada o mapa abre no Brasil
inteiro — nunca num pino aproximado. Usado em `PropertyFields` (Produtor 360),
`RouteMap` (Visitas) e `PropertyPreview` (Preparar visita). CSP libera só
`https://server.arcgisonline.com` em `img-src`.

### Painel contextual (`.context-panel`)

Split View do Produtor 360: Timeline · Contexto · Copiloto. Sticky no desktop, empilhado
abaixo de 1180px.

### Barra mobile (`.mobile-nav`)

Cinco destinos: Início · Produtores · **+** · Copiloto · Mais.

---

## 5. Responsividade

| Largura | Comportamento |
|---|---|
| ≥ 1181 | 4 cartões de dia, 3 painéis operacionais, Split View em duas colunas, busca inline |
| 1081–1180 | painéis operacionais empilham; Split View vira seção |
| ≤ 1080 | busca inline vira ícone com painel |
| ≤ 900 | cartões de dia em 2 colunas |
| ≤ 760 | sidebar sai, barra inferior entra |
| ≤ 640 | faixa do Copiloto empilha; ações rápidas em coluna |

Overflow horizontal medido em 1920, 1440, 1366, 1280, 1024, 768, 430, 390 e 375:
**zero em todas**.

---

## 6. O que o rebrand **não** fez

- Não migrou a stack: Vite + React 18 + CSS puro.
- Não reescreveu `styles.css` (286 KB) — dívida registrada no R0.
- Não tocou em Knowledge Engine, Decision Engine, Memory Engine, roteamento de contexto,
  grounding, fronteira de produtor, prompts, roteamento de modelo, voz, banco ou APIs.
- Não alterou nenhuma rota.
- Não trocou a paleta.
