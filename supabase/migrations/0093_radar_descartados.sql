-- ============================================================
-- Contatia — Migration 0093 (Radar: CNPJs descartados)
--
-- "Já vi esse CNPJ, não quero no cadastro E não quero vê-lo de novo nas buscas do
-- Radar" (ex.: empresa sem perfil). Lista por workspace; o Radar filtra estes CNPJs
-- dos resultados, exatamente como já esconde os que estão no cadastro.
--
-- Roda depois de 0001-0092. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.radar_dismissed (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  cnpj       text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, cnpj)
);
create index if not exists radar_dismissed_tenant_idx on public.radar_dismissed(tenant_id);

alter table public.radar_dismissed enable row level security;
create policy radar_dismissed_all on public.radar_dismissed for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());
