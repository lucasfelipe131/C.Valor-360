# VALOR 360 — Estrutura do Projeto

## Proposta central
**VALOR 360 = CRM empresarial + Cliente 360 + Inteligência Agronômica + VAL**

- **Cliente 360:** perfil, NPS, IRT, preferências, histórico e contexto do produtor.
- **Inteligência Agronômica:** sinais, integrações e futuros motores técnicos dentro do VALOR 360, sempre sob validação habilitada.
- **VAL — Value Agriculture Intelligence:** cérebro que transforma dados em próxima melhor ação.

## Portfólio de produtos

### VALOR 360
Visão de produto empresarial. O piloto reúne CRM, carteira, visitas, oportunidades, indicadores e VAL na mesma experiência; os módulos agronômicos exibidos no aplicativo são roadmap, enquanto a integração técnica atual recebe eventos JSON estruturados do Manual.

### Manual do Agrônomo
Produto independente e de menor ticket, voltado ao uso técnico individual ou por pequenas equipes. Mantém marca, planos, autenticação, implantação e dados separados. Não inclui CRM empresarial, pipeline comercial nem a inteligência gerencial da VAL.

### Núcleo técnico compartilhado
As regras agronômicas, calculadoras, conectores oficiais e validações devem evoluir como componentes reutilizáveis e versionados. Cada produto consome somente o que seu plano autoriza, sem iframe, redirecionamento externo ou duplicação de lógica.

## Navegação
1. Dashboard
2. Clientes
3. Visitas
4. Oportunidades
5. Inteligência (VAL)
6. Inteligência Agronômica
7. Produtor 360
8. Relatórios
9. Configurações

## Estratégia de dados
As 27 perguntas atuais do Produtor 360 são mantidas por compatibilidade. Os cinco perfis são tags legadas de preferência, não diagnóstico psicológico nem evidência suficiente para decidir abordagem, preço, crédito ou condição. A VAL prioriza objetivo, preferência de prova declarada, reversibilidade, governança, horizonte, prontidão e confiança observada.
O consultor complementa na ficha Cliente 360:
- propriedade;
- plantas daninhas;
- doenças;
- pragas;
- solo;
- metas do produtor;
- concorrentes e categorias adquiridas fora da empresa;
- observações.

## Estado da versão 0.4

O piloto já possui API, autenticação mínima, PostgreSQL, engine da VAL, feedback, importação comercial e webhook JSON estruturado do Manual. Sem banco, só funciona quando `VAL_DEMO_MODE=true` foi ativado explicitamente; fora desse modo, banco e acesso falham fechados. A chave da OpenAI é opcional apenas para o fallback demonstrativo.

Próximas camadas empresariais:

- identidade corporativa, papéis e tenant autenticado;
- RLS e testes de isolamento entre empresas;
- object storage, quarentena, antivírus e OCR;
- PostGIS e processamento de raster/COG;
- feature store e ranker offline com joins point-in-time;
- avaliação contínua, shadow mode, canário e rollback;
- licenciamento independente por produto, plano, empresa e usuário.
