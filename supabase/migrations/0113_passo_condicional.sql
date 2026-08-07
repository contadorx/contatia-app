-- ============================================================
-- Contatia — Migration 0113 (passo condicional na cadência)
--
-- POR QUE: a cadência é uma régua — passo 2 no dia 3, aconteça o que acontecer. Isso
-- trata igual quem abriu três vezes e quem nunca viu nada. O que se quer é o que um
-- vendedor faz: "abriu o e-mail? então chama no WhatsApp".
--
-- O QUE ENTRA:
--   sequence_steps.condicao  jsonb → a regra do passo, escolhida na cadência.
--   tasks.condicao           jsonb → a MESMA regra, copiada na inscrição.
--
-- Por que copiar na tarefa em vez de ler do passo na hora? Pelo mesmo motivo do texto:
-- a tarefa é o compromisso que já foi assumido com aquele contato. Se alguém editar a
-- cadência amanhã, o que está na fila não muda sozinho — e quando você QUISER que mude,
-- existe o "Atualizar toques pendentes", que é explícito e simula antes.
--
-- Formato: {"tipo":"abriu_email","passo":0}  (passo = posição observada; null = qualquer
-- passo anterior). Os tipos aceitos estão em src/lib/condicoes.ts — validar aqui no
-- banco deixaria a regra em dois lugares, e um dia eles divergem.
--
-- Idempotente. Non-breaking: sem condição, o passo sai como sempre saiu.
-- ============================================================

alter table public.sequence_steps add column if not exists condicao jsonb;
alter table public.tasks          add column if not exists condicao jsonb;

comment on column public.sequence_steps.condicao is
  'Regra opcional do passo: {"tipo":"abriu_email|nao_abriu_email|clicou|nao_clicou|tem_whatsapp|tem_email|tem_instagram|tem_linkedin","passo":N|null}';

-- A função que salva os passos (0072/0111) precisa conhecer o campo novo. Sem isto a
-- edição de cadência gravaria os passos SEM a condição, em silêncio — a mesma perda
-- muda que a 0111 já teve de consertar uma vez.
create or replace function public.replace_sequence_steps(p_seq uuid, p_tenant uuid, p_steps jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.sequence_steps where sequence_id = p_seq and tenant_id = p_tenant;

  insert into public.sequence_steps
    (sequence_id, tenant_id, position, channel, delay_days, subject, subject_b, body_template, body_variants, condicao)
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
    end,
    case
      when jsonb_typeof(elem->'condicao') = 'object'
       and coalesce(elem->'condicao'->>'tipo', '') <> ''
      then elem->'condicao'
      else null
    end
  from jsonb_array_elements(p_steps) as elem;
end
$$;

grant execute on function public.replace_sequence_steps(uuid, uuid, jsonb) to authenticated;
