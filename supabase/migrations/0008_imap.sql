-- ============================================================
-- Contatia — Migration 0008 (Detecção automática de resposta via IMAP)
-- Lê a caixa por IMAP e pausa a sequência quando o contato responde.
-- Reaproveita smtp_user/smtp_pass como credencial IMAP. Roda depois de 0001-0007.
-- ============================================================

alter table public.email_accounts add column if not exists imap_host text;
alter table public.email_accounts add column if not exists imap_port int default 993;
alter table public.email_accounts add column if not exists detect_replies boolean default false;
alter table public.email_accounts add column if not exists last_reply_check_at timestamptz;

-- ============================================================
-- NOTA: o cron /api/cron/check-replies (protegido por CRON_SECRET) roda com a
-- SERVICE ROLE KEY, itera as caixas com detect_replies=true e is_active=true,
-- conecta por IMAP (host = imap_host ou smtp_host; user/pass = smtp_user/smtp_pass),
-- e marca "respondeu" quando o remetente casa com um contato em cadência ativa.
-- Caixas de ENVIO puro (ex.: Brevo) não têm inbox — não habilite detecção nelas.
-- ============================================================
