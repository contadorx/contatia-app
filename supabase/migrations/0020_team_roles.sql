-- ============================================================
-- Contatia — Migration 0020 (Níveis de equipe no tenant)
-- Hierarquia funcional dentro do workspace, separada do papel de billing
-- (user_role = owner/partner). Roda depois de 0001-0019. Non-breaking.
-- ============================================================

alter table public.profiles add column if not exists team_role text
  check (team_role in ('admin', 'gestor', 'sdr', 'vendedor'));

-- owner vira admin por padrão; demais viram vendedor (ajustável na tela Equipe)
update public.profiles set team_role = 'admin'    where team_role is null and role = 'owner';
update public.profiles set team_role = 'vendedor' where team_role is null;

-- helper: o usuário atual é gestor/admin? (para telas de gestão)
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select team_role in ('admin','gestor') or role = 'owner'
       from public.profiles where id = auth.uid()),
    false
  );
$$;
