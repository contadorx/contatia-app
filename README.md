# Contatia — App (Fase 0 + Fundação B2B)

Cadência de vendas + pipeline CRM, multi-tenant (Next.js 14 + Supabase + Vercel).

## 1. Banco (Supabase)
1. Crie um projeto no Supabase.
2. SQL Editor → rode NA ORDEM:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_fundacao_b2b.sql`
3. Settings → API: copie a Project URL e a anon/public key.

## 2. Variáveis de ambiente
`cp .env.local.example .env.local` e preencha:
    NEXT_PUBLIC_SUPABASE_URL=...
    NEXT_PUBLIC_SUPABASE_ANON_KEY=...

## 3. Rodar local
    npm install
    npm run dev
Build de teste (env fake): ver seção no fim.

## 4. Deploy (Vercel)
1. Suba o repositório no GitHub.
2. Vercel → New Project → importe o repo (framework Next.js é detectado sozinho).
3. Settings → Environment Variables: adicione as DUAS vars acima (Production + Preview).
4. Deploy.
5. Supabase → Authentication → URL Configuration:
   - Site URL: https://SEU-APP.vercel.app
   - Redirect URLs: https://SEU-APP.vercel.app/auth/callback
   (sem isso, o login/confirmação de e-mail não volta pro app)
6. (Opcional, p/ testar rápido) Authentication → Providers → Email:
   desligue "Confirm email" enquanto testa; religue depois.

## 5. Bootstrap do seu acesso (1x)
1. Acesse /login no app publicado e CADASTRE-SE.
2. Supabase → Authentication → Users: copie seu user id.
3. SQL Editor → rode o bloco SEED comentado no FIM de 0001_init.sql
   (cria o tenant, te promove a `owner` e cria os estágios do pipeline),
   trocando SEU_USER_ID e o TENANT_ID.
4. Recarregue o dashboard.

## O que já roda (Fase 0)
Auth · contatos (add + importar CSV) · cockpit "Hoje" · Radar (placeholder).
A migration 0002 cria a fundação B2B (accounts, opportunities, meetings, documents,
tracking, scoring) — as TABELAS já existem; as telas dessas features vêm nas próximas fatias.

## Build de teste (env fake)
    NEXT_PUBLIC_SUPABASE_URL="https://fake.supabase.co" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="fake" npm run build
