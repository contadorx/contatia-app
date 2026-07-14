-- ============================================================
-- Contatia — Migration 0075 (Impersonação restaura o tenant original) — M13
--
-- BUG M13: impersonate_start sobrescrevia tenant_id com o alvo sem guardar o original, e
-- impersonate_stop zerava tenant_id. Um superadmin que TAMBÉM é dono de um workspace
-- perdia o vínculo com o próprio workspace ao sair do modo suporte. Aqui usamos a coluna
-- pre_impersonation_tenant_id (já existente) para guardar e restaurar.
--
-- SECURITY DEFINER. Idempotente. Roda depois das anteriores.
-- ============================================================

create or replace function public.impersonate_start(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_super boolean;
  v_current  uuid;
begin
  select is_superadmin, tenant_id into v_is_super, v_current from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin pode impersonar';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'workspace inexistente';
  end if;

  update public.profiles
     set pre_impersonation_tenant_id = coalesce(pre_impersonation_tenant_id, v_current),
         impersonating_tenant_id = p_tenant,
         tenant_id = p_tenant,
         role = 'owner'
   where id = auth.uid();
end;
$$;

create or replace function public.impersonate_stop()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_super boolean;
  v_prev     uuid;
begin
  select is_superadmin, pre_impersonation_tenant_id into v_is_super, v_prev from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin';
  end if;

  update public.profiles
     set tenant_id = v_prev,                    -- volta ao workspace original (ou null)
         impersonating_tenant_id = null,
         pre_impersonation_tenant_id = null,
         role = 'owner'
   where id = auth.uid();
end;
$$;

grant execute on function public.impersonate_start(uuid) to authenticated;
grant execute on function public.impersonate_stop() to authenticated;
