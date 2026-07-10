-- ============================================================
-- Contatia — Migration 0026 (Central de faturas / invoices)
-- Nível plataforma. A Contatia cria a cobrança (link de pagamento Asaas), envia a
-- fatura por e-mail (SMTP próprio) e controla pago/não-pago via webhook.
-- Roda depois de 0001-0025. Non-breaking.
-- ============================================================

create table if not exists public.platform_invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  amount          numeric not null default 0,
  description     text,
  due_date        date,
  status          text not null default 'pending',   -- pending | paid | overdue | canceled
  payment_link    text,                              -- link de pagamento Asaas (colado/gerado)
  asaas_payment_id text,                             -- id da cobrança no Asaas (casa o webhook)
  sent_at         timestamptz,                       -- quando a fatura foi enviada por e-mail
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists platform_invoices_tenant_idx on public.platform_invoices(tenant_id, status);

alter table public.platform_invoices enable row level security;
create policy platform_invoices_super on public.platform_invoices for all
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ============================================================
-- FLUXO: superadmin cria a fatura (valor+vencimento+link Asaas) → ENVIA por e-mail (SMTP)
-- → cliente paga no link → webhook Asaas casa por asaas_payment_id → status=paid + paid_at,
-- e reflete na assinatura do tenant (subscription_status/current_period_end/mrr).
-- A régua (cobranca) lê platform_invoices vencidas/pendentes e reenvia lembrete por e-mail.
-- ============================================================
