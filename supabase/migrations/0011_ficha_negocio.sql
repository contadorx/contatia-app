-- ============================================================
-- Contatia — Migration 0011 (Ficha do negócio + marca white-label)
-- Dados de identidade e marca no tenant. Roda depois de 0001-0010. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists legal_name   text;   -- razão social / nome do negócio exibido
alter table public.tenants add column if not exists cnpj         text;
alter table public.tenants add column if not exists segment      text;   -- segmento (wedge): contabil, advocacia, consultoria...
alter table public.tenants add column if not exists contact_email text;
alter table public.tenants add column if not exists phone        text;
alter table public.tenants add column if not exists website      text;
alter table public.tenants add column if not exists logo_url     text;   -- marca white-label
alter table public.tenants add column if not exists brand_color  text;   -- hex, ex.: #4A3AFF

-- ============================================================
-- RLS: a policy de UPDATE do tenant precisa permitir o owner editar a ficha.
-- 0001 já tem SELECT (id = current_tenant_id()). Garantimos o UPDATE do owner:
-- ============================================================
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='tenants' and policyname='tenants_update_owner'
  ) then
    create policy tenants_update_owner on public.tenants for update
      using (id = public.current_tenant_id() and public.current_user_role() = 'owner')
      with check (id = public.current_tenant_id() and public.current_user_role() = 'owner');
  end if;
end $$;
