-- ============================================================
-- Contatia — Migration 0097 (Captura de telefone/WhatsApp no site)
--
-- Marca o estado da captura por contato. A captura lê o site público da empresa
-- (HTTP) e extrai wa.me (WhatsApp CONFIRMADO), tel: e telefones no texto. Um wa.me
-- já entra como wa_status='valid'; um telefone comum entra na fila de verificação
-- (wa_status='queued') para o cron confirmar no WhatsApp.
--
-- web_capture: null (nunca) | queued (na fila do cron) | done | notfound | error
-- Roda depois da 0096.
-- ============================================================

alter table public.contacts add column if not exists web_capture text;

create index if not exists contacts_web_capture_idx
  on public.contacts(tenant_id, web_capture)
  where web_capture is not null;
