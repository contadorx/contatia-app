-- ============================================================
-- Contatia — Migration 0038 (Agendamento público robusto)
-- A página /agendar/[token] é pública e não deve depender da SERVICE_ROLE_KEY.
-- Esta função SECURITY DEFINER expõe SOMENTE os campos de agendamento por token,
-- sem abrir a tabela tenants ao anônimo. Roda após 0001-0037.
-- ============================================================

create or replace function public.get_booking_config(p_token text)
returns table (
  id uuid,
  name text,
  booking_enabled boolean,
  booking_duration_min int,
  booking_days text,
  booking_start_hour int,
  booking_end_hour int,
  booking_title text
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.name, t.booking_enabled, t.booking_duration_min,
         t.booking_days, t.booking_start_hour, t.booking_end_hour, t.booking_title
  from public.tenants t
  where t.inbound_token = p_token
    and coalesce(t.booking_enabled, false) = true
  limit 1;
$$;

-- disponível para visitantes anônimos e autenticados (página pública)
grant execute on function public.get_booking_config(text) to anon, authenticated;

-- ============================================================
-- FLUXO: getBookingSlots/createBooking chamam esta RPC (via cliente anônimo do
-- servidor) para resolver o tenant e a config. Só retorna se o agendamento estiver
-- ATIVO. Não expõe nenhum outro dado do tenant. Funciona sem SERVICE_ROLE_KEY.
-- As operações que ESCREVEM (criar contato/reunião) continuam podendo usar o admin
-- client quando disponível; se não, usam RPCs específicas (ver createBooking).
-- ============================================================

-- ============================================================
-- RPC de criação do agendamento (contato + reunião) sem depender de service role.
-- Valida o token + booking ativo + horário livre; cria contato (ou reusa) e a reunião.
-- Retorna o id da reunião e o e-mail/refresh para o app criar o evento no Google depois.
-- ============================================================
create or replace function public.create_public_booking(
  p_token text,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_datetime timestamptz,
  p_note text
)
returns table (meeting_id uuid, ok boolean, msg text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_dur int;
  v_contact_id uuid;
  v_meeting_id uuid;
  v_collision int;
begin
  select * into v_tenant from public.tenants
   where inbound_token = p_token and coalesce(booking_enabled,false)=true limit 1;
  if not found then
    return query select null::uuid, false, 'Agenda não encontrada ou desativada.'; return;
  end if;
  if p_name is null or btrim(p_name)='' or p_email is null or btrim(p_email)='' then
    return query select null::uuid, false, 'Informe nome e e-mail.'; return;
  end if;
  if p_datetime is null or p_datetime < now() then
    return query select null::uuid, false, 'Horário inválido.'; return;
  end if;

  v_dur := coalesce(v_tenant.booking_duration_min, 30);

  -- horário livre? (reuniões do Contatia)
  select count(*) into v_collision from public.meetings m
   where m.tenant_id = v_tenant.id
     and m.status in ('agendada','confirmada')
     and abs(extract(epoch from (m.datetime - p_datetime))) < v_dur*60;
  if v_collision > 0 then
    return query select null::uuid, false, 'Esse horário acabou de ser reservado. Escolha outro.'; return;
  end if;

  -- contato: acha por e-mail ou cria
  select id into v_contact_id from public.contacts
   where tenant_id = v_tenant.id and lower(email)=lower(p_email) limit 1;
  if v_contact_id is null then
    insert into public.contacts (tenant_id, name, email, phone, company, origin, status, email_status)
    values (v_tenant.id, btrim(p_name), lower(p_email), nullif(btrim(coalesce(p_phone,'')),''),
            nullif(btrim(coalesce(p_company,'')),''), 'Agendamento', 'new', 'ok')
    returning id into v_contact_id;
  end if;

  insert into public.meetings (tenant_id, contact_id, title, datetime, duration_min, status, notes, source)
  values (v_tenant.id, v_contact_id,
          coalesce(nullif(btrim(coalesce(v_tenant.booking_title,'')),''), 'Reunião com '||btrim(p_name)),
          p_datetime, v_dur, 'agendada', nullif(btrim(coalesce(p_note,'')),''), 'booking')
  returning id into v_meeting_id;

  return query select v_meeting_id, true, 'ok';
end;
$$;

grant execute on function public.create_public_booking(text,text,text,text,text,timestamptz,text) to anon, authenticated;
