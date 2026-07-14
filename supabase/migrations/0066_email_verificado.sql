-- ============================================================
-- Contatia — Migration 0066 (Status de validação da caixa de e-mail)
--
-- CFG-05: a caixa SMTP salva ficava "cinza" mesmo quando o teste de conexão
-- falhava — sem sinal de válida/ inválida. Aqui: colunas para registrar se a
-- conexão foi validada com sucesso e quando. A UI mostra verde (validada) /
-- vermelho (não validada) a partir daqui.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

alter table public.email_accounts
  add column if not exists verified boolean not null default false;

alter table public.email_accounts
  add column if not exists verified_at timestamptz;
