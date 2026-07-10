-- ============================================================
-- Contatia — Migration 0033 (Sugestões de contato de e-mails recebidos)
-- Quando a detecção de resposta vê um remetente que não está na base, guarda como
-- sugestão para o usuário aprovar (vira contato) ou descartar. Roda após 0001-0032.
-- ============================================================

create table if not exists public.contact_suggestions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  name        text,
  status      text not null default 'pending',   -- pending | added | dismissed
  seen_count  int not null default 1,
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);
create index if not exists contact_suggestions_tenant_idx on public.contact_suggestions(tenant_id, status);

alter table public.contact_suggestions enable row level security;
create policy contact_suggestions_tenant on public.contact_suggestions for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- ============================================================
-- FLUXO: o cron de detecção de resposta, ao ver um remetente que NÃO é contato nem já
-- sugerido, cria uma sugestão. O usuário vê em Contatos → "Sugestões" e aprova (cria o
-- contato) ou descarta. Ignora domínios próprios/no-reply. Sem virar CRM: é só um atalho
-- para não perder quem te respondeu sem estar cadastrado.
-- ============================================================
