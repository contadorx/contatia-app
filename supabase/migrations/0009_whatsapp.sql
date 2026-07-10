-- ============================================================
-- Contatia — Migration 0009 (WhatsApp via Evolution API)
-- Integra com uma instância Evolution API hospedada pelo cliente.
-- Roda depois de 0001-0008. Non-breaking.
-- ============================================================

create table if not exists public.whatsapp_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  evolution_url text not null,          -- ex.: https://evo.seudominio.com
  api_key       text not null,          -- apikey da instância (ver NOTA)
  instance      text not null,          -- nome da instância
  is_active     boolean not null default true,
  daily_cap     int not null default 40,
  inbound_token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now()
);
create index if not exists whatsapp_tenant_idx on public.whatsapp_accounts(tenant_id);

alter table public.whatsapp_accounts enable row level security;
create policy whatsapp_all on public.whatsapp_accounts for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- NOTA: api_key em texto puro sob RLS (mesmo tratamento de smtp_pass). O app
-- NUNCA devolve api_key ao client. O webhook de entrada é público
-- (/api/whatsapp/webhook/{inbound_token}) e roda com SERVICE ROLE.
-- ============================================================
