-- ============================================================
-- Contatia — Migration 0017 (Sistema de TAGS)
-- Tags reutilizáveis por tenant, aplicáveis a contatos e empresas.
-- Roda depois de 0001-0016. Non-breaking.
-- ============================================================

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  color      text default '#4A3AFF',
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists tags_tenant_idx on public.tags(tenant_id);

-- vínculo tag ↔ contato
create table if not exists public.contact_tags (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index if not exists contact_tags_tag_idx on public.contact_tags(tag_id);
create index if not exists contact_tags_tenant_idx on public.contact_tags(tenant_id);

-- vínculo tag ↔ empresa (account)
create table if not exists public.account_tags (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, tag_id)
);
create index if not exists account_tags_tag_idx on public.account_tags(tag_id);

alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.account_tags enable row level security;

create policy tags_all on public.tags for all
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy contact_tags_all on public.contact_tags for all
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy account_tags_all on public.account_tags for all
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- Gatilho de automação "recebeu tag": a automação usa trigger_type='tag_added'
-- e trigger_value = tag_id. O disparo é no código (ao aplicar a tag a um contato).
-- ============================================================
