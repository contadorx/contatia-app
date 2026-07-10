-- ============================================================
-- Contatia — Migration 0001 (Fase 0)
-- Cadência de vendas + pipeline CRM, multi-tenant, RLS.
-- Roda single-tenant (seu uso) mas com a estrutura multi-tenant
-- pronta: ao liberar o lançamento, "liga" novos tenants sem refazer nada.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------
do $$ begin
  create type user_role as enum ('owner', 'partner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel as enum ('email', 'whatsapp', 'call', 'linkedin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type enrollment_status as enum ('active', 'paused', 'completed', 'replied', 'stopped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('pending', 'done', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_provider as enum ('gmail', 'smtp');
exception when duplicate_object then null; end $$;

-- ---------- TENANTS ----------
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- PROFILES (1:1 com auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid references public.tenants(id) on delete set null,
  email       text,
  full_name   text,
  role        user_role not null default 'partner',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- HELPERS (SECURITY DEFINER — evitam recursão de RLS) ----------
create or replace function public.current_tenant_id()
  returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
  returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- PIPELINE STAGES ----------
create table if not exists public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  position    int  not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- CONTACTS ----------
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,
  name          text not null,
  email         text,
  phone         text,
  company       text,
  cnpj          text,
  role_title    text,
  origin        text,            -- ex.: Lead-Quente, Parceiro-Prospect, Radar-T1
  stage_id      uuid references public.pipeline_stages(id) on delete set null,
  status        text default 'novo',
  opted_out     boolean not null default false,   -- LGPD
  loss_reason   text,
  notes         text,
  custom        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists contacts_tenant_idx  on public.contacts(tenant_id);
create index if not exists contacts_assigned_idx on public.contacts(assigned_to);
create index if not exists contacts_stage_idx    on public.contacts(stage_id);

-- ---------- SEQUENCES + STEPS ----------
create table if not exists public.sequences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  audience    text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  position      int not null default 0,
  channel       channel not null,
  delay_days    int not null default 0,
  subject       text,
  body_template text
);
create index if not exists steps_seq_idx on public.sequence_steps(sequence_id);

-- ---------- ENROLLMENTS ----------
create table if not exists public.enrollments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,
  current_step  int not null default 0,
  status        enrollment_status not null default 'active',
  started_at    timestamptz not null default now()
);
create index if not exists enroll_tenant_idx on public.enrollments(tenant_id);

-- ---------- TASKS (fila diária) ----------
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  enrollment_id     uuid references public.enrollments(id) on delete cascade,
  contact_id        uuid not null references public.contacts(id) on delete cascade,
  assigned_to       uuid references public.profiles(id) on delete set null,
  channel           channel not null,
  title             text,
  generated_content text,
  due_date          date not null default current_date,
  status            task_status not null default 'pending',
  completed_at      timestamptz
);
create index if not exists tasks_tenant_idx   on public.tasks(tenant_id);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to, due_date, status);

-- ---------- EMAIL ACCOUNTS (base do Envio Seguro) ----------
create table if not exists public.email_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade,
  provider      email_provider not null,
  from_email    text not null,
  display_name  text,
  is_active     boolean not null default true,
  daily_cap     int not null default 40,      -- rampa de volume
  warmup_stage  int not null default 0,        -- estágio de aquecimento
  created_at    timestamptz not null default now()
);

-- ---------- EVENTS (auditoria/analytics) ----------
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete cascade,
  task_id       uuid references public.tasks(id) on delete set null,
  type          text not null,   -- enviado | aberto | clicado | respondido | ...
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists events_tenant_idx on public.events(tenant_id, created_at);

-- ---------- RADAR LEADS (staging da base Receita — Radar A) ----------
-- Fonte de prospecção (seus ~103k). Vira contato ao ser "puxado" pro pipeline.
create table if not exists public.radar_leads (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  cnpj                 text,
  razao_social         text,
  nome_fantasia        text,
  cnae                 text,
  uf                   text,
  municipio            text,
  situacao_cadastral   text,
  porte                text,
  tier                 text,       -- T1..T4
  contato_principal    text,
  email                text,
  telefone             text,
  converted_contact_id uuid references public.contacts(id) on delete set null,
  imported_at          timestamptz not null default now()
);
create index if not exists radar_tenant_idx on public.radar_leads(tenant_id, tier, uf);

-- ============================================================
-- RLS
-- ============================================================
alter table public.tenants         enable row level security;
alter table public.profiles        enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.contacts        enable row level security;
alter table public.sequences       enable row level security;
alter table public.sequence_steps  enable row level security;
alter table public.enrollments     enable row level security;
alter table public.tasks           enable row level security;
alter table public.email_accounts  enable row level security;
alter table public.events          enable row level security;
alter table public.radar_leads     enable row level security;

-- PROFILES: vejo o meu; owner vê os do tenant.
create policy profiles_self on public.profiles for select
  using (id = auth.uid() or tenant_id = public.current_tenant_id());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- TENANTS: vejo só o meu.
create policy tenants_read on public.tenants for select
  using (id = public.current_tenant_id());

-- Macro de política padrão (isolamento por tenant) aplicada às tabelas simples.
create policy stages_all on public.pipeline_stages for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy sequences_all on public.sequences for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy steps_all on public.sequence_steps for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy enroll_all on public.enrollments for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy email_all on public.email_accounts for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy events_all on public.events for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy radar_all on public.radar_leads for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- CONTACTS: dupla camada — isolamento por tenant + parceiro só vê o que é dele.
create policy contacts_select on public.contacts for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  );
create policy contacts_write on public.contacts for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());

-- TASKS: mesma dupla camada (a fila diária é pessoal do parceiro).
create policy tasks_select on public.tasks for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  );
create policy tasks_write on public.tasks for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());

-- ---------- Trigger: cria profile ao cadastrar usuário ----------
-- Novo usuário nasce SEM tenant (não vê nada até o owner atribuir) — seguro por padrão.
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'partner')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at automático em contacts
create or replace function public.touch_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

-- ============================================================
-- SEED (SEU BOOTSTRAP) — rode DEPOIS de criar seu login no app.
-- 1) Cadastre-se no /login. 2) Pegue seu user id em Auth > Users.
-- 3) Rode o bloco abaixo trocando SEU_USER_ID:
-- ------------------------------------------------------------
-- insert into public.tenants (name) values ('ContadorX') returning id;
-- -- copie o id retornado e use abaixo:
-- update public.profiles
--   set tenant_id = 'TENANT_ID_AQUI', role = 'owner', full_name = 'Leandro Oliveira'
--   where id = 'SEU_USER_ID';
-- -- estágios iniciais do pipeline:
-- insert into public.pipeline_stages (tenant_id, name, position, is_won, is_lost) values
--   ('TENANT_ID_AQUI','Novo',0,false,false),
--   ('TENANT_ID_AQUI','Contatado',1,false,false),
--   ('TENANT_ID_AQUI','Respondeu',2,false,false),
--   ('TENANT_ID_AQUI','Reunião',3,false,false),
--   ('TENANT_ID_AQUI','Proposta',4,false,false),
--   ('TENANT_ID_AQUI','Fechado',5,true,false),
--   ('TENANT_ID_AQUI','Perdido',6,false,true);
-- ============================================================
