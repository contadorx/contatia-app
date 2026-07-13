-- ============================================================
-- Contatia — Migration 0061 (Pacote Opus — qualidade máxima)
--
-- Além da geração padrão (Sonnet, dentro da cota de uso justo), cada workspace
-- ganha um PACOTE mensal de gerações no Opus (o modelo topo) para as cadências
-- que você quer impecáveis. É bounded de propósito: ~R$0,43/geração, 20/mês ≈ R$8,60.
--
-- Uso do Opus conta como event type='ai_generation_opus' (separado do padrão).
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.platform_plans add column if not exists opus_quota int not null default 20;

update public.platform_plans set opus_quota = 20 where is_active = true;
