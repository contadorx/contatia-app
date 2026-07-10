-- ============================================================
-- Contatia — Migration 0025 (Google Calendar nas reuniões)
-- Roda depois de 0001-0024. Non-breaking.
-- ============================================================

alter table public.meetings add column if not exists google_event_id text;
alter table public.meetings add column if not exists google_event_link text;

-- ============================================================
-- Ao agendar, se houver uma conta Google conectada (com scope calendar.events),
-- o Contatia cria o evento no Google Calendar com o contato como convidado
-- (envia o convite) e guarda o id/link aqui. Reutiliza o oauth_refresh_token
-- de email_accounts. Reconectar o Gmail é necessário para conceder o novo scope.
-- ============================================================
