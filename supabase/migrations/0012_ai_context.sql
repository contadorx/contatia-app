-- ============================================================
-- Contatia — Migration 0012 (Contexto rico da IA de cadência)
-- Guarda o briefing estruturado no tenant para reuso. Roda depois de 0001-0011.
-- ============================================================

alter table public.tenants add column if not exists ai_context jsonb not null default '{}'::jsonb;

-- ai_context guarda: { market, product, icp, tone, pain, proof, goal, cta, avoid, steps, channels }
-- Editável pelo owner (usa a policy tenants_update_owner criada em 0011).
