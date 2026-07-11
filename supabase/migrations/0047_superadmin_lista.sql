-- ============================================================
-- Contatia — Migration 0047 (Painel do superadmin sem SERVICE_ROLE_KEY)
-- PROBLEMA: o painel do superadmin lista os workspaces via createAdminClient(),
-- que exige SUPABASE_SERVICE_ROLE_KEY no ambiente. Sem essa variável no Vercel,
-- a lista NÃO CARREGA — o superadmin não vê workspace nenhum.
-- SOLUÇÃO: uma RPC SECURITY DEFINER que verifica is_superadmin no servidor e
-- devolve todos os workspaces com suas métricas. Funciona com a chave anônima.
-- Roda depois das anteriores. Idempotente.
-- ============================================================

create or replace function public.superadmin_list_tenants()
returns table (
  id uuid,
  name text,
  legal_name text,
  segment text,
  created_at timestamptz,
  mrr numeric,
  subscription_status text,
  users_count bigint,
  contacts_count bigint,
  opps_open bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- só o dono da plataforma enxerga todos os workspaces
  if not coalesce((select p2.is_superadmin from public.profiles p2 where p2.id = auth.uid()), false) then
    raise exception 'acesso restrito ao superadmin';
  end if;

  return query
  select
    t.id,
    t.name,
    t.legal_name,
    t.segment,
    t.created_at,
    coalesce(t.mrr, 0)::numeric,
    t.subscription_status,
    (select count(*) from public.profiles p where p.tenant_id = t.id)   as users_count,
    (select count(*) from public.contacts c where c.tenant_id = t.id)   as contacts_count,
    (select count(*) from public.opportunities o
       where o.tenant_id = t.id
         and coalesce(o.status, 'open') not in ('won','lost'))          as opps_open
  from public.tenants t
  order by t.created_at desc;
end;
$$;

grant execute on function public.superadmin_list_tenants() to authenticated;

-- ============================================================
-- Confere: rode como seu usuário superadmin e veja se lista os workspaces.
-- (No SQL Editor, roda como service role e sempre vai listar — o teste real
-- é abrir o painel no app depois do deploy.)
-- ============================================================
