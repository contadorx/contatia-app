-- ============================================================
-- Contatia — Migration 0002 (Fase 1 · Fundação B2B)
-- Empresa (account) + Oportunidade (deal) como objetos de 1ª classe,
-- reuniões (anti no-show), repositório de propostas com tracking,
-- e campos de scoring. Reusa os helpers/RLS da 0001.
-- Roda DEPOIS da 0001. Non-breaking: só adiciona.
-- ============================================================

-- ---------- ENUMS NOVOS ----------
do $$ begin
  create type opportunity_status as enum ('open', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type meeting_status as enum ('agendada', 'confirmada', 'realizada', 'no_show', 'remarcada');
exception when duplicate_object then null; end $$;

-- ---------- ACCOUNTS (a EMPRESA) ----------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  owner_id    uuid references public.profiles(id) on delete set null,
  name        text not null,
  cnpj        text,
  cnae        text,
  uf          text,
  municipio   text,
  porte       text,
  domain      text,
  phone       text,
  website     text,
  custom      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists accounts_tenant_idx on public.accounts(tenant_id);
create index if not exists accounts_owner_idx  on public.accounts(owner_id);

-- contato passa a poder pertencer a uma conta (vários contatos por conta)
alter table public.contacts
  add column if not exists account_id uuid references public.accounts(id) on delete set null;
create index if not exists contacts_account_idx on public.contacts(account_id);

-- scoring (base do lead scoring da Fase 2)
alter table public.contacts add column if not exists score int not null default 0;
alter table public.contacts add column if not exists last_activity_at timestamptz;

-- ---------- OPPORTUNITIES (o NEGÓCIO/DEAL) ----------
-- O PIPELINE/kanban passa a operar aqui (não em contacts). Contato pode existir
-- sem oportunidade (lead cru); vira oportunidade quando qualifica.
create table if not exists public.opportunities (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  account_id         uuid references public.accounts(id) on delete set null,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  owner_id           uuid references public.profiles(id) on delete set null,
  title              text not null,
  value_mrr          numeric(12,2) default 0,   -- recorrente mensal esperado
  stage_id           uuid references public.pipeline_stages(id) on delete set null,
  probability        int default 0,             -- 0..100
  expected_close     date,
  status             opportunity_status not null default 'open',
  loss_reason        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists opp_tenant_idx  on public.opportunities(tenant_id);
create index if not exists opp_owner_idx    on public.opportunities(owner_id);
create index if not exists opp_account_idx  on public.opportunities(account_id);
create index if not exists opp_stage_idx    on public.opportunities(stage_id);

-- ---------- MEETINGS (anti no-show) ----------
create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  opportunity_id  uuid references public.opportunities(id) on delete set null,
  assigned_to     uuid references public.profiles(id) on delete set null,
  title           text,
  datetime        timestamptz not null,
  status          meeting_status not null default 'agendada',
  reminder_config jsonb not null default '{}'::jsonb,   -- ex.: {"24h":true,"1h":true,"canais":["email","whatsapp"]}
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists meetings_tenant_idx   on public.meetings(tenant_id);
create index if not exists meetings_assigned_idx on public.meetings(assigned_to, datetime);

-- ---------- DOCUMENTS (repositório) + SHARES (tracking) ----------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  type          text,           -- proposta | deck | one-pager | case ...
  version       int not null default 1,
  storage_path  text,           -- Supabase Storage
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists documents_tenant_idx on public.documents(tenant_id);

create table if not exists public.document_shares (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  document_id        uuid not null references public.documents(id) on delete cascade,
  contact_id         uuid references public.contacts(id) on delete set null,
  opportunity_id     uuid references public.opportunities(id) on delete set null,
  token              text not null unique,       -- link rastreado único por destinatário
  sent_at            timestamptz not null default now(),
  first_open_at      timestamptz,
  total_opens        int not null default 0,
  total_time_seconds int not null default 0,
  forwarded          boolean not null default false
);
create index if not exists doc_shares_tenant_idx on public.document_shares(tenant_id);
create index if not exists doc_shares_token_idx  on public.document_shares(token);

-- events ganha referências opcionais aos novos objetos (auditoria/score)
alter table public.events add column if not exists account_id     uuid references public.accounts(id) on delete set null;
alter table public.events add column if not exists opportunity_id uuid references public.opportunities(id) on delete set null;
alter table public.events add column if not exists meeting_id     uuid references public.meetings(id) on delete set null;
alter table public.events add column if not exists document_share_id uuid references public.document_shares(id) on delete set null;

-- ============================================================
-- RLS (mesmo padrão da 0001)
-- ============================================================
alter table public.accounts        enable row level security;
alter table public.opportunities   enable row level security;
alter table public.meetings        enable row level security;
alter table public.documents       enable row level security;
alter table public.document_shares enable row level security;

-- ACCOUNTS: isolamento por tenant + owner vê tudo / parceiro vê o que é dele.
create policy accounts_select on public.accounts for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or owner_id = auth.uid())
  );
create policy accounts_write on public.accounts for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or owner_id = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());

-- OPPORTUNITIES: mesma dupla camada (por owner).
create policy opp_select on public.opportunities for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or owner_id = auth.uid())
  );
create policy opp_write on public.opportunities for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or owner_id = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());

-- MEETINGS: por atribuído (a agenda é pessoal do vendedor).
create policy meetings_select on public.meetings for select
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  );
create policy meetings_write on public.meetings for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or assigned_to = auth.uid())
  )
  with check (tenant_id = public.current_tenant_id());

-- DOCUMENTS + SHARES: isolamento por tenant (biblioteca é do escritório).
create policy documents_all on public.documents for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy doc_shares_all on public.document_shares for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------- updated_at automático nos novos objetos ----------
drop trigger if exists accounts_touch on public.accounts;
create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists opp_touch on public.opportunities;
create trigger opp_touch before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- ============================================================
-- NOTA: o tracking de document_shares (abertura pública via token) é lido por
-- um endpoint público que roda com service_role (fora do RLS) — o RLS acima
-- protege a leitura/escrita AUTENTICADA; a marcação de "abriu" vem do endpoint.
-- ============================================================
