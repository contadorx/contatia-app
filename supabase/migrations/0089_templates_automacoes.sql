-- ============================================================
-- Contatia — Migration 0089 (Biblioteca de templates de automação)
--
-- Espelho de sequence_templates (0014): modelos de automação curados (is_global)
-- que TODA a base vê como "Sugestões" e instala em 1 clique. Também permite ao
-- tenant salvar as próprias automações como modelo local.
--
-- config (jsonb) traz os campos do formulário já prontos: trigger_type, trigger_value,
-- action_type, priority, stop_on_match, end_current, set_state, cond_state, e "needs"
-- (o que o usuário ainda escolhe: cadência/estágio/tag).
--
-- Roda depois de 0001-0088. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.automation_templates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.tenants(id) on delete cascade,  -- null = global (curado)
  name            text not null,
  description     text,
  category        text not null default 'geral',   -- sinais | reciclagem | posvenda | higiene | geral
  config          jsonb not null default '{}'::jsonb,
  is_global       boolean not null default false,
  install_default boolean not null default false,   -- entra pré-instalada em workspace novo
  sort            int not null default 100,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists automation_templates_idx on public.automation_templates(is_global, category, sort);
-- nome único entre os globais → torna a semeadura idempotente (re-rodar não duplica)
create unique index if not exists automation_templates_global_name on public.automation_templates(name) where is_global;

alter table public.automation_templates enable row level security;
-- vê os globais + os do próprio tenant
create policy automation_templates_select on public.automation_templates for select
  using (is_global = true or tenant_id = public.current_tenant_id());
-- escreve nos do próprio tenant; superadmin escreve em qualquer (curadoria dos globais)
create policy automation_templates_write on public.automation_templates for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- flag de "já semeei os padrões neste tenant" (evita reinserir se o usuário apagar)
alter table public.tenants add column if not exists automations_seeded boolean not null default false;

-- ---------- Sementes globais (as sugestões) ----------
insert into public.automation_templates (name, description, category, config, is_global, install_default, sort) values
-- A) Sinais quentes
('Abriu a proposta → marcar quente', 'Quem abre a proposta demonstra intenção. Sobe o score para quente.', 'sinais',
  '{"trigger_type":"doc_opened","action_type":"mark_hot","priority":100}'::jsonb, true, true, 10),
('Clicou no link → marcar quente', 'Clique é sinal. Sobe o score para quente.', 'sinais',
  '{"trigger_type":"link_clicked","action_type":"mark_hot","priority":100}'::jsonb, true, true, 20),
('Score atingiu 25 → mover no funil', 'Quando o engajamento cruza 25, move a oportunidade de estágio.', 'sinais',
  '{"trigger_type":"score_gte","trigger_value":"25","action_type":"move_stage","priority":100,"needs":["action_stage"]}'::jsonb, true, false, 30),
('Recebeu tag → acelerar numa cadência', 'Ao receber uma tag, inscreve numa cadência de aceleração (encerra a atual).', 'sinais',
  '{"trigger_type":"tag_added","action_type":"enroll","end_current":true,"priority":100,"needs":["trigger_value","action_seq"]}'::jsonb, true, false, 40),
-- B) Reciclagem / reengajamento
('Fim de cadência → dormente', 'Quando uma cadência termina sem resposta, marca o contato como dormente.', 'reciclagem',
  '{"trigger_type":"cadence_completed","trigger_value":"0","action_type":"mark_state","set_state":"dormente","priority":50}'::jsonb, true, true, 10),
('Dormente 90 dias → reengajar', 'Dormente há 90 dias entra na cadência de reengajamento (encerra a atual).', 'reciclagem',
  '{"trigger_type":"state_days","cond_state":"dormente","trigger_value":"90","action_type":"enroll","end_current":true,"set_state":"em_E","priority":100,"needs":["action_seq"]}'::jsonb, true, false, 20),
('Sem atividade 120 dias → reengajar', 'Versão simples: sem qualquer atividade há 120 dias, reengaja.', 'reciclagem',
  '{"trigger_type":"no_activity_days","trigger_value":"120","action_type":"enroll","end_current":true,"priority":100,"needs":["action_seq"]}'::jsonb, true, false, 30),
('Chegou a data de retomada → retomar', 'Na data anotada na triagem, inscreve na cadência de retomada (encerra a atual).', 'reciclagem',
  '{"trigger_type":"date_reached","action_type":"enroll","end_current":true,"priority":100,"needs":["action_seq"]}'::jsonb, true, false, 40),
-- C) Pós-venda / expansão
('Oportunidade perdida +30 dias → recuperação', 'Perdeu a venda; 30 dias depois entra numa cadência de recuperação.', 'posvenda',
  '{"trigger_type":"opportunity_lost","trigger_value":"30","action_type":"enroll","priority":100,"needs":["action_seq"]}'::jsonb, true, false, 10),
('Oportunidade ganha +15 dias → cross-sell', 'Ganhou; 15 dias depois entra numa cadência de outro produto.', 'posvenda',
  '{"trigger_type":"opportunity_won","trigger_value":"15","action_type":"enroll","priority":100,"needs":["action_seq"]}'::jsonb, true, false, 20),
('Ganhou → marcar como Cliente', 'Ao ganhar a oportunidade, aplica a tag de cliente.', 'posvenda',
  '{"trigger_type":"opportunity_won","trigger_value":"0","action_type":"add_tag","priority":100,"needs":["action_tag"]}'::jsonb, true, false, 30),
-- D) Higiene avançada
('Fim da retomada (E) → suprimir', 'Quem ignorou a retomada sai de vez. Prioridade alta (avaliada antes).', 'higiene',
  '{"trigger_type":"cadence_completed","trigger_value":"0","action_type":"suppress","priority":40,"stop_on_match":true,"needs":["source_seq"]}'::jsonb, true, false, 10)
on conflict do nothing;
