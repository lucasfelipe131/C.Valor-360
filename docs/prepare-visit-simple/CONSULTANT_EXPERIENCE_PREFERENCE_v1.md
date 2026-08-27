# Consultant Experience Preference v1

Versão: `val.consultant_experience_preference.v1`

## Valores

- `SIMPLE`: essencial aberto; detalhes fechados.
- `BALANCED`: essencial e análise abertos; números sob demanda.
- `ANALYTICAL`: essencial, análise e números disponíveis e abertos.

O default é `SIMPLE`. A preferência é do consultor, não do produtor.

## Escopo e persistência

Nesta versão de staging a escolha é armazenada no navegador com chave composta por versão e `storageScope` autenticado. Assim, usuários diferentes no mesmo navegador não compartilham a preferência. Não há migration nem novo recurso pago.

## Regra de neutralidade decisória

A preferência não é enviada à API, ao modelo, aos prompts ou aos módulos cognitivos. Ela não pode mudar fatos, perfil do produtor, `ContextSnapshot`, `DecisionThesis`, `ValuePlan`, `ActionPlan`, safety ou provenance. Muda somente quais blocos já começam expandidos.

