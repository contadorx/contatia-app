-- ============================================================
-- Contatia — Migration 0076 (Garantia das cotas de IA)
--
-- Reafirma as cotas de IA nos planos ativos (Individual e Equipes) e fixa os DEFAULTs
-- das colunas, para que a config no banco seja a FONTE DA VERDADE e nenhum plano novo
-- nasça sem cota. O código tem um fallback alinhado (100 total / 20 Opus) como rede de
-- segurança para quando não há plano (trial) — as duas proteções apontam pro mesmo número.
--
--   ai_quota   = 100  → total de gerações de IA por mês (padrão + Opus), renova dia 1º.
--   opus_quota = 20   → pacote Opus (qualidade máxima) por mês. (Equipes: ai_quota escala
--                       por assento no código; opus é o pacote base.)
--
-- Idempotente. Roda depois das anteriores.
-- ============================================================

-- DEFAULT das colunas (todo plano novo já nasce com a cota certa)
alter table public.platform_plans alter column ai_quota   set default 100;
alter table public.platform_plans alter column opus_quota set default 20;

-- reafirma nos planos ATIVOS (Individual e Equipes)
update public.platform_plans
   set ai_quota   = 100,
       opus_quota = 20
 where is_active = true;
