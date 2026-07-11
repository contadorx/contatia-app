-- ============================================================
-- Contatia — Migration 0041 (Central de faturas do cliente)
-- A tabela platform_invoices (0026) já guarda as cobranças, mas só o superadmin
-- enxergava. Aqui liberamos LEITURA das próprias faturas para os membros do
-- workspace, para alimentar a aba "Faturas" na tela de Planos.
-- A escrita continua restrita (webhook usa service role; superadmin gerencia).
-- Roda após 0026. Idempotente.
-- ============================================================

-- garante colunas usadas pela assinatura recorrente (no-op se já existem)
alter table public.platform_invoices add column if not exists asaas_subscription_id text;

create index if not exists platform_invoices_sub_idx on public.platform_invoices(asaas_subscription_id);

-- leitura das próprias faturas: qualquer membro do workspace vê as faturas do seu tenant
drop policy if exists platform_invoices_read_own on public.platform_invoices;
create policy platform_invoices_read_own on public.platform_invoices
  for select
  using (
    tenant_id in (
      select tenant_id from public.profiles where id = auth.uid()
    )
  );

-- ============================================================
-- FLUXO ATUALIZADO: o webhook do Asaas (PAYMENT_CREATED de uma assinatura) agora
-- cria a fatura na central automaticamente (via service role) casando pelo
-- asaas_subscription_id → asaas_customer_id. PAYMENT_CONFIRMED marca paid_at.
-- O cliente vê tudo em Planos → aba Faturas (link de pagamento das em aberto).
-- ============================================================
