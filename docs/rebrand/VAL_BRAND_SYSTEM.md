# VAL_BRAND_SYSTEM

Sistema de marca da VAL. Fase **R1 — BRAND FOUNDATION**.

---

## 1. A marca é congelada

A identidade oficial da VAL é o **V em marfim/floresta com a folha em verde-oliva**,
o wordmark **VAL** e a assinatura **INTELIGÊNCIA QUE GERA VALOR**.

Não redesenhar. Não reinterpretar. Não simplificar. Não substituir.
Não gerar outra logo. Não alterar o símbolo, o wordmark ou a relação entre eles.

---

## 2. Fonte de verdade única

A geometria vive em **dois lugares que precisam concordar**:

| Arquivo | Papel |
|---|---|
| `src/components/Logo.jsx` | versão React usada dentro do produto; cores por token CSS |
| `scripts/build-brand-assets.mjs` | gerador dos `.svg` estáticos; cores por hex |

Todas as variantes de uso **derivam** do gerador. Nenhuma é desenhada à mão:

```bash
node scripts/build-brand-assets.mjs
```

Se a geometria mudar em um, muda no outro. Os dois carregam os mesmos `path`.

### Geometria aprovada

```
V (braço esquerdo)  M3.6 5.2H17.8L33.4 53.6L30.2 61.2Z
folha (braço dir.)  M30.6 61C32.8 45.6 39.4 24.4 52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61Z
dobra da folha      M52.4 3C60.4 17.4 58 38.6 45.2 51.6C40.6 56.3 35.6 59.4 30.6 61C36.9 44.4 44.6 22.9 52.4 3Z
nervura             M31.4 59.4C37.5 43.2 45 22.2 52.2 3.9
```

Wordmark (viewBox `0 0 220 72`, altura de caixa alta 56, tracking largo):

```
V  M2 8H12.5L29 50L45.5 8H56L33.5 64H24.5Z
A  M76 64L101.5 8H108.5L134 64H123.5L105 26L86.5 64Z
A (travessão)  M88 48H122V57H88Z
L  M154 8H164.5V53.5H212V64H154Z
```

---

## 3. Variantes geradas

| Arquivo | Uso |
|---|---|
| `public/brand/val-icon-only.svg` | símbolo isolado, superfície clara |
| `public/brand/val-icon-only-on-dark.svg` | símbolo isolado, superfície escura |
| `public/brand/val-icon-only-monochrome.svg` | símbolo achatado em `currentColor` (mask-icon, stencil) |
| `public/brand/val-icon-maskable.svg` | ícone PWA maskable, zona segura de 80% |
| `public/brand/val-logo-on-light.svg` | lockup horizontal, fundo claro |
| `public/brand/val-logo-on-dark.svg` | lockup horizontal, fundo floresta |
| `public/brand/val-logo-compact.svg` | lockup reduzido |
| `public/brand/val-logo-monochrome.svg` / `-light.svg` | lockup em `currentColor` |
| `public/brand/val-logo-vertical-on-light.svg` | lockup vertical, fundo claro |
| `public/brand/val-logo-vertical-on-dark.svg` | lockup vertical, fundo floresta |
| `public/icon.svg` | favicon |
| `public/val-logo.svg`, `logo.svg` | ativos históricos, mantidos nos mesmos caminhos |

---

## 4. Cores da marca (extraídas do ativo oficial)

### Superfície escura — o V é marfim

| Token | Valor | Onde |
|---|---|---|
| `--val-logo-stem-top` | `#f1f1ea` | topo do V |
| `--val-logo-stem-bottom` | `#cfcfc6` | base do V |
| `--val-logo-leaf-top` | `#b6d96b` | ponta da folha |
| `--val-logo-leaf-mid` | `#8cbc49` | corpo da folha |
| `--val-logo-leaf-deep` | `#4e7a2e` | base da folha |
| `--val-logo-leaf-shade-top` | `#6e9c38` | meia-folha em sombra |
| `--val-logo-leaf-shade-bottom` | `#3a6624` | meia-folha em sombra |
| `--val-logo-vein` | `#0d1f15` | nervura |
| `--val-logo-word` | `#edede6` | wordmark |
| `--val-logo-accent` | `#9bc85a` | assinatura |

### Superfície clara — o V é floresta

| Token | Valor |
|---|---|
| `--val-logo-stem-top` | `#1d3b27` |
| `--val-logo-stem-bottom` | `#12291b` |
| `--val-logo-leaf-top` | `#a6cc5b` |
| `--val-logo-leaf-mid` | `#79a63e` |
| `--val-logo-leaf-deep` | `#3f6b26` |
| `--val-logo-leaf-shade-top` | `#5f8a32` |
| `--val-logo-leaf-shade-bottom` | `#2f5720` |
| `--val-logo-vein` | `#f2f6e9` |
| `--val-logo-word` | `#12291b` |
| `--val-logo-accent` | `#5f8a32` |

### Monocromática

Todos os tokens em `currentColor`. A marca herda a cor do texto.

---

## 5. API do componente

```jsx
<Logo/>                            // compact — símbolo + wordmark
<Logo variant="full"/>             // + assinatura INTELIGÊNCIA QUE GERA VALOR
<Logo variant="icon-only"/>        // símbolo isolado
<Logo compact/>                    // idem icon-only
<Logo variant="monochrome"/>       // herda currentColor
<Logo surface="dark"/>             // força contraste de superfície escura
<Logo decorative/>                 // aria-hidden, para quando o texto já nomeia a marca
```

`surface="auto"` (padrão) resolve o contraste pela superfície: `.sidebar`, `.login-story`,
`.public-welcome`, `.val-fs-header` e `[data-val-surface="dark"]` recebem a versão marfim.

---

## 6. Onde a marca aparece

| Superfície | Variante |
|---|---|
| Login | lockup completo com assinatura |
| Sidebar / Workspace | lockup compacto |
| Header mobile | símbolo + VAL |
| Splash / carregamento | símbolo |
| Copiloto em tela cheia | lockup compacto |
| Pesquisa pública, troca de senha | lockup compacto |
| PWA (favicon, maskable, monochrome) | símbolo |
| `theme-color` / `background_color` | `#0D1F15` |

A marca é presente e discreta. A interface não vira publicidade.

---

## 7. Migração executada

| Script | O que faz |
|---|---|
| `scripts/rebrand-logo-tokens.mjs` | substitui os blocos de tokens `--val-logo-*` antigos (azul + verde-água) pelos oficiais; idempotente, `--check` para auditar |
| `scripts/build-brand-assets.mjs` | regenera todos os `.svg` a partir da geometria aprovada |

Marca antiga removida de: `Logo.jsx`, `val-brand.css`, `logo.svg`, `public/icon.svg`,
`public/val-logo.svg`, `public/brand/*.svg` (9 arquivos), `index.html`, `manifest.webmanifest`.

Nenhum token azul `--val-logo-blue-*` / `--val-logo-fold-*` / `--val-logo-green-*` permanece.
