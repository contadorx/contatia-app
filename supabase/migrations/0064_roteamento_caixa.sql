-- ============================================================
-- Contatia — Migration 0064 (Roteamento de caixa por produto)
--
-- Multi-produto: cada PRODUTO pode ter uma CAIXA de e-mail padrão; cada CADÊNCIA
-- pertence a um produto e pode SOBRESCREVER a caixa. Na inscrição, a caixa é
-- RESOLVIDA (override da cadência → caixa do produto → rodízio) e CARIMBADA na
-- tarefa; o envio prefere a caixa carimbada (com fallback pro rodízio atual se
-- ela estiver inativa/sem folga). Tudo opcional — sem produto/caixa = rodízio como hoje.
--
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

-- caixa PADRÃO do produto
alter table public.products
  add column if not exists email_account_id uuid references public.email_accounts(id) on delete set null;

-- a que PRODUTO a cadência pertence + caixa de OVERRIDE (opcional) da cadência
alter table public.sequences
  add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.sequences
  add column if not exists email_account_id uuid references public.email_accounts(id) on delete set null;

-- caixa RESOLVIDA, carimbada na tarefa no momento da inscrição
alter table public.tasks
  add column if not exists email_account_id uuid references public.email_accounts(id) on delete set null;

create index if not exists sequences_product_idx on public.sequences(product_id);
create index if not exists tasks_email_account_idx on public.tasks(email_account_id);
