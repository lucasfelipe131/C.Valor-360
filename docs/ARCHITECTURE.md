# VALOR 360 — Estrutura do Projeto

## Proposta central
**VALOR 360 = CRM empresarial + Cliente 360 + Inteligência Agronômica + VAL**

- **Cliente 360:** perfil, NPS, IRT, preferências, histórico e contexto do produtor.
- **Inteligência Agronômica:** conjunto completo de motores técnicos dentro do VALOR 360.
- **VAL — Value Agriculture Intelligence:** cérebro que transforma dados em próxima melhor ação.

## Portfólio de produtos

### VALOR 360
Plataforma completa para empresas. Reúne CRM, gestão de carteira, visitas, oportunidades, indicadores, VAL e todos os módulos de inteligência agronômica na mesma experiência, autenticação e base de dados.

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
Por enquanto, as 27 perguntas atuais do Produtor 360 são mantidas.
O consultor complementa na ficha Cliente 360:
- propriedade;
- plantas daninhas;
- doenças;
- pragas;
- solo;
- metas do produtor;
- concorrentes e categorias adquiridas fora da empresa;
- observações.

## MVP
A versão atual é frontend navegável com dados reais das primeiras respostas.
O próximo passo é:
- PostgreSQL;
- login;
- persistência;
- API;
- VAL com modelo de IA;
- migração gradual dos motores agronômicos para componentes compartilhados;
- licenciamento independente por produto, plano, empresa e usuário.
