-- ============================================================
-- Contatia — Migration 0003 (Fase 1 · Envio de e-mail)
-- Credenciais de envio em email_accounts: SMTP genérico + Gmail OAuth2.
-- Roda DEPOIS de 0001 e 0002. Non-breaking: só adiciona colunas.
-- ============================================================

alter table public.email_accounts add column if not exists smtp_host   text;
alter table public.email_accounts add column if not exists smtp_port   int;
alter table public.email_accounts add column if not exists smtp_secure boolean default false;
alter table public.email_accounts add column if not exists smtp_user   text;
alter table public.email_accounts add column if not exists smtp_pass   text;   -- ver NOTA de segurança
alter table public.email_accounts add column if not exists oauth_refresh_token text;

-- para o cap diário do Envio Seguro por caixa: marca a caixa usada no evento
alter table public.events add column if not exists email_account_id uuid
  references public.email_accounts(id) on delete set null;

-- ============================================================
-- NOTA DE SEGURANÇA (dívida técnica registrada):
-- smtp_pass e oauth_refresh_token estão em texto puro, protegidos só pela RLS
-- (tenant). Para produção, criptografar em repouso (pgsodium/Vault) OU mover os
-- segredos para um secrets manager. O app NUNCA devolve esses campos ao client
-- (as páginas selecionam só metadados; o envio lê os segredos no servidor).
-- ============================================================
