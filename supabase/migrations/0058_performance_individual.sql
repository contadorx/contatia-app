-- ============================================================
-- Contatia — Migration 0058 (Performance também no Individual)
--
-- O segmento INDIVIDUAL ganha um tier Performance COM IA — o solo que quer a IA
-- não precisa mais ir para um plano de equipe. Fica o mesmo ladder nos dois
-- segmentos: "Pro" (sem IA) → "Performance" (com IA).
--
--   INDIVIDUAL: Essencial · Individual Pro · Performance Individual (IA)
--   EQUIPES:    Profissional · Performance (IA)
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

insert into public.platform_plans (name, price_monthly, max_seats, sort, has_ai, segment, is_active)
select 'Performance Individual', 219, 1, 3, true, 'individual', true
where not exists (select 1 from public.platform_plans where name = 'Performance Individual');
