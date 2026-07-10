-- ============================================================
-- Contatia — Migration 0005 (Web-to-lead)
-- Token público por workspace para o formulário de captação criar contatos.
-- Roda depois de 0001-0004. Non-breaking.
-- ============================================================

alter table public.tenants add column if not exists inbound_token text;

-- gera token para tenants existentes que ainda não têm
update public.tenants
set inbound_token = replace(gen_random_uuid()::text, '-', '')
where inbound_token is null;

create unique index if not exists tenants_inbound_token_idx on public.tenants(inbound_token);

-- ============================================================
-- NOTA: o endpoint público /api/inbound/{token} usa a SERVICE ROLE KEY (mesma
-- do rastreio de propostas) para inserir o contato fora do RLS. O token NÃO é
-- segredo forte (só cria leads) — se precisar, regenere via SQL/UI. Rate-limit
-- e anti-spam ficam para uma fatia futura.
-- ============================================================
