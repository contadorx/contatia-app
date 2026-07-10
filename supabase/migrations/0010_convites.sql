-- ============================================================
-- Contatia — Migration 0010 (Convite de equipe por link)
-- Owner convida por e-mail → gera link com token (14 dias) → pessoa cria conta,
-- abre o link e entra no workspace. Roda depois de 0001-0009.
-- ============================================================

create table if not exists public.tenant_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null,
  role        public.user_role not null default 'partner',
  token       text unique not null default replace(gen_random_uuid()::text, '-', ''),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists tenant_invites_tenant_idx on public.tenant_invites(tenant_id);

alter table public.tenant_invites enable row level security;

-- só o owner do tenant gerencia os convites do próprio workspace
create policy tenant_invites_all on public.tenant_invites for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner');

-- info do convite (nome do workspace) para exibir antes do aceite — só logado
create or replace function public.invite_info(p_token text)
returns table(tenant_name text, invited_email text, valid boolean)
language sql security definer set search_path = public as $$
  select t.name, i.email, (i.accepted_at is null and i.expires_at > now())
  from public.tenant_invites i
  join public.tenants t on t.id = i.tenant_id
  where i.token = p_token;
$$;

-- aceite: entra o usuário logado no tenant do convite
create or replace function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  select * into inv from public.tenant_invites
    where token = p_token and accepted_at is null and expires_at > now();
  if not found then return 'invalid'; end if;

  update public.profiles
    set tenant_id = inv.tenant_id, role = inv.role, is_active = true
    where id = auth.uid();
  update public.tenant_invites set accepted_at = now() where id = inv.id;
  return 'ok';
end $$;

revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
