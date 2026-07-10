-- ============================================================
-- Contatia — Migration 0013 (Assinatura de e-mail)
-- Assinatura padrão do workspace, anexada aos envios de e-mail da cadência.
-- Roda depois de 0001-0012. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists email_signature text;

-- Suporta as variáveis {{primeiro_nome}}/{{empresa}} e um placeholder simples de
-- marca. Editável pelo owner (policy tenants_update_owner de 0011).
