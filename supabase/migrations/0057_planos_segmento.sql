-- ============================================================
-- Contatia — Migration 0057 (Planos: Individual x Equipes)
--
-- Reestrutura o catálogo em DOIS segmentos, com uma aba em /planos:
--   INDIVIDUAL (solo, 1 assento): Essencial · Individual Pro
--   EQUIPES   (por assento):      Profissional · Performance (IA)
-- O antigo "Time" é aposentado. A IA segue exclusiva do topo (Performance/has_ai).
--
-- Nível plataforma. Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.platform_plans add column if not exists segment text not null default 'equipe';

-- INDIVIDUAL — Essencial (solo)
update public.platform_plans set segment = 'individual', max_seats = 1, sort = 1 where name = 'Essencial';

-- aposenta o "Time" (substituído pela estrutura Individual/Equipes)
update public.platform_plans set is_active = false where name = 'Time';

-- EQUIPES — Profissional (sem IA) e Performance (com IA)
update public.platform_plans set segment = 'equipe', max_seats = null, sort = 3, has_ai = false where name = 'Profissional';
update public.platform_plans set segment = 'equipe', max_seats = null, sort = 4, has_ai = true  where name = 'Performance';

-- novo INDIVIDUAL PRO (solo turbinado — sem IA e sem gestão de equipe)
insert into public.platform_plans (name, price_monthly, max_seats, sort, has_ai, segment, is_active)
select 'Individual Pro', 149, 1, 2, false, 'individual', true
where not exists (select 1 from public.platform_plans where name = 'Individual Pro');
