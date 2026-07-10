-- ============================================================
-- Contatia — Migration 0036 (Régua de ciclo de vida do assinante)
-- E-mails da PLATAFORMA para o cliente (boas-vindas, onboarding, reengajamento).
-- Controle de quais estágios já foram enviados a cada tenant, para não repetir.
-- Roda após 0001-0035.
-- ============================================================

create table if not exists public.lifecycle_sends (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  stage       text not null,             -- welcome | onboard_email | onboard_cadence | reengage
  sent_at     timestamptz not null default now(),
  unique (tenant_id, stage)
);
create index if not exists lifecycle_sends_tenant_idx on public.lifecycle_sends(tenant_id);

alter table public.lifecycle_sends enable row level security;
create policy lifecycle_sends_admin on public.lifecycle_sends for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- liga/desliga a régua por instância (padrão ligado)
alter table public.tenants add column if not exists lifecycle_enabled boolean default true;

-- ============================================================
-- FLUXO (roda no cron diário): para cada tenant ativo com lifecycle_enabled:
--   welcome         → assim que o tenant existe (D0), se ainda não enviado
--   onboard_email   → D+1 se NÃO conectou caixa de e-mail (empurra a ativação)
--   onboard_cadence → D+3 se conectou caixa mas NÃO criou cadência
--   reengage        → sem nenhuma atividade (contatos/cadências) há 14+ dias
-- Cada estágio é enviado UMA vez (lifecycle_sends). E-mails via Brevo (mesma infra).
-- Distinto do motor de automações (que age sobre LEADS do cliente). Aqui o alvo é o CLIENTE.
-- ============================================================
