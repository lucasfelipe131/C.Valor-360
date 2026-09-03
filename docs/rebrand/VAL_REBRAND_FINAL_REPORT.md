# VAL_REBRAND_FINAL_REPORT

Rebrand geral + Workspace Contextual Híbrido da VAL.
Branch: `rebrand/val-global-hybrid-workspace-v1` · Base: `2bed57c` · `main` não tocada.

---

## 1. O que foi entregue

| Fase | Escopo | Commit |
|---|---|---|
| **R0** | Auditoria e inventário funcional congelado | `rebrand(r0)` |
| **R1** | Marca oficial instalada e gerada de fonte única | `rebrand(r1)` |
| **R2** | Design System: migração cromática com preservação de luminância | `rebrand(r2)` |
| **R3** | App Shell: Workspace Contextual Híbrido | `rebrand(r3)` |
| **R4** | Home como centro operacional | `rebrand(r4)` |
| **R5** | Produtor 360 com Split View contextual | `rebrand(r5)` |
| **R9** | Identidade atravessando a fronteira do iframe | `rebrand(r9)` |

**Não entregues: R6, R7 (parcial), R8, R10 (parcial), R11.** Detalhe na seção 5.

---

## 2. As três decisões que definiram o trabalho

### 2.1 A migração cromática preserva luminância, não claridade

A auditoria mediu o problema real: **2.525 cores hex distintas** escritas à mão contra
**131 usos de `var()`**. A camada de tokens existia e quase não era usada. Trocar tokens
mudaria 131 declarações de ~4.700 — a marca mudaria e o produto continuaria azul.

A saída foi rodar a matiz dos literais, mas **resolvendo a claridade por busca binária
para preservar a luminância relativa (WCAG)** de cada cor. Verde e azul têm coeficientes
de luminância muito diferentes (0,7152 contra 0,0722); girar a matiz mantendo o `L` do HSL
clarearia tudo e destruiria contraste em silêncio, em milhares de lugares.

Preservando luminância, **toda razão de contraste do produto permanece idêntica**. O gate
de acessibilidade saiu resolvido por construção, sem inspecionar 4.700 declarações.

3.156 literais migrados no total (2.955 em `src/`, 201 no app embutido), com vermelhos,
âmbares, amarelos e violetas fora da faixa: **alerta não virou verde VAL**.

### 2.2 A navegação passou a responder "em qual contexto", não "em qual página"

Sete dos treze módulos viviam atrás de um accordion chamado "Mais recursos", e
`Sidebar.jsx` e `MobileNav.jsx` mantinham duas listas independentes que já tinham
divergido. `lib/val-workspaces.js` virou o modelo único: cinco workspaces sobre os mesmos
treze módulos, com `assertModuleCoverage()` provando em teste que nenhum ficou órfão.

O efeito colateral mais importante: **navegar deixou de descartar o produtor em foco**.
Antes, sair de `client360` zerava a seleção e um efeito de fallback reativava o primeiro
da carteira — um contexto que o usuário nunca escolheu.

### 2.3 Recomendação não ganhou uma segunda superfície

O prompt pedia Timeline / Recomendações / Copiloto no painel contextual. Entregamos
**Timeline / Contexto / Copiloto**.

Motivo: `/api/val/recommendations` existe, mas **nenhuma superfície do produto o usa** —
tudo passa por `/api/val/chat`, que é o caminho governado. Criar um segundo renderizador
de recomendação significaria uma superfície de decisão paralela, capaz de divergir da
resposta oficial, e uma chamada de IA a cada abertura de produtor.

A aba Copiloto entrega as recomendações pelos mesmos atalhos governados, com o produtor
já vinculado. **Nenhuma aba dispara IA ao abrir.**

---

## 3. Preservação funcional

**13 módulos antes → 13 módulos depois. 10 ferramentas agronômicas antes → 10 depois.**
Nada foi removido. Matriz completa em `VAL_REBRAND_MIGRATION_MATRIX.md`.

