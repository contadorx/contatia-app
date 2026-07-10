-- ============================================================
-- Contatia — Migration 0019 (Superadmin da plataforma)
-- Marca o dono do Contatia (Leandro) para a visão de plataforma sobre todos os
-- tenants. Roda depois de 0001-0018. Non-breaking.
-- ============================================================

alter table public.profiles add column if not exists is_superadmin boolean not null default false;

-- helper para uso futuro em policies/telas
create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================
-- BOOTSTRAP (rode UMA vez no Supabase, com seu próprio id de auth):
--   update public.profiles set is_superadmin = true where email = 'SEU_EMAIL';
-- A tela /superadmin lê os dados de TODOS os tenants via service role (server),
-- protegida por esta flag. Nenhuma policy de tabela é afrouxada.
-- ============================================================
