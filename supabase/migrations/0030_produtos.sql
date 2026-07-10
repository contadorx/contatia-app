-- ============================================================
-- Contatia — Migration 0030 (Produtos & Serviços)
-- Catálogo por workspace + vínculo opcional na oportunidade (o que está sendo vendido).
-- Roda depois de 0001-0029. Non-breaking.
-- ============================================================

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  kind        text not null default 'servico',   -- servico | produto
  billing     text not null default 'recorrente', -- recorrente | avulso
  price       numeric not null default 0,          -- preço de referência (mensal se recorrente)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists products_tenant_idx on public.products(tenant_id, active);

-- vínculo na oportunidade (qual produto/serviço está sendo vendido)
alter table public.opportunities add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists opportunities_product_idx on public.opportunities(product_id);

-- ---- RLS ----
alter table public.products enable row level security;
create policy products_tenant on public.products for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- ============================================================
-- Uso: cadastro em Config→Produtos & Serviços; seleção na oportunidade (pipeline);
-- filtros no pipeline e nas métricas por produto; "receita por produto" nas métricas.
-- ============================================================
