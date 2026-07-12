-- ============================================================
-- Contatia — Migration 0050 (Gestão de assinatura pelo superadmin)
-- Espelha o painel do Quotaria: o dono da plataforma controla o status, o plano,
-- o trial, o bônus, a data de vencimento, o parceiro que indicou, e pode marcar
-- a conta como TESTE (fora das métricas).
--
-- Resolve também a pendência da auditoria: TRIAL COM DATA DE FIM.
-- Roda depois das anteriores. Idempotente.
-- ============================================================

alter table public.tenants add column if not exists trial_ends_at    timestamptz;
alter table public.tenants add column if not exists bonus_until      timestamptz;
alter table public.tenants add column if not exists next_due_date    date;
alter table public.tenants add column if not exists billing_cycle    text default 'monthly';   -- monthly | quarterly | yearly
alter table public.tenants add column if not exists partner_ref      text;
alter table public.tenants add column if not exists internal_notes   text;
alter table public.tenants add column if not exists is_test_account  boolean not null default false;

-- índice para excluir contas de teste das métricas
create index if not exists tenants_real_idx on public.tenants(is_test_account) where is_test_account = false;

-- ------------------------------------------------------------
-- RPC: superadmin atualiza a assinatura de um workspace.
-- SECURITY DEFINER + checagem de superadmin no servidor (não dá para burlar
-- pelo front). Funciona sem SERVICE_ROLE_KEY.
-- ------------------------------------------------------------
create or replace function public.superadmin_update_subscription(
  p_tenant           uuid,
  p_status           text,
  p_plan_id          uuid,
  p_mrr              numeric,
  p_cycle            text,
  p_trial_ends_at    timestamptz,
  p_bonus_until      timestamptz,
  p_next_due_date    date,
  p_partner_ref      text,
  p_internal_notes   text,
  p_is_test          boolean,
  p_asaas_customer   text,
  p_asaas_subscription text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'acesso restrito ao superadmin';
  end if;

  update public.tenants set
    subscription_status    = coalesce(nullif(btrim(p_status), ''), subscription_status),
    plan_id                = coalesce(p_plan_id, plan_id),
    mrr                    = coalesce(p_mrr, mrr),
    billing_cycle          = coalesce(nullif(btrim(p_cycle), ''), billing_cycle),
    trial_ends_at          = p_trial_ends_at,
    bonus_until            = p_bonus_until,
    next_due_date          = p_next_due_date,
    partner_ref            = nullif(btrim(coalesce(p_partner_ref, '')), ''),
    internal_notes         = nullif(btrim(coalesce(p_internal_notes, '')), ''),
    is_test_account        = coalesce(p_is_test, false),
    asaas_customer_id      = nullif(btrim(coalesce(p_asaas_customer, '')), ''),
    asaas_subscription_id  = nullif(btrim(coalesce(p_asaas_subscription, '')), '')
  where id = p_tenant;
end;
$$;

grant execute on function public.superadmin_update_subscription(
  uuid, text, uuid, numeric, text, timestamptz, timestamptz, date, text, text, boolean, text, text
) to authenticated;

-- ------------------------------------------------------------
-- RPC: ficha completa da assinatura de um workspace (para abrir o modal).
-- ------------------------------------------------------------
create or replace function public.superadmin_get_subscription(p_tenant uuid)
returns table (
  id uuid, name text, subscription_status text, plan_id uuid, plan_name text,
  mrr numeric, billing_cycle text, trial_ends_at timestamptz, bonus_until timestamptz,
  next_due_date date, partner_ref text, internal_notes text, is_test_account boolean,
  asaas_customer_id text, asaas_subscription_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'acesso restrito ao superadmin';
  end if;

  return query
  select t.id, t.name, t.subscription_status, t.plan_id, pp.name,
         t.mrr, t.billing_cycle, t.trial_ends_at, t.bonus_until,
         t.next_due_date, t.partner_ref, t.internal_notes, t.is_test_account,
         t.asaas_customer_id, t.asaas_subscription_id
    from public.tenants t
    left join public.platform_plans pp on pp.id = t.plan_id
   where t.id = p_tenant;
end;
$$;

grant execute on function public.superadmin_get_subscription(uuid) to authenticated;

-- ------------------------------------------------------------
-- Trial padrão para quem se cadastrar daqui em diante: 14 dias.
-- (Contas antigas sem trial ficam como estão — você define no painel.)
-- ------------------------------------------------------------
alter table public.tenants alter column trial_ends_at set default (now() + interval '14 days');

update public.tenants
   set trial_ends_at = created_at + interval '14 days',
       subscription_status = coalesce(subscription_status, 'trialing')
 where trial_ends_at is null
   and coalesce(subscription_status, '') not in ('active', 'past_due', 'canceled');
