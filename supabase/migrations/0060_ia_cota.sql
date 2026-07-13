-- ============================================================
-- Contatia — Migration 0060 (Cota de uso justo da IA)
--
-- Protege a margem contra ABUSO da geração de cadência (o único cenário de custo
-- descontrolado). Cada plano tem uma cota mensal de gerações; Equipes multiplica
-- pela quantidade de assentos. O limite é generoso — só pega uso anormal.
--
-- A contagem usa events (type='ai_generation'); não precisa de tabela nova.
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.platform_plans add column if not exists ai_quota int not null default 100;

-- Individual: 100 gerações/mês · Equipes: 100 por assento/mês (x nº de assentos no app)
update public.platform_plans set ai_quota = 100 where is_active = true;
