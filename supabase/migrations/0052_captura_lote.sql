-- ============================================================
-- Contatia — Migration 0052 (Ponte LinkedIn ↔ Receita)
--
-- A IDEIA: o LinkedIn diz QUEM é o decisor, mas não dá e-mail nem domínio.
-- A base da Receita (radar_leads) tem CNPJ, telefone, e-mail e razão social —
-- mas não sabe quem decide. Esta função CASA os dois: dado o nome da empresa
-- que veio do LinkedIn, encontra a empresa real e devolve seus dados.
--
-- Com isso, a captura em lote deixa de produzir "nomes soltos" e passa a
-- produzir leads completos.
--
-- Roda depois das anteriores. Idempotente.
-- ============================================================

-- extensão para busca por semelhança (nome do LinkedIn raramente é igual à razão social)
create extension if not exists pg_trgm;

create index if not exists radar_razao_trgm on public.radar_leads using gin (razao_social gin_trgm_ops);
create index if not exists radar_fantasia_trgm on public.radar_leads using gin (nome_fantasia gin_trgm_ops);

-- ------------------------------------------------------------
-- Busca a empresa na base da Receita pelo nome vindo do LinkedIn.
-- Compara com razão social E nome fantasia, por semelhança, e devolve as
-- melhores candidatas ordenadas por parecença.
-- ------------------------------------------------------------
create or replace function public.match_company(p_nome text, p_limite int default 5)
returns table (
  id uuid,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  email text,
  telefone text,
  contato_principal text,
  municipio text,
  uf text,
  porte text,
  cnae text,
  semelhanca real
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_nome text;
begin
  select pr.tenant_id into v_tenant from public.profiles pr where pr.id = auth.uid();
  if v_tenant is null then return; end if;

  v_nome := btrim(coalesce(p_nome, ''));
  if length(v_nome) < 3 then return; end if;

  return query
  select r.id, r.cnpj, r.razao_social, r.nome_fantasia, r.email, r.telefone,
         r.contato_principal, r.municipio, r.uf, r.porte, r.cnae,
         greatest(
           similarity(coalesce(r.razao_social, ''), v_nome),
           similarity(coalesce(r.nome_fantasia, ''), v_nome)
         ) as sem
    from public.radar_leads r
   where r.tenant_id = v_tenant
     and (
       r.razao_social  ilike '%' || v_nome || '%'
       or r.nome_fantasia ilike '%' || v_nome || '%'
       or similarity(coalesce(r.razao_social, ''), v_nome) > 0.3
       or similarity(coalesce(r.nome_fantasia, ''), v_nome) > 0.3
     )
   order by sem desc
   limit greatest(1, least(p_limite, 20));
end;
$$;

grant execute on function public.match_company(text, int) to authenticated;

-- ------------------------------------------------------------
-- Captura em lote: guarda o que veio da tela (Sales Navigator, busca, etc.)
-- para o usuário revisar, enriquecer e só então importar.
-- ------------------------------------------------------------
create table if not exists public.capture_batches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  source      text not null default 'linkedin',   -- linkedin | sales_navigator | site
  items       jsonb not null default '[]',        -- [{name, role, company, domain, cnpj, linkedin_url, status}]
  status      text not null default 'draft',      -- draft | imported
  created_at  timestamptz not null default now(),
  imported_at timestamptz
);

create index if not exists capture_batches_tenant_idx on public.capture_batches(tenant_id, created_at desc);

alter table public.capture_batches enable row level security;

drop policy if exists capture_batches_all on public.capture_batches;
create policy capture_batches_all on public.capture_batches for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- FLUXO DA CAPTURA EM LOTE:
-- 1. Extensão captura os cards da lista (nome, cargo, empresa, URL).
-- 2. Cria um "lote" (capture_batches) e abre a tela de revisão no app.
-- 3. Na revisão, o app roda match_company() para CADA empresa → traz CNPJ,
--    telefone, e-mail e (quando houver) o site → o domínio.
-- 4. O usuário confere, ajusta e importa. Quem tiver domínio entra na fila de
--    descoberta de e-mail; quem não tiver, segue por WhatsApp.
-- ============================================================
