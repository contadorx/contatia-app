-- ============================================================
-- Contatia — Migration 0042 (Impersonação de workspace — suporte)
-- Permite ao superadmin "entrar" num workspace para dar suporte, vendo o app
-- exatamente como o cliente vê. Como toda a RLS usa current_tenant_id() (lido de
-- profiles.tenant_id), a impersonação apenas troca temporariamente o tenant_id do
-- superadmin e guarda o estado para poder voltar. Roda após 0001. Idempotente.
-- ============================================================

-- flag: quando não-nulo, o superadmin está impersonando este workspace.
alter table public.profiles add column if not exists impersonating_tenant_id uuid references public.tenants(id) on delete set null;

-- ------------------------------------------------------------
-- RPC: iniciar impersonação (só superadmin). Guarda que está impersonando e
-- aponta o tenant_id do próprio perfil para o workspace-alvo.
-- ------------------------------------------------------------
create or replace function public.impersonate_start(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super boolean;
begin
  select is_superadmin into v_is_super from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin pode impersonar';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'workspace inexistente';
  end if;

  update public.profiles
     set impersonating_tenant_id = p_tenant,
         tenant_id = p_tenant,
         role = 'owner'
   where id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- RPC: encerrar impersonação. Limpa a flag e volta o tenant_id para nulo
-- (superadmin não pertence a nenhum workspace fora da impersonação).
-- ------------------------------------------------------------
create or replace function public.impersonate_stop()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super boolean;
begin
  select is_superadmin into v_is_super from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin';
  end if;

  update public.profiles
     set tenant_id = null,
         impersonating_tenant_id = null,
         role = 'owner'
   where id = auth.uid();
end;
$$;

grant execute on function public.impersonate_start(uuid) to authenticated;
grant execute on function public.impersonate_stop() to authenticated;

-- ============================================================
-- SEGURANÇA: as RPCs verificam is_superadmin server-side (SECURITY DEFINER).
-- Um usuário comum não consegue chamar (raise exception). A impersonação é
-- auditável pela coluna impersonating_tenant_id (não-nula = sessão de suporte ativa).
-- ============================================================
