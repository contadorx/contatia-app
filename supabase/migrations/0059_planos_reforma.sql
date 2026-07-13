-- ============================================================
-- Contatia — Migration 0059 (Reforma dos planos — estrutura final e simples)
--
-- Decisão estratégica (menos é mais): DOIS planos, IA incluída nos dois.
--   INDIVIDUAL — R$127/mês · 1 usuário · tudo + IA (sem gestão de equipe).
--   EQUIPES    — R$147/assento/mês · MÍNIMO 3 assentos · tudo + gestão de equipe + IA.
--
-- Muda em relação ao anterior: remove o plano básico do Individual; a IA deixa de
-- ser exclusiva do topo e vira padrão; Equipes passa a exigir 3 assentos (cobrança
-- mínima por 3 mesmo com menos gente). Preços são proposta estratégica — ajustáveis.
--
-- Roda depois das anteriores. Idempotente. Non-breaking (aposenta os antigos).
-- ============================================================

alter table public.platform_plans add column if not exists min_seats int not null default 1;

-- aposenta todo o catálogo anterior (os tenants mantêm o plan_id; só somem do seletor)
update public.platform_plans set is_active = false
 where name in ('Essencial', 'Individual Pro', 'Performance Individual', 'Profissional', 'Performance', 'Time');

-- INDIVIDUAL (solo, IA incluída)
insert into public.platform_plans (name, price_monthly, max_seats, min_seats, sort, has_ai, segment, is_active)
select 'Individual', 127, 1, 1, 1, true, 'individual', true
where not exists (select 1 from public.platform_plans where name = 'Individual' and segment = 'individual');

-- EQUIPES (por assento, mínimo 3, IA incluída)
insert into public.platform_plans (name, price_monthly, max_seats, min_seats, sort, has_ai, segment, is_active)
select 'Equipes', 147, null, 3, 2, true, 'equipe', true
where not exists (select 1 from public.platform_plans where name = 'Equipes' and segment = 'equipe');
