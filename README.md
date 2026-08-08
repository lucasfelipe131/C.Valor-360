# VALOR 360

Plataforma de inteligência comercial e agronômica para gerar valor em cada relação.

## Conceito
**Cliente 360 + Inteligência Agronômica + VAL**

A **VAL (Value Agriculture Intelligence)** é o cérebro do projeto.

## Interface
O frontend foi criado para seguir a identidade aprovada:
- ícone **C** como assinatura;
- nome **VALOR 360**;
- azul-marinho, azul vivo e branco;
- verde reservado para valor, resultado e oportunidade;
- layout responsivo para desktop e iPhone.

## Dados incorporados
Esta versão usa as respostas existentes do **Projeto Produtor 360** para montar a base piloto de clientes, perfis, IRT, NPS e preferências. Novos questionários, visitas, complementos técnicos e oportunidades ficam persistidos no dispositivo do usuário.

## Fluxos demonstráveis
- Dashboard e priorização comercial.
- Carteira e ficha Cliente 360.
- Questionário de 27 perguntas com cálculo de perfil, IRT e NPS.
- Preparação de visita pela VAL com objetivo, SPIN, reframe e fechamento.
- Agenda de visitas e rota priorizada.
- Pipeline de oportunidades e simulador de ROI.
- Relatório executivo do piloto para impressão/PDF.
- Backup local e governança do ambiente demonstrativo.

## Rodar localmente
```bash
npm install
npm run dev
```

## Publicar na Railway
1. Suba este projeto para o repositório GitHub.
2. Na Railway, escolha **New Project → Deploy from GitHub Repo**.
3. Selecione o repositório.
4. A Railway reconhecerá `railway.json`.
5. Gere o domínio público.

## Build
```bash
npm run build
npm run start
```

## Estrutura
- `src/` frontend React
- `src/data/` dados atuais do Produtor 360
- `database/schema.sql` modelo inicial PostgreSQL
- `docs/ARCHITECTURE.md` visão técnica
- `railway.json` configuração de deploy

## Estado
**MVP 0.3 — piloto funcional e responsivo**
