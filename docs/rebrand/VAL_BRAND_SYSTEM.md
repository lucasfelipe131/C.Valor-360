# VAL_BRAND_SYSTEM

Sistema de marca da VAL.

---

## 1. A marca é o arquivo, não uma reprodução

A identidade oficial da VAL é o **V com textura de pedra e duas lâminas de folha
sobrepostas**, o wordmark **VAL** — com o "A" em forma de chevron, sem travessão — e a
assinatura **INTELIGÊNCIA QUE GERA VALOR**.

O briefing é explícito:

> NÃO redesenhar · NÃO reinterpretar · NÃO aproximar por CSS · NÃO recriar com fonte
> semelhante · **Usar o asset oficial fornecido.**

### O erro que este documento existe para não repetir

A primeira entrega **redesenhou a marca em SVG**: paths vetoriais aproximando o V, uma
folha única com dobra, e um wordmark reconstruído. Ficava parecido de longe e errado de
perto — a textura de pedra sumia, as duas lâminas viravam uma só, e as proporções não
batiam. Foi recusado, corretamente.

A marca agora é **o arquivo original recortado**, e o teste
`val-brand-variants.test.js` falha se qualquer `<svg>` ou `<path>` voltar ao componente.

---

## 2. Como as peças são geradas

Origem: o PNG oficial entregue (4096×3437, com transparência).

```bash
node scripts/extract-brand-asset.mjs <caminho-do-png-oficial> public/brand
```

O script abre o arquivo num Chrome headless, mede a **caixa alfa real** de cada faixa
— símbolo, wordmark, assinatura — e exporta os recortes. Nada é posicionado à mão:

- perfil de opacidade por linha separa as três faixas;
- densidade por coluna descarta os respingos decorativos do original, que uma caixa alfa
  pura incluiria;
- a caixa cheia é a **união** das faixas, porque a assinatura é mais larga que o wordmark
  e tem traço fino — uma densidade global cortaria o "VALOR" do fim.

**Para trocar a marca:** troque o arquivo de origem e rode o script. Não edite os recortes.

### Peças em `public/brand/`

| Arquivo | Recorte do original | Uso |
|---|---|---|
| `val-symbol-official.png` | 1900×1507 | símbolo isolado (V + folha) |
| `val-wordmark-only-official.png` | 3320×779 | apenas "VAL" |
| `val-wordmark-official.png` | 3325×1012 | "VAL" + assinatura |
| `val-signature-official.png` | 3258×132 | apenas a assinatura |
| `val-logo-official.png` | 3325×2676 | lockup completo empilhado |

---

## 3. Montagem no produto

O lockup do produto é **horizontal com a assinatura embaixo**, como na referência:

```
[ V+folha ]  [ VAL ]
[ INTELIGÊNCIA QUE GERA VALOR ]
```

A assinatura fica sob o conjunto, não espremida ao lado do wordmark — ali ela teria ~4px
e seria ilegível.

### Dimensionamento

O tamanho é dado pela **altura do símbolo** (`--val-mark-height`); largura e demais peças
acompanham. Travar largura e altura deformaria a marca.

| Superfície | Altura do símbolo |
|---|---|
| Sidebar | 44px |
| Login (lado institucional) | 70px |
| Variante `full` padrão | 52px |
| Pesquisa pública, troca de senha | 46px |
| Header mobile | 32px |

A assinatura é dimensionada pela **largura do lockup**, não pela altura.

---

## 4. API do componente

```jsx
<Logo/>                       // compact — símbolo + VAL
<Logo variant="full"/>        // + assinatura embaixo
<Logo variant="icon-only"/>   // símbolo isolado
<Logo compact/>               // idem icon-only
<Logo variant="monochrome"/>  // grayscale derivado do ativo
<Logo surface="dark"/>        // força tratamento de superfície escura
<Logo decorative/>            // aria-hidden
```

A API não mudou com a troca do ativo — todas as chamadas existentes continuam válidas.

### Superfícies

A marca foi desenhada para fundo escuro. Em superfície clara o traço de pedra recebe um
halo mínimo (`drop-shadow`) para não sumir no branco. Em superfície escura, uma sombra
suave. Nada além disso: **nenhum filtro recolore a marca**.

`surface="auto"` (padrão) resolve pela superfície: `.sidebar`, `.login-story`,
`.public-welcome`, `.val-fs-header` e `[data-val-surface="dark"]` recebem o tratamento
escuro.

---

## 5. Onde a marca aparece

| Superfície | Variante |
|---|---|
| Login | completa, com assinatura |
| Sidebar | completa, com assinatura |
| Header mobile | símbolo |
| Copiloto em tela cheia | compacta |
| Pesquisa pública, troca de senha | compacta |
| Favicon | `val-symbol-official.png` |
| PWA (`manifest.webmanifest`) | símbolo e lockup completo |
| Manual do Agrônomo (iframe) | `val-wordmark-official.png`, servido pelo app pai |
| `theme-color` / `background_color` | `#071B19` — o verde profundo da VAL |

---

## 6. Paleta: inalterada

**A troca foi de marca, não de cor.** A paleta da VAL — `--val-ink`, `--val-emerald`,
`--val-mint`, `--val-lime` — permanece exatamente como estava. Detalhe em
`VAL_DESIGN_SYSTEM.md`.

Os tokens `--val-logo-*` foram removidos: existiam só para colorir o desenho recusado.
Um ativo raster traz as próprias cores.

---

## 7. O que o teste trava

`test/val-brand-variants.test.js`:

1. as cinco peças existem e têm massa de imagem real;
2. o componente usa `<img>` com os arquivos oficiais — **nenhum `<svg>` ou `<path>`**;
3. as geometrias da marca antiga e do redesenho estão banidas por assinatura de path;
4. a API do componente segue intacta;
5. a assinatura fica sob o conjunto;
6. o dimensionamento preserva a proporção;
7. o extrator mede o alfa em vez de usar coordenadas chumbadas;
8. nenhum SVG redesenhado sobrou no repositório;
9. favicon, PWA e app embutido apontam para o ativo;
10. a paleta da VAL segue preservada.
