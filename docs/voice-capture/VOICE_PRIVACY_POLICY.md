# Política de privacidade do Voice Capture

Status: controles técnicos implementados e validados em CI/staging técnico. Este documento não substitui revisão jurídica, aviso de privacidade, política corporativa ou a jornada integral de privacidade.

## Finalidade

O Voice Capture permite que o consultor registre conscientemente uma nota falada, revise o que a VAL entendeu e autorize efeitos nos módulos existentes.

Não é finalidade:

- monitorar pessoas;
- gravar conversa inteira em segredo;
- analisar emoção, tom ou personalidade pela voz;
- inferir característica sensível;
- fazer biometria vocal;
- gerar prescrição agronômica;
- promover conhecimento automaticamente;
- reutilizar mídia para finalidade não declarada.

## Dados tratados

| Classe | Natureza |
|---|---|
| tenant, ator, produtor e visita | identidade operacional confidencial |
| áudio bruto | conteúdo potencialmente sensível |
| transcript | conteúdo sensível, falível e não confiável |
| candidatos | extração não confirmada |
| revisão | decisão auditável do consultor |
| efeitos | dados de domínio sob regras MMI/MCTX/MIC/MEX/Visit Loop |
| metadata | provider, modelo, duração, estado, tentativa e IDs |

## Captura consciente

O microfone só é solicitado depois da ação do consultor. A UI mostra gravação, cronômetro, parar e cancelar. Não há listener em background, ativação automática, gravação contínua ou gravação de reunião escondida.

O foco é uma nota falada pelo consultor. Gravação futura de conversa com produtor/terceiro exige consentimento e política jurídica próprios antes de ser habilitada.

## Minimização implementada

- áudio limitado a 6.000.000 bytes e 900 segundos;
- OpenAI recebe somente o arquivo, modelo, idioma opcional e keywords genéricas configuradas no adapter;
- a transcrição não recebe dossiê completo do produtor;
- `source_context` remove chaves que sugiram secret, token, áudio, transcript, prompt ou instrução;
- localStorage guarda somente ID pendente e timestamp;
- logs usam allowlist de metadata operacional;
- áudio, transcript, candidato e prompt não entram em eventos de observabilidade;
- provider real opera server-side.

## Identidade e autorização

`organization_id` e `actor_id` vêm da sessão. `client_id` e `visit_id` são resolvidos no repositório da carteira autorizada.

As rotas de voz são protegidas por autenticação, bloqueio enquanto a senha bootstrap exigir troca e disponibilidade do PostgreSQL fora de demo. Cada operação recebe tenant/ator do servidor, não do corpo.

O GET autorizado pode retornar transcript para revisão. Não existe endpoint público de mídia nem URL permanente. Acesso alheio retorna não encontrado/negado sem conteúdo.

## Processamento externo

Quando `OPENAI_API_KEY` está configurada, o áudio é enviado ao adapter OpenAI para transcrição e o transcript pode ser enviado à Responses API para extração estruturada. Sem a chave, áudio não é transcrito; texto manual e extração determinística continuam disponíveis.

Antes de habilitar em um ambiente, precisam ser verificados termos, região, controles de dados e finalidade da conta. Esta implementação não prova, por si só, condições jurídicas ou de retenção do terceiro.

Staging deve usar chave própria e somente produtor/áudio fictícios.

## Transcript como dado não confiável

O extractor delimita transcript como conteúdo do usuário e aplica schema fechado. Texto como “ignore as políticas” não altera system/developer prompts, não executa comando e não chama ferramenta.

Filtros determinísticos descartam:

- prompt injection/comandos;
- atributos sensíveis ou inferidos da voz;
- prescrição agronômica/dose/manejo.

Esses filtros são reaplicados em edição, adição e próximo passo.

## Fato e interpretação

Confidence não define verdade. Mesmo depois de confirmação:

- declaração explícita pode virar memória `FACT/verified`;
- inferência permanece `INFERENCE/proposed`;
- hipótese permanece `HYPOTHESIS/proposed`.

“Achou caro” não autoriza inferir “está sem dinheiro”.

## Perfil comportamental

Somente comportamento observável pode virar sinal, por exemplo pedido de ROI, números, custo/ha ou comparativo. O código bloqueia referências a tom, prosódia, sotaque, emoção, gênero e idade aparente.

Não existe score psicológico amplo de sentimento.

## Informação agronômica

Relato de buva/talhão pode virar observação ou oportunidade candidata. Depois da confirmação:

- a memória usa `REPORTED_OBSERVATION` e exige revisão técnica;
- oportunidade técnica recebe `REQUIRES_MIA`;
- nenhum herbicida, dose, mistura ou manejo é gerado automaticamente.

## Confirmação humana

Antes de `CONFIRMED`, tabelas de domínio não são alteradas pelo Voice Capture. O consultor decide cada item, pode editar, rejeitar e adicionar. O candidato inicial e a revisão final ficam separados.

Confirmação não apaga automaticamente áudio/transcript e não transforma inferência em fato.

## Retenção

Áudio, transcript e efeitos têm ciclos separados em `VOICE_STORAGE_POLICY.md`. Nesta versão:

- não há deleção automática;
- o áudio é temporário por intenção arquitetural, mas permanece no PostgreSQL;
- não há legal hold implementado;
- deleção definitiva exige política e autorização futuras.

## Observabilidade

Eventos permitidos incluem IDs pseudônimos, tipo, estado, provider/model, tentativa, duração, contagens e códigos de erro. Eventos de uso guardam metadata estritamente operacional.

São proibidos:

- bytes/base64;
- transcript ou trechos;
- texto candidato/editado;
- prompt e resposta bruta do provider;
- `OPENAI_API_KEY`, headers ou token;
- URL/credencial de storage.

Testes verificam a allowlist; o smoke real do provider registrou apenas metadata operacional, sem transcript ou chave. A jornada integral ainda deve repetir essa inspeção.

## Ambientes e pendências

Produção não faz parte desta entrega. Nenhum dado real deve ser copiado para staging.

Evidência ainda necessária:

- repetição cross-tenant pela superfície HTTP implantada (o gate PostgreSQL 16 já foi aprovado no CI);
- transcrição OpenAI real dentro da jornada autenticada (o adapter real isolado já foi aprovado);
- inspeção de logs do ambiente;
- navegação móvel e permissão do microfone em dispositivos reais;
- validação jurídica/organizacional antes de uso com pessoas reais.

## Incidente

Suspeita de exposição de secret, áudio, transcript ou tenant exige interromper o caminho, preservar metadata mínima, revogar credenciais quando necessário, identificar o escopo, seguir o processo de incidente e testar isolamento antes de reativar.

## Fora de escopo

- conclusão jurídica sobre consentimento;
- gravação secreta/automática;
- biometria e análise emocional;
- compartilhamento externo de mídia;
- treinamento/promoção automática;
- retenção ou exclusão definitiva.