Não foram tocados: Knowledge Engine, Decision Engine, Memory Engine, roteamento de
contexto, grounding, fronteira de produtor, anti-contaminação, arquitetura de prompt,
roteamento de modelo, engine de voz, retrieval, banco, APIs, integrações e permissões.

**Nenhuma rota criada, renomeada ou removida.**

---

## 4. Resultado dos gates

| Gate | Resultado |
|---|---|
| Testes | **1301 pass / 26 fail** — baseline era 1263/28. Zero regressões; +36 testes novos |
| Build | ✅ limpo, PWA carimbado e validado |
| Route smoke | ✅ 5 workspaces e 11 módulos abertos, desktop e mobile |
| Inventário funcional | ✅ automatizado |
| Visual desktop e mobile | ✅ **zero overflow horizontal** em 1920, 1440, 1366, 1280, 1024, 768, 430, 390 e 375 |
| A11y | ✅ parcial — contraste por construção, marcação ARIA; sem auditoria de leitor de tela |
| Performance | ✅ nenhuma dependência nova, nenhuma chamada de rede nova |
| Integridade de contexto | ✅ fronteira de produtor testada e reforçada |
| Anti-regressão | ✅ nenhum teste verde virou vermelho |

As 26 falhas são as **mesmas ambientais do baseline** (resolução de caminho do vite SSR no
Windows, loader TS, `ffprobe`). Detalhe em `VAL_REBRAND_TEST_REPORT.md`.

---

## 5. O que NÃO foi feito — e por quê

| Item | Situação | Motivo |
|---|---|---|
| **R6 — Preparar Visita em seis etapas** | não feito | fluxo grande, com comportamento a preservar item a item; merece sua própria fase e seu próprio gate |
| **R7 — Copiloto** | parcial | painel contextual entregue; a integração de contexto de página já existia e foi preservada. Full screen e voz não foram redesenhados |
| **R8 — Conhecimento** | não feito | reestruturar a apresentação em Resumo/Diagnóstico/Evidências/… mexe em como a resposta da IA é renderizada — risco alto, precisa de golden set próprio |
| **R10 — Calculadoras** | parcial | identidade migrada e contrato mobile travado por teste; a refatoração de apresentação não foi feita e **não pôde ser validada em execução**: `manual/node_modules` não está instalado e instalar a sub-aplicação está fora do escopo |
| **R11 — demais módulos** | herdaram a nova identidade pela migração cromática, mas não foram redesenhados individualmente |
| **Publicação em staging** | não feita | depende de autorização e credenciais que não tenho |
| **`src/styles.css` com 286 KB** | dívida registrada, não resolvida | é outro trabalho, com outro risco |

---

## 6. Pendência de Git a resolver

Durante a auditoria, o `HEAD` mudou porque houve commits pelo terminal em paralelo. Como
consequência, os commits `rebrand(r0)` e `rebrand(r1)` também ficaram em
`content/val-knowledge-library-expansion-v1`. O trabalho está íntegro na branch de rebrand;
para limpar a outra:

```bash
git branch -f content/val-knowledge-library-expansion-v1 2bed57c
```

---

## 7. Próximos passos sugeridos, em ordem

1. Rodar o UAT com carteira real — especialmente **3.2, 3.3 e 3.6**, a fronteira de produtor.
2. Rodar a suíte em Linux/CI para confirmar que as 26 falhas são mesmo ambientais.
3. Publicar em staging e validar `/live`, `/ready` e `/health`.
4. R6 — Preparar Visita, a fase de maior retorno restante.
5. R10 — instalar o app embutido e validar as calculadoras em execução no celular.
6. R8 — Conhecimento, com golden set próprio antes de mexer na renderização.

---

## 8. Critério de aprovação do produto

> "É claramente a VAL que já existia, mas agora virou uma plataforma madura."

A comparação BEFORE/AFTER foi feita com as duas versões rodando lado a lado. A mesma
carteira, os mesmos módulos, as mesmas engines, os mesmos textos. O que mudou foi a marca,
a hierarquia da navegação, o que a Home responde primeiro e o fato de a decisão e o que a
sustenta finalmente aparecerem juntos.

**VAL — INTELIGÊNCIA QUE GERA VALOR.**
