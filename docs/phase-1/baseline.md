# Baseline de comportamento

## Referência

- Commit: `f405617405fb66811207fdf006c2fbdaebfb8c9d`.
- Branch local de trabalho: `phase1/foundation`.
- Runtime local observado: Node `24.19.0`, npm `11.9.0`.
- Runtime obrigatório no CI: Node `22`, compatível com `engines >=20.19`.

## Antes das alterações

| Comando | Resultado | Observação |
|---|---|---|
| `npm ci` | passou | cache movido para `/tmp` por restrição ambiental da sessão |
| `npm test` | 314 passaram, 0 falharam | duração aproximada de 4,0 s |
| `npm run build` | passou | Vite 5.4; apenas aviso de chunk acima de 500 kB |
| `cd manual && npm ci` | passou | 92 pacotes instalados |
| `cd manual && npm run build` | passou | Next.js 16.3; aviso preexistente de múltiplos lockfiles |

O primeiro `npm ci` falhou antes de alcançar o projeto porque o cache padrão apontava para um diretório indisponível. A repetição com cache em `/tmp` passou; isso é variação do ambiente de auditoria, não falha do código.

## Caracterização acrescentada

- mapa exato dos seis métodos instalados pelos dois bootstraps;
- ordem `conversion-bootstrap.js` antes de `innovation-bootstrap.js`;
- coexistência de `conversionFoundation` e `conversionInnovations`;
- resposta determinística, arquitetura, versão do Core e persistência atuais;
- negação de sessão e chamadas de repositório com tenant divergente;
- propagação assíncrona e sanitização de `request_id`;
- ordenação, idempotência e imutabilidade por checksum de migrations;
- natureza aditiva da migration expand.

## Depois das alterações da fundação

| Comando | Resultado |
|---|---|
| `npm test` | 331 passaram, 0 falharam, 0 ignorados no CI final |
| `npm run build` | passou; mesmo aviso preexistente de chunk |
| `cd manual && npm run build` | passou, inclusive TypeScript e geração das rotas |
| `npm run db:inventory` | passou; baseline intacto + uma migration versionada |

Os 17 testes novos da Fase 1 cobrem engine, migrations, observabilidade, isolamento e o ensaio controlado de backup/restore.

O smoke test local de `GET /live` preservou o UUID enviado em `X-Request-Id`, devolveu HTTP 200 e registrou `api.received`/`api.completed` com o mesmo ID e `tenant_ref` pseudonimizado.

Um primeiro build pós-alteração do Manual encontrou corrupção no cache gerado do Turbopack. O cache foi isolado e a repetição limpa passou; nenhum arquivo-fonte foi alterado para mascarar o problema.

## Política de preservação

Uma refatoração futura só pode substituir um comportamento coberto depois de registrar a mudança de contrato e aprovar uma nova expectativa. Os testes de caracterização não legitimam a arquitetura por prototype; apenas impedem que sua substituição mude o resultado silenciosamente.
