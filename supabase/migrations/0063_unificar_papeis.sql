-- ============================================================
-- Contatia — Migration 0063 (Unificação dos papéis de equipe)
--
-- Consolida o papel operacional em profiles.team_role (admin|gestor|sdr|vendedor).
-- O campo legado profiles.role passa a valer só como TITULARIDADE ('owner' vs
-- não-owner) — o app já decide tudo por effectiveRole()/team_role desde a revisão
-- da tela de Equipe (Fatia C). Esta migração faz o BACKFILL: quem só tinha o papel
-- no campo legado (ex.: um SDR criado antes de o team_role existir) recebe o
-- team_role equivalente, para o placar e as permissões ficarem corretos e nada mais
-- depender do valor legado de role.
--
-- NÃO altera o enum user_role nem os valores de role (zero risco de constraint).
-- Roda depois das anteriores. Idempotente. Non-breaking.
-- ============================================================

-- 1) SDR legado sem papel operacional definido → team_role 'sdr'
update public.profiles
   set team_role = 'sdr'
 where role = 'sdr'
   and (team_role is null or team_role = '');

-- 2) Qualquer não-owner ainda sem papel operacional → 'vendedor' (padrão seguro;
--    era exatamente o que o effectiveRole() já assumia por omissão)
update public.profiles
   set team_role = 'vendedor'
 where role <> 'owner'
   and (team_role is null or team_role = '');
