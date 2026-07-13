-- ============================================================
-- Contatia — Migration 0055 (IA exclusiva do plano de topo)
--
-- Decisão de produto: a geração de cadência com IA (que consome API paga por
-- geração) deixa de estar no Profissional e passa a ser EXCLUSIVA de um novo
-- plano de TOPO ("Performance"). O gate é data-driven: platform_plans.has_ai.
-- No app, o trial continua liberando tudo (o cliente sente o produto); após o
-- trial, a IA só existe no plano com has_ai.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.platform_plans add column if not exists has_ai boolean not null default false;

-- IA sai do Profissional (e de qualquer outro) — só o topo terá
update public.platform_plans set has_ai = false where name in ('Essencial', 'Profissional', 'Time');

-- novo plano de topo que concentra a IA (preço PLACEHOLDER, sujeito a ajuste)
insert into public.platform_plans (name, price_monthly, max_seats, sort, has_ai)
select 'Performance', 279, null, 4, true
where not exists (select 1 from public.platform_plans where name = 'Performance');
