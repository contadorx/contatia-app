-- ============================================================
-- Contatia — Migration 0016 (Rastreio de clique em link)
-- Links do e-mail são reescritos para /l/{token}?u=destino; o clique registra
-- o evento link_clicked e dispara automações. Roda depois de 0001-0015.
-- ============================================================

create table if not exists public.link_clicks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  token       text unique not null,
  url         text not null,
  clicks      int not null default 0,
  first_click_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists link_clicks_token_idx on public.link_clicks(token);
create index if not exists link_clicks_tenant_idx on public.link_clicks(tenant_id);

alter table public.link_clicks enable row level security;
create policy link_clicks_select on public.link_clicks for select
  using (tenant_id = public.current_tenant_id());

-- ============================================================
-- NOTA: a rota pública /l/{token} usa SERVICE ROLE (destinatário não tem sessão).
-- Registra clique + evento link_clicked (+10 no score) + dispara automações de
-- link_clicked e score_gte, e redireciona para a url original.
-- ============================================================
