-- ============================================================
-- Contatia — Migration 0091 (Assinatura por caixa de e-mail)
--
-- Cada caixa (email_accounts) pode ter a SUA assinatura. No envio, usa a
-- assinatura da caixa que enviou; se ela estiver vazia, cai na assinatura geral
-- do workspace (tenants.email_signature) — comportamento de hoje, sem quebrar nada.
--
-- Roda depois de 0001-0090. Idempotente. Non-breaking.
-- ============================================================

alter table public.email_accounts add column if not exists signature text;
