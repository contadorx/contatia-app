-- ============================================================
-- Contatia — Migration 0085 (Pool de caixas por produto — rotação)
--
-- Antes (0064): cada PRODUTO tinha UMA caixa padrão (products.email_account_id).
-- Agora: um produto pode ter VÁRIAS caixas — um POOL — e o envio faz RODÍZIO
-- entre elas. Na inscrição, a caixa é sorteada dentro do pool do produto e
-- carimbada na tarefa (sender consistente para o mesmo contato). Os limites
-- diários/aquecimento de cada caixa continuam valendo no envio.
--
-- Ordem de resolução da caixa: override da cadência → pool do produto (rodízio)
-- → caixa única legada do produto → rodízio geral (todas as caixas ativas).
--
-- Roda depois de 0001-0084. Idempotente. Non-breaking.
-- ============================================================

create table if not exists public.product_email_accounts (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (product_id, email_account_id)
);
create index if not exists product_email_accounts_tenant_idx on public.product_email_accounts(tenant_id);
create index if not exists product_email_accounts_prod_idx   on public.product_email_accounts(product_id);

alter table public.product_email_accounts enable row level security;
create policy pea_all on public.product_email_accounts for all
  using (tenant_id = public.current_tenant_id() or public.is_superadmin())
  with check (tenant_id = public.current_tenant_id() or public.is_superadmin());

-- Semeia o pool com a caixa única já configurada (0064): quem tinha 1 caixa
-- passa a ter um pool de 1 — nada muda até o usuário adicionar mais caixas.
insert into public.product_email_accounts (tenant_id, product_id, email_account_id)
  select tenant_id, id, email_account_id
  from public.products
  where email_account_id is not null
on conflict do nothing;
