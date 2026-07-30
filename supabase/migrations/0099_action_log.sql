-- ============================================================
-- Contatia — Migration 0099 (Registro de ações / action_log)
--
-- Trilha de auditoria das ações do OPERADOR (não do lead). O `events` já registra
-- o que o LEAD fez (abriu, clicou, respondeu) e serve de score; aqui é o outro lado:
-- quem-apagou-o-quê-quando. Nasceu da exclusão em lote de tarefas na caixa de hoje,
-- mas serve para toda ação destrutiva/em massa (excluir contatos, empresas, aplicar
-- tags em lote, inscrever em cadência, gravar empresas do Radar).
--
-- Por que tabela nova e não `events`: events é por CONTATO (contact_id) e alimenta
-- o score; ação em lote não tem um contato só, e não pode mexer em score. Além disso
-- events cascateia com o contato — e o log de uma exclusão tem que SOBREVIVER ao
-- registro excluído. Daí `entity_id` ser uuid SEM foreign key (de propósito).
--
-- Roda depois de 0001-0098. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.action_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  user_name  text,                       -- nome no momento da ação (sobrevive ao membro sair)
  action     text not null,              -- 'task_delete' | 'contact_delete' | ...
  entity     text not null default 'outro', -- 'task' | 'contact' | 'account' | ...
  entity_id  uuid,                       -- SEM fk: o log sobrevive ao registro apagado
  qtd        integer not null default 1, -- quantos registros a ação atingiu
  detail     text,                       -- resumo legível, já em PT-BR
  meta       jsonb not null default '{}'::jsonb, -- itens atingidos, filtros, etc.
  created_at timestamptz not null default now()
);

create index if not exists action_log_tenant_idx on public.action_log(tenant_id, created_at desc);
create index if not exists action_log_action_idx on public.action_log(tenant_id, action, created_at desc);
create index if not exists action_log_user_idx   on public.action_log(tenant_id, user_id, created_at desc);

alter table public.action_log enable row level security;

-- LEITURA: qualquer membro do workspace lê o log do próprio workspace. O recorte por
-- papel (vendedor vê só o que ele mesmo fez) é feito na consulta da tela, não aqui —
-- assim o gestor não precisa de policy extra e o superadmin continua enxergando tudo.
drop policy if exists action_log_select on public.action_log;
create policy action_log_select on public.action_log for select
  using (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- ESCRITA: só inserir, e só no próprio workspace. Ninguém edita nem apaga log —
-- não existe policy de update/delete de propósito (nem o dono reescreve a trilha).
drop policy if exists action_log_insert on public.action_log;
create policy action_log_insert on public.action_log for insert
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

comment on table public.action_log is
  'Trilha de auditoria das ações do operador (exclusões e ações em lote). Só INSERT e SELECT: log não se reescreve.';
