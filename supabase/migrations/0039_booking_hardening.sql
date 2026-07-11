-- ============================================================
-- Contatia — Migration 0039 (Endurecimento do agendamento público)
-- Corrige dois achados da auditoria de 10/07:
-- (a) create_public_booking aceitava qualquer horário via POST direto (fora dos
--     dias/horários configurados pelo dono da agenda);
-- (b) sem proteção contra flood: um visitante podia criar reuniões ilimitadas.
-- A validação roda em BRT (UTC-3, fixo — sem horário de verão desde 2019),
-- igual à geração de slots no app. Roda após 0038.
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
  v_future int;
  v_brt timestamptz;
  v_dow int;
  v_minutes int;
  v_start_min int;
  v_end_min int;
begin
  select * into v_tenant from public.tenants
   where inbound_token = p_token and coalesce(booking_enabled,false)=true limit 1;
  if not found then
    return query select null::uuid, false, 'Agenda não encontrada ou desativada.'; return;
  end if;
  if p_name is null or btrim(p_name)='' or p_email is null or btrim(p_email)='' then
    return query select null::uuid, false, 'Informe nome e e-mail.'; return;
  end if;
  if p_datetime is null or p_datetime < now() + interval '55 minutes' then
    return query select null::uuid, false, 'Horário inválido.'; return;
  end if;

  -- (a) valida a janela configurada, em BRT (dia da semana + faixa de horário)
  v_brt := p_datetime at time zone 'America/Sao_Paulo';
  v_dow := extract(dow from v_brt)::int;                       -- 0=domingo ... 6=sábado
  v_minutes := extract(hour from v_brt)::int * 60 + extract(minute from v_brt)::int;
  v_start_min := coalesce(v_tenant.booking_start_hour, 9) * 60;
  v_end_min := coalesce(v_tenant.booking_end_hour, 18) * 60;
  v_dur := coalesce(v_tenant.booking_duration_min, 30);

  if not (v_dow = any (string_to_array(coalesce(v_tenant.booking_days,'1,2,3,4,5'), ',')::int[])) then
    return query select null::uuid, false, 'Esse dia não está disponível para agendamento.'; return;
  end if;
  if v_minutes < v_start_min or (v_minutes + v_dur) > v_end_min then
    return query select null::uuid, false, 'Esse horário está fora da janela de atendimento.'; return;
  end if;
  if (extract(minute from v_brt)::int % 30) <> 0 then
    return query select null::uuid, false, 'Escolha um horário válido da lista.'; return;
  end if;

  -- (b) anti-flood: 1 reunião futura por e-mail nesta agenda
  select count(*) into v_future from public.meetings m
   join public.contacts c on c.id = m.contact_id
   where m.tenant_id = v_tenant.id
     and m.status in ('agendada','confirmada')
     and m.datetime > now()
     and lower(c.email) = lower(p_email);
  if v_future > 0 then
    return query select null::uuid, false, 'Você já tem uma reunião marcada nesta agenda. Se precisar remarcar, responda o e-mail de confirmação.'; return;
  end if;

  -- horário ainda livre? (reuniões do Contatia)
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
