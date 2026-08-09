# Manual do Agrônomo

## Diagnóstico por imagem

A aba **Diagnóstico por foto** oferece quatro metodologias independentes:

- **NutriScan**: ranking diferencial de deficiências nutricionais.
- **FitoScan**: ranking diferencial de doenças e danos semelhantes.
- **InsetoScan**: identificação ranqueada de insetos, pragas e organismos benéficos.
- **DaninhaScan**: identificação ranqueada de plantas daninhas por características botânicas.

As fotos são redimensionadas no navegador antes do envio. A análise ocorre somente
na rota protegida do servidor e requer a variável `OPENAI_API_KEY`. O modelo pode
ser substituído com `OPENAI_VISION_MODEL`; o padrão atual é `gpt-5.6`.

O resultado é uma triagem assistida e deve ser confirmado por vistoria, análise
de solo/tecido, chave taxonômica ou laboratório antes de uma recomendação
agronômica. A foto não é usada para inferir resistência a herbicidas, nível de
controle ou dano econômico.

Plataforma web mobile-first para apoiar a rotina de agrônomos no campo e no
escritório.

## Primeira versão

- Painel responsivo da propriedade e dos talhões.
- Cadastro visual de produtores e propriedades.
- Importação de análises de solo por PDF, fotografia, CSV ou TXT.
- Visão de fertilidade e histórico de laudos.
- Calculadoras de sementes por metro, calda, produto e fertilizante.
- Modelos de relatórios técnicos.
- Navegação otimizada para smartphones.

Os dados exibidos nesta etapa são demonstrativos. A próxima camada conecta banco
de dados, autenticação, leitura real de laudos e geração de relatórios em PDF.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

## Railway

O arquivo `railway.json` define os comandos de produção:

- build: `npm run build:railway`
- start: `npm run start:railway`

A porta é lida automaticamente da variável `PORT` fornecida pela Railway.

## Integração com o VALOR 360

O Manual envia, pelo servidor, o dossiê atualizado de cada produtor e os
registros salvos para o webhook do VALOR 360. O corpo é assinado com HMAC
SHA-256; o segredo nunca é exposto ao navegador. Configure no serviço Railway
do Manual:

- `VALOR360_WEBHOOK_URL`: URL completa do endpoint
  `/api/v1/integrations/manual/events` do VALOR 360.
- `VALOR360_WEBHOOK_SECRET`: o mesmo valor de
  `VAL_MANUAL_WEBHOOK_SECRET` configurado no VALOR 360.

Dados binários, imagens, credenciais e documentos de identificação não são
enviados. Permanecem no contexto estratégico cadastro, propriedades, talhões,
safras, análises, cálculos, cotações, relatórios e recomendações. O endpoint
administrativo `POST /api/integrations/valor360/sync` reprocessa o histórico já
persistido no PostgreSQL.
