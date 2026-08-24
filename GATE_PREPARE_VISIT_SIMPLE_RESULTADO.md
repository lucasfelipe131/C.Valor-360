# GATE PREPARE VISIT SIMPLE — RESULTADO

## GATE PREPARE VISIT SIMPLE APROVADO

Data: 24/08/2026  
Escopo: staging da VAL  
Base auditada: `feature/voice-capture@85c6209c095702d4f02f0d31ff2c9ab224855ebf`  
Branch de desenvolvimento: `feature/prepare-visit-simple-ux`  
Commit inicial de UI: `2076c5e30298d884442f97c5dcd549c0a85f24b6`

Correção de entrada: pendente de hash remoto neste registro local

Deploy final: pendente de validação após a correção de entrada

## Evidências do gate

| Critério | Resultado | Evidência |
|---|---|---|
| Primeira tela materialmente mais simples | Aprovado | Tela focada substitui o relatório no card; essencial tem cinco blocos curtos |
| Essencial antes dos detalhes | Aprovado | Objetivo, atenção, perguntas, estratégia e compromisso precedem os dois `details` |
| Máximo três Perguntas de Ouro | Aprovado | Limite da engine preservado e projeção defensiva `.slice(0,3)` |
| Compromisso-alvo evidente | Aprovado | Card verde “SAIA COM” na camada essencial |
| Voice Capture acessível | Aprovado | Uma ação principal “Falar com a VAL”, `PRE_VISIT`, confirmação e recálculo preservados |
| SIMPLE funciona | Aprovado | Default SIMPLE, apenas essencial aberto |
| ANALYTICAL mantém profundidade | Aprovado | Números, tese, evidências, riscos, caso econômico e agronomia sob demanda |
| Mesma inteligência nos modos | Aprovado | Teste compara `essential`, `analysis` e tese em SIMPLE/BALANCED/ANALYTICAL |
| Mobile | Aprovado | Uma coluna abaixo de 760 px, alvos de toque, sheet de 94dvh e safe area |
| Engines e contratos | Aprovado | Nenhum endpoint, motor, schema cognitivo ou migration alterado |
| Safety agronômico | Aprovado | Regressão completa verde; dados técnicos permanecem drill-down e sem nova recomendação |
| Cross-tenant | Aprovado | Gates existentes verdes; preferência local escopada por `storageScope` |
| Suíte completa | Aprovado | 610/610 testes |
| Builds | Aprovado | Vite/PWA e Manual Next.js aprovados localmente e no container Railway |
| Entrada principal “Preparar visita” | Aprovado localmente | Centro de Decisão, Dashboard e Cliente 360 convergem para a jornada focada |

## Validação de staging

- CI GitHub Validate #181: `success` para a UI inicial; novo check será exigido para a correção de entrada.
- Railway: novo deploy será exigido para a correção de entrada.
- PostgreSQL isolado: permaneceu `SUCCESS`; nenhum recurso novo criado.
- Migrations: cinco versões verificadas, todas `already-applied`.
- Health: `/live` retornou `{"status":"ok","service":"valor360"}`.
- URL: `https://val-web-staging-production.up.railway.app/`.
- `main` e produção externa não foram alteradas.

## Decisão

A camada de apresentação ficou simples sem reduzir a capacidade decisória. Uma evidência visual do usuário revelou que o atalho principal ainda abria o Centro de Decisão genérico; o gate foi reaberto e a entrada foi corrigida antes do fechamento definitivo. O consultor encontra em poucos segundos por que vai, o que perguntar, como conduzir e com qual compromisso sair. Análise, números, agronomia, evidências e provenance continuam disponíveis em profundidade progressiva.

Nenhuma promoção para produção foi realizada. O Passo 07 não foi iniciado.
