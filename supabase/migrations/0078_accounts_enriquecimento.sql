-- ============================================================
-- Contatia — Migration 0078 (Empresas: campos de enriquecimento)
--
-- A ficha da empresa passa a guardar e-mail, endereço completo e mais dados vindos
-- do enriquecimento (base da Receita + BrasilAPI). Sócios, capital, natureza e data
-- de abertura continuam no jsonb `custom` (menos centrais), o resto vira coluna.
--
-- Idempotente. Roda depois das anteriores.
-- ============================================================

alter table public.accounts add column if not exists email          text;
alter table public.accounts add column if not exists cep            text;
alter table public.accounts add column if not exists bairro         text;
alter table public.accounts add column if not exists logradouro     text;
alter table public.accounts add column if not exists numero         text;
alter table public.accounts add column if not exists complemento    text;
alter table public.accounts add column if not exists situacao       text;   -- ATIVA / BAIXADA / …
alter table public.accounts add column if not exists cnae_descricao text;

-- (municipio, uf, cnae, porte, phone, domain, website, custom já existem)
