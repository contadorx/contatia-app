-- ============================================================
-- Contatia — Migration 0051 (Papéis, agenda compartilhada e tetos de plano)
--
-- 1) PAPÉIS: admin (dono) · vendedor · sdr
--    O enum antigo tinha owner/partner. Mantemos os valores antigos para não
--    quebrar nada e adicionamos 'sdr'. Mapa mental:
--      owner   = Admin (dono da conta)
--      partner = Vendedor (trabalha a própria carteira)
--      sdr     = SDR (prospecta e AGENDA para os vendedores)
--
-- 2) AGENDA COMPARTILHADA: o SDR só marca na agenda de um vendedor se houver
--    permissão — concedida pelo ADMIN ou pelo PRÓPRIO VENDEDOR.
--
-- 3) TETO DE USUÁRIOS POR PLANO: Essencial 2 · Profissional 5 · Time ilimitado.
--    Ao bater no teto, o app sugere o plano adequado (não bloqueia em silêncio).
--
-- Roda depois das anteriores. Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) PAPEL NOVO: sdr
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_role' and e.enumlabel = 'sdr'
  ) then
    alter type user_role add value 'sdr';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) PERMISSÕES DE AGENDA
--    Uma linha = "o SDR X pode agendar na agenda do vendedor Y".
--    granted_by registra QUEM liberou (o admin ou o próprio vendedor).
-- ------------------------------------------------------------
create table if not exists public.calendar_permissions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  sdr_id       uuid not null references public.profiles(id) on delete cascade,   -- quem agenda
  seller_id    uuid not null references public.profiles(id) on delete cascade,   -- dono da agenda
  can_view     boolean not null default true,
  can_book     boolean not null default true,
  granted_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create unique index if not exists calperm_unique on public.calendar_permissions(sdr_id, seller_id);
create index if not exists calperm_tenant_idx on public.calendar_permissions(tenant_id);

alter table public.calendar_permissions enable row level security;

-- leitura: qualquer membro do workspace vê as permissões do próprio workspace
drop policy if exists calperm_read on public.calendar_permissions;
create policy calperm_read on public.calendar_permissions for select
  using (tenant_id = public.current_tenant_id());

-- escrita: o ADMIN (owner) libera para qualquer um;
--          o VENDEDOR pode liberar/revogar a PRÓPRIA agenda.
drop policy if exists calperm_write on public.calendar_permissions;
create policy calperm_write on public.calendar_permissions for all
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or seller_id = auth.uid())
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (public.current_user_role() = 'owner' or seller_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 3) TETOS DE USUÁRIO POR PLANO (2 / 5 / ilimitado)
-- ------------------------------------------------------------
update public.platform_plans set max_seats = 2    where name = 'Essencial';
update public.platform_plans set max_seats = 5    where name = 'Profissional';
update public.platform_plans set max_seats = null where name = 'Time';   -- null = ilimitado

-- ------------------------------------------------------------
-- RPC: quantos usuários cabem e qual plano é o adequado.
-- Usada na tela de Equipe para sugerir o upgrade certo antes de bloquear.
-- ------------------------------------------------------------
create or replace function public.seat_check()
returns table (
  usuarios_atuais bigint,
  teto integer,
  plano_atual text,
  plano_sugerido text,
  pode_adicionar boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_count bigint;
  v_max int;
  v_plan text;
  v_sug text;
begin
  select tenant_id into v_tenant from public.profiles where id = auth.uid();
  if v_tenant is null then
    return;
  end if;

  select count(*) into v_count
    from public.profiles
   where tenant_id = v_tenant and coalesce(is_active, true);

  select pp.name, pp.max_seats into v_plan, v_max
    from public.tenants t
    left join public.platform_plans pp on pp.id = t.plan_id
   where t.id = v_tenant;

  -- sem plano definido: trata como o menor
  if v_plan is null then
    select name, max_seats into v_plan, v_max
      from public.platform_plans where is_active order by sort limit 1;
  end if;

  -- qual o menor plano que comporta MAIS UM usuário?
  select pp.name into v_sug
    from public.platform_plans pp
   where pp.is_active
     and (pp.max_seats is null or pp.max_seats >= v_count + 1)
   order by pp.sort
   limit 1;

  return query select
    v_count,
    v_max,
    v_plan,
    v_sug,
    (v_max is null or v_count < v_max);
end;
$$;

grant execute on function public.seat_check() to authenticated;

-- ============================================================
-- COMO O APP USA:
-- - Equipe: antes de convidar, chama seat_check(). Se pode_adicionar = false,
--   mostra "Seu plano X comporta N usuários. Para adicionar mais, mude para Y."
-- - Agenda: o SDR vê/agenda nas agendas em calendar_permissions.
-- - Cobrança: o valor continua sendo preço_do_plano × usuários ativos.
-- ============================================================
