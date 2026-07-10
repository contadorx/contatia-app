-- ============================================================
-- Contatia — Migration 0021 (Parceiros da plataforma + comissões)
-- Nível PLATAFORMA (não é por tenant): o dono do Contatia gerencia parceiros que
-- indicam novos workspaces e recebem comissão recorrente. Espelha o Quotaria.
-- Roda depois de 0001-0020. Non-breaking.
-- ============================================================

create table if not exists public.platform_partners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text,
  ref_code        text unique not null,
  commission_rate numeric not null default 0.20,   -- 20% recorrente por padrão
  pix_key         text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- indicação: um parceiro trouxe um workspace (tenant). mrr = mensalidade do indicado
-- (manual por ora; liga no billing depois). commission = mrr * rate, calculada na leitura.
create table if not exists public.platform_referrals (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.platform_partners(id) on delete cascade,
  tenant_id    uuid references public.tenants(id) on delete set null,
  label        text,                 -- nome do indicado, caso ainda não vire tenant
  mrr          numeric not null default 0,
  status       text not null default 'active',  -- active | pending | churned
  created_at   timestamptz not null default now()
);
create index if not exists platform_referrals_partner_idx on public.platform_referrals(partner_id);

-- atribuição direta no tenant (quando o workspace nasce de um ?ref=)
alter table public.tenants add column if not exists referred_by uuid references public.platform_partners(id) on delete set null;

-- ---- RLS: SOMENTE superadmin enxerga/gerencia (tabelas de plataforma) ----
alter table public.platform_partners enable row level security;
alter table public.platform_referrals enable row level security;

create policy platform_partners_super on public.platform_partners for all
  using (public.is_superadmin()) with check (public.is_superadmin());
create policy platform_referrals_super on public.platform_referrals for all
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ============================================================
-- ATRIBUIÇÃO ?ref=: a rota pública /r/{code} grava um cookie 'contatia_ref'.
-- Quando o workspace for criado (self-serve, futuro), lê o cookie → tenants.referred_by.
-- Por ora, o superadmin também registra indicações manualmente na tela Parceiros.
-- ============================================================
