# VAL_DESIGN_SYSTEM

Fase **R2 — DESIGN SYSTEM**. Como a identidade oficial passou a valer em toda a superfície do produto.

---

## 1. O problema que este documento resolve

A auditoria R0 mediu:

| Métrica (todos os `src/*.css`) | Antes |
|---|---|
| Cores hex distintas | **2.525** |
| Literais de cor | 3.952 hex + 786 `rgb()` |
| Usos de `var(--token)` | **131** |
| Cor mais frequente depois de `#fff` | `#0b67d8` — **azul** |

A camada de tokens existia e quase não era usada. **Trocar variáveis não faria rebrand
nenhum** — mudaria 131 declarações em ~4.700. O produto era azul corporativo escrito à mão.

Duas saídas ruins e uma boa:

- ❌ Reescrever as 25 folhas à mão: semanas de trabalho, regressão visual garantida.
- ❌ Trocar só os tokens: a marca muda, o produto não.
- ✅ **Migração cromática determinística sobre os literais**, com garantia de contraste.

---

## 2. O método: rotação de matiz com preservação de luminância

`scripts/rebrand-color-migration.mjs`

Para cada literal de cor:

1. converte para HSL;
2. **não toca** em matizes fora da família azul/ciano/verde-água — vermelhos, âmbares,
   amarelos, os verdes que já eram VAL, violetas e cinzas (`saturação < 6%`);
3. os que estão na faixa de entrada `[155°, 246°]` recebem a matiz VAL correspondente
   ao seu papel na interface;
4. limita a saturação, porque verde satura muito mais que azul aos olhos;
5. **resolve a claridade por busca binária** para que a luminância relativa (WCAG) final
   seja idêntica à original.

### Por que o passo 5 é o ponto central

Verde e azul têm coeficientes de luminância muito diferentes (`0.7152` contra `0.0722`).
Rodar a matiz mantendo o `L` do HSL clarearia tudo e destruiria contraste em silêncio,
em milhares de lugares.

Resolvendo a claridade pela luminância, **toda razão de contraste do produto permanece
exatamente a mesma**. Um texto que passava em WCAG antes continua passando depois —
sem inspecionar 4.700 declarações uma a uma. É o gate A11Y resolvido por construção.

### As âncoras de matiz

A marca tem duas, e nenhum verde puro entre elas:

```
L ≤ 0.16          → 146°   floresta profunda   (nav, sidebar, superfícies premium)
0.16 < L < 0.24   → 146°→90°  transição curta
0.24 ≤ L < 0.76   →  90°   oliva da folha      (ação, marca, destaque, estado positivo)
L ≥ 0.76          →  90°→146°  tinta menta     (fundos, chips, divisores)
```

Hue 120 — verde-grama — **não pertence à VAL** e as faixas de transição são curtas de
propósito para não parar nele. As matizes 146 e 90 são as do ativo oficial:
`#0D1F15` é hsl(145°), `#79A63E` é hsl(85°).

Saturação limitada a **52%** (45% em tintas muito claras), que é a faixa da folha oficial
(`#A6CC5B` 52%, `#79A63E` 46%, `#3F6B26` 47%).

### Resultado

```
arquivos analisados: 26  |  com alteração: 25
literais de cor: 3.952 hex + 786 rgb
migrados para a família VAL: 2.955  |  preservados: 1.783
```

Exemplos:

| Antes | Depois | Papel |
|---|---|---|
| `#0b67d8` azul primário | `#437820` | ação primária, oliva profundo |
| `#2d8cff` azul claro | `#589e2a` | acento |
| `#00c896` verde-água antigo | `#80c23d` | destaque da marca |
| `#071b19` | `#091b11` | superfície escura |
| `#082e29 → #0a4038` gradiente da sidebar | `#0c2e1d → #114129` | floresta |
| `#eaf4ff` tinta azul | `#e5f6ed` | tinta menta |
| `#e11d48` vermelho | `#e11d48` | **preservado** — semântica |
| `#c8f25e` lima | `#c8f25e` | **preservado** — já era VAL |

