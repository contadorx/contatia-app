-- ============================================================
-- Contatia — Migration 0111 (várias mensagens para o mesmo passo)
--
-- POR QUE: WhatsApp e Instagram tratam texto idêntico repetido como padrão de
-- disparo. A cadência precisa poder guardar N redações do MESMO passo, e cada
-- inscrição levar uma — o cronograma continua igual, muda só a redação.
--
-- O QUE ENTRA:
--   sequence_steps.body_variants  jsonb  → redações ALTERNATIVAS (array de textos).
--       A principal continua em `body_template`; este campo guarda só as extras.
--       Assim toda cadência existente segue funcionando sem migração de dados.
--   tasks.body_variant            int    → qual redação foi usada (0 = a principal).
--       Existe para o relatório poder responder "qual versão traz mais resposta?".
--
-- E a função `replace_sequence_steps` (0072) é recriada para carregar o campo novo.
-- Sem isso a edição de cadência salvaria os passos SEM as variações, em silêncio —
-- exatamente o tipo de perda que não dá erro nenhum.
--
-- Idempotente. Non-breaking: sem o campo preenchido, o comportamento é o de hoje.
-- ============================================================

alter table public.sequence_steps add column if not exists body_variants jsonb;
alter table public.tasks          add column if not exists body_variant  int;

-- Índice não é necessário: `body_variant` é lido em relatório agregado por passo,
-- sempre junto de tenant/cadência, que já têm índice.

create or replace function public.replace_sequence_steps(p_seq uuid, p_tenant uuid, p_steps jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.sequence_steps where sequence_id = p_seq and tenant_id = p_tenant;

  insert into public.sequence_steps
    (sequence_id, tenant_id, position, channel, delay_days, subject, subject_b, body_template, body_variants)
  select
    p_seq,
    p_tenant,
    (elem->>'position')::int,
    (elem->>'channel')::channel,
    coalesce((elem->>'delay_days')::int, 0),
    nullif(elem->>'subject', ''),
    nullif(elem->>'subject_b', ''),
    nullif(elem->>'body_template', ''),
    case
      when jsonb_typeof(elem->'body_variants') = 'array'
       and jsonb_array_length(elem->'body_variants') > 0
      then elem->'body_variants'
      else null
    end
  from jsonb_array_elements(p_steps) as elem;
end
$$;

grant execute on function public.replace_sequence_steps(uuid, uuid, jsonb) to authenticated;
