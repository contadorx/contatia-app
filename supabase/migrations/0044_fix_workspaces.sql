-- ============================================================
-- Contatia — Migration 0044 (Correção do provisionamento de workspace)
-- Corrige dois problemas do 0043:
-- (1) o backfill EXCLUÍA superadmins → a conta do dono ficava sem workspace;
-- (2) o backfill não tinha tratamento de erro → um único registro problemático
--     abortava o bloco inteiro (atômico), deixando TODOS sem workspace.
-- Agora: provisiona TODAS as contas sem workspace (inclusive superadmin), com
-- tratamento de erro POR LINHA, e imprime diagnóstico antes/depois no output.
-- O impersonar passa a preservar o workspace de origem. Roda após 0043. Idempotente.
-- ============================================================

-- coluna para guardar o workspace do superadmin enquanto ele impersona outro
alter table public.profiles add column if not exists pre_impersonation_tenant_id uuid references public.tenants(id) on delete set null;

-- ------------------------------------------------------------
-- DIAGNÓSTICO (aparece nas mensagens/Notices do editor SQL do Supabase)
-- ------------------------------------------------------------
do $$
declare
  v_total int; v_sem_ws int; v_super_sem_ws int; v_tenants int;
begin
  select count(*) into v_total from public.profiles;
  select count(*) into v_sem_ws from public.profiles where tenant_id is null;
  select count(*) into v_super_sem_ws from public.profiles where tenant_id is null and coalesce(is_superadmin,false)=true;
  select count(*) into v_tenants from public.tenants;
  raise notice '=== ANTES: % perfis, % sem workspace (% superadmin), % workspaces ===',
    v_total, v_sem_ws, v_super_sem_ws, v_tenants;
end $$;

-- ------------------------------------------------------------
-- BACKFILL ROBUSTO: cria workspace para TODA conta sem workspace.
-- Cada linha num bloco próprio: se uma falhar, as outras seguem.
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_tid uuid;
  v_nome text;
  v_ok int := 0;
  v_fail int := 0;
begin
  for r in
    select p.id, p.email, p.full_name
    from public.profiles p
    where p.tenant_id is null
  loop
    begin
      v_nome := coalesce(
        nullif(btrim(r.full_name), ''),
        nullif(split_part(coalesce(r.email,''), '@', 1), ''),
        'usuário'
      );

      insert into public.tenants (name) values ('Workspace de ' || v_nome) returning id into v_tid;

      update public.profiles set tenant_id = v_tid, role = 'owner' where id = r.id;

      insert into public.pipeline_stages (tenant_id, name, position, is_won, is_lost) values
        (v_tid, 'Novo', 0, false, false),
        (v_tid, 'Contatado', 1, false, false),
        (v_tid, 'Respondeu', 2, false, false),
        (v_tid, 'Reunião', 3, false, false),
        (v_tid, 'Proposta', 4, false, false),
        (v_tid, 'Fechado', 5, true, false),
        (v_tid, 'Perdido', 6, false, true);

      v_ok := v_ok + 1;
    exception when others then
      -- não deixa um registro problemático derrubar os demais
      v_fail := v_fail + 1;
      raise notice 'falha ao provisionar profile %: %', r.id, sqlerrm;
    end;
  end loop;

  raise notice '=== BACKFILL: % workspaces criados, % falhas ===', v_ok, v_fail;
end $$;

-- diagnóstico final
do $$
declare v_sem_ws int; v_tenants int;
begin
  select count(*) into v_sem_ws from public.profiles where tenant_id is null;
  select count(*) into v_tenants from public.tenants;
  raise notice '=== DEPOIS: % sem workspace, % workspaces no total ===', v_sem_ws, v_tenants;
end $$;

-- ------------------------------------------------------------
-- TRIGGER: reforça o auto-provisionamento no cadastro. Agora o superadmin também
-- recebe workspace próprio (não é mais exceção). Convidados entram no destino.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_name text;
  v_company text;
begin
  if exists (select 1 from public.profiles where id = new.id and tenant_id is not null) then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
                     nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'novo usuário');
  v_company := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'company'), ''),
    nullif(btrim(new.raw_user_meta_data->>'workspace'), ''),
    'Workspace de ' || v_name
  );

  -- convidado: entra no workspace de destino como partner
  if (new.raw_user_meta_data ? 'invite_tenant_id')
     and nullif(btrim(new.raw_user_meta_data->>'invite_tenant_id'), '') is not null then
    insert into public.profiles (id, email, full_name, role, tenant_id)
    values (new.id, new.email, v_name, 'partner', (new.raw_user_meta_data->>'invite_tenant_id')::uuid)
    on conflict (id) do update set tenant_id = excluded.tenant_id, full_name = excluded.full_name;
    return new;
  end if;

  -- fluxo normal: cria workspace e vira owner
  insert into public.tenants (name) values (v_company) returning id into v_tenant_id;

  insert into public.profiles (id, email, full_name, role, tenant_id)
  values (new.id, new.email, v_name, 'owner', v_tenant_id)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id, role = 'owner', full_name = excluded.full_name;

  insert into public.pipeline_stages (tenant_id, name, position, is_won, is_lost) values
    (v_tenant_id, 'Novo', 0, false, false),
    (v_tenant_id, 'Contatado', 1, false, false),
    (v_tenant_id, 'Respondeu', 2, false, false),
    (v_tenant_id, 'Reunião', 3, false, false),
    (v_tenant_id, 'Proposta', 4, false, false),
    (v_tenant_id, 'Fechado', 5, true, false),
    (v_tenant_id, 'Perdido', 6, false, true);

  return new;
end $$;

-- ------------------------------------------------------------
-- IMPERSONAR: agora que o superadmin tem workspace próprio, ao sair ele volta
-- para o workspace de origem (não mais para null).
-- ------------------------------------------------------------
create or replace function public.impersonate_start(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super boolean;
  v_current uuid;
  v_already uuid;
begin
  select is_superadmin, tenant_id, impersonating_tenant_id
    into v_is_super, v_current, v_already
    from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin pode impersonar';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'workspace inexistente';
  end if;

  update public.profiles
     set -- só guarda a origem na PRIMEIRA vez (evita perder o home ao trocar de alvo)
         pre_impersonation_tenant_id = case when v_already is null then v_current else pre_impersonation_tenant_id end,
         impersonating_tenant_id = p_tenant,
         tenant_id = p_tenant,
         role = 'owner'
   where id = auth.uid();
end;
$$;

create or replace function public.impersonate_stop()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_super boolean;
  v_home uuid;
begin
  select is_superadmin, pre_impersonation_tenant_id
    into v_is_super, v_home
    from public.profiles where id = auth.uid();
  if not coalesce(v_is_super, false) then
    raise exception 'apenas superadmin';
  end if;

  update public.profiles
     set tenant_id = v_home,               -- volta ao workspace de origem
         impersonating_tenant_id = null,
         pre_impersonation_tenant_id = null,
         role = 'owner'
   where id = auth.uid();
end;
$$;

grant execute on function public.impersonate_start(uuid) to authenticated;
grant execute on function public.impersonate_stop() to authenticated;
