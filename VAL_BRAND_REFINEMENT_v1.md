# VAL Brand Refinement v1

## Status e escopo

Refinamento evolutivo da identidade existente da VAL. Não é um rebranding e não altera nome, proposta, paleta central, tipografia do produto, navegação, engines, dados ou integrações.

O trabalho preserva:

- o “V” construído por duas fitas convergentes;
- azul para tecnologia, conexão e dados;
- verde para campo, ação e inteligência aplicada;
- a folha como sinal agronômico;
- o wordmark proprietário `VAL`;
- os endereços públicos `/val-logo.svg` e `/icon.svg`.

## Problemas corrigidos

### Contraste

O wordmark anterior usava o gradiente `#082C57 → #0A4C9B` em todas as superfícies. Sobre o fundo institucional `#071B19`, o contraste variava de aproximadamente `1,28:1` a `2,14:1`.

Agora:

- superfície clara: wordmark `#082C57`, contraste de aproximadamente `13,92:1` sobre branco;
- superfície escura: wordmark `#F4F8F6`, contraste de aproximadamente `16,62:1` sobre `#071B19`;
- o símbolo também recebe uma escala azul/verde mais luminosa em fundos escuros.

### Folha

A folha anterior continha uma cunha escura rígida que podia lembrar um cacto. A nova geometria usa:

- silhueta assimétrica e contínua;
- base arredondada;
- ponta suavizada;
- nervura única e curva somente em tamanhos adequados;
- nenhuma segunda massa triangular interna.

Em icon-only e no legado `<Logo compact/>`, nervura, brilhos e nó interno são removidos para aumentar a legibilidade.

### Wordmark

O wordmark mantém desenho vetorial, sem depender de uma fonte instalada. O refinamento:

- aumenta a massa óptica;
- melhora o espaço entre `V`, `A` e `L`;
- amplia a contraforma do `A`;
- fortalece o `L`;
- preserva o detalhe verde no `A`;
- usa cor sólida no wordmark e reserva os gradientes ao símbolo.

## Paleta aplicada à marca

| Papel | Superfície clara | Superfície escura |
|---|---:|---:|
| Wordmark | `#082C57` | `#F4F8F6` |
| Azul principal | `#2D8CFF` | `#72B8FF` |
| Azul médio | `#167FE8` | `#2D8CFF` |
| Verde principal | `#00C896` | `#C8F25E` |
| Verde médio | `#009F78` | `#00C896` |
| Detalhe do A | `#009F78` | `#72E6C5` |

O lima permanece um acento de oportunidade em superfícies escuras. Ele não é usado como borda essencial sobre branco.

## Adaptação por superfície

O componente usa `surface="light"`, `surface="dark"` ou `surface="auto"`.

No modo `auto`, os tokens são herdados da superfície. A integração atual reconhece automaticamente:

- `.sidebar`;
- `.public-welcome`;
- `.login-story`;
- `.val-fs-header`;
- ancestrais com `data-val-surface="dark"`;
- topbar móvel escura.

Isso corrige as superfícies existentes sem exigir detecção de cor por JavaScript e sem criar um novo dark mode global.

## PWA e ícones

O ícone principal passa a usar placa institucional escura e símbolo luminoso. O manifesto separa:

- `any`: `/icon.svg`;
- `maskable`: `/brand/val-icon-maskable.svg`;
- `monochrome`: `/brand/val-icon-only-monochrome.svg`.

O maskable possui fundo full-bleed e símbolo reduzido à região segura. Os SVGs foram rasterizados temporariamente com Inkscape para inspeção visual, mas nenhum PNG foi adicionado ao produto nesta rodada: SVG continua sendo a fonte canônica e evita publicar densidades raster incompletas.

## Compatibilidade

- `<Logo compact/>` continua significando icon-only.
- `<Logo/>` continua exibindo símbolo + `VAL`.
- `/val-logo.svg` permanece disponível.
- `/icon.svg` permanece disponível.
- `logo.svg` e `public/val-logo.svg` devem permanecer byte a byte idênticos.
- Identificadores internos `valor360`, bancos, rotas, cache e integrações não são renomeados.
- A identidade standalone do Manual do Agrônomo não é substituída; apenas superfícies incorporadas podem usar a VAL.

## Gate visual

Antes de promover:

1. conferir wordmark off-white na sidebar e em qualquer hero escuro;
2. conferir wordmark azul-escuro em fundo branco;
3. conferir símbolo em 16, 24, 32, 44 e 64 px;
4. conferir favicon em navegadores claros e escuros;
5. conferir recorte maskable circular, squircle e quadrado arredondado;
6. conferir PWA instalada em Android e iOS físico;
7. conferir que o alias `/val-logo.svg` continua carregando no Manual incorporado;
8. executar testes de marca, regressão e build/PWA.

## Rollback

O rollback é somente de assets e CSS:

- restaurar `Logo.jsx`, os dois CSS de marca, os SVGs públicos, o manifesto e o `index.html` da revisão anterior;
- manter os novos arquivos em `/public/brand` sem referência não afeta runtime;
- nenhum rollback de banco, migration, memória ou dados é necessário.
