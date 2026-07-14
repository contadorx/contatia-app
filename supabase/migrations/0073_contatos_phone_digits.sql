-- ============================================================
-- Contatia — Migration 0073 (Telefone normalizado p/ match de WhatsApp) — M9
--
-- BUG M9: o webhook de WhatsApp carregava a tabela INTEIRA de contatos e casava pelos
-- últimos 10 dígitos em JS (scan por mensagem + colisão entre números que compartilham
-- os 10 finais). Aqui: coluna phone_digits (só dígitos, os 10 finais), mantida por
-- trigger, com índice — o webhook passa a consultar direto no banco por igualdade.
--
-- Idempotente. Roda depois das anteriores.
-- ============================================================

alter table public.contacts add column if not exists phone_digits text;

-- normaliza: tira tudo que não é dígito e pega os 10 finais (DDD + número)
create or replace function public.contacts_set_phone_digits()
returns trigger language plpgsql set search_path = public as $$
begin
  new.phone_digits := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  if new.phone_digits = '' then new.phone_digits := null; end if;
  return new;
end $$;

drop trigger if exists trg_contacts_phone_digits on public.contacts;
create trigger trg_contacts_phone_digits
  before insert or update of phone on public.contacts
  for each row execute function public.contacts_set_phone_digits();

-- backfill dos existentes
update public.contacts
   set phone_digits = nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
 where phone is not null;

create index if not exists contacts_phone_digits_idx
  on public.contacts (tenant_id, phone_digits)
  where phone_digits is not null;
