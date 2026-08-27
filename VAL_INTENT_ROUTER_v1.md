# VAL Intent Router v1

Contrato: `val.intent_router.v1`.

Intenções: `ASK_GENERAL`, `ASK_CLIENT`, `PREPARE_VISIT`, `REGISTER_NOTE`, `POST_VISIT`, `AGRONOMIC_ANALYSIS`, `IMAGE_DIAGNOSIS`, `SOIL_INTERPRETATION`, `VALUE_ANALYSIS`, `OBJECTION_HELP`, `OPPORTUNITY_REVIEW` e `FOLLOW_UP_HELP`.

O roteador usa dica explícita válida, mensagem, anexos e presença de cliente. `REGISTER_NOTE` e `POST_VISIT` recebem `CONFIRM_REQUIRED`; todas as perguntas recebem `NONE`. A API de pergunta rejeita intenções que exigem confirmação e orienta o usuário ao fluxo de registro.

O intent não concede acesso, não escolhe tenant e não desativa safety.
