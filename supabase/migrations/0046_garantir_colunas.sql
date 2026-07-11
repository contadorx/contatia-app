-- ============================================================
-- Contatia — Migration 0046 (Garantir colunas que o app consulta)
-- HIPÓTESE DO BUG: o layout do app consulta profiles pedindo as colunas
-- is_superadmin e impersonating_tenant_id. Se QUALQUER uma delas não existir,
-- o PostgREST devolve ERRO e o app recebe profile = null — concluindo
-- "conta sem workspace" mesmo com o dado correto no banco.
-- Esta migration garante que todas as colunas consultadas existam.
-- Segura e idempotente: se já existirem, não faz nada.
-- ============================================================

alter table public.profiles add column if not exists is_superadmin boolean not null default false;
alter table public.profiles add column if not exists impersonating_tenant_id uuid references public.tenants(id) on delete set null;
alter table public.profiles add column if not exists pre_impersonation_tenant_id uuid references public.tenants(id) on delete set null;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;

-- colunas consultadas em tenants pelo app
alter table public.tenants add column if not exists subscription_status text;
alter table public.tenants add column if not exists plan_id uuid;
alter table public.tenants add column if not exists asaas_customer_id text;
alter table public.tenants add column if not exists asaas_subscription_id text;

-- ------------------------------------------------------------
-- VERIFICAÇÃO: lista o que o app consulta e se existe.
-- TODAS devem aparecer com existe = true.
-- ------------------------------------------------------------
select
  c.coluna,
  exists(
    select 1 from information_schema.columns i
    where i.table_schema='public' and i.table_name='profiles' and i.column_name=c.coluna
  ) as existe
from (values
  ('id'),('email'),('full_name'),('role'),('tenant_id'),
  ('is_superadmin'),('impersonating_tenant_id'),('pre_impersonation_tenant_id')
) as c(coluna);
