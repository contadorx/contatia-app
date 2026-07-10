-- ============================================================
-- Contatia — Migration 0035 (Base de conhecimento / FAQ)
-- Artigos de ajuda geridos pelo superadmin (plataforma), lidos por todos os workspaces.
-- Roda após 0001-0034.
-- ============================================================

create table if not exists public.kb_articles (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'Geral',
  body        text not null default '',
  keywords    text default '',            -- termos extras para a busca
  position    int not null default 0,     -- ordem dentro da categoria
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists kb_articles_pub_idx on public.kb_articles(published, category, position);

-- KB é conteúdo da plataforma: todos os autenticados LEEM os publicados; só superadmin ESCREVE.
alter table public.kb_articles enable row level security;

create policy kb_read on public.kb_articles for select
  using (published = true or public.is_superadmin());

create policy kb_write on public.kb_articles for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ============================================================
-- FLUXO: superadmin cria/edita artigos em /dashboard/superadmin/kb. Qualquer usuário abre o
-- modal de ajuda (botão flutuante em qualquer tela) → busca artigos por título/categoria/
-- keywords → lê inline; se não resolver, abre um chamado (support_tickets) dali mesmo.
-- ============================================================
