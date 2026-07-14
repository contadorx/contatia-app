-- ============================================================
-- Contatia — Migration 0074 (Mensagem de WhatsApp única) — B9
--
-- BUG B9: o dedup do webhook era check-then-insert com o erro do insert não inspecionado
-- → entregas duplicadas da Evolution podiam gravar a mesma mensagem duas vezes e dobrar
-- a pontuação. Aqui: índice único por (tenant_id, wa_message_id) — o upsert idempotente
-- do webhook passa a ter árbitro real. Deduplica o que já existe antes de criar.
--
-- Idempotente. Roda depois das anteriores.
-- ============================================================

with ranked as (
  select id, row_number() over (
           partition by tenant_id, wa_message_id
           order by created_at asc, id asc
         ) as rn
    from public.whatsapp_messages
   where wa_message_id is not null
)
delete from public.whatsapp_messages m
 using ranked r
 where m.id = r.id and r.rn > 1;

-- índice SIMPLES (não parcial): linhas com wa_message_id nulo são tratadas como
-- distintas pelo Postgres (multi-coluna com NULL), então convivem; e o upsert
-- ON CONFLICT (tenant_id, wa_message_id) consegue inferir este índice.
create unique index if not exists whatsapp_messages_waid_uniq
  on public.whatsapp_messages (tenant_id, wa_message_id);
