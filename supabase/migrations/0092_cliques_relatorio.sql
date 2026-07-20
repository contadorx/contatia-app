-- ============================================================
-- Contatia — Migration 0092 (Relatório de cliques: por vendedor + volume)
--
-- Move a agregação de cliques para o BANCO (SUM/COUNT/GROUP BY) em vez de puxar
-- milhares de linhas para o app. Escala para qualquer volume. Filtro opcional por
-- DONO (contacts.assigned_to) para o relatório por vendedor.
--
-- As funções são SECURITY INVOKER (padrão): rodam com a permissão do usuário, então
-- a RLS de link_clicks/contacts já garante o isolamento por tenant. O filtro por dono
-- é adicional.
--
-- Roda depois de 0001-0091. Idempotente. Non-breaking.
-- ============================================================

-- índices para as agregações/ordenered por volume
create index if not exists link_clicks_contact_idx    on public.link_clicks(contact_id);
create index if not exists link_clicks_firstclick_idx on public.link_clicks(tenant_id, first_click_at desc);

-- Totais de clique (opcional por dono e por período de 1º clique)
create or replace function public.link_click_totais(p_since timestamptz, p_owner uuid)
returns table(rastreados bigint, clicados bigint, cliques bigint, cliques_periodo bigint)
language sql stable as $$
  select
    count(*)::bigint,
    count(*) filter (where lc.clicks > 0)::bigint,
    coalesce(sum(lc.clicks) filter (where lc.clicks > 0), 0)::bigint,
    coalesce(sum(lc.clicks) filter (where lc.clicks > 0 and lc.first_click_at >= p_since), 0)::bigint
  from public.link_clicks lc
  left join public.contacts c on c.id = lc.contact_id
  where (p_owner is null or c.assigned_to = p_owner);
$$;

-- Top links por total de cliques (opcional por dono)
create or replace function public.link_click_top(p_owner uuid, p_limit int)
returns table(url text, cliques bigint)
language sql stable as $$
  select lc.url, sum(lc.clicks)::bigint as cliques
  from public.link_clicks lc
  left join public.contacts c on c.id = lc.contact_id
  where lc.clicks > 0
    and (p_owner is null or c.assigned_to = p_owner)
  group by lc.url
  order by cliques desc
  limit coalesce(p_limit, 15);
$$;
