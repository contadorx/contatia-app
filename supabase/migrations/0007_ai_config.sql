-- ============================================================
-- Contatia — Migration 0007 (Config de IA por workspace)
-- Modelo e chave da IA no tenant, editáveis pela interface (sem depender de env).
-- Roda depois de 0001-0006. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists ai_model   text;
alter table public.tenants add column if not exists ai_api_key text;   -- ver NOTA

-- ============================================================
-- NOTA DE SEGURANÇA: ai_api_key em texto puro, protegido pela RLS (tenant).
-- Mesmo tratamento do smtp_pass — para produção, criptografar em repouso.
-- O app NUNCA devolve a chave ao client (a página lê só um booleano "tem chave").
-- Fallback: se o tenant não setar, usa ANTHROPIC_API_KEY/ANTHROPIC_MODEL do ambiente.
-- ============================================================