### Idempotência

As matizes de destino (90–146) caem fora da faixa de entrada (155–246). Rodar duas vezes
não muda nada:

```bash
node scripts/rebrand-color-migration.mjs --check   # falha se algo mudaria em disco
node scripts/rebrand-color-migration.mjs --report  # mostra cor a cor
```

---

## 3. Cores semânticas continuam independentes da marca

Regra do prompt mestre respeitada literalmente: **alerta ≠ verde VAL**, **erro continua
reconhecível**. Vermelhos (0–20°), âmbares (20–55°) e amarelos (55–70°) ficam fora da faixa
migrada e não foram tocados. Violetas (≥ 247°) também.

---

## 4. Camada de tokens

`src/val-brand.css` continua sendo a raiz:

```css
--val-ink       #091b11   superfície mais escura
--val-ink-soft  #0d2919
--val-forest    #113521   floresta
--val-emerald   #80c23d   oliva da folha — destaque
--val-emerald-dark #659a31 oliva profundo — ação
--val-mint      #b9de95   acento claro
--val-lime      #c8f25e   lima (preservada)
--val-canvas    #f4f8f6   fundo geral
--val-surface   #ffffff   superfície
--val-text      #102419
--val-muted     #747e6b
--val-line      #dce8e2
```

Mais os tokens da marca oficial (`--val-logo-*`, ver `VAL_BRAND_SYSTEM.md`) e os aliases
legados (`--navy`, `--blue`, `--bg`, `--card`, `--line`), preservados para não quebrar
nenhuma folha existente.

### Hierarquia de superfícies

```
FUNDO GERAL   --val-canvas   #f4f8f6
  SUPERFÍCIE  --val-surface  #ffffff
    CARD      borda --val-line + --shadow
      AÇÃO    --val-emerald-dark
```

A maior parte da área de trabalho permanece **clara e limpa**. O verde floresta fica
onde o prompt pediu: navegação, sidebar, Copiloto, superfícies institucionais.

---

## 5. Camadas de folha, na ordem de carga

`src/main.jsx` carrega, nesta ordem:

| # | Folha | Papel |
|---|---|---|
| 1 | `styles.css` | base monolítica herdada (286 KB) |
| 2 | `val-brand.css` | tokens da marca e da logo |
| 3–8 | `agro-workspace`, `mobile-browser`, `mobile-login`, `val-mobile-overflow`, `val-logo-final`, `presentation` | por feature |
| 9 | `copilot-ux.css` | Copiloto |
| 10 | `val-ui-simple-modern.css` | camada de refinamento visual |
| 11 | **`val-workspace-shell.css`** | **novo (R3)** — sidebar por workspace, cabeçalho global, barra inferior mobile |

O shell entra por último porque é a camada mais nova e precisa vencer o legado sem
`!important`.

---

## 6. O que o R2 **não** fez

- Não migrou a stack. Continua Vite + React 18 + CSS puro.
- Não reescreveu `styles.css`. A dívida dos 286 KB está registrada no R0; resolvê-la é
  outro trabalho, com outro risco.
- Não mexeu em Knowledge Engine, Decision Engine, Memory Engine, roteamento de contexto,
  grounding, fronteira de produtor, prompts, roteamento de modelo, voz, banco ou APIs.
- Não alterou nenhuma rota.

---

## 7. Gates do R2

| Gate | Resultado |
|---|---|
| Build | ✅ `vite build` limpo |
| Testes | ✅ **1279 pass / 26 fail** — baseline era 1263/28; as 26 são as ambientais do R0 |
| Contraste | ✅ preservado por construção (luminância relativa idêntica) |
| Cores semânticas | ✅ vermelhos, âmbares e amarelos intactos |
| Azul residual | ✅ zero — teste automatizado varre as 26 folhas |
| Idempotência | ✅ `--check` limpo |
