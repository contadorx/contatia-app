-- ============================================================
-- Contatia — Migration 0072 (Substituição transacional dos passos) — M2
--
-- BUG M2: updateSequence fazia delete() e depois insert() em duas chamadas. Se o insert
-- falhasse, os passos antigos já tinham sido apagados e não havia rollback → cadência
-- ficava SEM passos e novas inscrições quebravam.
--
-- Aqui: uma função que faz delete + insert no MESMO comando (uma transação) — ou tudo
-- grava, ou nada muda. SECURITY INVOKER (padrão): a RLS do usuário continua valendo,
-- então ninguém escreve passos em cadência de outro tenant.
--
-- Idempotente (create or replace). Roda depois das anteriores.
-- ============================================================

create or replace function public.replace_sequence_steps(p_seq uuid, p_tenant uuid, p_steps jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.sequence_steps where sequence_id = p_seq and tenant_id = p_tenant;

  insert into public.sequence_steps
    (sequence_id, tenant_id, position, channel, delay_days, subject, subject_b, body_template)
  select
    p_seq,
    p_tenant,
    (elem->>'position')::int,
    (elem->>'channel')::channel,
    coalesce((elem->>'delay_days')::int, 0),
    nullif(elem->>'subject', ''),
    nullif(elem->>'subject_b', ''),
    nullif(elem->>'body_template', '')
  from jsonb_array_elements(p_steps) as elem;
end
$$;

grant execute on function public.replace_sequence_steps(uuid, uuid, jsonb) to authenticated;
