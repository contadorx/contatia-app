-- ============================================================
-- Contatia — Migration 0043 (Auto-provisionar workspace no cadastro)
-- BUG CRÍTICO corrigido: o trigger handle_new_user (0001) criava só o profile,
-- sem tenant e como 'partner'. A criação do workspace dependia de um bloco SEED
-- manual — o que travava TODO cliente novo na tela "Conta ainda sem workspace".
-- Agora cada cadastro provisiona o workspace completo automaticamente:
-- tenant + profile owner + estágios de pipeline. Roda após 0001. Idempotente.
-- ============================================================

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
  -- já tem profile com workspace? (reexecução / usuário convidado) → não mexe
  if exists (select 1 from public.profiles where id = new.id and tenant_id is not null) then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'novo usuário');
  -- nome do workspace: o que o usuário informou, ou a empresa, ou "Workspace de <nome>"
  v_company := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'company'), ''),
    nullif(btrim(new.raw_user_meta_data->>'workspace'), ''),
    'Workspace de ' || coalesce(nullif(btrim(v_name), ''), 'novo usuário')
  );

  -- se o usuário foi CONVIDADO (metadata traz invite_tenant_id), entra no workspace
  -- existente como partner em vez de criar um novo.
  if (new.raw_user_meta_data ? 'invite_tenant_id')
     and nullif(btrim(new.raw_user_meta_data->>'invite_tenant_id'), '') is not null then
    insert into public.profiles (id, email, full_name, role, tenant_id)
    values (new.id, new.email, v_name, 'partner', (new.raw_user_meta_data->>'invite_tenant_id')::uuid)
    on conflict (id) do update set tenant_id = excluded.tenant_id, full_name = excluded.full_name;
    return new;
  end if;

  -- fluxo normal: cria um workspace novo e torna o usuário owner
  insert into public.tenants (name) values (v_company) returning id into v_tenant_id;

  insert into public.profiles (id, email, full_name, role, tenant_id)
  values (new.id, new.email, v_name, 'owner', v_tenant_id)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id, role = 'owner', full_name = excluded.full_name;

  -- estágios iniciais do pipeline (o funil-padrão)
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

-- o trigger em si já existe (0001); a função nova substitui o comportamento.

-- ------------------------------------------------------------
-- BACKFILL: conserta quem JÁ se cadastrou e ficou sem workspace (exceto superadmin,
-- que não deve ter workspace próprio). Cria o workspace retroativo para cada um.
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_tid uuid;
begin
  for r in
    select p.id, p.email, p.full_name
    from public.profiles p
    where p.tenant_id is null
      and coalesce(p.is_superadmin, false) = false
  loop
    insert into public.tenants (name)
    values ('Workspace de ' || coalesce(nullif(btrim(r.full_name), ''), nullif(split_part(coalesce(r.email,''), '@', 1), ''), r.id::text))
    returning id into v_tid;

    update public.profiles set tenant_id = v_tid, role = 'owner' where id = r.id;

    insert into public.pipeline_stages (tenant_id, name, position, is_won, is_lost) values
      (v_tid, 'Novo', 0, false, false),
      (v_tid, 'Contatado', 1, false, false),
      (v_tid, 'Respondeu', 2, false, false),
      (v_tid, 'Reunião', 3, false, false),
      (v_tid, 'Proposta', 4, false, false),
      (v_tid, 'Fechado', 5, true, false),
      (v_tid, 'Perdido', 6, false, true);
  end loop;
end $$;

-- ------------------------------------------------------------
-- CONVITE: como agora todo cadastro cria um workspace próprio, um usuário que se
-- cadastra e DEPOIS aceita um convite deixa para trás um workspace órfão (vazio,
-- do qual ele era o único membro). O accept_invite passa a remover esse órfão ao
-- reassociar o convidado ao workspace de destino.
-- ------------------------------------------------------------
create or replace function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  inv record;
  v_old_tenant uuid;
begin
  select * into inv from public.tenant_invites
    where token = p_token and accepted_at is null and expires_at > now();
  if not found then return 'invalid'; end if;

  -- workspace atual do convidado (o órfão criado no cadastro, se for o caso)
  select tenant_id into v_old_tenant from public.profiles where id = auth.uid();

  update public.profiles
    set tenant_id = inv.tenant_id, role = inv.role, is_active = true
    where id = auth.uid();
  update public.tenant_invites set accepted_at = now() where id = inv.id;

  -- remove o workspace antigo se ele ficou sem nenhum membro (evita órfãos vazios)
  if v_old_tenant is not null and v_old_tenant <> inv.tenant_id then
    if not exists (select 1 from public.profiles where tenant_id = v_old_tenant) then
      delete from public.tenants where id = v_old_tenant;
    end if;
  end if;

  return 'ok';
end $$;

grant execute on function public.accept_invite(text) to authenticated;
