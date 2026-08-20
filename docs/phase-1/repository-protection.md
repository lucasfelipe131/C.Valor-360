# Proteção do repositório

## Configuração obrigatória de `main`

Aplicar no GitHub sem exceção para administradores durante o piloto:

1. exigir pull request antes de merge;
2. exigir uma aprovação e revisão de CODEOWNER;
3. dispensar aprovações antigas quando houver novos commits;
4. exigir resolução de todas as conversas;
5. exigir branch atualizada antes do merge;
6. exigir os checks `npm test`, `npm run build` e `manual npm run build`;
7. bloquear force-push e exclusão da branch;
8. impedir merge quando qualquer check estiver pendente ou vermelho.

O workflow usa permissões somente leitura e separa teste, build principal e build do Manual. `CODEOWNERS` cobre todo o repositório e explicita os diretórios sensíveis.

## Política de pull request

- uma mudança por objetivo, sem refatoração oportunista;
- evidência de testes e rollback no corpo do PR;
- migration histórica é imutável;
- mudança de tenancy exige teste negativo;
- nenhum deploy é consequência automática da aprovação do código sem o gate do ambiente;
- merge preferencial por squash, mantendo referência ao PR e à migration.

## Verificação

Depois de configurar a proteção, executar em ambiente autorizado:

```bash
GITHUB_REPOSITORY=lucasfelipe131/C.Valor-360 \
GITHUB_TOKEN='<token somente leitura de administração>' \
npm run repo:protection:verify
```

O script é somente leitura e encerra com código diferente de zero se qualquer requisito do gate estiver ausente. A existência dos arquivos locais não prova que `main` está protegida.
