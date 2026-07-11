-- ============================================================
-- Contatia — Migration 0045 (REPARO DEFINITIVO de contas sem workspace)
-- O furo que faltava: os backfills anteriores varriam apenas public.profiles.
-- Se o usuário se cadastrou ANTES do trigger existir (ou o trigger falhou), a linha
-- em public.profiles NUNCA foi criada — então o backfill não tinha o que consertar,
-- e o app, sem profile, mostra "conta sem workspace" para sempre.
-- Esta migration varre auth.users (a fonte da verdade do login) e garante que TODO
-- usuário tenha profile + workspace + pipeline. Tratamento de erro por linha.
-- Idempotente: rodar de novo não duplica nada.
-- ============================================================

-- ------------------------------------------------------------
-- DIAGNÓSTICO ANTES
-- ------------------------------------------------------------
do $$
declare v_users int; v_profiles int; v_sem_profile int; v_sem_ws int;
begin
  select count(*) into v_users from auth.users;
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_sem_profile from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id);
  select count(*) into v_sem_ws from public.profiles where tenant_id is null;
  raise notice '=== ANTES: % usuários logáveis | % profiles | % SEM PROFILE | % sem workspace ===',
    v_users, v_profiles, v_sem_profile, v_sem_ws;
end $$;

-- ------------------------------------------------------------
-- REPARO: para cada usuário de auth.users, garante profile + workspace + pipeline
-- ------------------------------------------------------------
do $$
declare
  u record;
  v_tid uuid;
  v_nome text;
  v_empresa text;
  v_criou_profile int := 0;
  v_criou_ws int := 0;
  v_falhas int := 0;
begin
  for u in select id, email, raw_user_meta_data from auth.users loop
    begin
      v_nome := coalesce(
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(split_part(coalesce(u.email,''), '@', 1), ''),
        'usuário'
      );
      v_empresa := coalesce(
        nullif(btrim(u.raw_user_meta_data->>'company'), ''),
        'Workspace de ' || v_nome
      );

      -- 1) profile não existe? cria (sem workspace ainda)
      if not exists (select 1 from public.profiles p where p.id = u.id) then
        insert into public.profiles (id, email, full_name, role)
        values (u.id, u.email, v_nome, 'owner');
        v_criou_profile := v_criou_profile + 1;
      end if;

      -- 2) profile sem workspace? cria o workspace e vincula como owner
      if exists (select 1 from public.profiles p where p.id = u.id and p.tenant_id is null) then
        insert into public.tenants (name) values (v_empresa) returning id into v_tid;

        update public.profiles
           set tenant_id = v_tid,
               role = 'owner',
               email = coalesce(email, u.email),
               full_name = coalesce(nullif(btrim(full_name), ''), v_nome)
         where id = u.id;

        insert into public.pipeline_stages (tenant_id, name, position, is_won, is_lost) values
          (v_tid, 'Novo', 0, false, false),
          (v_tid, 'Contatado', 1, false, false),
          (v_tid, 'Respondeu', 2, false, false),
          (v_tid, 'Reunião', 3, false, false),
          (v_tid, 'Proposta', 4, false, false),
          (v_tid, 'Fechado', 5, true, false),
          (v_tid, 'Perdido', 6, false, true);

        v_criou_ws := v_criou_ws + 1;
      end if;

    exception when others then
      v_falhas := v_falhas + 1;
      raise notice 'FALHA no usuário % (%): %', u.id, u.email, sqlerrm;
    end;
  end loop;

  raise notice '=== REPARO: % profiles criados | % workspaces criados | % falhas ===',
    v_criou_profile, v_criou_ws, v_falhas;
end $$;

-- ------------------------------------------------------------
-- DIAGNÓSTICO DEPOIS (o que você deve ver: 0 sem profile, 0 sem workspace)
-- ------------------------------------------------------------
do $$
declare v_sem_profile int; v_sem_ws int; v_tenants int;
begin
  select count(*) into v_sem_profile from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id);
  select count(*) into v_sem_ws from public.profiles where tenant_id is null;
  select count(*) into v_tenants from public.tenants;
  raise notice '=== DEPOIS: % sem profile | % sem workspace | % workspaces ===',
    v_sem_profile, v_sem_ws, v_tenants;
end $$;

-- ------------------------------------------------------------
-- CONFERÊNCIA FINAL (esta tabela aparece como resultado no SQL Editor):
-- toda conta deve mostrar tem_profile = true e tem_workspace = true.
-- ------------------------------------------------------------
select
  u.email,
  (p.id is not null)                                   as tem_profile,
  (p.tenant_id is not null)                            as tem_workspace,
  p.role,
  coalesce(p.is_superadmin, false)                     as superadmin,
  (select t.name from public.tenants t where t.id = p.tenant_id) as workspace
from auth.users u
left join public.profiles p on p.id = u.id
order by tem_workspace, u.email;
