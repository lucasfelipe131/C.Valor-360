# Cliente 360 v2 — memória viva

## Propósito

O Cliente 360 responde “o que sabemos, o que mudou e o que fazer depois”, antes de abrir cadastro ou relatório.

## Primeira camada

- relação atual, sem score técnico desnecessário;
- última interação conhecida;
- até três prioridades/oportunidades;
- compromisso ativo ou próxima ação;
- perfil apenas quando sustentado por sinais observáveis;
- mudança recente confirmada;
- ações **Preparar com a VAL** e **Registrar informação**.

Ausências são apresentadas como lacunas, nunca preenchidas com texto genérico. Voz não confirmada não aparece como memória consolidada.

## Drill-down

Os componentes existentes são preservados sob camadas opcionais:

- Histórico e visitas;
- Comercial, compras e financeiro;
- Agronomia e evidências;
- Perfil e preferências;
- Fotos e documentos;
- Cadastro e complemento técnico.

## Regra de identidade

“Clientes” é a carteira e o Cliente 360 é o dossiê de cada produtor. O antigo “Produtor 360” de questionários passa a ser coleta de preferências, não um segundo lugar para entender o produtor.

## Voz

`CLIENT_NOTE` continua usando transcrição, extração e revisão humana. Após confirmação, a tela atualiza a primeira camada e o contexto futuro. O componente não lê nem persiste transcrição bruta em log.

## Critérios

- informação importante aparece antes do cadastro;
- usuário encontra mudança e próximo passo sem scroll longo;
- profundidade anterior permanece disponível;
- nenhuma memória cruza tenant;
- áudio rejeitado ou pendente não altera a visão consolidada.
