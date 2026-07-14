-- ============================================================
-- Contatia — Migration 0071 (Aceite de convite confere o e-mail) — M7
--
-- BUG M7: accept_invite validava só o token/validade; o casamento do e-mail estava
-- apenas na UI. Quem tivesse o link, logado com OUTRA conta, entrava no workspace via
-- action. Aqui a função passa a exigir que o e-mail do usuário logado seja o mesmo do
-- convite (comparação case-insensitive). Retorna 'email_mismatch' para a UI tratar.
--
-- Mantém todo o comportamento anterior (reassociação + limpeza de workspace órfão).
-- SECURITY DEFINER. Idempotente (create or replace). Roda depois das anteriores.
-- ============================================================

create or replace function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  inv record;
  v_old_tenant uuid;
  v_email text;
begin
  select * into inv from public.tenant_invites
    where token = p_token and accepted_at is null and expires_at > now();
  if not found then return 'invalid'; end if;

  -- e-mail do usuário logado (do JWT) precisa casar com o do convite
  v_email := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  if inv.email is not null and lower(inv.email) <> v_email then
    return 'email_mismatch';
  end if;

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
