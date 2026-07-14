-- ============================================================
-- Contatia — Migration 0065 (Token de captação por padrão)
--
-- A coluna tenants.inbound_token (0005) não tinha DEFAULT, então workspaces novos
-- (criados no onboarding self-service) nasciam sem token → web-to-lead e link de
-- agendamento não apareciam. Aqui: default automático + backfill dos que estão nulos.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.tenants
  alter column inbound_token set default replace(gen_random_uuid()::text, '-', '');

update public.tenants
  set inbound_token = replace(gen_random_uuid()::text, '-', '')
  where inbound_token is null or inbound_token = '';
