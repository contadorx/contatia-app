-- ============================================================
-- Contatia — Migration 0024 (Reuniões 2.0 — registro rico)
-- Roda depois de 0001-0023. Non-breaking.
-- ============================================================

alter table public.meetings add column if not exists duration_min int default 30;
alter table public.meetings add column if not exists location text;         -- link do meet / endereço
alter table public.meetings add column if not exists notes text;            -- pauta/preparação
alter table public.meetings add column if not exists outcome text;          -- resultado (pós-reunião)
alter table public.meetings add column if not exists outcome_status text;   -- avancou | sem_interesse | remarcar | fechou

-- ============================================================
-- A agenda lê meetings por datetime. O resultado (outcome/outcome_status) é
-- preenchido depois da reunião — vira base para conversão e próximo passo.
-- ============================================================
