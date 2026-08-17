# Checklist de deploy do VALOR 360

Use esta lista em toda publicação, inclusive em correções pequenas. O objetivo é impedir que uma versão nova chegue ao servidor enquanto o navegador continua preso a arquivos antigos do PWA.

## Antes de publicar

1. Confirme que a PR contém somente o escopo previsto e que nenhuma regra de segurança da VAL foi enfraquecida.
2. Instale exatamente as dependências registradas:

   ```bash
   npm ci
   ```

3. Rode a suíte completa:

   ```bash
   npm test
   ```

4. Gere a versão de produção:

   ```bash
   npm run build
   ```

   O build executa três passos obrigatórios: compila o React, carimba `dist/sw.js` com a identificação da release e valida o resultado.

5. Faça uma verificação explícita do PWA:

   ```bash
   npm run pwa:verify
   ```

6. Confirme que `dist/sw.js`:

   - não contém `__VAL_RELEASE__`;
   - possui um `CACHE` no formato `valor360-v<release>`;
   - mantém navegações e chunks do Manual em estratégia network-first;
   - não foi editado manualmente.

## Como a versão do cache é gerada

O script `scripts/pwa-release.mjs` usa, nesta ordem, a identificação informada pelo ambiente de deploy, o commit Git ou um fingerprint das fontes. Assim, uma nova revisão do sistema gera um nome de cache novo sem depender de alguém lembrar de trocar `v08`, `v09` ou outro número manual.

O arquivo `public/sw.js` é um modelo e deve manter exatamente um marcador `__VAL_RELEASE__`. O marcador só pode existir no código-fonte; nunca no artefato publicado.

## Depois de publicar

1. Confirme que `/health` responde normalmente.
2. Abra `/sw.js` e verifique nos cabeçalhos que ele continua com `no-store, no-cache, must-revalidate, max-age=0`.
3. Abra o sistema em uma janela já utilizada anteriormente e pressione **Ctrl + F5** uma vez para o teste de atualização.
4. Confirme no DevTools que o service worker novo ficou ativo e que o cache antigo foi removido durante `activate`.
5. Valide pelo menos:

   - login e restauração da sessão;
   - abertura de Ambientes VAL;
   - uma análise direta;
   - uma análise estratégica com progresso;
   - Cliente 360;
   - SOG;
   - Manual integrado.

6. Se a tela continuar antiga, não publique outro hotfix às cegas. Compare o `CACHE` servido em `/sw.js`, o commit implantado e os arquivos de `dist` antes de qualquer nova alteração.

## Critério de bloqueio

A publicação deve ser interrompida quando qualquer uma destas condições ocorrer:

- `npm test` falhar;
- `npm run build` falhar;
- `npm run pwa:verify` falhar;
- `dist/sw.js` ainda contiver `__VAL_RELEASE__`;
- `/sw.js` for servido como imutável;
- o cache da nova release tiver o mesmo nome de uma revisão de frontend diferente.
