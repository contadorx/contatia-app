-- ============================================================
-- Contatia — Migration 0096 (Verificação de WhatsApp em massa)
--
-- Marca, por contato, se o número TEM WhatsApp e guarda o número que existe
-- (o Brasil tem o problema do 9º dígito: a conta pode estar registrada com ou
-- sem o 9). A verificação usa o endpoint whatsappNumbers do Evolution, em LOTE
-- (uma chamada por vários números) e com RITMO (cron) para não sinalizar
-- comportamento de scraping ao WhatsApp.
--
-- wa_status:  null (nunca verificado) | queued (na fila do cron) | valid | invalid | error
-- Roda depois da 0095.
-- ============================================================

alter table public.contacts add column if not exists wa_status     text;
alter table public.contacts add column if not exists wa_number     text;         -- número que EXISTE no WhatsApp (com/sem 9)
alter table public.contacts add column if not exists wa_checked_at  timestamptz;

-- o cron encontra os pendentes rápido: (tenant, status) só para linhas com status.
create index if not exists contacts_wa_status_idx
  on public.contacts(tenant_id, wa_status)
  where wa_status is not null;
