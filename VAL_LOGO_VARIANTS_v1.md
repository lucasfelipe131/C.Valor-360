# VAL Logo Variants v1

## Catálogo

| Variante | Asset | Uso correto |
|---|---|---|
| VAL Light | `public/brand/val-logo-on-light.svg` | Logo colorido sobre fundo claro |
| VAL Dark | `public/brand/val-logo-on-dark.svg` | Logo colorido sobre fundo escuro |
| VAL Monochrome Dark | `public/brand/val-logo-monochrome.svg` | Uma tinta escura sobre fundo claro |
| VAL Monochrome Light | `public/brand/val-logo-monochrome-light.svg` | Uma tinta clara sobre fundo escuro |
| VAL Compact | `public/brand/val-logo-compact.svg` | Símbolo + wordmark em espaços horizontais menores |
| VAL Icon Only | `public/brand/val-icon-only.svg` | Navegação, avatar e superfícies claras |
| VAL Icon Only Dark | `public/brand/val-icon-only-on-dark.svg` | Navegação e superfícies escuras |
| VAL Icon Mono | `public/brand/val-icon-only-monochrome.svg` | Máscara, impressão e cor única |
| VAL Maskable | `public/brand/val-icon-maskable.svg` | Ícone adaptativo do PWA |

## Componente React

### Padrão compatível

```jsx
<Logo />
```

Renderiza a versão compacta de produto: símbolo + wordmark, sem assinatura auxiliar.

### Full

```jsx
<Logo variant="full" surface="light" />
```

Renderiza símbolo + wordmark + “INTELIGÊNCIA QUE GERA VALOR”. Usar somente quando houver largura suficiente.

### Compact

```jsx
<Logo variant="compact" surface="auto" />
```

Renderiza símbolo + wordmark. É a variante recomendada para sidebar, header e login.

### Icon-only

```jsx
<Logo variant="icon-only" surface="dark" />
```

Renderiza somente o símbolo simplificado.

### Compatibilidade legada

```jsx
<Logo compact />
```

Continua renderizando icon-only. O booleano legado tem precedência para não mudar topbar e ambientes técnicos existentes.

### Monochrome

```jsx
<Logo variant="monochrome" surface="light" />
```

Usa `currentColor` em toda a construção. A superfície define a cor padrão; um contexto controlado também pode definir `color`.

### Decorativo

```jsx
<Logo variant="icon-only" decorative />
```

Remove o nome acessível e aplica `aria-hidden`. O padrão continua sendo `role="img"` com `aria-label`.

## Surface API

| Valor | Comportamento |
|---|---|
| `light` | força wordmark escuro e símbolo calibrado para fundo claro |
| `dark` | força wordmark claro e símbolo luminoso |
| `auto` | herda tokens da superfície e é o padrão |

Para novas superfícies, preferir:

```jsx
<section data-val-surface="dark">
  <Logo surface="auto" />
</section>
```

Não inferir cor de pixels e não usar `prefers-color-scheme` para decidir uma superfície interna.

## Tamanho mínimo

| Variante | Mínimo recomendado |
|---|---:|
| Full com assinatura | 170 px de largura |
| Compact | 112 px de largura |
| Icon-only com detalhes | 32 px |
| Icon-only simplificado | 16 px |
| Maskable | região segura central de 80% |

## Área de proteção

- Lockups: no mínimo metade da largura visual da haste azul em todos os lados.
- Icon-only: no mínimo 12% do quadro em aplicações comuns.
- Maskable: fundo full-bleed e símbolo dentro da região segura central.

## Regras de uso

- Não usar `val-logo-on-light.svg` sobre fundo escuro.
- Não usar `val-logo-on-dark.svg` sobre fundo branco.
- Não recolorir partes isoladas do símbolo.
- Não retirar o azul nem o verde das versões coloridas.
- Não recolocar a cunha escura antiga dentro da folha.
- Não aplicar sombras metálicas, bevel, rotação ou distorção.
- Não usar a assinatura abaixo de 170 px de largura.
- Não usar o asset `any` como maskable.
- Não substituir ícones semânticos do sistema pela marca; o símbolo identifica a VAL, não toda ação de IA.

## Aliases preservados

| Alias | Destino conceitual |
|---|---|
| `/val-logo.svg` | VAL Light / lockup compatível |
| `/icon.svg` | ícone institucional PWA `any` |
| `logo.svg` | cópia de distribuição do lockup compatível |

Os aliases não devem ser removidos enquanto o Manual incorporado, instalações PWA ou materiais externos puderem referenciá-los.
